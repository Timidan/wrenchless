import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  HeartbeatEnvelopeSchema,
  type HeartbeatEnvelope,
} from "@wrenchless/canary-core";
import { z } from "zod";

const MAX_ACTIVE_ENVELOPES = 256;
const MAX_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MILLISECONDS = 5 * 60 * 1_000;

const mailboxRowSchema = z.object({
  receive_capability_hash: z.string().regex(/^[0-9a-f]{64}$/),
  bind_capability_hash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  sender_signing_public_key: z.string().regex(/^04[0-9a-f]{128}$/).nullable(),
  sender_encryption_public_key: z.string().regex(/^04[0-9a-f]{128}$/).nullable(),
});

const columnSchema = z.object({ name: z.string() });

const countRowSchema = z.object({ count: z.number().int().nonnegative() });

const envelopeRowSchema = z.object({
  envelope_json: z.string().min(1),
});

export type MailboxEnrollment = {
  mailboxId: string;
  bindCapability: string;
  receiveCapability: string;
};

export type StoreEnvelopeResult = "stored" | "duplicate";

export type MailboxSenderKeys = {
  signingPublicKey: string;
  encryptionPublicKey: string;
};

export class MailboxStoreError extends Error {
  constructor(
    readonly code:
      | "unauthorized"
      | "expired"
      | "invalid_retention"
      | "mailbox_full"
      | "message_conflict"
      | "sender_not_bound",
  ) {
    super(code);
    this.name = "MailboxStoreError";
  }
}

function randomHex(byteLength: number): string {
  return randomBytes(byteLength).toString("hex");
}

function hashCapability(capability: string): string {
  return createHash("sha256").update(capability, "utf8").digest("hex");
}

