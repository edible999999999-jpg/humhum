import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createRelayServer } from "../src/server.mjs";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function relay(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "humhum-relay-"));
  const databasePath = join(directory, "relay.sqlite");
  const server = createRelayServer({ databasePath, ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { baseUrl, databasePath };
}

async function createChannel(baseUrl) {
  const response = await fetch(`${baseUrl}/v1/channels`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

test("health and channel creation expose no secrets through headers or storage", async () => {
  const { baseUrl, databasePath } = await relay();
  const health = await fetch(`${baseUrl}/health`);
  assert.deepEqual(await health.json(), { status: "ok", name: "HUMHUM Wake Relay" });
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

test("mailboxes retain only 128 bounded envelopes", async () => {
  const { baseUrl } = await relay();
  const channel = await createChannel(baseUrl);
  const oversized = envelope(1, "A".repeat(4_097));
  assert.equal((await publish(
    baseUrl, channel.channel_id, channel.publisher_token, oversized,
  )).status, 413);

  for (let sequence = 1; sequence <= 129; sequence += 1) {
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
