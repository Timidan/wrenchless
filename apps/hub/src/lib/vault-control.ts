import {
  generateGuardianControlKeypair,
  fingerprintGuardianPublicKey,
  HeartbeatEnvelopeSchema,
  openGuardianControl,
  openGuardianEnrollmentResponse,
  resolveRestorePause,
  sealRestorePause,
  type GuardianControlPlaintext,
  type RestorePauseState,
} from "@wrenchless/canary-core";
import { z } from "zod";

import { deliverHeartbeat } from "./mailbox-client.js";
import {
  createGuardianEnrollmentBundle,
  type GuardianEnrollmentBundle,
} from "./role-handoff.js";

/**
 * The one channel that runs backwards.
 *
 * Everything else in this product moves away from the person holding the money:
 * a signal leaves the carried phone and is read somewhere else. The pause is the
 * exception. It leaves the trusted reader's phone and lands in an inbox the home
 * vault owns, sealed to a key only the home vault holds, and the home vault acts
 * on it the next time someone opens it.
 *
 * The key is separate from the reader's own signal key on purpose. They travel
 * in opposite directions and belong to different people; one key doing both
 * would mean the reader could decrypt what it sends.
 *
 * Nothing here reaches the carried wallet. The pause stops the home vault from
 * funding new restores; money already on the phone is untouched, and the phone
 * is never told that anything changed.
 */

const KEY_DATABASE = "wrenchless-local-secrets-v1";
const KEY_STORE = "keys";
const CONTROL_KEY_NAME = "vault-control";

export type StoredVaultControlKey = {
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
      () => reject(request.error ?? new Error("Control key request failed")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("Control key write aborted")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("Control key write failed")),
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

/**
 * What a usable control key looks like, checked rather than assumed.
 *
 * IndexedDB hands back whatever was put in, including from an older version of
 * this application. A half-valid record here would mean a pause that silently
 * never decrypts, so the shape is parsed and a record that fails is treated as
 * absent.
 */
const storedControlKeySchema = z.object({
  privateKey: z.custom<CryptoKey>(
    (value) => value instanceof CryptoKey && value.type === "private",
    "The control key on this device is invalid",
  ),
  publicKey: z.string().regex(/^04[0-9a-f]{128}$/),
  fingerprint: z.string().regex(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){4}$/),
});

export async function readVaultControlKey(): Promise<StoredVaultControlKey | null> {
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(KEY_STORE, "readonly");
    const value = await requestResult<unknown>(
      transaction.objectStore(KEY_STORE).get(CONTROL_KEY_NAME),
    );
    if (value === undefined) return null;
    const parsed = storedControlKeySchema.safeParse(value);
    if (!parsed.success) {
      throw new Error("The control key on this device is unavailable");
    }
    return parsed.data;
  } finally {
    database.close();
  }
}

export async function getOrCreateVaultControlKey(): Promise<StoredVaultControlKey> {
  const existing = await readVaultControlKey();
  if (existing !== null) return existing;

  const generated = await generateGuardianControlKeypair();
  const stored: StoredVaultControlKey = {
    privateKey: generated.keyPair.privateKey,
    publicKey: generated.publicKey,
    fingerprint: generated.fingerprint,
  };
  const database = await openKeyDatabase();
  try {
    const transaction = database.transaction(KEY_STORE, "readwrite");
    transaction.objectStore(KEY_STORE).add(stored, CONTROL_KEY_NAME);
    await transactionComplete(transaction);
  } catch (error) {
    const raced = await readVaultControlKey();
    if (raced !== null) return raced;
    throw error;
  } finally {
    database.close();
  }
  return stored;
}

const controlContentsSchema = z
  .object({
    envelopes: z.array(HeartbeatEnvelopeSchema).max(100),
    senderEncryptionPublicKey: z
      .string()
      .regex(/^04[0-9a-f]{128}$/)
      .nullable(),
  })
  .strict();

function mailboxBase(mailboxUrl: string): string {
  return new URL(
    mailboxUrl.endsWith("/") ? mailboxUrl : `${mailboxUrl}/`,
  ).toString();
}

