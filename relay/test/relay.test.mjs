import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createRateLimiter, createRelayServer, rateLimitIdentity } from "../src/server.mjs";

const cleanups = [];
const PUSH_TOKEN_KEY = "11".repeat(32);
const INVITE_SECRET = "humhum-beta-invite-2026";
const ADMIN_SECRET = "humhum-beta-admin-2026";
const NOOP_PUSH_PROVIDER = { async sendWake() {} };
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function relay(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "humhum-relay-"));
  const databasePath = join(directory, "relay.sqlite");
  const server = createRelayServer({
    databasePath,
    inviteSecret: INVITE_SECRET,
    adminSecret: ADMIN_SECRET,
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { baseUrl, databasePath };
}

async function createChannel(baseUrl, inviteSecret = INVITE_SECRET) {
  const response = await fetch(`${baseUrl}/v1/channels`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-humhum-invite": inviteSecret,
    },
    body: "{}",
  });
  assert.equal(response.status, 201);
  return response.json();
}

function envelope(sequence, ciphertext = "AQIDBA") {
  return { version: 1, sequence, nonce: "AAECAwQFBgcICQoL", ciphertext };
}

async function publish(baseUrl, channel, token, body) {
  return fetch(`${baseUrl}/v1/channels/${channel}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function putPush(baseUrl, channel, token, body) {
  return fetch(`${baseUrl}/v1/channels/${channel}/push`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function publishAndDropResponse(baseUrl, channel, token, body) {
  const url = new URL(baseUrl);
  const payload = JSON.stringify(body);
  await new Promise((resolve, reject) => {
    const socket = connect(Number(url.port), url.hostname, () => {
      const request = [
        `POST /v1/channels/${channel}/messages HTTP/1.1`,
        `Host: ${url.host}`,
        `Authorization: Bearer ${token}`,
        "Content-Type: application/json",
        `Content-Length: ${Buffer.byteLength(payload)}`,
        "Connection: close",
        "",
        payload,
      ].join("\r\n");
      socket.write(request, () => {
        socket.destroy();
        resolve();
      });
    });
    socket.on("error", reject);
  });
}

async function waitForSequence(databasePath, channelId, sequence) {
  const database = new DatabaseSync(databasePath);
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const row = database.prepare(
        "SELECT last_sequence FROM channels WHERE id = ?",
      ).get(channelId);
      if (row?.last_sequence === sequence) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    database.close();
  }
  assert.fail(`sequence ${sequence} was not committed`);
}

test("health and channel creation expose no secrets through headers or storage", async () => {
  const { baseUrl, databasePath } = await relay();
  const health = await fetch(`${baseUrl}/health`);
  assert.deepEqual(await health.json(), { status: "ok", name: "HUMHUM Anywhere Relay" });
  assert.equal(health.headers.get("access-control-allow-origin"), null);
  assert.equal(health.headers.get("cache-control"), "no-store");

  const channel = await createChannel(baseUrl);
  assert.match(channel.channel_id, /^[a-f0-9]{64}$/);
  assert.match(channel.publisher_token, /^[a-f0-9]{64}$/);
  assert.match(channel.subscriber_token, /^[a-f0-9]{64}$/);
  assert.notEqual(channel.publisher_token, channel.subscriber_token);

  const database = new DatabaseSync(databasePath);
  const stored = database.prepare(
    "SELECT publisher_digest, subscriber_digest FROM channels WHERE id = ?",
  ).get(channel.channel_id);
  database.close();
  assert.match(stored.publisher_digest, /^[a-f0-9]{64}$/);
  assert.match(stored.subscriber_digest, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.publisher_digest, channel.publisher_token);
  assert.notEqual(stored.subscriber_digest, channel.subscriber_token);
  const bytes = await readFile(databasePath);
  assert.equal(bytes.includes(Buffer.from(channel.publisher_token)), false);
  assert.equal(bytes.includes(Buffer.from(channel.subscriber_token)), false);
});

test("channel creation is invite-only and admin capacity stays private", async () => {
  const { baseUrl } = await relay();
  for (const inviteSecret of ["", "wrong-invite-secret"]) {
    const response = await fetch(`${baseUrl}/v1/channels`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(inviteSecret ? { "x-humhum-invite": inviteSecret } : {}),
      },
      body: "{}",
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  }

  await createChannel(baseUrl);
  const hidden = await fetch(`${baseUrl}/v1/admin/stats`);
  assert.equal(hidden.status, 401);
  assert.deepEqual(await hidden.json(), { error: "Unauthorized" });
  const stats = await fetch(`${baseUrl}/v1/admin/stats`, {
    headers: { "x-humhum-admin": ADMIN_SECRET },
  });
  assert.equal(stats.status, 200);
  assert.deepEqual(await stats.json(), {
    channels: 1,
    messages: 0,
    push_subscriptions: 0,
  });
});

test("publisher and subscriber credentials are separated with generic failures", async () => {
  const { baseUrl } = await relay();
  const channel = await createChannel(baseUrl);

  assert.equal((await publish(
    baseUrl, channel.channel_id, channel.publisher_token, envelope(1),
  )).status, 201);
  assert.equal((await publish(
    baseUrl, channel.channel_id, channel.subscriber_token, envelope(2),
  )).status, 401);

  const denied = await fetch(
    `${baseUrl}/v1/channels/${channel.channel_id}/messages?after=0&wait=0`,
    { headers: { authorization: `Bearer ${channel.publisher_token}` } },
  );
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: "Unauthorized" });

  const allowed = await fetch(
    `${baseUrl}/v1/channels/${channel.channel_id}/messages?after=0&wait=0`,
    { headers: { authorization: `Bearer ${channel.subscriber_token}` } },
  );
  assert.equal(allowed.status, 200);
  assert.deepEqual((await allowed.json()).messages, [envelope(1)]);
});

test("sequences are monotonic and a waiting subscriber wakes for new ciphertext", async () => {
  const { baseUrl } = await relay();
  const channel = await createChannel(baseUrl);

  assert.equal((await publish(
    baseUrl, channel.channel_id, channel.publisher_token, envelope(2),
  )).status, 409);

  const waiting = fetch(
    `${baseUrl}/v1/channels/${channel.channel_id}/messages?after=0&wait=2`,
    { headers: { authorization: `Bearer ${channel.subscriber_token}` } },
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal((await publish(
    baseUrl, channel.channel_id, channel.publisher_token, envelope(1),
  )).status, 201);
  const response = await waiting;
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).messages, [envelope(1)]);
});

test("identical publication retry is idempotent after the first response is lost", async () => {
  const { baseUrl, databasePath } = await relay();
  const channel = await createChannel(baseUrl);
  const first = envelope(1);

  await publishAndDropResponse(
    baseUrl,
    channel.channel_id,
    channel.publisher_token,
    first,
  );
  await waitForSequence(databasePath, channel.channel_id, 1);

  const retried = await publish(
    baseUrl,
    channel.channel_id,
    channel.publisher_token,
    first,
  );
  assert.equal(retried.status, 201);
  assert.deepEqual(await retried.json(), { sequence: 1 });
  assert.equal((await publish(
    baseUrl,
    channel.channel_id,
    channel.publisher_token,
    envelope(1, "DIFFERENT"),
  )).status, 409);
});

test("push subscription is subscriber-only and encrypted at rest", async () => {
  const { baseUrl, databasePath } = await relay({
    pushTokenKey: PUSH_TOKEN_KEY,
    pushProvider: NOOP_PUSH_PROVIDER,
  });
  const channel = await createChannel(baseUrl);
  const token = "fcm:opaque-registration-token-123";

  assert.equal((await putPush(
    baseUrl,
    channel.channel_id,
    channel.publisher_token,
    { provider: "fcm", token },
  )).status, 401);
  assert.equal((await putPush(
    baseUrl,
    channel.channel_id,
    channel.subscriber_token,
    { provider: "fcm", token },
  )).status, 204);

  const database = new DatabaseSync(databasePath);
  const stored = database.prepare(
    "SELECT provider, nonce, ciphertext FROM push_subscriptions WHERE channel_id = ?",
  ).get(channel.channel_id);
  database.close();
  assert.equal(stored.provider, "fcm");
  assert.match(stored.nonce, /^[A-Za-z0-9_-]{16}$/);
  assert.notEqual(stored.ciphertext, token);
  const bytes = await readFile(databasePath);
  assert.equal(bytes.includes(Buffer.from(token)), false);
});

test("push subscription replaces, deletes, and cascades with its channel", async () => {
  const { baseUrl, databasePath } = await relay({
    pushTokenKey: PUSH_TOKEN_KEY,
    pushProvider: NOOP_PUSH_PROVIDER,
  });
  const first = await createChannel(baseUrl);
  const second = await createChannel(baseUrl);

  for (const token of ["fcm:first-token", "fcm:rotated-token"]) {
    assert.equal((await putPush(
      baseUrl,
      first.channel_id,
      first.subscriber_token,
      { provider: "fcm", token },
    )).status, 204);
  }
  assert.equal((await putPush(
    baseUrl,
    second.channel_id,
    second.subscriber_token,
    { provider: "fcm", token: "fcm:second-token" },
  )).status, 204);

  assert.equal((await fetch(`${baseUrl}/v1/channels/${first.channel_id}/push`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${first.subscriber_token}` },
  })).status, 204);
  assert.equal((await fetch(`${baseUrl}/v1/channels/${second.channel_id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${second.publisher_token}` },
  })).status, 204);

  const database = new DatabaseSync(databasePath);
  assert.equal(database.prepare("SELECT count(*) AS count FROM push_subscriptions").get().count, 0);
  database.close();
});

