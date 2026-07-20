import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const nativeRoot = path.join(repoRoot, "native", "humhum-wechat");

export const forbiddenPackages = [
  "net",
  "net/http",
  "net/rpc",
  "net/smtp",
  "crypto/tls",
  "os/exec",
  "plugin",
];

const forbiddenSymbolPatterns = [
  { label: "net/http", pattern: /(?:^|\s)net\/http\./ },
  { label: "net.Dialer", pattern: /(?:^|\s)net\.\(\*Dialer\)/ },
  { label: "os/exec", pattern: /(?:^|\s)os\/exec\./ },
  { label: "ListenAndServe", pattern: /ListenAndServe/ },
  { label: "sqlite3_exec", pattern: /sqlite3_exec/ },
  { label: "sqlite3_backup", pattern: /sqlite3_backup_/ },
];

const forbiddenStringPatterns = [
  /http\.ListenAndServe/,
  /net\.Dial/,
  /os\/exec\.Command/,
  /sqlite3_exec/,
  /sqlite3_backup_/,
  /OpenWithKeyMapWritable/,
];

const forbiddenSourcePatterns = [
  /http\.ListenAndServe/,
  /net\.Dial\s*\(/,
  /exec\.Command\s*\(/,
  /func\s+\w*(?:download|update)\w*\s*\(/i,
  /sqlite3_exec/,
  /sqlite3_backup_/,
  /OpenWithKeyMapWritable/,
  /\b(?:INSERT|UPDATE|DELETE|ATTACH|REKEY)\s+(?:INTO|FROM|DATABASE|TABLE|[A-Za-z_])/,
];

export function assertBoundary({
  packages,
  symbols,
  strings,
  source,
}) {
  for (const dependency of packages) {
    if (
      forbiddenPackages.includes(dependency) ||
      dependency.startsWith("net/")
    ) {
      throw new Error(`forbidden Go package: ${dependency}`);
    }
  }
  for (const symbol of symbols) {
    const match = forbiddenSymbolPatterns.find((candidate) =>
      candidate.pattern.test(symbol),
    );
    if (match) {
      throw new Error(`forbidden binary symbol: ${match.label}`);
    }
  }
  for (const value of strings) {
    const pattern = forbiddenStringPatterns.find((candidate) =>
      candidate.test(value),
    );
    if (pattern) {
      throw new Error(`forbidden binary string: ${pattern.source}`);
    }
  }
  for (const pattern of forbiddenSourcePatterns) {
    if (pattern.test(source)) {
      throw new Error(`forbidden source pattern: ${pattern.source}`);
    }
  }
}

function spawnChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: nativeRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "command failed")
      .trim()
      .split("\n")[0];
    throw new Error(`${command} failed: ${detail}`);
  }
  return result.stdout;
}

function collectGoSource(directory) {
  const chunks = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "testdata" && entry.name !== "third_party") {
        chunks.push(collectGoSource(target));
      }
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.endsWith(".go") &&
      !entry.name.endsWith("_test.go")
    ) {
      chunks.push(fs.readFileSync(target, "utf8"));
    }
  }
  return chunks.join("\n");
}

function inspectBinary(binaryPath) {
  if (!binaryPath) {
    return { symbols: [], strings: [] };
  }
  const canonicalBinary = fs.realpathSync(binaryPath);
  if (!fs.statSync(canonicalBinary).isFile()) {
    throw new Error("reader binary is not a regular file");
  }
  const symbolResult = spawnSync("go", ["tool", "nm", canonicalBinary], {
    cwd: nativeRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
  });
  const symbols =
    symbolResult.status === 0 ? symbolResult.stdout.split(/\r?\n/) : [];
  const stringOutput = spawnChecked("strings", ["-a", canonicalBinary], {
    cwd: repoRoot,
  });
  return {
    symbols,
    strings: stringOutput.split(/\r?\n/),
  };
}

export function checkReaderBoundary({ binaryPath } = {}) {
  const packages = spawnChecked("go", [
    "list",
    "-deps",
    "./cmd/humhum-wechat-reader",
  ])
    .split(/\r?\n/)
    .filter(Boolean);
  const binary = inspectBinary(binaryPath);
  assertBoundary({
    packages,
    symbols: binary.symbols,
    strings: binary.strings,
    source: collectGoSource(nativeRoot),
  });
  return {
    packageCount: packages.length,
    binaryChecked: Boolean(binaryPath),
  };
}

function parseArguments(argv) {
  if (argv.length === 0) {
    return {};
  }
  if (argv.length === 2 && argv[0] === "--binary") {
    return { binaryPath: path.resolve(repoRoot, argv[1]) };
  }
  throw new Error("usage: node scripts/check-wechat-reader-boundary.mjs [--binary PATH]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = checkReaderBoundary(parseArguments(process.argv.slice(2)));
    console.log(
      `WeChat reader boundary passed (${result.packageCount} packages, binary=${result.binaryChecked})`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
