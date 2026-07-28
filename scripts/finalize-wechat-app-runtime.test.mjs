import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  finalizeWechatAppRuntime,
  verifyWechatAppRuntime,
} from "./finalize-wechat-app-runtime.mjs";

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function appFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "humhum-finalize-runtime-"));
  const appPath = path.join(root, "HumHum.app");
  const macos = path.join(appPath, "Contents", "MacOS");
  const resources = path.join(appPath, "Contents", "Resources", "wechat");
  fs.mkdirSync(macos, { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  const reader = path.join(macos, "humhum-wechat-reader");
  const wcdb = path.join(resources, "libWCDB.dylib");
  const manifest = path.join(resources, "native-manifest.json");
  fs.writeFileSync(reader, "signed reader bytes");
  fs.writeFileSync(wcdb, "signed wcdb bytes");
  fs.writeFileSync(
    manifest,
    `${JSON.stringify(
      {
        formatVersion: 1,
        reader: { file: "humhum-wechat-reader-aarch64-apple-darwin", sha256: "old" },
        wcdb: { file: "libWCDB.dylib", sha256: "old" },
        provenance: { source: "fixture" },
      },
      null,
      2,
    )}\n`,
  );
  return { root, appPath, reader, wcdb, manifest };
}

test("finalizes the manifest from the signed bundled bytes", () => {
  const fixture = appFixture();
  try {
    finalizeWechatAppRuntime(fixture.appPath);
    const manifest = JSON.parse(fs.readFileSync(fixture.manifest, "utf8"));

    assert.equal(manifest.reader.sha256, sha256(fixture.reader));
    assert.equal(manifest.wcdb.sha256, sha256(fixture.wcdb));
    assert.equal(manifest.reader.file, "humhum-wechat-reader-aarch64-apple-darwin");
    assert.equal(manifest.provenance.source, "fixture");
    assert.doesNotThrow(() => verifyWechatAppRuntime(fixture.appPath));

    fs.appendFileSync(fixture.reader, "tampered");
    assert.throws(
      () => verifyWechatAppRuntime(fixture.appPath),
      /does not match/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a symlinked native component", () => {
  const fixture = appFixture();
  try {
    const outside = path.join(fixture.root, "outside-reader");
    fs.writeFileSync(outside, "replacement");
    fs.rmSync(fixture.reader);
    fs.symlinkSync(outside, fixture.reader);

    assert.throws(
      () => finalizeWechatAppRuntime(fixture.appPath),
      /regular file/,
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