/**
 * Reads the control inbox and returns only what opened.
 *
 * A message that cannot be decrypted is skipped rather than fatal. Delivery is
 * authenticated by the guardian key, and HPKE authentication is checked again
 * when the vault opens it.
 */
export async function retrieveRestorePauseCommands(input: {
  mailboxUrl: string;
  mailboxId: string;
  receiveCapability: string;
  controlPrivateKey: CryptoKey;
  guardianPublicKey: string;
  fetcher?: typeof fetch;
}): Promise<GuardianControlPlaintext[]> {
  const response = await (input.fetcher ?? fetch)(
    new URL(
      `v1/mailboxes/${input.mailboxId}/envelopes`,
      mailboxBase(input.mailboxUrl),
    ),
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.receiveCapability}` },
    },
  );
  if (!response.ok) {
    throw new Error(`The control inbox returned HTTP ${response.status}`);
  }
  const contents = controlContentsSchema.parse(await response.json());
  if (contents.senderEncryptionPublicKey === null) return [];
  if (contents.senderEncryptionPublicKey !== input.guardianPublicKey) {
    throw new Error("The control inbox is bound to a different guardian");
  }
  const opened: GuardianControlPlaintext[] = [];
  for (const envelope of contents.envelopes) {
    try {
      opened.push(
        await openGuardianControl(
          envelope,
          input.controlPrivateKey,
          input.guardianPublicKey,
        ),
      );
    } catch {
      // Not ours, or not a control message. Skipped, never surfaced.
    }
  }
  return opened;
}

export async function retrieveGuardianEnrollment(input: {
  mailboxUrl: string;
  mailboxId: string;
  receiveCapability: string;
  controlPrivateKey: CryptoKey;
  fetcher?: typeof fetch;
}): Promise<GuardianEnrollmentBundle | null> {
  const response = await (input.fetcher ?? fetch)(
    new URL(
      `v1/mailboxes/${input.mailboxId}/envelopes`,
      mailboxBase(input.mailboxUrl),
    ),
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.receiveCapability}` },
    },
  );
  if (!response.ok) {
    throw new Error(`The control inbox returned HTTP ${response.status}`);
  }
  const contents = controlContentsSchema.parse(await response.json());
  if (contents.senderEncryptionPublicKey === null) return null;
  for (const envelope of contents.envelopes) {
    try {
      const enrollment = await openGuardianEnrollmentResponse(
        envelope,
        input.controlPrivateKey,
        contents.senderEncryptionPublicKey,
      );
      return createGuardianEnrollmentBundle({
        guardianPublicKey: contents.senderEncryptionPublicKey,
        guardianFingerprint: await fingerprintGuardianPublicKey(
          contents.senderEncryptionPublicKey,
        ),
        mailboxUrl: input.mailboxUrl,
        mailboxId: enrollment.mailboxId,
        mailboxBindCapability: enrollment.mailboxBindCapability,
      });
    } catch {
      // Pause commands and malformed replies are not enrollment responses.
    }
  }
  return null;
}

/** The guardian's half: seal a pause to the home vault and deliver it. */
export async function sendRestorePause(input: {
  mailboxUrl: string;
  mailboxId: string;
  vaultControlPublicKey: string;
  guardianPrivateKey: CryptoKey;
  guardianSigningPrivateKey: CryptoKey;
  fetcher?: typeof fetch;
}): Promise<{ blockedUntil: string }> {
  const envelope = await sealRestorePause(
    input.vaultControlPublicKey,
    input.guardianPrivateKey,
  );
  await deliverHeartbeat(
    {
      mailboxUrl: input.mailboxUrl,
      mailboxId: input.mailboxId,
      senderSigningPrivateKey: input.guardianSigningPrivateKey,
    },
    envelope,
    input.fetcher ?? fetch,
  );
  return {
    blockedUntil: new Date(
      Date.parse(envelope.createdAt) + 24 * 60 * 60 * 1_000,
    ).toISOString(),
  };
}

export { resolveRestorePause };
export type { GuardianControlPlaintext, RestorePauseState };
