import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createRelayServer } from "../src/server.mjs";

const USERS = 30;
const CHANNELS = USERS * 2;
const ACTIVE_PUBLISHERS = 15;
const INVITE = "load-invite-secret-0123456789";
const ADMIN = "load-admin-secret-0123456789";

const directory = await mkdtemp(join(tmpdir(), "humhum-relay-load-"));
const server = createRelayServer({
  databasePath: join(directory, "relay.sqlite"),
  inviteSecret: INVITE,
  adminSecret: ADMIN,
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const rssBefore = process.memoryUsage().rss;

try {
  const channels = await Promise.all(Array.from({ length: CHANNELS }, async () => {
    const response = await fetch(`${baseUrl}/v1/channels`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-humhum-invite": INVITE,
      },
      body: "{}",
    });
    assert.equal(response.status, 201);
    return response.json();
  }));

  const started = performance.now();
  const polls = channels.map(async (channel) => {
    const before = performance.now();
    const response = await fetch(
      `${baseUrl}/v1/channels/${channel.channel_id}/messages?after=0&wait=1`,
      { headers: { authorization: `Bearer ${channel.subscriber_token}` } },
    );
    assert.equal(response.status, 200);
    return { latency: performance.now() - before, body: await response.json() };
  });

  await new Promise((resolve) => setTimeout(resolve, 100));
  const publications = await Promise.all(
    channels.slice(0, ACTIVE_PUBLISHERS).map(async (channel, index) => {
      const before = performance.now();
      const response = await fetch(
        `${baseUrl}/v1/channels/${channel.channel_id}/messages`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${channel.publisher_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            version: 1,
            sequence: 1,
            nonce: "AAECAwQFBgcICQoL",
            ciphertext: Buffer.alloc(1_024, index + 1).toString("base64url"),
          }),
        },
      );
      assert.equal(response.status, 201);
      return performance.now() - before;
    }),
  );
  const results = await Promise.all(polls);
  const total = performance.now() - started;
  assert.equal(results.filter(({ body }) => body.messages.length === 1).length, ACTIVE_PUBLISHERS);
  assert.equal(results.filter(({ body }) => body.messages.length === 0).length,
    CHANNELS - ACTIVE_PUBLISHERS);

  const statsResponse = await fetch(`${baseUrl}/v1/admin/stats`, {
    headers: { "x-humhum-admin": ADMIN },
  });
  assert.equal(statsResponse.status, 200);
  assert.deepEqual(await statsResponse.json(), {
    channels: CHANNELS,
    messages: ACTIVE_PUBLISHERS,
    push_subscriptions: 0,
  });

  const sorted = publications.toSorted((left, right) => left - right);
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const rssDeltaMiB = (process.memoryUsage().rss - rssBefore) / 1024 / 1024;
  assert.ok(total < 3_000, `load round took ${Math.round(total)} ms`);
  assert.ok(p95 < 2_000, `publish p95 was ${Math.round(p95)} ms`);
  assert.ok(rssDeltaMiB < 256, `RSS grew by ${rssDeltaMiB.toFixed(1)} MiB`);
  process.stdout.write(JSON.stringify({
    users: USERS,
    long_polls: CHANNELS,
    active_publishers: ACTIVE_PUBLISHERS,
    total_ms: Math.round(total),
    publish_p95_ms: Math.round(p95),
    rss_delta_mib: Number(rssDeltaMiB.toFixed(1)),
  }, null, 2) + "\n");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
