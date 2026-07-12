import { sign } from "node:crypto";
import { readFileSync } from "node:fs";

const OAUTH_AUDIENCE = "https://oauth2.googleapis.com/token";
const MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const PROJECT_ID = /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/;
const CHANNEL = /^[a-f0-9]{64}$/;

function encoded(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function validateServiceAccount(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.type !== "service_account"
      || typeof value.client_email !== "string"
      || !/^[^\s@]+@[^\s@]+$/.test(value.client_email)
      || typeof value.private_key !== "string"
      || !value.private_key.includes("BEGIN PRIVATE KEY")
      || value.token_uri !== OAUTH_AUDIENCE) {
    throw new Error("Invalid FCM service account");
  }
  return value;
}

function validateProjectId(value) {
  if (typeof value !== "string" || !PROJECT_ID.test(value)) {
    throw new Error("Invalid FCM project ID");
  }
  return value;
}

async function boundedFetch(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch {
    throw new Error("FCM request failed");
  } finally {
    clearTimeout(timeout);
  }
}

export function createFcmProvider({
  projectId,
  serviceAccount,
  fetchImpl = fetch,
  clock = Date.now,
  timeoutMs = 5_000,
}) {
  const targetProject = validateProjectId(projectId);
  const account = validateServiceAccount(serviceAccount);
  if (typeof fetchImpl !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error("Invalid FCM provider options");
  }
  let cachedToken = null;
  let refreshAfter = 0;

  async function accessToken() {
    const now = clock();
    if (cachedToken && now < refreshAfter) return cachedToken;
    const seconds = Math.floor(now / 1_000);
    const header = encoded({ alg: "RS256", typ: "JWT" });
    const claims = encoded({
      iss: account.client_email,
      sub: account.client_email,
      aud: OAUTH_AUDIENCE,
      scope: MESSAGING_SCOPE,
      iat: seconds,
      exp: seconds + 3_600,
    });
    const unsigned = `${header}.${claims}`;
    let signature;
    try {
      signature = sign("RSA-SHA256", Buffer.from(unsigned, "ascii"), account.private_key)
        .toString("base64url");
    } catch {
      throw new Error("FCM credential failed");
    }
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }).toString();
    const response = await boundedFetch(fetchImpl, OAUTH_AUDIENCE, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }, timeoutMs);
    if (!response.ok) throw new Error("FCM authentication failed");
    let value;
    try {
      value = await response.json();
    } catch {
      throw new Error("FCM authentication failed");
    }
    if (!value || typeof value.access_token !== "string" || value.access_token.length === 0
        || !Number.isInteger(value.expires_in) || value.expires_in < 60 || value.expires_in > 86_400) {
      throw new Error("FCM authentication failed");
    }
    cachedToken = value.access_token;
    refreshAfter = now + Math.max(0, value.expires_in - 60) * 1_000;
    return cachedToken;
  }

  return Object.freeze({
    async sendWake(registrationToken, channel, sequence) {
      if (typeof registrationToken !== "string" || registrationToken.length === 0
          || registrationToken.length > 4_096 || !/^[\x21-\x7e]+$/.test(registrationToken)
          || !CHANNEL.test(channel)
          || !Number.isSafeInteger(sequence) || sequence <= 0) {
        throw new Error("Invalid FCM wake");
      }
      try {
        const token = await accessToken();
        const response = await boundedFetch(
          fetchImpl,
          `https://fcm.googleapis.com/v1/projects/${targetProject}/messages:send`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json; charset=utf-8",
            },
            body: JSON.stringify({
              message: {
                token: registrationToken,
                data: {
                  kind: "humhum_wake",
                  channel,
                  sequence: String(sequence),
                },
                android: {
                  priority: "high",
                  collapse_key: channel,
                  ttl: "60s",
                },
              },
            }),
          },
          timeoutMs,
        );
        if (!response.ok) throw new Error("FCM delivery failed");
      } catch (error) {
        if (error?.message?.startsWith("FCM ")) throw error;
        throw new Error("FCM request failed");
      }
    },
  });
}

export function loadFcmProviderFromEnvironment(
  env,
  readFile = (path) => readFileSync(path, "utf8"),
  fetchImpl = fetch,
  clock = Date.now,
) {
  const values = [
    env.HUMHUM_FCM_PROJECT_ID,
    env.GOOGLE_APPLICATION_CREDENTIALS,
    env.HUMHUM_PUSH_TOKEN_KEY,
  ];
  if (values.every((value) => value === undefined || value === "")) return null;
  if (values.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new Error("Incomplete FCM configuration");
  }
  if (!/^[a-f0-9]{64}$/.test(env.HUMHUM_PUSH_TOKEN_KEY)) {
    throw new Error("Invalid FCM push token key");
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(readFile(env.GOOGLE_APPLICATION_CREDENTIALS));
  } catch {
    throw new Error("Invalid FCM service account");
  }
  return createFcmProvider({
    projectId: env.HUMHUM_FCM_PROJECT_ID,
    serviceAccount,
    fetchImpl,
    clock,
  });
}
