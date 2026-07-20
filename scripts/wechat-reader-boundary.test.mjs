import assert from "node:assert/strict";
import test from "node:test";

import {
  assertBoundary,
  forbiddenPackages,
} from "./check-wechat-reader-boundary.mjs";

test("rejects forbidden dependencies and binary symbols", () => {
  assert.throws(
    () =>
      assertBoundary({
        packages: ["context", "net/http"],
        symbols: ["main.main"],
        strings: [],
        source: "",
      }),
    /forbidden Go package: net\/http/,
  );
  assert.throws(
    () =>
      assertBoundary({
        packages: ["context", "encoding/json"],
        symbols: ["os\/exec.Command"],
        strings: [],
        source: "",
      }),
    /forbidden binary symbol: os\/exec/,
  );
});

test("rejects network, shell, updater, server, and write source", () => {
  for (const source of [
    `http.ListenAndServe(":3000", nil)`,
    `net.Dial("tcp", address)`,
    `exec.Command("sh", "-c", input)`,
    `func downloadUpdate() {}`,
    `sqlite3_exec(handle, "DELETE FROM x")`,
    `func OpenWithKeyMapWritable() {}`,
  ]) {
    assert.throws(
      () =>
        assertBoundary({
          packages: ["context", "encoding/json"],
          symbols: [],
          strings: [],
          source,
        }),
      /forbidden source pattern/,
    );
  }
});

test("accepts the fixed reader allowlist", () => {
  assert.deepEqual(forbiddenPackages.includes("crypto/md5"), false);
  assert.doesNotThrow(() =>
    assertBoundary({
      packages: [
        "bytes",
        "context",
        "crypto/md5",
        "encoding/json",
        "os",
      ],
      symbols: ["main.main", "github.com/ebitengine/purego.Dlopen"],
      strings: ["status", "sessions", "timeline"],
      source: `database.Query("SELECT username FROM SessionTable LIMIT ?")`,
    }),
  );
});
