import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentSessionId } from "./hexa-session-context.mjs";

test("prefers an explicit id then provider environment ids", () => {
  assert.equal(resolveAgentSessionId("manual", { CODEX_THREAD_ID: "codex" }), "manual");
  assert.equal(resolveAgentSessionId(null, { CODEX_THREAD_ID: "codex" }), "codex");
  assert.equal(resolveAgentSessionId(null, { CLAUDE_SESSION_ID: "claude" }), "claude");
  assert.equal(resolveAgentSessionId(null, { HUMHUM_SESSION_ID: "generic" }), "generic");
});
