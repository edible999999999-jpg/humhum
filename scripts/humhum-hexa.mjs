#!/usr/bin/env node
// HUMHUM_MANAGED_HEXA_CONNECTOR
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_API_URL = "http://127.0.0.1:31275";
const SESSION_ENVIRONMENTS = [
  ["HUMHUM_SESSION_ID", null],
  ["CODEX_THREAD_ID", "codex"],
  ["CLAUDE_SESSION_ID", "claude-code"],
  ["OPENCODE_SESSION_ID", "opencode"],
  ["CURSOR_SESSION_ID", "cursor"],
  ["QODER_SESSION_ID", "qoder"],
  ["QODERWORK_SESSION_ID", "qoderwork"],
  ["QWEN_SESSION_ID", "qwen-code"],
  ["GEMINI_SESSION_ID", "gemini-cli"],
  ["HERMES_SESSION_ID", "hermes"],
  ["OPENCLAW_SESSION_ID", "openclaw"],
];

function clean(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveApiUrl(value = null) {
  const candidate = clean(value) ?? DEFAULT_API_URL;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Hexa API URL must be an HTTP loopback address");
  }
  const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (
    parsed.protocol !== "http:"
    || !loopback
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("Hexa API URL must be an HTTP loopback address without credentials or a path");
  }
  return parsed.origin;
}

export function resolveAgentContext(options = {}, environment = process.env) {
  const explicitProvider = clean(options.provider);
  const explicitAgent = clean(options.agent);
  const explicitSession = clean(options.sessionId);
  if (explicitSession) {
    const provider = explicitProvider ?? explicitAgent ?? clean(environment.HUMHUM_AGENT) ?? "agent";
    return { provider, agent: explicitAgent ?? provider, sessionId: explicitSession };
  }

  for (const [name, providerHint] of SESSION_ENVIRONMENTS) {
    const sessionId = clean(environment[name]);
    if (!sessionId) continue;
    const provider = explicitProvider
      ?? explicitAgent
      ?? clean(environment.HUMHUM_AGENT)
      ?? providerHint
      ?? "agent";
    return { provider, agent: explicitAgent ?? provider, sessionId };
  }

  const provider = explicitProvider ?? explicitAgent ?? clean(environment.HUMHUM_AGENT) ?? "agent";
  return { provider, agent: explicitAgent ?? provider, sessionId: null };
}

export function resolveAgentSurface(options = {}, environment = {}, context = {}) {
  const explicit = clean(options.surface) ?? clean(environment.HUMHUM_AGENT_SURFACE);
  if (explicit) return explicit;
  if (context.provider === "qoderwork") return "qoder_worker";
  return "unknown";
}

function safeProvider(provider) {
  return (provider || "agent").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 32) || "agent";
}

export function stateFileFor({ home, cwd, provider, sessionId }) {
  const hasSession = Boolean(clean(sessionId));
  const identity = hasSession ? sessionId : resolve(cwd);
  const digest = createHash("sha256")
    .update(`${provider ?? "agent"}\0${identity}`)
    .digest("hex")
    .slice(0, 32);
  return join(
    home,
    ".humhum",
    "hexa",
    hasSession ? "sessions" : "workspaces",
    `${safeProvider(provider)}-${digest}.json`,
  );
}

function parseArguments(argv) {
  const command = argv[0] ?? "";
  const flags = {};
  const positionals = [];
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    const separator = value.indexOf("=");
    if (separator > 2) {
      flags[value.slice(2, separator)] = value.slice(separator + 1);
      continue;
    }
    const name = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = "true";
    }
  }
  return { command, flags, positionals };
}

