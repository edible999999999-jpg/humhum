# HUMHUM Anywhere Relay

This service is a deliberately opaque mailbox for encrypted Android wake envelopes. It stores channel identifiers, SHA-256 credential digests, sequence numbers, timestamps, nonces and ciphertext. Encryption keys and HUMHUM session data never reach the relay.

## Run Locally

Node 22.13 or newer is required.

```bash
cd relay
HUMHUM_RELAY_DB="$HOME/.humhum/relay.sqlite" \
HUMHUM_RELAY_INVITE_SECRET="$(openssl rand -hex 24)" \
HUMHUM_RELAY_ADMIN_SECRET="$(openssl rand -hex 24)" \
PORT=3005 node src/server.mjs
```

Check it without creating a channel:

```bash
curl http://127.0.0.1:3005/health
```

Loopback HTTP exists for development only. Android and HUMHUM desktop require HTTPS for non-loopback relay URLs.

## Docker

```bash
docker build -t humhum-wake-relay relay
docker run --rm -p 3005:3005 -v humhum-relay:/data humhum-wake-relay
```

For network use, place the container behind a TLS reverse proxy such as Caddy or nginx. Do not expose its SQLite volume through a web server. Backing up the volume preserves only ciphertext and credential digests, but access timing and channel metadata are still private operational data.

## Limits

- 65,536-character ciphertext field per envelope.
- 128 newest envelopes per channel.
- 24-hour envelope retention.
- 20-second maximum long poll.
- 300 requests per minute per source IP and channel.
- No browser CORS access.

Creating a channel requires the beta invite secret. Capacity statistics require the separate admin secret at `GET /v1/admin/stats`; neither secret is stored in SQLite. The relay cannot decrypt, forge or execute a HUMHUM command.

## Optional FCM Wake

FCM can wake an Android process that the operating system reclaimed. It remains disabled unless all three server variables are present:

```bash
export HUMHUM_PUSH_TOKEN_KEY="$(openssl rand -hex 32)"
export HUMHUM_FCM_PROJECT_ID="your-firebase-project-id"
export GOOGLE_APPLICATION_CREDENTIALS="/run/secrets/firebase-service-account.json"
```

Keep the token key stable with the SQLite volume and store both secrets outside the repository. The service account needs permission to send Firebase Cloud Messaging HTTP v1 messages to the target project. HUMHUM signs short-lived OAuth assertions in memory and never stores access tokens.

Android registers one opaque FCM token per relay channel. The token is AES-256-GCM encrypted in SQLite under `HUMHUM_PUSH_TOKEN_KEY`. FCM receives only a high-priority data wake containing `kind`, opaque channel ID and sequence; it never receives session, project, Agent, approval or message text. If FCM rejects a wake, the relay returns `503` so desktop retries the exact already-stored encrypted envelope.

FCM requires a release APK built with the matching public Firebase Android client identifiers. Without them, existing encrypted long polling and pinned private-network wake continue normally.

## Test

```bash
node --test relay/test/*.test.mjs
```

Tests start a real HTTP server and SQLite database, then inspect persistence to prove raw publisher, subscriber and FCM registration tokens are absent. The FCM tests use an ephemeral RSA service account and injected HTTP transport; they do not contact Google.
