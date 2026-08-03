import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRepoFile = (relativePath) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("Windows CI installs the Rust components it invokes", () => {
  const workflow = readRepoFile(".github/workflows/windows.yml");

  assert.match(workflow, /components:\s*rustfmt, clippy/);
});

test("Windows Tauri builds omit the macOS-only WeChat runtime", () => {
  const windowsConfig = JSON.parse(
    readRepoFile("src-tauri/tauri.windows.conf.json"),
  );

  assert.equal(windowsConfig.bundle.externalBin, null);
  assert.equal(windowsConfig.bundle.resources, null);
});

test("macOS CI does not promote existing Clippy warnings to errors", () => {
  const workflow = readRepoFile(".github/workflows/macos-ci.yml");

  assert.doesNotMatch(workflow, /cargo clippy -- -D warnings/);
});
