import {
  createTravelSafeTicketStore,
  removeTravelSafeTicket,
  type TravelSafeSecrets,
  type TravelSafeTicket,
  type TravelSafeTicketStatus,
  type TravelSafeTicketStore,
  type TravelSafeTicketTransitionPatch,
} from "@wrenchless/canary-core";

import { readSettings, writeSettings } from "../adapters/settings.js";

const TICKET_KEY_CONTEXT = "WRENCHLESS_TRAVEL_SAFE_TICKET_KEY_V2";
const LEGACY_KEY_DATABASE = "wrenchless-local-secrets-v1";
const LEGACY_TICKET_PREFIX = "wrenchless.travel-safe-ticket.v1:";
let sessionSealingKey: CryptoKey | null = null;

function deleteLegacyKeyDatabase(): Promise<void> {
  if (!("indexedDB" in window)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LEGACY_KEY_DATABASE);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Legacy Travel Safe data could not be erased")),
      { once: true },
    );
    request.addEventListener(
      "blocked",
      () => reject(new Error("Close other Wrenchless tabs, then try again")),
      { once: true },
    );
  });
}

function removeLegacyTickets(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(LEGACY_TICKET_PREFIX)) localStorage.removeItem(key);
  }
}

export async function unlockTravelSafeTicketStorage(
  passkeySecret: Uint8Array<ArrayBuffer>,
): Promise<void> {
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
  await deleteLegacyKeyDatabase();
  removeTravelSafeTicket(localStorage, stateId);
  removeLegacyTickets();
  sessionSealingKey = null;
  writeSettings({ activeSafeStateId: null });
}