function validCapability(candidate: string, expectedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(candidate)) {
    return false;
  }
  const actual = Buffer.from(hashCapability(candidate), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class MailboxStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

    const legacyColumns = new Set(
      this.database
        .prepare("PRAGMA table_info(mailboxes)")
        .all()
        .map((row) => columnSchema.parse(row).name),
    );
    if (legacyColumns.has("send_capability_hash")) {
      // Signed delivery cannot safely reuse a v1 mailbox: its invitation has no
      // bound signing or encryption key. The hub also starts a v2 setup, so
      // retaining these short-lived opaque rows would only preserve dead data.
      this.database.exec("DROP TABLE IF EXISTS envelopes; DROP TABLE mailboxes;");
    }

    this.database.exec(`
      CREATE TABLE IF NOT EXISTS mailboxes (
        mailbox_id TEXT PRIMARY KEY,
        receive_capability_hash TEXT NOT NULL,
        bind_capability_hash TEXT,
        sender_signing_public_key TEXT,
        sender_encryption_public_key TEXT,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS envelopes (
        mailbox_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        envelope_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (mailbox_id, message_id),
        FOREIGN KEY (mailbox_id) REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX IF NOT EXISTS envelopes_expiry
        ON envelopes(expires_at);
    `);
  }

  close(): void {
    this.database.close();
  }

  createMailbox(now = Date.now()): MailboxEnrollment {
    const mailboxId = randomHex(16);
    const bindCapability = randomHex(32);
    const receiveCapability = randomHex(32);
    this.database
      .prepare(
        `INSERT INTO mailboxes (
          mailbox_id,
          receive_capability_hash,
          bind_capability_hash,
          sender_signing_public_key,
          sender_encryption_public_key,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        mailboxId,
        hashCapability(receiveCapability),
        hashCapability(bindCapability),
        null,
        null,
        now,
      );
    return { mailboxId, bindCapability, receiveCapability };
  }

  private authorize(
    mailboxId: string,
    capability: string,
  ): void {
    const row = mailboxRowSchema.safeParse(
      this.database
        .prepare(
          `SELECT receive_capability_hash, bind_capability_hash,
                  sender_signing_public_key, sender_encryption_public_key
           FROM mailboxes WHERE mailbox_id = ?`,
        )
        .get(mailboxId),
    );
    if (!row.success) {
      throw new MailboxStoreError("unauthorized");
    }
    const expected = row.data.receive_capability_hash;
    if (!validCapability(capability, expected)) {
      throw new MailboxStoreError("unauthorized");
    }
  }

  bindSender(
    mailboxId: string,
    bindCapability: string,
    senderSigningPublicKey: string,
    senderEncryptionPublicKey: string,
  ): void {
    if (
      !/^04[0-9a-f]{128}$/.test(senderSigningPublicKey) ||
      !/^04[0-9a-f]{128}$/.test(senderEncryptionPublicKey)
    ) {
      throw new MailboxStoreError("unauthorized");
    }
    const row = mailboxRowSchema.safeParse(
      this.database
        .prepare(
          `SELECT receive_capability_hash, bind_capability_hash,
                  sender_signing_public_key, sender_encryption_public_key
           FROM mailboxes WHERE mailbox_id = ?`,
        )
        .get(mailboxId),
    );
    if (
      row.success &&
      row.data.sender_signing_public_key === senderSigningPublicKey &&
      row.data.sender_encryption_public_key === senderEncryptionPublicKey
    ) {
      return;
    }
    if (!row.success || row.data.bind_capability_hash === null) {
      throw new MailboxStoreError("unauthorized");
    }
    if (!validCapability(bindCapability, row.data.bind_capability_hash)) {
      throw new MailboxStoreError("unauthorized");
    }
    this.database
      .prepare(
        `UPDATE mailboxes
         SET sender_signing_public_key = ?,
             sender_encryption_public_key = ?,
             bind_capability_hash = NULL
         WHERE mailbox_id = ?`,
      )
      .run(senderSigningPublicKey, senderEncryptionPublicKey, mailboxId);
  }

  senderKeys(mailboxId: string): MailboxSenderKeys {
    const row = mailboxRowSchema.safeParse(
      this.database
        .prepare(
          `SELECT receive_capability_hash, bind_capability_hash,
                  sender_signing_public_key, sender_encryption_public_key
           FROM mailboxes WHERE mailbox_id = ?`,
        )
        .get(mailboxId),
    );
    if (
      !row.success ||
      row.data.sender_signing_public_key === null ||
      row.data.sender_encryption_public_key === null
    ) {
      throw new MailboxStoreError("sender_not_bound");
    }
    return {
      signingPublicKey: row.data.sender_signing_public_key,
      encryptionPublicKey: row.data.sender_encryption_public_key,
    };
  }

  deleteExpired(now = Date.now()): number {
    const result = this.database
      .prepare("DELETE FROM envelopes WHERE expires_at <= ?")
      .run(now);
    return Number(result.changes);
  }

  storeEnvelope(
    mailboxId: string,
    envelopeInput: HeartbeatEnvelope,
    now = Date.now(),
  ): StoreEnvelopeResult {
    this.senderKeys(mailboxId);
    const envelope = HeartbeatEnvelopeSchema.parse(envelopeInput);
    const createdAt = Date.parse(envelope.createdAt);
    const expiresAt = Date.parse(envelope.expiresAt);
    if (expiresAt <= now) {
      throw new MailboxStoreError("expired");
    }
    if (
      expiresAt - createdAt > MAX_RETENTION_MILLISECONDS ||
      createdAt > now + MAX_CLOCK_SKEW_MILLISECONDS
    ) {
      throw new MailboxStoreError("invalid_retention");
    }

    this.deleteExpired(now);
    const envelopeJson = JSON.stringify(envelope);
    const existing = envelopeRowSchema.safeParse(
      this.database
        .prepare(
          `SELECT envelope_json FROM envelopes
           WHERE mailbox_id = ? AND message_id = ?`,
        )
        .get(mailboxId, envelope.messageId),
    );
    if (existing.success) {
      if (existing.data.envelope_json === envelopeJson) {
        return "duplicate";
      }
      throw new MailboxStoreError("message_conflict");
    }

    const count = countRowSchema.parse(
      this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM envelopes
           WHERE mailbox_id = ?`,
        )
        .get(mailboxId),
    );
    if (count.count >= MAX_ACTIVE_ENVELOPES) {
      throw new MailboxStoreError("mailbox_full");
    }

    this.database
      .prepare(
        `INSERT INTO envelopes (
          mailbox_id, message_id, envelope_json, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        mailboxId,
        envelope.messageId,
        envelopeJson,
        createdAt,
        expiresAt,
      );
    return "stored";
  }

  listEnvelopes(
    mailboxId: string,
    receiveCapability: string,
    now = Date.now(),
  ): HeartbeatEnvelope[] {
    this.authorize(mailboxId, receiveCapability);
    this.deleteExpired(now);
    return this.database
      .prepare(
        `SELECT envelope_json FROM (
           SELECT envelope_json, created_at, message_id
           FROM envelopes
           WHERE mailbox_id = ?
           ORDER BY created_at DESC, message_id DESC
           LIMIT 100
         )
         ORDER BY created_at ASC, message_id ASC`,
      )
      .all(mailboxId)
      .map((row) => {
        const parsedRow = envelopeRowSchema.parse(row);
        return HeartbeatEnvelopeSchema.parse(JSON.parse(parsedRow.envelope_json));
      });
  }
}