test("push subscription rejects disabled, malformed, and oversized requests", async () => {
  const disabled = await relay();
  const disabledChannel = await createChannel(disabled.baseUrl);
  assert.equal((await putPush(
    disabled.baseUrl,
    disabledChannel.channel_id,
    disabledChannel.subscriber_token,
    { provider: "fcm", token: "fcm:token" },
  )).status, 503);

  const { baseUrl } = await relay({
    pushTokenKey: PUSH_TOKEN_KEY,
    pushProvider: NOOP_PUSH_PROVIDER,
  });
  const channel = await createChannel(baseUrl);
  for (const body of [
    { provider: "other", token: "fcm:token" },
    { provider: "fcm", token: "" },
    { provider: "fcm", token: "fcm:token", extra: true },
  ]) {
    assert.equal((await putPush(
      baseUrl, channel.channel_id, channel.subscriber_token, body,
    )).status, 400);
  }
  assert.equal((await putPush(
    baseUrl,
    channel.channel_id,
    channel.subscriber_token,
    { provider: "fcm", token: "A".repeat(4_097) },
  )).status, 413);
});

test("push delivery retries the same durable envelope after provider failure", async () => {
  const calls = [];
  const pushProvider = {
    async sendWake(token, channel, sequence) {
      calls.push({ token, channel, sequence });
      if (calls.length === 1) throw new Error("provider unavailable");
    },
  };
  const { baseUrl, databasePath } = await relay({
    pushTokenKey: PUSH_TOKEN_KEY,
    pushProvider,
  });
  const channel = await createChannel(baseUrl);
  assert.equal((await putPush(
    baseUrl,
    channel.channel_id,
    channel.subscriber_token,
    { provider: "fcm", token: "fcm:retry-token" },
  )).status, 204);
  const first = envelope(1);

  assert.equal((await publish(
    baseUrl, channel.channel_id, channel.publisher_token, first,
  )).status, 503);
  await waitForSequence(databasePath, channel.channel_id, 1);
  assert.equal((await publish(
    baseUrl, channel.channel_id, channel.publisher_token, first,
  )).status, 201);
  assert.deepEqual(calls, [
    { token: "fcm:retry-token", channel: channel.channel_id, sequence: 1 },
    { token: "fcm:retry-token", channel: channel.channel_id, sequence: 1 },
  ]);
  assert.equal((await publish(
    baseUrl,
    channel.channel_id,
    channel.publisher_token,
    envelope(1, "DIFFERENT"),
  )).status, 409);
  assert.equal(calls.length, 2);
});

