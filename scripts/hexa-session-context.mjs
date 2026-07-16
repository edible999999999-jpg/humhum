const PROVIDER_SESSION_ENV = [
  "HUMHUM_SESSION_ID",
  "CODEX_THREAD_ID",
  "CLAUDE_SESSION_ID",
  "OPENCODE_SESSION_ID",
  "CURSOR_SESSION_ID",
  "QODER_SESSION_ID",
  "HERMES_SESSION_ID",
  "OPENCLAW_SESSION_ID",
];

export function resolveAgentSessionId(explicit, environment = process.env) {
  if (explicit?.trim()) return explicit.trim();
  for (const name of PROVIDER_SESSION_ENV) {
    const value = environment[name];
    if (value?.trim()) return value.trim();
  }
  return null;
}
