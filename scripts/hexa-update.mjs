#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const API_URL = process.env.HUMHUM_HEXA_URL ?? "http://127.0.0.1:31275";
const STATE_FILE = join(process.cwd(), ".humhum", "hexa-watch-session.json");

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

function positionalStep() {
  const values = process.argv.slice(2).filter((arg, index, all) => {
    if (arg.startsWith("--")) return false;
    const previous = all[index - 1];
    return !previous?.startsWith("--");
  });
  return values.join(" ").trim();
}

async function localToken() {
  return (await readFile(join(homedir(), ".humhum", "local-api-token"), "utf8")).trim();
}

async function readState() {
  return JSON.parse(await readFile(STATE_FILE, "utf8"));
}

async function post(path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-humhum-token": await localToken(),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function main() {
  const state = await readState();
  const status = readArg("status", "working");
  const currentStep = readArg("step", positionalStep());
  const blockedReason = readArg("blocked-reason", null);
  const needUser = readArg("need-user", "false") === "true";

  if (!currentStep && !blockedReason) {
    throw new Error('Usage: npm run hexa:update -- "当前进展"');
  }

  let updated = await post("/hexa/update", {
    session_id: readArg("session-id", state.session_id),
    status,
    current_step: currentStep || null,
    blocked_reason: blockedReason,
    need_user: needUser,
    confidence: "agent-bound",
    goal: readArg("goal", state.goal ?? null),
  });
  const sessionId = updated.session_id;
  const evidenceLabel = readArg("evidence-label", null);
  const evidence = evidenceLabel
    ? [{
        kind: "reference",
        label: evidenceLabel,
        location: readArg("evidence-location", null),
      }]
    : [];
  const workItemId = readArg("work-item-id", null);
  if (workItemId) {
    const dependsOn = (readArg("depends-on", "") ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    updated = await post("/hexa/audit", {
      session_id: sessionId,
      action: "upsert_work_item",
      work_item: {
        id: workItemId,
        title: readArg("work-item-title", currentStep || workItemId),
        description: readArg("work-item-description", null),
        acceptance_criteria: readArg("acceptance-criteria", null),
        status: readArg("work-status", "in_progress"),
        depends_on: dependsOn,
        evidence,
      },
    });
  }
  const milestone = readArg("milestone", null);
  if (milestone) {
    updated = await post("/hexa/audit", {
      session_id: sessionId,
      action: "append_milestone",
      milestone: {
        summary: milestone,
        work_item_id: workItemId,
        alignment: readArg("alignment", "watch"),
        evidence,
      },
    });
  }
  await writeFile(STATE_FILE, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  console.log(`Hexa updated: ${updated.status} · ${updated.current_step ?? updated.blocked_reason ?? updated.name}`);
}

main().catch((error) => {
  console.error(`hexa:update failed: ${error.message}`);
  process.exit(1);
});
