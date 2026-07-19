import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  isMainModule,
  resolveApiUrl,
  resolveAgentContext,
  runCli,
  stateFileFor,
} from "./humhum-hexa.mjs";

test("recognizes execution through a symlinked path", async () => {
  const root = await mkdtemp(join(tmpdir(), "humhum-hexa-entry-"));
  const script = fileURLToPath(new URL("./humhum-hexa.mjs", import.meta.url));
  const alias = join(root, "humhum-hexa");
  await symlink(script, alias);
  assert.equal(isMainModule(alias, new URL("./humhum-hexa.mjs", import.meta.url).href), true);
  assert.equal(isMainModule(fileURLToPath(import.meta.url), new URL("./humhum-hexa.mjs", import.meta.url).href), false);
});

test("never sends the local API token outside loopback", () => {
  assert.equal(resolveApiUrl(), "http://127.0.0.1:31275");
  assert.equal(resolveApiUrl("http://127.0.0.1:39999/"), "http://127.0.0.1:39999");
  assert.throws(() => resolveApiUrl("https://example.com/collect"), /loopback/);
  assert.throws(() => resolveApiUrl("http://127.0.0.1:31275/proxy"), /loopback/);
  assert.throws(() => resolveApiUrl("http://user:pass@127.0.0.1:31275"), /loopback/);
});

test("resolves a real provider session before using the fallback", () => {
  assert.deepEqual(
    resolveAgentContext({}, {
      CODEX_THREAD_ID: " codex-real-thread ",
      CLAUDE_SESSION_ID: "claude-other",
    }),
    { provider: "codex", agent: "codex", sessionId: "codex-real-thread" },
  );
  assert.deepEqual(
    resolveAgentContext(
      { provider: "qoder", agent: "qoder", sessionId: "explicit-session" },
      { CODEX_THREAD_ID: "ignored" },
    ),
    { provider: "qoder", agent: "qoder", sessionId: "explicit-session" },
  );
});

test("keeps real session state outside the project and uses an opaque filename", () => {
  const home = "/Users/example";
  const file = stateFileFor({
    home,
    cwd: "/work/repo",
    provider: "codex",
    sessionId: "../unsafe/session",
  });
  assert.equal(dirname(file), join(home, ".humhum", "hexa", "sessions"));
  assert.match(basename(file), /^codex-[a-f0-9]{32}\.json$/);
  assert.equal(file.includes("unsafe"), false);

  const fallback = stateFileFor({
    home,
    cwd: "/work/repo",
    provider: "agent",
    sessionId: null,
  });
  assert.equal(dirname(fallback), join(home, ".humhum", "hexa", "workspaces"));
  assert.match(basename(fallback), /^agent-[a-f0-9]{32}\.json$/);
});