test("mailboxes retain only 128 bounded envelopes", async () => {
  const { baseUrl } = await relay();
  const channel = await createChannel(baseUrl);
  const largest = envelope(1, "A".repeat(65_536));
  assert.equal((await publish(
    baseUrl, channel.channel_id, channel.publisher_token, largest,
  )).status, 201);
  const oversized = envelope(2, "A".repeat(65_537));
  assert.equal((await publish(
    baseUrl, channel.channel_id, channel.publisher_token, oversized,
  )).status, 413);

  for (let sequence = 2; sequence <= 129; sequence += 1) {
    assert.equal((await publish(
      baseUrl, channel.channel_id, channel.publisher_token, envelope(sequence),
    )).status, 201);
  }
  const response = await fetch(
    `${baseUrl}/v1/channels/${channel.channel_id}/messages?after=0&wait=0`,
    { headers: { authorization: `Bearer ${channel.subscriber_token}` } },
  );
  const messages = (await response.json()).messages;
  assert.equal(messages.length, 128);
  assert.equal(messages[0].sequence, 2);
  assert.equal(messages.at(-1).sequence, 129);
});

test("expired ciphertext disappears and either credential can delete the channel", async () => {
  let now = 1_800_000_000_000;
  const { baseUrl } = await relay({ clock: () => now });
  const first = await createChannel(baseUrl);
  assert.equal((await publish(
    baseUrl, first.channel_id, first.publisher_token, envelope(1),
  )).status, 201);
  now += 24 * 60 * 60 * 1_000 + 1;
  const expired = await fetch(
    `${baseUrl}/v1/channels/${first.channel_id}/messages?after=0&wait=0`,
    { headers: { authorization: `Bearer ${first.subscriber_token}` } },
  );
  assert.deepEqual((await expired.json()).messages, []);

  const deletion = await fetch(`${baseUrl}/v1/channels/${first.channel_id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${first.subscriber_token}` },
  });
  assert.equal(deletion.status, 204);
  const gone = await fetch(
    `${baseUrl}/v1/channels/${first.channel_id}/messages?after=0&wait=0`,
    { headers: { authorization: `Bearer ${first.subscriber_token}` } },
  );
  assert.equal(gone.status, 401);
});

