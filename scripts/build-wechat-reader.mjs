import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { checkReaderBoundary } from "./check-wechat-reader-boundary.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const nativeRoot = path.join(repoRoot, "native", "humhum-wechat");
const manifestPath = path.join(nativeRoot, "third_party", "manifest.json");
const binaryDirectory = path.join(repoRoot, "src-tauri", "binaries");
const resourceDirectory = path.join(
  repoRoot,
  "src-tauri",
  "resources",
  "wechat",
);
const readerPath = path.join(
  binaryDirectory,
  "humhum-wechat-reader-aarch64-apple-darwin",
);
const wcdbDestination = path.join(resourceDirectory, "libWCDB.dylib");
const runtimeManifestPath = path.join(
  resourceDirectory,
  "native-manifest.json",
);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: nativeRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.status !== 0) {
    const detail = options.capture
      ? (result.stderr || result.stdout || "command failed")
          .trim()
          .split("\n")[0]
      : "see command output above";
    throw new Error(`${command} failed: ${detail}`);
  }
  return options.capture ? result.stdout : "";
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function requireRegularFile(filePath, label) {
  const info = fs.lstatSync(filePath);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
}

function atomicCopy(source, destination, mode) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.copyFileSync(source, temporary);
  fs.chmodSync(temporary, mode);
  fs.renameSync(temporary, destination);
}

function atomicJSON(destination, value) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o644,
  });
  fs.renameSync(temporary, destination);
}

function verifyToolchain() {
  const version = run("go", ["version"], { capture: true }).trim();
  if (!/\bgo1\.26\.5\b/.test(version)) {
    throw new Error(`Go 1.26.5 is required; found ${version}`);
  }
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    throw new Error("the phase-one reader build requires macOS arm64");
  }
}

function main() {
  verifyToolchain();
  const sourceManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const wcdbSource =
    process.env.HUMHUM_WECHAT_WCDB_DYLIB ||
    path.join(
      os.homedir(),
      ".local",
      "share",
      "wechat-cli",
      sourceManifest.wcdbFile,
    );
  requireRegularFile(wcdbSource, "WCDB source library");
  const wcdbHash = sha256(wcdbSource);
  if (wcdbHash !== sourceManifest.wcdbSha256) {
    throw new Error(`WCDB checksum mismatch: ${wcdbHash}`);
  }

  run("go", ["test", "./..."]);
  const stagingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "humhum-wechat-reader-"),
  );
  try {
    const auditBinary = path.join(stagingDirectory, "reader-audit");
    run("go", [
      "build",
      "-trimpath",
      "-buildvcs=false",
      "-ldflags=-buildid=",
      "-o",
      auditBinary,
      "./cmd/humhum-wechat-reader",
    ]);
    checkReaderBoundary({ binaryPath: auditBinary });

    const releaseBinary = path.join(stagingDirectory, "reader-release");
    run("go", [
      "build",
      "-trimpath",
      "-buildvcs=false",
      "-ldflags=-s -w -buildid=",
      "-o",
      releaseBinary,
      "./cmd/humhum-wechat-reader",
    ]);
    checkReaderBoundary({ binaryPath: releaseBinary });
    atomicCopy(releaseBinary, readerPath, 0o755);
    atomicCopy(wcdbSource, wcdbDestination, 0o644);
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }

  const readerHash = sha256(readerPath);
  atomicJSON(runtimeManifestPath, {
    formatVersion: 1,
    reader: {
      file: path.basename(readerPath),
      sha256: readerHash,
    },
    wcdb: {
      file: "libWCDB.dylib",
      sha256: wcdbHash,
    },
    provenance: {
      r266WechatCliCommit: sourceManifest.r266WechatCliCommit,
      r266WxkeyCommit: sourceManifest.r266WxkeyCommit,
      goVersion: sourceManifest.goVersion,
    },
  });
  console.log(`reader: ${readerPath}`);
  console.log(`reader sha256: ${readerHash}`);
  console.log(`wcdb sha256: ${wcdbHash}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