test("runs every command from a non-HUMHUM project with per-session state", async () => {
  const root = await mkdtemp(join(tmpdir(), "humhum-hexa-cli-"));
  const home = join(root, "home");
  const cwd = join(root, "other-project");
  await mkdir(join(home, ".humhum"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(join(home, ".humhum", "local-api-token"), "test-token\n");

  const calls = [];
  let session = {
    session_id: "thread-123",
    provider: "codex",
    agent: "codex",
    name: "修好跨项目监控",
    goal: "修好跨项目监控",
    status: "working",
    audit: { work_items: [], milestones: [] },
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const path = new URL(url).pathname;
    calls.push({ path, body, token: init.headers["x-humhum-token"] });
    if (path === "/hexa/register") {
      session = { ...session, ...body, session_id: body.session_id ?? session.session_id };
    } else if (path === "/hexa/update") {
      session = { ...session, ...body };
    } else if (path === "/hexa/plan") {
      session = { ...session, audit: { ...session.audit, work_items: body.items } };
    } else if (path === "/hexa/audit") {
      if (body.action === "upsert_work_item") {
        session = {
          ...session,
          audit: {
            ...session.audit,
            work_items: [
              ...session.audit.work_items.filter((item) => item.id !== body.work_item.id),
              body.work_item,
            ],
          },
        };
      } else {
        session = {
          ...session,
          audit: {
            ...session.audit,
            milestones: [...session.audit.milestones, body.milestone],
          },
        };
      }
    }
    return new Response(JSON.stringify(path === "/hexa/delete" ? { deleted: true } : session), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const options = {
    cwd,
    home,
    env: { CODEX_THREAD_ID: "thread-123" },
    fetchImpl,
    stdout: () => {},
  };

  await runCli(["watch", "修好跨项目监控"], options);
  await runCli(["update", "正在写测试"], options);
  await runCli([
    "plan",
    "--json",
    JSON.stringify({
      items: [
        { id: "test", title: "补测试", status: "completed" },
        { id: "fix", title: "修实现", status: "in_progress", depends_on: ["test"] },
      ],
    }),
  ], options);
  await runCli([
    "update",
    "修复已经实现",
    "--work-item-id",
    "fix",
    "--work-item-title",
    "修实现",
    "--work-status",
    "completed",
    "--evidence-label",
    "测试通过",
    "--evidence-location",
    "scripts/humhum-hexa.test.mjs",
    "--milestone",
    "兼容旧 update 参数",
  ], options);
  await runCli(["complete", "验证通过"], options);

  assert.deepEqual(calls.map((call) => call.path), [
    "/hexa/register",
    "/hexa/update",
    "/hexa/update",
    "/hexa/plan",
    "/hexa/update",
    "/hexa/audit",
    "/hexa/audit",
    "/hexa/update",
    "/hexa/audit",
  ]);
  assert.equal(calls.every((call) => call.token === "test-token"), true);
  assert.equal(calls[0].body.session_id, "thread-123");
  assert.equal(calls[3].body.capability, "reported");
  assert.equal(calls[3].body.items.length, 2);
  assert.equal(calls[5].body.action, "upsert_work_item");
  assert.equal(calls[5].body.work_item.evidence[0].label, "测试通过");
  assert.equal(calls[6].body.action, "append_milestone");
  await assert.rejects(
    runCli(["complete", "--blocked-reason", "不能把阻塞当成完成"], options),
    /Usage: humhum-hexa complete/,
  );
  assert.equal(calls[7].body.status, "completed");
  assert.equal(calls[8].body.action, "append_milestone");

  const stateFile = stateFileFor({
    home,
    cwd,
    provider: "codex",
    sessionId: "thread-123",
  });
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(saved.status, "completed");

  await runCli(["unwatch"], options);
  assert.equal(calls.at(-1).path, "/hexa/delete");
  await assert.rejects(readFile(stateFile, "utf8"), { code: "ENOENT" });
});

test("reuses the server session for providers without a runtime session id", async () => {
  const root = await mkdtemp(join(tmpdir(), "humhum-hexa-fallback-"));
  const home = join(root, "home");
  const cwd = join(root, "runner");
  const workspace = join(root, "target-workspace");
  await mkdir(join(home, ".humhum"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(join(home, ".humhum", "local-api-token"), "test-token\n");
  const registeredIds = [];
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body);
    if (path === "/hexa/register") registeredIds.push(body.session_id);
    return new Response(JSON.stringify({
      session_id: body.session_id ?? "generated-fallback-id",
      provider: "agent",
      agent: "agent",
      workspace,
      goal: "fallback",
      name: "fallback",
      status: "working",
      audit: { work_items: [], milestones: [] },
    }), { status: 200 });
  };
  const options = { cwd, home, env: {}, fetchImpl, stdout: () => {} };

  await runCli(["watch", "fallback", "--workspace", workspace], options);
  await runCli(["watch", "fallback", "--workspace", workspace], options);
  const fallbackStateFile = stateFileFor({
    home,
    cwd: workspace,
    provider: "agent",
    sessionId: null,
  });
  const completed = JSON.parse(await readFile(fallbackStateFile, "utf8"));
  await writeFile(fallbackStateFile, JSON.stringify({ ...completed, status: "completed" }));
  await runCli(["watch", "new fallback task", "--workspace", workspace], options);

  assert.deepEqual(registeredIds, [null, "generated-fallback-id", null]);
  await assert.rejects(readFile(join(cwd, ".humhum", "hexa-watch-session.json"), "utf8"), {
    code: "ENOENT",
  });
});

test("requires an explicit structured-plan payload", async () => {
  await assert.rejects(
    runCli(["plan"], {
      cwd: "/tmp",
      home: "/tmp",
      env: { CODEX_THREAD_ID: "thread-123" },
      stdout: () => {},
    }),
    /--json.*--file/,
  );
});

test("reports the live watched-session status without shell pipelines", async () => {
  const root = await mkdtemp(join(tmpdir(), "humhum-hexa-status-"));
  const home = join(root, "home");
  const cwd = join(root, "workspace");
  await mkdir(join(home, ".humhum"), { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(join(home, ".humhum", "local-api-token"), "test-token\n");

  const context = {
    home,
    cwd,
    provider: "hermes",
    sessionId: "hermes-session-1",
  };
  await mkdir(dirname(stateFileFor(context)), { recursive: true });
  await writeFile(stateFileFor(context), JSON.stringify({
    session_id: "watched-session-1",
    provider: "hermes",
    agent: "hermes",
    goal: "整理本机 Agent 会话",
    status: "working",
  }));

  const calls = [];
  const lines = [];
  const liveSession = {
    session_id: "watched-session-1",
    provider: "hermes",
    agent: "hermes",
    goal: "整理本机 Agent 会话",
    status: "working",
    current_step: "正在识别活跃会话",
    audit: {
      work_items: [
        { id: "scan", title: "识别会话", status: "completed" },
        { id: "report", title: "生成报告", status: "in_progress" },
        { id: "verify", title: "核对结果", status: "failed" },
      ],
      milestones: [{ summary: "完成第一轮扫描" }],
    },
  };
  const fetchImpl = async (url, init) => {
    calls.push({
      path: new URL(url).pathname,
      method: init.method,
      token: init.headers["x-humhum-token"],
      body: init.body,
    });
    return new Response(JSON.stringify([liveSession]), { status: 200 });
  };

  const result = await runCli(["status"], {
    cwd,
    home,
    env: { HERMES_SESSION_ID: "hermes-session-1" },
    fetchImpl,
    stdout: (line) => lines.push(line),
  });

  assert.equal(result.session_id, "watched-session-1");
  assert.deepEqual(calls, [{
    path: "/hexa/sessions",
    method: "GET",
    token: "test-token",
    body: undefined,
  }]);
  assert.deepEqual(lines, [
    "Hexa status: working",
    "goal: 整理本机 Agent 会话",
    "step: 正在识别活跃会话",
    "work_items: 1/3 completed, 1 failed",
    "milestones: 1",
    "session_id: watched-session-1",
  ]);
});
