import assert from "node:assert/strict";
import test from "node:test";
import {
  NODE_TEST_FILES,
  buildTestCommands,
  runTests,
} from "./run-tests.mjs";

test("forwards optional arguments only to the local Vitest command", () => {
  const commands = buildTestCommands(["src/components/Hub/HushModule.test.ts"]);

  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0].args.slice(-2), ["run", "src/components/Hub/HushModule.test.ts"]);
  assert.deepEqual(commands[1].args, ["--test", ...NODE_TEST_FILES]);
});

test("runs fixed Hexa tests after Vitest and preserves failures", () => {
  const calls = [];
  const success = runTests(["src/example.test.ts"], (command, args) => {
    calls.push([command, args]);
    return { status: 0, signal: null };
  });

  assert.equal(success, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1][1], ["--test", ...NODE_TEST_FILES]);

  const failure = runTests([], () => ({ status: 7, signal: null }));
  assert.equal(failure, 7);
});

test("relays a child signal through the supplied terminator", () => {
  let receivedSignal = null;
  const code = runTests([], () => ({ status: null, signal: "SIGTERM" }), (signal) => {
    receivedSignal = signal;
  });

  assert.equal(receivedSignal, "SIGTERM");
  assert.equal(code, 1);
});
