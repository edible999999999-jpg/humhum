#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { resolveAgentSessionId } from "./hexa-session-context.mjs";

const API_URL = process.env.HUMHUM_HEXA_URL ?? "http://127.0.0.1:31275";
const STATE_DIR = join(process.cwd(), ".humhum");
const STATE_FILE = join(STATE_DIR, "hexa-watch-session.json");

function readArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }
  return fallback;
}

function positionalGoal() {
  const values = process.argv.slice(2).filter((arg, index, all) => {
    if (arg.startsWith("--")) return false;
    const previous = all[index - 1];
    return !previous?.startsWith("--");
  });
  return values.join(" ").trim();
}

async function localToken() {
  const tokenPath = join(homedir(), ".humhum", "local-api-token");
  return (await readFile(tokenPath, "utf8")).trim();
}

async function post(path, body) {
  const token = await localToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-humhum-token": token,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data;
}

async function main() {
  const goal = readArg("goal", positionalGoal()) ?? "";
  const workspace = resolve(readArg("workspace", process.cwd()));
  const agent = readArg("agent", process.env.HUMHUM_AGENT ?? "codex");
  const name = readArg("name", goal || basename(workspace) || "Hexa watched session");
  const provider = readArg("provider", agent);
  const sessionId = resolveAgentSessionId(readArg("session-id", null));
  const currentStep = readArg("step", "Agent 已主动加入 Hexa 托管，等待第一轮进展更新。");

  if (!goal.trim()) {
    throw new Error('Usage: npm run hexa:watch -- "这轮任务目标"');
  }

  const session = await post("/hexa/register", {
    session_id: sessionId,
    agent,
    name,
    provider,
    workspace,
    goal,
  });

  const updated = await post("/hexa/update", {
    session_id: session.session_id,
    status: readArg("status", "working"),
    current_step: currentStep,
    need_user: false,
    confidence: "agent-bound",
    goal,
  });

  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  console.log(`Hexa watching: ${updated.name}`);
  console.log(`session_id: ${updated.session_id}`);
}

main().catch((error) => {
  console.error(`hexa:watch failed: ${error.message}`);
  process.exit(1);
});
