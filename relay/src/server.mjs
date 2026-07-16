import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";
import { loadFcmProviderFromEnvironment } from "./fcm.mjs";
import { RelayStore } from "./store.mjs";

const CHANNEL_PATH = /^\/v1\/channels\/([a-f0-9]{64})$/;
const MESSAGES_PATH = /^\/v1\/channels\/([a-f0-9]{64})\/messages$/;
const PUSH_PATH = /^\/v1\/channels\/([a-f0-9]{64})\/push$/;
const TOKEN = /^[a-f0-9]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_CIPHERTEXT_CHARS = 65_536;
const MAX_ENVELOPE_BYTES = 66_000;

function send(response, status, value = null) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  if (value === null) {
    response.writeHead(status).end();
    return;
  }
  const body = JSON.stringify(value);
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.writeHead(status, { "content-length": Buffer.byteLength(body) }).end(body);
}

function unauthorized(response) {
  send(response, 401, { error: "Unauthorized" });
}

function bearer(request) {
  const value = request.headers.authorization;
  if (typeof value !== "string" || !value.startsWith("Bearer ")) return null;
  const token = value.slice(7);
  return TOKEN.test(token) ? token : null;
}

function validServerSecret(value) {
  return typeof value === "string"
    && value.length >= 16
    && value.length <= 256
    && /^[\x21-\x7e]+$/.test(value);
}

function secretMatches(actual, expected) {
  if (typeof actual !== "string") return false;
  const left = createHash("sha256").update(actual, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

async function readJson(request, maxBytes) {
  if (request.headers["content-type"] !== "application/json") throw new Error("content-type");
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error("too-large");
      error.tooLarge = true;
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function exactObject(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === fields.length
    && keys.every((key, index) => key === [...fields].sort()[index]);
}

function validEnvelope(value) {
  return exactObject(value, ["version", "sequence", "nonce", "ciphertext"])
    && value.version === 1
    && Number.isSafeInteger(value.sequence)
    && value.sequence > 0
    && typeof value.nonce === "string"
    && value.nonce.length === 16
    && BASE64URL.test(value.nonce)
    && Buffer.from(value.nonce, "base64url").length === 12
    && typeof value.ciphertext === "string"
    && value.ciphertext.length > 0
    && value.ciphertext.length <= MAX_CIPHERTEXT_CHARS
    && BASE64URL.test(value.ciphertext);
}

function query(url) {
  if ([...url.searchParams.keys()].some((key) => key !== "after" && key !== "wait")) {
    return null;
  }
  if (url.searchParams.getAll("after").length !== 1
      || url.searchParams.getAll("wait").length !== 1) return null;
  const afterText = url.searchParams.get("after");
  const waitText = url.searchParams.get("wait");
  if (!/^\d+$/.test(afterText) || !/^\d+$/.test(waitText)) return null;
  const after = Number(afterText);
  const wait = Number(waitText);
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(wait) || wait < 0 || wait > 20) {
    return null;
  }
  return { after, wait };
}

export function createRateLimiter(clock) {
  const buckets = new Map();
  let lastSweepMinute = -1;
  return {
    allow(key) {
    const minute = Math.floor(clock() / 60_000);
    if (minute !== lastSweepMinute) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.minute < minute - 1) buckets.delete(bucketKey);
      }
      lastSweepMinute = minute;
    }
    const current = buckets.get(key);
    const count = current?.minute === minute ? current.count + 1 : 1;
    buckets.set(key, { minute, count });
    return count <= 300;
    },
    size() {
      return buckets.size;
    },
  };
}

export function rateLimitIdentity(forwarded, remote, trustProxy) {
  if (!trustProxy) return remote || "unknown";
  return typeof forwarded === "string" && isIP(forwarded) ? forwarded : "invalid-proxy";
}

