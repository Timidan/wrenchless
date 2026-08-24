import { describe, expect, it } from "vitest";

import {
  createRefillTicketStore,
  generateRefillTicketSealingKey,
  type RefillTicket,
  type RefillTicketStorage,
} from "./refill-ticket-store.js";

const CREATED_AT = "2026-08-21T18:00:00.000Z";
const UPDATED_AT = "2026-08-21T18:05:00.000Z";

const COVER_TICKET: RefillTicket = {
  schemaVersion: "wrenchless.refill-ticket.v1",
  role: "cover",
  stateId: "0x111",
  status: "CREATED",
  claimPrivateKey: "0x12345",
  claimPublicKey:
    "0x65b7a03cb44c41a9184e56b26dd11d04a6f7fe3c4fdfc5a7b77e3e486a890dd",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

type MemoryStorageFixture = {
  storage: RefillTicketStorage;
  readOnlyValue(): string;
  replaceOnlyValue(value: string): void;
};

function createMemoryStorage(): MemoryStorageFixture {
  const values = new Map<string, string>();
  const onlyEntry = (): [string, string] => {
    const entry = values.entries().next().value;
    if (entry === undefined) {
      throw new Error("memory storage is empty");
    }
    return entry;
  };
  return {
    storage: {
      getItem(key) {
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        values.set(key, value);
      },
    },
    readOnlyValue() {
      return onlyEntry()[1];
    },
    replaceOnlyValue(value) {
      values.set(onlyEntry()[0], value);
    },
  };
}

describe("encrypted refill ticket storage", () => {
  it("seals private material and enforces the refill lifecycle", async () => {
    const memory = createMemoryStorage();
    const store = createRefillTicketStore(
      memory.storage,
      await generateRefillTicketSealingKey(),
    );

    await store.saveNew(COVER_TICKET);
    expect(memory.readOnlyValue()).not.toContain(COVER_TICKET.claimPrivateKey);
    expect(await store.get(COVER_TICKET.stateId)).toEqual(COVER_TICKET);

    const funded = await store.transition(
      COVER_TICKET.stateId,
      "FUNDED",
      UPDATED_AT,
    );
    expect(funded.status).toBe("FUNDED");
    await expect(store.saveNew(COVER_TICKET)).rejects.toThrow(
      "refill ticket already exists",
    );
    await expect(
      store.transition(COVER_TICKET.stateId, "REFUNDED"),
    ).rejects.toThrow("invalid refill ticket transition FUNDED -> REFUNDED");
  });

  it("rejects ciphertext tampering", async () => {
    const memory = createMemoryStorage();
    const store = createRefillTicketStore(
      memory.storage,
      await generateRefillTicketSealingKey(),
    );
    await store.saveNew(COVER_TICKET);

    const sealed = memory.readOnlyValue();
    const marker = '"ciphertext":"';
    const ciphertextIndex = sealed.indexOf(marker) + marker.length;
    const replacement = sealed[ciphertextIndex] === "0" ? "1" : "0";
    memory.replaceOnlyValue(
      `${sealed.slice(0, ciphertextIndex)}${replacement}${sealed.slice(ciphertextIndex + 1)}`,
    );

    await expect(store.get(COVER_TICKET.stateId)).rejects.toThrow(
      "stored refill ticket could not be decrypted",
    );
  });
});
