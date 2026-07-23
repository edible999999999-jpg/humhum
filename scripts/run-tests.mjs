import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const HEXA_TEST_FILES = [
  "scripts/hexa-session-context.test.mjs",
  "scripts/hexa-plan-input.test.mjs",
  "scripts/humhum-hexa.test.mjs",
];

const LOCAL_VITEST_ENTRY = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
export const NODE_TEST_FILES = [
  "scripts/run-tests.test.mjs",
  "scripts/hush-egress-boundary.test.mjs",
  ...HEXA_TEST_FILES,
];

export function buildTestCommands(vitestArgs = []) {
  return [
    {
      command: process.execPath,
      args: [LOCAL_VITEST_ENTRY, "run", ...vitestArgs],
    },
    {
      command: process.execPath,
      args: ["--test", ...NODE_TEST_FILES],
    },
  ];
}

export function runTests(
  vitestArgs,
  spawn = spawnSync,
  terminate = (signal) => process.kill(process.pid, signal),
) {
  for (const { command, args } of buildTestCommands(vitestArgs)) {
    const result = spawn(command, args, { stdio: "inherit" });
    if (result.error) {
      console.error(result.error.message);
      return 1;
    }
    if (result.signal) {
      terminate(result.signal);
      return 1;
    }
    if (result.status !== 0) {
      return typeof result.status === "number" ? result.status : 1;
    }
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runTests(process.argv.slice(2));
}
