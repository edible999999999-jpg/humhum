import assert from "node:assert/strict";
import test from "node:test";

import { parsePlanJson } from "./hexa-plan-input.mjs";

test("parses a direct plan snapshot without a temporary file", () => {
  const plan = parsePlanJson(JSON.stringify({
    items: [
      { id: "inspect", title: "排查问题", status: "completed" },
      { id: "fix", title: "修复问题", status: "in_progress" },
    ],
  }));

  assert.deepEqual(plan, [
    { id: "inspect", title: "排查问题", status: "completed" },
    { id: "fix", title: "修复问题", status: "in_progress" },
  ]);
});

test("rejects a direct snapshot without work items", () => {
  assert.throws(() => parsePlanJson('{"items":"invalid"}'), /array or contain an items array/);
});