function parsePlan(raw) {
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Plan JSON is invalid: ${error.message}`);
  }
  const items = Array.isArray(plan) ? plan : plan?.items;
  if (!Array.isArray(items)) {
    throw new Error("Plan JSON must be an array or contain an items array");
  }
  return items;
}

async function responseJson(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

export async function runCli(argv, options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const home = resolve(options.home ?? homedir());
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const stdout = options.stdout ?? console.log;
  const { command, flags, positionals } = parseArguments(argv);
  const context = resolveAgentContext({
    provider: flags.provider,
    agent: flags.agent,
    sessionId: flags["session-id"],
  }, env);
  const surface = resolveAgentSurface({ surface: flags.surface }, env, context);
  const workspace = resolve(flags.workspace ?? cwd);
  const stateFile = stateFileFor({ home, cwd: workspace, ...context });
  const apiUrl = resolveApiUrl(clean(flags.url) ?? clean(env.HUMHUM_HEXA_URL));

  const post = async (path, body) => {
    const token = (await readFile(join(home, ".humhum", "local-api-token"), "utf8")).trim();
    return responseJson(await fetchImpl(`${apiUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-humhum-token": token,
      },
      body: JSON.stringify(body),
    }));
  };
  const readOptionalState = async () => {
    try {
      return JSON.parse(await readFile(stateFile, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  };
  const readState = async () => {
    const state = await readOptionalState();
    if (!state) throw new Error("当前 Agent 会话还没有加入 Hexa，请先运行 humhum-hexa watch");
    return state;
  };
  const writeState = async (state) => {
    await mkdir(dirname(stateFile), { recursive: true });
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  };
  const withGoalContext = (session, state) => ({
    ...session,
    goal_id: clean(state.goal_id) ?? undefined,
    surface: clean(state.surface) ?? undefined,
  });

  if (command === "watch") {
    const goal = clean(flags.goal) ?? clean(positionals.join(" "));
    if (!goal) throw new Error('Usage: humhum-hexa watch "这轮任务目标"');
    const previousState = context.sessionId ? null : await readOptionalState();
    const previous = previousState?.status === "completed" ? null : previousState;
    const registered = await post("/hexa/register", {
      session_id: context.sessionId ?? previous?.session_id ?? null,
      agent: context.agent,
      name: clean(flags.name) ?? goal ?? basename(workspace),
      provider: context.provider,
      workspace,
      goal,
    });
    const updated = await post("/hexa/update", {
      session_id: registered.session_id,
      status: clean(flags.status) ?? "working",
      current_step: clean(flags.step) ?? "Agent 已主动加入 Hexa，正在整理真实工作计划。",
      blocked_reason: null,
      need_user: false,
      confidence: "agent-bound",
      goal,
    });
    let watched = { ...updated, surface };
    const goalLinkRequested = Boolean(clean(flags["goal-id"]))
      || flags["link-goal"] === "true";
    if (goalLinkRequested) {
      try {
        const linkedGoal = await post("/hexa/goal/link", {
          goal_id: clean(flags["goal-id"]),
          project_key: `repo:${workspace}`,
          title: goal,
          success_criteria: (clean(flags["success-criteria"]) ?? "")
            .split("|")
            .map((item) => item.trim())
            .filter(Boolean),
          session_id: updated.session_id,
          surface,
          branch: clean(flags.branch),
          worktree: clean(flags.worktree),
        });
        watched = { ...watched, goal_id: linkedGoal.id };
      } catch (error) {
        stdout(`Hexa session registered, but goal linking failed: ${error.message}`);
      }
    }
    await writeState(watched);
    stdout(`Hexa watching: ${watched.name ?? goal}`);
    stdout(`session_id: ${watched.session_id}`);
    return watched;
  }

  if (command === "plan") {
    const directJson = clean(flags.json);
    const file = clean(flags.file);
    if ((!directJson && !file) || (directJson && file)) {
      throw new Error('Usage: humhum-hexa plan --json \'{"items":[...]}\' or --file plan.json');
    }
    const state = await readState();
    const raw = directJson ?? await readFile(resolve(cwd, file), "utf8");
    const updated = await post("/hexa/plan", {
      session_id: state.session_id,
      capability: clean(flags.capability) ?? "reported",
      source_provider: clean(flags.provider) ?? state.provider ?? state.agent ?? context.provider,
      revision: clean(flags.revision),
      items: parsePlan(raw),
    });
    await writeState(withGoalContext(updated, state));
    stdout(`Hexa plan synced: ${updated.audit?.work_items?.length ?? 0} work items`);
    return updated;
  }

  if (command === "update" || command === "complete") {
    const state = await readState();
    const summary = clean(flags.step) ?? clean(positionals.join(" "));
    const blockedReason = clean(flags["blocked-reason"]);
    if ((command === "complete" && !summary) || (!summary && !blockedReason)) {
      throw new Error(`Usage: humhum-hexa ${command} "当前进展"`);
    }
    const completed = command === "complete";
    const resultStatus = completed ? clean(flags.result) ?? "unverified" : null;
    if (resultStatus && !["unverified", "failed", "superseded"].includes(resultStatus)) {
      throw new Error("Hexa completion result must be unverified, failed, or superseded");
    }
    let updated = await post("/hexa/update", {
      session_id: state.session_id,
      status: completed ? "completed" : clean(flags.status) ?? "working",
      current_step: summary,
      blocked_reason: blockedReason,
      need_user: flags["need-user"] === "true",
      confidence: "agent-bound",
      goal: clean(flags.goal) ?? state.goal ?? null,
    });
    const evidenceLabel = clean(flags["evidence-label"]);
    const evidence = evidenceLabel
      ? [{
          kind: "reference",
          label: evidenceLabel,
          location: clean(flags["evidence-location"]),
        }]
      : [];
    const workItemId = clean(flags["work-item-id"]);
    if (workItemId) {
      updated = await post("/hexa/audit", {
        session_id: state.session_id,
        action: "upsert_work_item",
        work_item: {
          id: workItemId,
          title: clean(flags["work-item-title"]) ?? summary ?? workItemId,
          description: clean(flags["work-item-description"]),
          acceptance_criteria: clean(flags["acceptance-criteria"]),
          status: clean(flags["work-status"]) ?? "in_progress",
          depends_on: (clean(flags["depends-on"]) ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          evidence,
        },
      });
    }
    const milestone = completed ? summary : clean(flags.milestone);
    if (milestone) {
      updated = await post("/hexa/audit", {
        session_id: state.session_id,
        action: "append_milestone",
        milestone: {
          summary: milestone,
          work_item_id: clean(flags["work-item-id"]),
          alignment: clean(flags.alignment) ?? (completed ? "on_track" : "watch"),
          evidence,
        },
      });
    }
    if (completed && state.goal_id) {
      await post("/hexa/goal/result", {
        goal_id: state.goal_id,
        session_id: state.session_id,
        result_status: resultStatus,
        evidence,
      });
    }
    await writeState(withGoalContext(updated, state));
    stdout(`Hexa ${completed ? "completed" : "updated"}: ${summary ?? blockedReason}`);
    return updated;
  }

  if (command === "unwatch") {
    const state = await readState();
    const result = await post("/hexa/delete", { session_id: state.session_id });
    await rm(stateFile, { force: true });
    stdout(`Hexa unwatch: ${state.session_id}`);
    return result;
  }

  throw new Error("Usage: humhum-hexa <watch|update|plan|complete|unwatch>");
}

export function isMainModule(argvPath, moduleUrl) {
  if (!argvPath) return false;
  try {
    return realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(`humhum-hexa failed: ${error.message}`);
    process.exitCode = 1;
  });
}
