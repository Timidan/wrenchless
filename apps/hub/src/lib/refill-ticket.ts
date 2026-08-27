import {
  createVersionedTravelSafeTicketStore,
  createTravelSafeTicketStore,
  generateTravelSafeTicketSealingKey,
  removeTravelSafeTicket,
  type AnyTravelSafeTicket,
  type TravelSafeSecrets,
  type TravelSafeTicket,
  type TravelSafeTicketStatus,
  type TravelSafeTicketStore,
  type TravelSafeTicketTransitionPatch,
  type TravelSafeTicketV3,
  type TravelSafeTicketV3Status,
  type TravelSafeTicketV3TransitionPatch,
  type VersionedTravelSafeTicketStore,
} from "@wrenchless/canary-core";
import { z } from "zod";

import { readSettings, writeSettings } from "../adapters/settings.js";

const TICKET_KEY_CONTEXT = "WRENCHLESS_TRAVEL_SAFE_TICKET_KEY_V2";
const LEGACY_KEY_DATABASE = "wrenchless-local-secrets-v1";
const LEGACY_TICKET_PREFIX = "wrenchless.travel-safe-ticket.v1:";
const LOCAL_KEY_DATABASE = "wrenchless-travel-safe-ticket-key-v1";
const LOCAL_KEY_STORE = "keys";
const LOCAL_KEY_ID = "ticket-sealing-key";
let sessionSealingKey: CryptoKey | null = null;

function deleteKeyDatabase(name: string): Promise<void> {
  if (!("indexedDB" in window)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Travel Safe device data could not be erased")),
      { once: true },
    );
    request.addEventListener(
      "blocked",
      () => reject(new Error("Close other Wrenchless tabs, then try again")),
      { once: true },
    );
  });
}

function openLocalKeyDatabase(): Promise<IDBDatabase> {
  if (!("indexedDB" in window)) {
    return Promise.reject(
      new Error("This browser cannot store a Travel Safe key on this device"),
    );
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_KEY_DATABASE, 1);
    request.addEventListener(
      "upgradeneeded",
      () => {
        if (!request.result.objectStoreNames.contains(LOCAL_KEY_STORE)) {
          request.result.createObjectStore(LOCAL_KEY_STORE);
        }
      },
      { once: true },
    );
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Travel Safe device storage did not open")),
      { once: true },
    );
    request.addEventListener(
      "blocked",
      () => reject(new Error("Close other Wrenchless tabs, then try again")),
      { once: true },
    );
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Travel Safe device storage failed")),
      { once: true },
    );
  });
}

function transactionFinished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    const fail = (): void => {
      reject(
        transaction.error ?? new Error("Travel Safe device storage did not save"),
      );
    };
    transaction.addEventListener("abort", fail, { once: true });
    transaction.addEventListener("error", fail, { once: true });
  });
}

const ticketSealingKeySchema = z.instanceof(CryptoKey).refine(
  (key) =>
    key.type === "secret" &&
    !key.extractable &&
    key.algorithm.name === "AES-GCM" &&
    key.usages.includes("encrypt") &&
    key.usages.includes("decrypt"),
);

async function readLocalTicketKey(): Promise<CryptoKey | null> {
  if (!("indexedDB" in window)) return null;
  const database = await openLocalKeyDatabase();
  try {
    const transaction = database.transaction(LOCAL_KEY_STORE, "readonly");
    const value = await requestResult(
      transaction.objectStore(LOCAL_KEY_STORE).get(LOCAL_KEY_ID),
    );
    if (value === undefined) return null;
    const parsed = ticketSealingKeySchema.safeParse(value);
    if (!parsed.success) {
      throw new Error("This browser's Travel Safe key is invalid");
    }
    return parsed.data;
  } finally {
    database.close();
  }
}

async function createLocalTicketKey(): Promise<CryptoKey> {
  const generated = await generateTravelSafeTicketSealingKey();
  const database = await openLocalKeyDatabase();
  try {
    const transaction = database.transaction(LOCAL_KEY_STORE, "readwrite");
    await Promise.all([
      requestResult(
        transaction.objectStore(LOCAL_KEY_STORE).add(generated, LOCAL_KEY_ID),
      ),
      transactionFinished(transaction),
    ]);
    return generated;
  } catch (caught) {
    if (!(caught instanceof DOMException) || caught.name !== "ConstraintError") {
      throw caught;
    }
  } finally {
    database.close();
  }
  const existing = await readLocalTicketKey();
  if (existing === null) {
    throw new Error("This browser did not save its Travel Safe key");
  }
  return existing;
}

