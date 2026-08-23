import { generateGuardianHeartbeatKeypair } from "@wrenchless/canary-core";
import { z } from "zod";

const KEY_DATABASE = "wrenchless-local-secrets-v1";
const KEY_STORE = "keys";
const GUARDIAN_KEY_NAME = "guardian-heartbeat";

export type StoredGuardianHeartbeatKey = {
  privateKey: CryptoKey;
  publicKey: string;
  fingerprint: string;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Guardian key request failed")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("Guardian key write aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("Guardian key write failed")),
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

const storedKeySchema = z.object({
  privateKey: z
    .custom<CryptoKey>((value) => value instanceof CryptoKey)
    .refine((key) => key.type === "private"),
  publicKey: z.string().regex(/^04[0-9a-f]{128}$/),
  fingerprint: z.string().regex(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){4}$/),
});

function parseStoredKey<T>(value: T): StoredGuardianHeartbeatKey {
  const parsed = storedKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("The local guardian key is invalid");
  }
  return parsed.data;
}

export async function readGuardianHeartbeatKey(): Promise<StoredGuardianHeartbeatKey | null> {
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(KEY_STORE, "readonly");
    const value = await requestResult<unknown>(
      transaction.objectStore(KEY_STORE).get(GUARDIAN_KEY_NAME),
    );
    return value === undefined ? null : parseStoredKey(value);
  } finally {
    database.close();
  }
}

export async function getOrCreateGuardianHeartbeatKey(): Promise<StoredGuardianHeartbeatKey> {
  const existing = await readGuardianHeartbeatKey();
  if (existing !== null) return existing;

  const generated = await generateGuardianHeartbeatKeypair();
  const stored: StoredGuardianHeartbeatKey = {
    privateKey: generated.keyPair.privateKey,
    publicKey: generated.publicKey,
    fingerprint: generated.fingerprint,
  };
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(KEY_STORE, "readwrite");
    transaction.objectStore(KEY_STORE).add(stored, GUARDIAN_KEY_NAME);
    await transactionComplete(transaction);
  } catch (error) {
    const raced = await readGuardianHeartbeatKey();
    if (raced !== null) return raced;
    throw error;
  } finally {
    database.close();
  }
  return stored;
}
