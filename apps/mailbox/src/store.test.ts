import {
  generateGuardianHeartbeatKeypair,
  generateMailboxSigningKeypair,
  sealHeartbeat,
} from "@wrenchless/canary-core";
import { describe, expect, it } from "vitest";

import { MailboxStore, MailboxStoreError } from "./store.js";

const NOW = new Date("2026-08-21T18:02:23.270Z");

function opaqueEnvelope(index: number) {
  const createdAt = new Date(
    Date.UTC(2026, 7, 21, 18, index, 0, 0),
  ).toISOString();
  return {
    protocolVersion: "wrenchless.heartbeat.v1" as const,
    suite: "DHKEM-P256-HKDF-SHA256/HKDF-SHA256/AES-256-GCM" as const,
    messageId: index.toString(16).padStart(32, "0"),
    createdAt,
    expiresAt: new Date(Date.parse(createdAt) + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    encapsulatedKey: `04${"0".repeat(128)}`,
    ciphertext: "0".repeat(1056),
  };
}

describe("opaque heartbeat mailbox", () => {
  it("consumes sender binding once, stores idempotently, and expires envelopes", async () => {
    const store = new MailboxStore(":memory:");
    const enrollment = store.createMailbox(NOW.getTime());
    const guardian = await generateGuardianHeartbeatKeypair();
    const sender = await generateGuardianHeartbeatKeypair();
    const signing = await generateMailboxSigningKeypair();
    store.bindSender(
      enrollment.mailboxId,
      enrollment.bindCapability,
      signing.publicKey,
      sender.publicKey,
    );
    expect(() =>
      store.bindSender(
        enrollment.mailboxId,
        enrollment.bindCapability,
        signing.publicKey,
        sender.publicKey,
      ),
    ).not.toThrow();
    const envelope = await sealHeartbeat(
      {
        signal: "DISTRESS",
        coverAlias: "Travel wallet",
        paymentOutcome: "submitted",
      },
      guardian.publicKey,
      sender.keyPair.privateKey,
      NOW,
    );

    expect(
      store.storeEnvelope(
        enrollment.mailboxId,
        envelope,
        NOW.getTime(),
      ),
    ).toBe("stored");
    expect(
      store.storeEnvelope(
        enrollment.mailboxId,
        envelope,
        NOW.getTime(),
      ),
    ).toBe("duplicate");
    expect(
      store.listEnvelopes(
        enrollment.mailboxId,
        enrollment.receiveCapability,
        NOW.getTime(),
      ),
    ).toEqual([envelope]);
    expect(() =>
      store.listEnvelopes(
        enrollment.mailboxId,
        enrollment.bindCapability,
        NOW.getTime(),
      ),
    ).toThrow(new MailboxStoreError("unauthorized"));

    expect(
      store.listEnvelopes(
        enrollment.mailboxId,
        enrollment.receiveCapability,
        Date.parse(envelope.expiresAt),
      ),
    ).toEqual([]);
    store.close();
  });

  it("rejects a different envelope that reuses a message ID", async () => {
    const store = new MailboxStore(":memory:");
    const enrollment = store.createMailbox(NOW.getTime());
    const guardian = await generateGuardianHeartbeatKeypair();
    const sender = await generateGuardianHeartbeatKeypair();
    const signing = await generateMailboxSigningKeypair();
    store.bindSender(
      enrollment.mailboxId,
      enrollment.bindCapability,
      signing.publicKey,
      sender.publicKey,
    );
    const envelope = await sealHeartbeat(
      {
        signal: "OK",
        coverAlias: "Daily wallet",
        paymentOutcome: "confirmed",
      },
      guardian.publicKey,
      sender.keyPair.privateKey,
      NOW,
    );
    store.storeEnvelope(
      enrollment.mailboxId,
      envelope,
      NOW.getTime(),
    );
    const lastCiphertextCharacter = envelope.ciphertext.at(-1);
    const conflicting = {
      ...envelope,
      ciphertext: `${envelope.ciphertext.slice(0, -1)}${lastCiphertextCharacter === "0" ? "1" : "0"}`,
    };

    expect(() =>
      store.storeEnvelope(
        enrollment.mailboxId,
        conflicting,
        NOW.getTime(),
      ),
    ).toThrow(new MailboxStoreError("message_conflict"));
    store.close();
  });

  it("returns the newest one hundred envelopes in chronological order", () => {
    const store = new MailboxStore(":memory:");
    const enrollment = store.createMailbox(NOW.getTime());
    store.bindSender(
      enrollment.mailboxId,
      enrollment.bindCapability,
      `04${"1".repeat(128)}`,
      `04${"2".repeat(128)}`,
    );
    for (let index = 0; index <= 100; index += 1) {
      const envelope = opaqueEnvelope(index);
      store.storeEnvelope(
        enrollment.mailboxId,
        envelope,
        Date.parse(envelope.createdAt),
      );
    }

    const envelopes = store.listEnvelopes(
      enrollment.mailboxId,
      enrollment.receiveCapability,
      Date.parse(opaqueEnvelope(100).createdAt),
    );

    expect(envelopes).toHaveLength(100);
    expect(envelopes[0]?.messageId).toBe(opaqueEnvelope(1).messageId);
    expect(envelopes.at(-1)?.messageId).toBe(opaqueEnvelope(100).messageId);
    store.close();
  });
});
