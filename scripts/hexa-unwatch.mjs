#!/usr/bin/env node
import { readFile, rm } from "node:fs/promises";
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

async function localToken() {
  return (await readFile(join(homedir(), ".humhum", "local-api-token"), "utf8")).trim();
}

async function sessionId() {
  const explicit = readArg("session-id", null);
  if (explicit) return explicit;
  const state = JSON.parse(await readFile(STATE_FILE, "utf8"));
  return state.session_id;
}

async function main() {
  const id = await sessionId();
  const response = await fetch(`${API_URL}/hexa/delete`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-humhum-token": await localToken(),
    },
    body: JSON.stringify({ session_id: id }),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  await rm(STATE_FILE, { force: true });
  console.log(`Hexa unwatch: ${id}`);
}

main().catch((error) => {
  console.error(`hexa:unwatch failed: ${error.message}`);
  process.exit(1);
});