test("strict query, JSON shape, and rate bounds fail closed", async () => {
  const { baseUrl } = await relay();
  const channel = await createChannel(baseUrl);
  const invalidQuery = await fetch(
    `${baseUrl}/v1/channels/${channel.channel_id}/messages?after=0&wait=21`,
    { headers: { authorization: `Bearer ${channel.subscriber_token}` } },
  );
  assert.equal(invalidQuery.status, 400);
  const ambiguous = await publish(
    baseUrl,
    channel.channel_id,
    channel.publisher_token,
    { ...envelope(1), plaintext: "not allowed" },
  );
  assert.equal(ambiguous.status, 400);

  let finalStatus = 0;
  for (let request = 0; request < 301; request += 1) {
    finalStatus = (await fetch(`${baseUrl}/health`)).status;
  }
  assert.equal(finalStatus, 429);
});

test("rate limiter expires old unauthenticated buckets", () => {
  let now = 0;
  const limiter = createRateLimiter(() => now);
  for (let index = 0; index < 300; index += 1) {
    assert.equal(limiter.allow(`random:${index}`), true);
  }
  assert.equal(limiter.size(), 300);

  now = 3 * 60_000;
  assert.equal(limiter.allow("current"), true);
  assert.equal(limiter.size(), 1);
});

test("proxy rate identity is explicit and rejects spoofed lists", () => {
  assert.equal(rateLimitIdentity("203.0.113.4", "172.18.0.2", true), "203.0.113.4");
  assert.equal(rateLimitIdentity("1.1.1.1, 2.2.2.2", "172.18.0.2", true), "invalid-proxy");
  assert.equal(rateLimitIdentity("203.0.113.4", "127.0.0.1", false), "127.0.0.1");
});
