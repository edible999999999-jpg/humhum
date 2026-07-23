import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const REMOTE_BOUNDARY_FILES = [
  "src-tauri/src/mobile_personal_context.rs",
  "src-tauri/src/mobile_bridge.rs",
  "src-tauri/src/mobile_relay.rs",
  "src-tauri/src/pi_sidecar.rs",
  "src-tauri/src/remote_bridge.rs",
  "src-tauri/src/codex_bridge/mod.rs",
  "src-tauri/src/codex_bridge/protocol.rs",
  "src-tauri/src/codex_bridge/transport.rs",
  "src-tauri/src/claude_followup.rs",
  "src-tauri/src/opencode_followup.rs",
];

test("remote projections and provider transports cannot read Hush records", () => {
  for (const relativePath of REMOTE_BOUNDARY_FILES) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /(?:hush_store::HushStore|HushStore|hush-inbox\.json)/,
      `${relativePath} crosses the Hush egress boundary`,
    );
  }
});

test("LAN and Anywhere reuse the same always-empty personal-context projection", () => {
  const mobileBridge = fs.readFileSync(
    path.join(repoRoot, "src-tauri/src/mobile_bridge.rs"),
    "utf8",
  );
  const projectionCalls =
    mobileBridge.match(
      /mobile_personal_context::project_mobile_personal_context\(/g,
    ) ?? [];
  assert.equal(
    projectionCalls.length,
    2,
    "LAN and Anywhere must each use the guarded projection",
  );

  const projection = fs.readFileSync(
    path.join(repoRoot, "src-tauri/src/mobile_personal_context.rs"),
    "utf8",
  );
  assert.match(projection, /inbox:\s*Vec::new\(\)/);
  assert.doesNotMatch(projection, /try_state::<[^>]*HushStore/);
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
