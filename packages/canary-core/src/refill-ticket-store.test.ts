import { describe, expect, it } from "vitest";

import {
  createVersionedTravelSafeTicketStore,
  createTravelSafeTicketStore,
  generateTravelSafeTicketSealingKey,
  resolveTicketContract,
  TravelSafeTicketSchema,
  TravelSafeTicketV3Schema,
  type TravelSafeTicketV3,
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

const V3_TICKET: TravelSafeTicketV3 = {
  schemaVersion: "wrenchless.travel-safe-ticket.v3",
  contractVersion: "v3",
  role: "safe",
  helperAddress: "0x888",
  stateId: "0x222",
  status: "READY",
  recoveryAccount: "0x444",
  recoverySalt: "0x777",
  devicePrivateKey: "0x999",
  tokenAddress: "0x555",
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  amountBaseUnits: "1000000",
  dailyAmountBaseUnits: "100000",
  firstReleaseSeconds: "1800000000",
  returnDateSeconds: "1800864000",
  fundTransactionHash: null,
  actionTransactionHash: null,
  pendingAction: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

type MemoryStorageHarness = {
  storage: TravelSafeTicketStorage;
  readOnlyValue(): string;
  replaceOnlyValue(value: string): void;
  writes(): number;
};

function memoryStorage(): MemoryStorageHarness {
  const values = new Map<string, string>();
  let writes = 0;
  const onlyEntry = (): [string, string] => {
    const entry = values.entries().next().value;
    if (entry === undefined) throw new Error("memory storage is empty");
    return entry;
  };
  return {
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        writes += 1;
        values.set(key, value);
      },
      removeItem: (key) => values.delete(key),
    },
    readOnlyValue: () => onlyEntry()[1],
    replaceOnlyValue: (value) => values.set(onlyEntry()[0], value),
    writes: () => writes,
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

  it("opens a v2 envelope without rewriting it or changing its helper", async () => {
    const memory = memoryStorage();
    const key = await generateTravelSafeTicketSealingKey();
    await createTravelSafeTicketStore(memory.storage, key).saveNew(TICKET);
    const sealedBefore = memory.readOnlyValue();
    const writesBefore = memory.writes();

    const opened = await createVersionedTravelSafeTicketStore(
      memory.storage,
      key,
    ).get(TICKET.stateId);

    expect(opened).toEqual(TICKET);
    expect(memory.readOnlyValue()).toBe(sealedBefore);
    expect(memory.writes()).toBe(writesBefore);
    expect(resolveTicketContract(opened!)).toEqual({
      contractVersion: "v2",
      helperAddress:
        "0x18f6925422c85da8c9e0c1572adf4316a9821ffabc4b29db37d11c6a0c2844a",
    });
  });

  it("seals a v3 ticket without accepting recovery words", async () => {
    expect(() =>
      TravelSafeTicketV3Schema.parse({
        ...V3_TICKET,
        recoveryPhrase: "must never be stored",
      }),
    ).toThrow();

    const memory = memoryStorage();
    const store = createVersionedTravelSafeTicketStore(
      memory.storage,
      await generateTravelSafeTicketSealingKey(),
    );
    await store.saveNew(V3_TICKET);

    expect(memory.readOnlyValue()).not.toContain(V3_TICKET.devicePrivateKey);
    expect(await store.get(V3_TICKET.stateId)).toEqual(V3_TICKET);
    expect(resolveTicketContract(V3_TICKET)).toEqual({
      contractVersion: "v3",
      helperAddress: V3_TICKET.helperAddress,
    });
  });

  it("supports repeated v3 actions while keeping terminal state terminal", async () => {
    const store = createVersionedTravelSafeTicketStore(
      memoryStorage().storage,
      await generateTravelSafeTicketSealingKey(),
    );
    await store.saveNew(V3_TICKET);
    await store.transitionV3(V3_TICKET.stateId, "FUND_SUBMITTING");
    await store.transitionV3(V3_TICKET.stateId, "FUNDED", {
      fundTransactionHash: "0xabc",
    });
    await store.transitionV3(V3_TICKET.stateId, "ACTION_SUBMITTING", {
      pendingAction: {
        operation: "RELEASE",
        previousNonce: "0",
        maximumRemaining: "900000",
      },
    });
    await store.transitionV3(V3_TICKET.stateId, "FUNDED", {
      actionTransactionHash: "0xdef",
      pendingAction: null,
    });
    await store.transitionV3(V3_TICKET.stateId, "ACTION_SUBMITTING");
    const terminal = await store.transitionV3(
      V3_TICKET.stateId,
      "TERMINAL",
      { actionTransactionHash: "0x123" },
    );

    expect(terminal.status).toBe("TERMINAL");
    await expect(
      store.transitionV3(V3_TICKET.stateId, "FUNDED"),
    ).rejects.toThrow("invalid Travel Safe v3 ticket transition");
  });
});
