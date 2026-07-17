#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

import { parsePlanJson } from "./hexa-plan-input.mjs";

const API_URL = process.env.HUMHUM_HEXA_URL ?? "http://127.0.0.1:31275";
const STATE_FILE = join(process.cwd(), ".humhum", "hexa-watch-session.json");

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

async function main() {
  const file = arg("file");
  const directJson = arg("json");
  if (!file && !directJson) {
    throw new Error('Usage: npm run hexa:plan -- --json \'{"items":[...]}\' or --file plan.json');
  }
  if (file && directJson) {
    throw new Error("Choose either --json or --file, not both");
  }
  const [state, token, planJson] = await Promise.all([
    readFile(STATE_FILE, "utf8").then(JSON.parse),
    readFile(join(homedir(), ".humhum", "local-api-token"), "utf8").then((value) => value.trim()),
    directJson ? Promise.resolve(directJson) : readFile(file, "utf8"),
  ]);
  const body = {
    session_id: arg("session-id", state.session_id),
    capability: arg("capability", "reported"),
    source_provider: arg("provider", state.provider ?? state.agent ?? "agent"),
    revision: arg("revision", null),
    items: parsePlanJson(planJson),
  };
  const response = await fetch(`${API_URL}/hexa/plan`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-humhum-token": token },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const updated = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(updated.error ?? `HTTP ${response.status}`);
  await writeFile(STATE_FILE, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  console.log(`Hexa plan synced: ${updated.audit?.work_items?.length ?? 0} work items`);
}

main().catch((error) => {
  console.error(`hexa:plan failed: ${error.message}`);
  process.exit(1);
});