function removeLegacyTickets(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(LEGACY_TICKET_PREFIX)) localStorage.removeItem(key);
  }
}

export async function unlockTravelSafeTicketStorage(
  passkeySecret: Uint8Array<ArrayBuffer> | null,
  allowLocalKeyCreation = false,
): Promise<void> {
  // PRF remains the stronger path: its key is derived only after the
  // authenticator answers. When PRF is unavailable, the browser keeps one
  // non-extractable key and callers reach this function only after verifying
  // the enrolled passkey. Nothing is added to the sponsor or sent over the
  // network in either path.
  const localKey = await readLocalTicketKey();
  if (localKey !== null) {
    sessionSealingKey = localKey;
    return;
  }
  if (passkeySecret === null) {
    if (allowLocalKeyCreation) {
      sessionSealingKey = await createLocalTicketKey();
      return;
    }
    throw new Error(
      "This device cannot open this Travel Safe. Use your recovery words instead.",
    );
  }
  if (passkeySecret.byteLength !== 32) {
    throw new Error("The passkey returned an invalid Travel Safe secret");
  }
  const material = await crypto.subtle.importKey(
    "raw",
    passkeySecret,
    "HKDF",
    false,
    ["deriveKey"],
  );
  const context = new TextEncoder().encode(TICKET_KEY_CONTEXT);
  sessionSealingKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: context, info: context },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function localTicketStore(): Promise<TravelSafeTicketStore> {
  if (sessionSealingKey === null) {
    throw new Error("Confirm your passkey to open this Travel Safe");
  }
  return createTravelSafeTicketStore(localStorage, sessionSealingKey);
}

async function localVersionedTicketStore(): Promise<VersionedTravelSafeTicketStore> {
  if (sessionSealingKey === null) {
    throw new Error("Confirm your passkey to open this Travel Safe");
  }
  return createVersionedTravelSafeTicketStore(
    localStorage,
    sessionSealingKey,
  );
}

export async function createTravelSafeTicket(input: {
  secrets: TravelSafeSecrets;
  recoveryPhrase: string;
  recoveryAccount: string;
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
    schemaVersion: "wrenchless.travel-safe-ticket.v2",
    role: "safe",
    stateId: input.secrets.stateId,
    status: "READY",
    recoveryPhrase: input.recoveryPhrase,
    recoveryAccount: input.recoveryAccount,
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

export async function readAnyTravelSafeTicket(
  stateId: string,
): Promise<AnyTravelSafeTicket> {
  const ticket = await (await localVersionedTicketStore()).get(stateId);
  if (ticket === null) throw new Error("Travel Safe ticket is not on this device");
  return ticket;
}

export async function readActiveAnyTravelSafeTicket(): Promise<AnyTravelSafeTicket | null> {
  const stateId = readSettings().activeSafeStateId;
  return stateId === null ? null : readAnyTravelSafeTicket(stateId);
}

export async function storeNewTravelSafeTicketV3(
  ticket: TravelSafeTicketV3,
): Promise<void> {
  if (readSettings().activeSafeStateId !== null) {
    throw new Error("Finish or clear the current Travel Safe first");
  }
  await (await localVersionedTicketStore()).saveNew(ticket);
  writeSettings({ activeSafeStateId: ticket.stateId });
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

export async function transitionStoredTravelSafeTicketV3(
  stateId: string,
  nextStatus: TravelSafeTicketV3Status,
  patch: TravelSafeTicketV3TransitionPatch = {},
): Promise<TravelSafeTicketV3> {
  return (await localVersionedTicketStore()).transitionV3(
    stateId,
    nextStatus,
    patch,
  );
}

export async function clearTravelSafeTicket(stateId: string): Promise<void> {
  const settings = readSettings();
  if (
    settings.activeSafeStateId !== null &&
    BigInt(settings.activeSafeStateId) !== BigInt(stateId)
  ) {
    throw new Error("That Travel Safe is not active on this device");
  }
  await Promise.all([
    deleteKeyDatabase(LOCAL_KEY_DATABASE),
    deleteKeyDatabase(LEGACY_KEY_DATABASE),
  ]);
  removeTravelSafeTicket(localStorage, stateId);
  removeLegacyTickets();
  sessionSealingKey = null;
  writeSettings({ activeSafeStateId: null });
}
