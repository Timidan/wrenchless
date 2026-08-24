import {
  generateGuardianHeartbeatKeypair,
  generateMailboxSigningKeypair,
} from "@wrenchless/canary-core";
import { z } from "zod";

const KEY_DATABASE = "wrenchless-local-secrets-v1";
const KEY_STORE = "keys";
// A new name is intentional: v1 held only an ECDH key and cannot sign mailbox
// delivery. Ignoring it lets an existing browser re-pair cleanly.
const KEY_NAME = "carried-heartbeat-auth-v2";

export type StoredCarriedAuthKey = {
  privateKey: CryptoKey;
  publicKey: string;
  signingPrivateKey: CryptoKey;
  signingPublicKey: string;
};

const storedKeySchema = z.object({
  privateKey: z
    .custom<CryptoKey>((value) => value instanceof CryptoKey)
    .refine((key) => key.type === "private"),
  publicKey: z.string().regex(/^04[0-9a-f]{128}$/),
  signingPrivateKey: z
    .custom<CryptoKey>((value) => value instanceof CryptoKey)
    .refine(
      (key) =>
        key.type === "private" &&
        key.algorithm.name === "ECDSA" &&
        !key.extractable &&
        key.usages.includes("sign"),
    ),
  signingPublicKey: z.string().regex(/^04[0-9a-f]{128}$/),
});

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Carried key request failed")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("Carried key write aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("Carried key write failed")),
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

export async function readCarriedAuthKey(): Promise<StoredCarriedAuthKey | null> {
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(KEY_STORE, "readonly");
    const value = await requestResult<unknown>(
      transaction.objectStore(KEY_STORE).get(KEY_NAME),
    );
    if (value === undefined) return null;
    const parsed = storedKeySchema.safeParse(value);
    if (!parsed.success) {
      throw new Error("The carried message key on this device is unavailable");
    }
    return parsed.data;
  } finally {
    database.close();
  }
}

export async function getOrCreateCarriedAuthKey(): Promise<StoredCarriedAuthKey> {
  const existing = await readCarriedAuthKey();
  if (existing !== null) return existing;

  const [generated, signing] = await Promise.all([
    generateGuardianHeartbeatKeypair(),
    generateMailboxSigningKeypair(),
  ]);
  const stored: StoredCarriedAuthKey = {
    privateKey: generated.keyPair.privateKey,
    publicKey: generated.publicKey,
    signingPrivateKey: signing.privateKey,
    signingPublicKey: signing.publicKey,
  };
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(KEY_STORE, "readwrite");
    transaction.objectStore(KEY_STORE).add(stored, KEY_NAME);
    await transactionComplete(transaction);
  } catch (error) {
    const raced = await readCarriedAuthKey();
    if (raced !== null) return raced;
    throw error;
  } finally {
    database.close();
  }
  return stored;
}
