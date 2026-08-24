import {
  createTravelSafeTicketStore,
  generateTravelSafeTicketSealingKey,
  removeTravelSafeTicket,
  type TravelSafeSecrets,
  type TravelSafeTicket,
  type TravelSafeTicketStatus,
  type TravelSafeTicketStore,
  type TravelSafeTicketTransitionPatch,
} from "@wrenchless/canary-core";

import { readSettings, writeSettings } from "../adapters/settings.js";

const KEY_DATABASE = "wrenchless-local-secrets-v1";
const KEY_STORE = "keys";
const SAFE_KEY = "safe";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed")),
      { once: true },
    );
  });
}

async function openKeyDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(KEY_DATABASE, 1);
  request.addEventListener(
    "upgradeneeded",
    () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE)) {
        request.result.createObjectStore(KEY_STORE);
      }
    },
    { once: true },
  );
  return requestResult(request);
}

async function getOrCreateSealingKey(): Promise<CryptoKey> {
  const database = await openKeyDatabase();
  try {
    const read = database.transaction(KEY_STORE, "readonly");
    const stored = await requestResult<CryptoKey | undefined>(
      read.objectStore(KEY_STORE).get(SAFE_KEY),
    );
    if (stored !== undefined) return stored;

    const key = await generateTravelSafeTicketSealingKey();
    const write = database.transaction(KEY_STORE, "readwrite");
    write.objectStore(KEY_STORE).add(key, SAFE_KEY);
    await transactionComplete(write);
    return key;
  } finally {
    database.close();
  }
}

async function localTicketStore(): Promise<TravelSafeTicketStore> {
  return createTravelSafeTicketStore(
    localStorage,
    await getOrCreateSealingKey(),
  );
}

export async function createTravelSafeTicket(input: {
  secrets: TravelSafeSecrets;
  tokenAddress: string;
  amountFri: string;
  returnDateSeconds: string;
  now?: Date;
}): Promise<TravelSafeTicket> {
  if (readSettings().activeSafeStateId !== null) {
    throw new Error("Finish or clear the current Travel Safe first");
  }
  const timestamp = (input.now ?? new Date()).toISOString();
  const ticket: TravelSafeTicket = {
    schemaVersion: "wrenchless.travel-safe-ticket.v1",
    role: "safe",
    stateId: input.secrets.stateId,
    status: "PHRASE_CONFIRMED",
    claimCommitment: input.secrets.claimCommitment,
    refundPrivateKey: input.secrets.refundPrivateKey,
    refundPublicKey: input.secrets.refundPublicKey,
    tokenAddress: input.tokenAddress,
    amountFri: input.amountFri,
    returnDateSeconds: input.returnDateSeconds,
    fundProofExpiresAtBlock: null,
    fundTransactionHash: null,
    returnSubmittedAtBlock: null,
    returnTransactionHash: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await (await localTicketStore()).saveNew(ticket);
  writeSettings({ activeSafeStateId: ticket.stateId });
  return ticket;
}

export async function readTravelSafeTicket(
  stateId: string,
): Promise<TravelSafeTicket> {
  const ticket = await (await localTicketStore()).get(stateId);
  if (ticket === null) throw new Error("Travel Safe ticket is not on this device");
  return ticket;
}

export async function readActiveTravelSafeTicket(): Promise<TravelSafeTicket | null> {
  const stateId = readSettings().activeSafeStateId;
  return stateId === null ? null : readTravelSafeTicket(stateId);
}

export async function transitionStoredTravelSafeTicket(
  stateId: string,
  nextStatus: TravelSafeTicketStatus,
  patch: TravelSafeTicketTransitionPatch = {},
): Promise<TravelSafeTicket> {
  return (await localTicketStore()).transition(stateId, nextStatus, patch);
}

export async function clearTravelSafeTicket(stateId: string): Promise<void> {
  const settings = readSettings();
  if (
    settings.activeSafeStateId !== null &&
    BigInt(settings.activeSafeStateId) !== BigInt(stateId)
  ) {
    throw new Error("That Travel Safe is not active on this device");
  }
  removeTravelSafeTicket(localStorage, stateId);
  writeSettings({ activeSafeStateId: null });
}
