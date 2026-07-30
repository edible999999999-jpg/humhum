import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const THIRD_PARTY_BOUNDARY_FILES = [
  "src-tauri/src/mobile_relay.rs",
  "src-tauri/src/pi_sidecar.rs",
  "src-tauri/src/remote_bridge.rs",
  "src-tauri/src/codex_bridge/mod.rs",
  "src-tauri/src/codex_bridge/protocol.rs",
  "src-tauri/src/codex_bridge/transport.rs",
  "src-tauri/src/claude_followup.rs",
  "src-tauri/src/opencode_followup.rs",
];

test("relay and provider transports cannot read Hush records", () => {
  for (const relativePath of THIRD_PARTY_BOUNDARY_FILES) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /(?:hush_store::HushStore|HushStore|hush-inbox\.json)/,
      `${relativePath} crosses the Hush egress boundary`,
    );
  }
});

test("authorized mobile Hush projection stays explicit bounded and redacted", () => {
  const mobileBridge = fs.readFileSync(
    path.join(repoRoot, "src-tauri/src/mobile_bridge.rs"),
    "utf8",
  );
  assert.match(
    mobileBridge,
    /AnywhereRequest::PersonalContext \| AnywhereRequest::HushRefresh[\s\S]*!personal_context/,
  );
  assert.match(
    mobileBridge,
    /POST,\s*"\/api\/hush\/refresh"[\s\S]*Some\(device\) if device\.personal_context/,
  );
  assert.doesNotMatch(
    fs.readFileSync(path.join(repoRoot, "src-tauri/src/mobile_relay.rs"), "utf8"),
    /(?:hush_store::HushStore|HushStore|hush-inbox\.json)/,
  );

  const projection = fs.readFileSync(
    path.join(repoRoot, "src-tauri/src/mobile_personal_context.rs"),
    "utf8",
  );
  assert.match(projection, /const MAX_INBOX:\s*usize\s*=\s*8/);
  assert.match(projection, /try_state::<[^>]*HushStore/);
  assert.match(projection, /\.filter_map\(project_inbox\)\s*\.take\(MAX_INBOX\)/);
  assert.match(projection, /user_safe_text::project_user_safe_text/);
  const inboxShape = projection.match(/pub struct MobileInboxItem\s*\{[^}]*\}/)?.[0] ?? "";
  assert.ok(inboxShape, "mobile inbox shape must remain explicit");
  assert.doesNotMatch(inboxShape, /\braw\b/);
});

test("Hush UI and local ingestion errors have no remote or sensitive log sink", () => {
  const hushModule = fs.readFileSync(
    path.join(repoRoot, "src/components/Hub/HushModule.tsx"),
    "utf8",
  );
  assert.doesNotMatch(hushModule, /\bfetch\s*\(/);
  assert.doesNotMatch(
    hushModule,
    /from\s+["'][^"']*(?:providers|openai|anthropic|mobile_relay)[^"']*["']/,
  );

  const appRuntime = fs.readFileSync(
    path.join(repoRoot, "src-tauri/src/lib.rs"),
    "utf8",
  );
  assert.match(appRuntime, /DingTalk DWS background sync failed"\)/);
  assert.match(appRuntime, /WeChat background sync failed"\)/);
  assert.doesNotMatch(
    appRuntime,
    /(?:DingTalk DWS|WeChat) background sync failed:[^"\n]*\{error\}/,
  );
});

test("Hush reply drafting stays local and every send crosses the confirmation commands", () => {
  const replySkill = fs.readFileSync(
    path.join(repoRoot, "src/lib/hush/replySkill.ts"),
    "utf8",
  );
  assert.doesNotMatch(replySkill, /\bfetch\s*\(/);
  assert.doesNotMatch(replySkill, /@tauri-apps|providers|openai|anthropic|mobile_relay/);

  const replyComposer = fs.readFileSync(
    path.join(repoRoot, "src/components/Hub/HushReplyComposer.tsx"),
    "utf8",
  );
  assert.match(replyComposer, /"prepare_hush_reply"/);
  assert.match(replyComposer, /"confirm_hush_reply"/);
  assert.doesNotMatch(replyComposer, /\bfetch\s*\(/);
});
