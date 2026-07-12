import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import {
  createFcmProvider,
  loadFcmProviderFromEnvironment,
} from "../src/fcm.mjs";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const serviceAccount = {
  type: "service_account",
  project_id: "humhum-test",
  private_key_id: "key-id",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  client_email: "relay@humhum-test.iam.gserviceaccount.com",
  client_id: "123456",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
};

function jsonResponse(status, value) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return value; },
    async text() { return JSON.stringify(value); },
  };
}

function decodePart(jwt, index) {
  return JSON.parse(Buffer.from(jwt.split(".")[index], "base64url").toString("utf8"));
}

test("FCM provider signs scoped OAuth assertion and sends exact generic wake", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return jsonResponse(200, { access_token: "oauth-access", expires_in: 3600 });
    return jsonResponse(200, { name: "projects/humhum-test/messages/1" });
  };
  const now = 1_800_000_000_000;
  const provider = createFcmProvider({
    projectId: "humhum-test",
    serviceAccount,
    fetchImpl,
    clock: () => now,
  });

  await provider.sendWake("opaque:fcm-token", "a".repeat(64), 7);

  assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["content-type"], "application/x-www-form-urlencoded");
  const oauthBody = new URLSearchParams(calls[0].init.body);
  assert.equal(oauthBody.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const assertion = oauthBody.get("assertion");
  assert.deepEqual(decodePart(assertion, 0), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decodePart(assertion, 1), {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    iat: now / 1000,
    exp: now / 1000 + 3600,
  });

  assert.equal(calls[1].url, "https://fcm.googleapis.com/v1/projects/humhum-test/messages:send");
  assert.equal(calls[1].init.headers.authorization, "Bearer oauth-access");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    message: {
      token: "opaque:fcm-token",
      data: {
        kind: "humhum_wake",
        channel: "a".repeat(64),
        sequence: "7",
      },
      android: {
        priority: "high",
        collapse_key: "a".repeat(64),
        ttl: "60s",
      },
    },
  });
});

test("FCM provider caches OAuth only inside its safe lifetime", async () => {
  let now = 1_800_000_000_000;
  let oauthCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("oauth2")) {
      oauthCalls += 1;
      return jsonResponse(200, { access_token: `oauth-${oauthCalls}`, expires_in: 120 });
    }
    return jsonResponse(200, { name: "accepted" });
  };
  const provider = createFcmProvider({
    projectId: "humhum-test", serviceAccount, fetchImpl, clock: () => now,
  });
  await provider.sendWake("token", "b".repeat(64), 1);
  now += 59_000;
  await provider.sendWake("token", "b".repeat(64), 2);
  assert.equal(oauthCalls, 1);
  now += 2_000;
  await provider.sendWake("token", "b".repeat(64), 3);
  assert.equal(oauthCalls, 2);
});

test("FCM provider fails with bounded credential-free errors and timeout", async () => {
  const provider = createFcmProvider({
    projectId: "humhum-test",
    serviceAccount,
    timeoutMs: 10,
    fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("contains-secret-token")), { once: true });
    }),
  });
  await assert.rejects(
    provider.sendWake("never-log-this-token", "c".repeat(64), 1),
    (error) => error.message === "FCM request failed" && !error.stack.includes("never-log-this-token"),
  );
});

test("FCM environment loader is all-or-none and validates service accounts", () => {
  assert.equal(loadFcmProviderFromEnvironment({}, () => ""), null);
  assert.throws(() => loadFcmProviderFromEnvironment({
    HUMHUM_FCM_PROJECT_ID: "humhum-test",
  }, () => ""), /incomplete/i);
  assert.throws(() => loadFcmProviderFromEnvironment({
    HUMHUM_FCM_PROJECT_ID: "humhum-test",
    GOOGLE_APPLICATION_CREDENTIALS: "/secret/account.json",
    HUMHUM_PUSH_TOKEN_KEY: "11".repeat(32),
  }, () => JSON.stringify({ type: "user" })), /service account/i);
});