export function createRelayServer({
  databasePath,
  clock = Date.now,
  inviteSecret,
  adminSecret,
  pushTokenKey = null,
  pushProvider = null,
  trustProxy = false,
}) {
  if (!databasePath) throw new Error("databasePath is required");
  if (!validServerSecret(inviteSecret)) {
    throw new Error("inviteSecret must contain 16 to 256 printable characters");
  }
  if (!validServerSecret(adminSecret)) {
    throw new Error("adminSecret must contain 16 to 256 printable characters");
  }
  const store = new RelayStore(databasePath, clock, pushTokenKey);
  const limiter = createRateLimiter(clock);
  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host || "localhost";
      const url = new URL(request.url, `http://${host}`);
      const remote = rateLimitIdentity(
        request.headers["x-forwarded-for"], request.socket.remoteAddress, trustProxy,
      );
      if (!limiter.allow(`ip:${remote}`)) return send(response, 429, { error: "Rate limited" });

      if (request.method === "GET" && url.pathname === "/health" && !url.search) {
        return send(response, 200, { status: "ok", name: "HUMHUM Anywhere Relay" });
      }
      if (request.method === "GET" && url.pathname === "/v1/admin/stats" && !url.search) {
        if (!secretMatches(request.headers["x-humhum-admin"], adminSecret)) {
          return unauthorized(response);
        }
        return send(response, 200, store.stats());
      }
      if (request.method === "POST" && url.pathname === "/v1/channels" && !url.search) {
        if (!secretMatches(request.headers["x-humhum-invite"], inviteSecret)) {
          return unauthorized(response);
        }
        const body = await readJson(request, 64);
        if (!exactObject(body, [])) return send(response, 400, { error: "Invalid request" });
        return send(response, 201, store.createChannel());
      }

      const messageMatch = MESSAGES_PATH.exec(url.pathname);
      if (messageMatch && !limiter.allow(`channel:${messageMatch[1]}`)) {
        return send(response, 429, { error: "Rate limited" });
      }
      if (request.method === "POST" && messageMatch && !url.search) {
        const token = bearer(request);
        if (!token) return unauthorized(response);
        let body;
        try {
          body = await readJson(request, MAX_ENVELOPE_BYTES);
        } catch (error) {
          return send(response, error.tooLarge ? 413 : 400, { error: "Invalid envelope" });
        }
        if (!validEnvelope(body)) {
          return send(
            response,
            body?.ciphertext?.length > MAX_CIPHERTEXT_CHARS ? 413 : 400,
            { error: "Invalid envelope" },
          );
        }
        const result = store.publish(messageMatch[1], token, body);
        if (result === "unauthorized") return unauthorized(response);
        if (result === "sequence") return send(response, 409, { error: "Invalid sequence" });
        const subscription = store.pushSubscription(messageMatch[1]);
        if (subscription && pushProvider && subscription.provider === "fcm") {
          try {
            await pushProvider.sendWake(subscription.token, messageMatch[1], body.sequence);
          } catch {
            return send(response, 503, { error: "Push unavailable" });
          }
        }
        return send(response, 201, { sequence: body.sequence });
      }
      if (request.method === "GET" && messageMatch) {
        const token = bearer(request);
        const options = query(url);
        if (!token) return unauthorized(response);
        if (!options) return send(response, 400, { error: "Invalid query" });
        const deadline = clock() + options.wait * 1_000;
        while (true) {
          const messages = store.messages(messageMatch[1], token, options.after);
          if (messages === null) return unauthorized(response);
          if (messages.length || options.wait === 0 || clock() >= deadline) {
            return send(response, 200, { messages });
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }

      const pushMatch = PUSH_PATH.exec(url.pathname);
      if (request.method === "PUT" && pushMatch && !url.search) {
        const token = bearer(request);
        if (!token) return unauthorized(response);
        let body;
        try {
          body = await readJson(request, 4_224);
        } catch (error) {
          return send(response, error.tooLarge ? 413 : 400, { error: "Invalid push subscription" });
        }
        if (!exactObject(body, ["provider", "token"])
            || body.provider !== "fcm"
            || typeof body.token !== "string"
            || body.token.length === 0
            || body.token.length > 4_096
            || !/^[\x21-\x7e]+$/.test(body.token)) {
          return send(response, body?.token?.length > 4_096 ? 413 : 400, {
            error: "Invalid push subscription",
          });
        }
        if (!pushProvider) return send(response, 503, { error: "Push unavailable" });
        const result = store.putPush(pushMatch[1], token, body.provider, body.token);
        if (result === "unauthorized") return unauthorized(response);
        if (result === "disabled") {
          return send(response, 503, { error: "Push unavailable" });
        }
        return send(response, 204);
      }
      if (request.method === "DELETE" && pushMatch && !url.search) {
        const token = bearer(request);
        if (!token || !store.deletePush(pushMatch[1], token)) return unauthorized(response);
        return send(response, 204);
      }

      const channelMatch = CHANNEL_PATH.exec(url.pathname);
      if (request.method === "DELETE" && channelMatch && !url.search) {
        const token = bearer(request);
        if (!token || !store.delete(channelMatch[1], token)) return unauthorized(response);
        return send(response, 204);
      }
      return send(response, 404, { error: "Not found" });
    } catch {
      if (!response.headersSent) send(response, 400, { error: "Invalid request" });
      else response.destroy();
    }
  });
  const close = server.close.bind(server);
  server.close = (callback) => close(() => {
    store.close();
    callback?.();
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const databasePath = process.env.HUMHUM_RELAY_DB || "./humhum-relay.sqlite";
  const port = Number(process.env.PORT || 3005);
  const inviteSecret = process.env.HUMHUM_RELAY_INVITE_SECRET;
  const adminSecret = process.env.HUMHUM_RELAY_ADMIN_SECRET;
  let pushProvider = null;
  try {
    pushProvider = loadFcmProviderFromEnvironment(process.env);
  } catch {
    process.stderr.write("HUMHUM Wake Relay push configuration is invalid\n");
    process.exit(1);
  }
  const server = createRelayServer({
    databasePath,
    inviteSecret,
    adminSecret,
    pushProvider,
    pushTokenKey: pushProvider ? process.env.HUMHUM_PUSH_TOKEN_KEY : null,
    trustProxy: process.env.HUMHUM_TRUST_PROXY === "1",
  });
  server.listen(port, "0.0.0.0", () => {
    process.stdout.write(`HUMHUM Wake Relay listening on ${port}\n`);
  });
}
