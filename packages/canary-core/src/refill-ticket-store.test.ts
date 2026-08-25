import { describe, expect, it } from "vitest";

import {
  createTravelSafeTicketStore,
  generateTravelSafeTicketSealingKey,
  TravelSafeTicketSchema,
  type TravelSafeTicket,
  type TravelSafeTicketStorage,
} from "./refill-ticket-store.js";

const CREATED_AT = "2026-08-24T12:00:00.000Z";
const UPDATED_AT = "2026-08-24T12:05:00.000Z";

const TICKET: TravelSafeTicket = {
  schemaVersion: "wrenchless.travel-safe-ticket.v2",
  role: "safe",
  stateId: "0x111",
  status: "READY",
  recoveryPhrase:
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  recoveryAccount: "0x444",
  tokenAddress: "0x555",
  amountFri: "1000000000000000000",
  returnDateSeconds: "1800003600",
  fundProofExpiresAtBlock: null,
  fundTransactionHash: null,
  returnSubmittedAtBlock: null,
  returnTransactionHash: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

type MemoryStorageHarness = {
  storage: TravelSafeTicketStorage;
  readOnlyValue(): string;
  replaceOnlyValue(value: string): void;
};

function memoryStorage(): MemoryStorageHarness {
  const values = new Map<string, string>();
  const onlyEntry = (): [string, string] => {
    const entry = values.entries().next().value;
    if (entry === undefined) throw new Error("memory storage is empty");
    return entry;
  };
  return {
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    readOnlyValue: () => onlyEntry()[1],
    replaceOnlyValue: (value) => values.set(onlyEntry()[0], value),
  };
}

describe("encrypted Travel Safe ticket storage", () => {
  it("opens tickets written before receipt reconciliation fields existed", () => {
    const {
      fundProofExpiresAtBlock: _oldProofExpiry,
      returnSubmittedAtBlock: _oldReturnBlock,
      ...oldTicket
    } = TICKET;

    expect(TravelSafeTicketSchema.parse(oldTicket)).toMatchObject({
      fundProofExpiresAtBlock: null,
      returnSubmittedAtBlock: null,
    });
  });

  it("seals the local recovery phrase and enforces the lifecycle", async () => {
    const memory = memoryStorage();
    const store = createTravelSafeTicketStore(
      memory.storage,
      await generateTravelSafeTicketSealingKey(),
    );

    await store.saveNew(TICKET);
    expect(memory.readOnlyValue()).not.toContain(TICKET.recoveryPhrase);
    expect(await store.get(TICKET.stateId)).toEqual(TICKET);
    await store.transition(
      TICKET.stateId,
      "FUND_SUBMITTING",
      { fundProofExpiresAtBlock: "123456" },
      UPDATED_AT,
    );
    const funded = await store.transition(
      TICKET.stateId,
      "FUNDED",
      { fundTransactionHash: "0x666" },
      UPDATED_AT,
    );
    expect(funded).toMatchObject({
      status: "FUNDED",
      fundProofExpiresAtBlock: "123456",
      fundTransactionHash: "0x666",
    });
    await store.transition(
      TICKET.stateId,
      "RETURN_SUBMITTING",
      { returnSubmittedAtBlock: "123500" },
      UPDATED_AT,
    );
    const terminal = await store.transition(
      TICKET.stateId,
      "TERMINAL",
      { returnTransactionHash: "0x777" },
      UPDATED_AT,
    );
    expect(terminal.status).toBe("TERMINAL");
    expect(terminal.returnSubmittedAtBlock).toBe("123500");

    await expect(store.saveNew(TICKET)).rejects.toThrow(
      "Travel Safe ticket already exists",
    );
    await expect(
      store.transition(TICKET.stateId, "FUNDED"),
    ).rejects.toThrow("invalid Travel Safe ticket transition TERMINAL -> FUNDED");

    store.remove(TICKET.stateId);
    expect(await store.get(TICKET.stateId)).toBeNull();
  });

  it("rejects ciphertext tampering", async () => {
    const memory = memoryStorage();
    const store = createTravelSafeTicketStore(
      memory.storage,
      await generateTravelSafeTicketSealingKey(),
    );
    await store.saveNew(TICKET);

    const sealed = memory.readOnlyValue();
    const marker = '"ciphertext":"';
    const index = sealed.indexOf(marker) + marker.length;
    const replacement = sealed[index] === "0" ? "1" : "0";
    memory.replaceOnlyValue(
      `${sealed.slice(0, index)}${replacement}${sealed.slice(index + 1)}`,
    );

    await expect(store.get(TICKET.stateId)).rejects.toThrow(
      "stored Travel Safe ticket could not be decrypted",
    );
  });
});
