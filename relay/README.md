# HUMHUM Wake Relay

This service is a deliberately opaque mailbox for encrypted Android wake envelopes. It stores channel identifiers, SHA-256 credential digests, sequence numbers, timestamps, nonces and ciphertext. Encryption keys and HUMHUM session data never reach the relay.

## Run Locally

Node 22.13 or newer is required.

```bash
cd relay
HUMHUM_RELAY_DB="$HOME/.humhum/relay.sqlite" PORT=3005 node src/server.mjs
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

- 4,096-character ciphertext field per envelope.
- 128 newest envelopes per channel.
- 24-hour envelope retention.
- 20-second maximum long poll.
- 300 requests per minute per source IP and channel.
- No browser CORS access.

The relay cannot decrypt, forge or execute a HUMHUM command. Android still uses the separately authenticated, certificate-pinned Mobile Bridge after receiving a wake.

## Test

```bash
node --test relay/test/relay.test.mjs
```

Tests start a real HTTP server and SQLite database, then inspect persistence to prove raw publisher and subscriber tokens are absent.
