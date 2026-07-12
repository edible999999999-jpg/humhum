import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_MESSAGES = 128;

function randomHex() {
  return randomBytes(32).toString("hex");
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameDigest(left, right) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export class RelayStore {
  constructor(databasePath, clock = Date.now) {
    this.clock = clock;
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        publisher_digest TEXT NOT NULL,
        subscriber_digest TEXT NOT NULL,
        last_sequence INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS messages (
        channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        version INTEGER NOT NULL,
        nonce TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        PRIMARY KEY (channel_id, sequence)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS messages_expiry
        ON messages(channel_id, created_at);
    `);
    this.insertChannel = this.database.prepare(`
      INSERT INTO channels
        (id, publisher_digest, subscriber_digest, last_sequence, created_at)
      VALUES (?, ?, ?, 0, ?)
    `);
    this.selectChannel = this.database.prepare(`
      SELECT publisher_digest, subscriber_digest, last_sequence
      FROM channels WHERE id = ?
    `);
    this.insertMessage = this.database.prepare(`
      INSERT INTO messages
        (channel_id, sequence, created_at, version, nonce, ciphertext)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.updateSequence = this.database.prepare(
      "UPDATE channels SET last_sequence = ? WHERE id = ?",
    );
    this.selectMessages = this.database.prepare(`
      SELECT sequence, version, nonce, ciphertext
      FROM messages
      WHERE channel_id = ? AND sequence > ?
      ORDER BY sequence ASC LIMIT 128
    `);
    this.selectMessage = this.database.prepare(`
      SELECT version, nonce, ciphertext
      FROM messages
      WHERE channel_id = ? AND sequence = ?
    `);
    this.deleteExpired = this.database.prepare(
      "DELETE FROM messages WHERE channel_id = ? AND created_at < ?",
    );
    this.trimMessages = this.database.prepare(`
      DELETE FROM messages
      WHERE channel_id = ? AND sequence NOT IN (
        SELECT sequence FROM messages
        WHERE channel_id = ? ORDER BY sequence DESC LIMIT 128
      )
    `);
    this.deleteChannel = this.database.prepare("DELETE FROM channels WHERE id = ?");
  }

  createChannel() {
    const channelId = randomHex();
    const publisherToken = randomHex();
    const subscriberToken = randomHex();
    this.insertChannel.run(
      channelId,
      digest(publisherToken),
      digest(subscriberToken),
      this.clock(),
    );
    return {
      channel_id: channelId,
      publisher_token: publisherToken,
      subscriber_token: subscriberToken,
    };
  }

  authorize(channelId, token, role) {
    const channel = this.selectChannel.get(channelId);
    if (!channel) return false;
    const expected = role === "publisher"
      ? channel.publisher_digest
      : channel.subscriber_digest;
    return sameDigest(expected, digest(token));
  }

  publish(channelId, token, envelope) {
    if (!this.authorize(channelId, token, "publisher")) return "unauthorized";
    const channel = this.selectChannel.get(channelId);
    if (envelope.sequence !== channel.last_sequence + 1) {
      const existing = this.selectMessage.get(channelId, envelope.sequence);
      if (existing
          && existing.version === envelope.version
          && existing.nonce === envelope.nonce
          && existing.ciphertext === envelope.ciphertext) return "duplicate";
      return "sequence";
    }
    const now = this.clock();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.insertMessage.run(
        channelId,
        envelope.sequence,
        now,
        envelope.version,
        envelope.nonce,
        envelope.ciphertext,
      );
      this.updateSequence.run(envelope.sequence, channelId);
      this.deleteExpired.run(channelId, now - RETENTION_MS);
      this.trimMessages.run(channelId, channelId);
      this.database.exec("COMMIT");
      return "created";
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  messages(channelId, token, after) {
    if (!this.authorize(channelId, token, "subscriber")) return null;
    this.deleteExpired.run(channelId, this.clock() - RETENTION_MS);
    return this.selectMessages.all(channelId, after);
  }

  delete(channelId, token) {
    const authorized = this.authorize(channelId, token, "publisher")
      || this.authorize(channelId, token, "subscriber");
    if (!authorized) return false;
    this.deleteChannel.run(channelId);
    return true;
  }

  close() {
    this.database.close();
  }
}
