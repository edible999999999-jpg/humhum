import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function requireRegularFile(filePath, label) {
  const info = fs.lstatSync(filePath);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function atomicJSON(destination, value) {
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o644,
    flag: "wx",
  });
  fs.renameSync(temporary, destination);
}

function readRuntime(appPath) {
  const absoluteAppPath = path.resolve(appPath);
  const appInfo = fs.lstatSync(absoluteAppPath);
  if (appInfo.isSymbolicLink() || !appInfo.isDirectory()) {
    throw new Error("app bundle must be a regular directory");
  }

  const readerPath = path.join(
    absoluteAppPath,
    "Contents",
    "MacOS",
    "humhum-wechat-reader",
  );
  const runtimeDirectory = path.join(
    absoluteAppPath,
    "Contents",
    "Resources",
    "wechat",
  );
  const wcdbPath = path.join(runtimeDirectory, "libWCDB.dylib");
  const manifestPath = path.join(runtimeDirectory, "native-manifest.json");
  requireRegularFile(readerPath, "WeChat reader");
  requireRegularFile(wcdbPath, "WCDB runtime");
  requireRegularFile(manifestPath, "native manifest");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (
    manifest?.formatVersion !== 1 ||
    typeof manifest.reader?.file !== "string" ||
    typeof manifest.wcdb?.file !== "string"
  ) {
    throw new Error("native manifest has an unsupported shape");
  }
  return { manifest, manifestPath, readerPath, wcdbPath };
}

export function verifyWechatAppRuntime(appPath) {
  const { manifest, readerPath, wcdbPath } = readRuntime(appPath);
  if (
    manifest.reader.sha256 !== sha256(readerPath) ||
    manifest.wcdb.sha256 !== sha256(wcdbPath)
  ) {
    throw new Error("native runtime manifest does not match the bundled bytes");
  }
  return manifest;
}

export function finalizeWechatAppRuntime(appPath) {
  const { manifest, manifestPath, readerPath, wcdbPath } = readRuntime(appPath);
  manifest.reader.sha256 = sha256(readerPath);
  manifest.wcdb.sha256 = sha256(wcdbPath);
  atomicJSON(manifestPath, manifest);
  return verifyWechatAppRuntime(appPath);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const verifyOnly = process.argv[2] === "--verify";
  const appPath = verifyOnly ? process.argv[3] : process.argv[2];
  if (!appPath || process.argv.length !== (verifyOnly ? 4 : 3)) {
    console.error(
      "usage: node scripts/finalize-wechat-app-runtime.mjs [--verify] <HumHum.app>",
    );
    process.exitCode = 2;
  } else {
    try {
      if (verifyOnly) {
        verifyWechatAppRuntime(appPath);
        console.log("WeChat native runtime manifest verified");
      } else {
        finalizeWechatAppRuntime(appPath);
        console.log("WeChat native runtime manifest finalized");
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
