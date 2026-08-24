import { z } from "zod";

const STORAGE_PREFIX = "wrenchless.refill-ticket.v1:";
const ENCRYPTION_CONTEXT = "WRENCHLESS_REFILL_TICKET_V1";
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;

const canonicalFeltSchema = z
  .string()
  .regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/, "expected a canonical felt")
  .refine((value) => BigInt(value) < STARK_FIELD_PRIME, "felt exceeds the Stark field");

const nonZeroFeltSchema = canonicalFeltSchema.refine(
  (value) => BigInt(value) !== 0n,
  "expected a non-zero felt",
);

export const RefillTicketStatusSchema = z.enum([
  "CREATED",
  "FUNDED",
  "CLAIMABLE",
  "CLAIMING",
  "CLAIMED",
  "EXPIRED",
  "REFUNDING",
  "REFUNDED",
]);

const commonTicketFields = {
  schemaVersion: z.literal("wrenchless.refill-ticket.v1"),
  stateId: nonZeroFeltSchema,
  status: RefillTicketStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

const coverTicketSchema = z
  .object({
    ...commonTicketFields,
    role: z.literal("cover"),
    claimPrivateKey: nonZeroFeltSchema,
    claimPublicKey: nonZeroFeltSchema,
  })
  .strict();

const vaultTicketSchema = z
  .object({
    ...commonTicketFields,
    role: z.literal("vault"),
    claimCommitment: nonZeroFeltSchema,
    refundPrivateKey: nonZeroFeltSchema,
    refundPublicKey: nonZeroFeltSchema,
  })
  .strict();

export const RefillTicketSchema = z.discriminatedUnion("role", [
  coverTicketSchema,
  vaultTicketSchema,
]);

const sealedTicketSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.sealed-refill-ticket.v1"),
    algorithm: z.literal("AES-GCM-256"),
    iv: z.string().regex(/^[0-9a-f]{24}$/),
    ciphertext: z.string().regex(/^(?:[0-9a-f]{2})+$/),
  })
  .strict();

export type RefillTicketStatus = z.infer<typeof RefillTicketStatusSchema>;
export type RefillTicket = z.infer<typeof RefillTicketSchema>;

export type RefillTicketStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type RefillTicketStore = {
  saveNew(ticket: RefillTicket): Promise<void>;
  get(stateId: string | bigint): Promise<RefillTicket | null>;
  transition(
    stateId: string | bigint,
    nextStatus: RefillTicketStatus,
    updatedAt?: string,
  ): Promise<RefillTicket>;
};

function toCanonicalFelt(value: string | bigint): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error("refill state ID is not a felt");
  }
  if (parsed <= 0n) {
    throw new Error("refill state ID must be non-zero");
  }
  if (parsed >= STARK_FIELD_PRIME) {
    throw new Error("refill state ID is outside the Stark field");
  }
  return `0x${parsed.toString(16)}`;
}

function storageKey(stateId: string | bigint): string {
  return `${STORAGE_PREFIX}${toCanonicalFelt(stateId)}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function assertSealingKey(key: CryptoKey): void {
  if (
    key.type !== "secret" ||
    key.extractable ||
    key.algorithm.name !== "AES-GCM" ||
    !key.usages.includes("encrypt") ||
    !key.usages.includes("decrypt")
  ) {
    throw new Error(
      "refill ticket storage requires a non-extractable AES-GCM encrypt/decrypt key",
    );
  }
}

function canTransition(
  current: RefillTicketStatus,
  next: RefillTicketStatus,
): boolean {
  switch (current) {
    case "CREATED":
      return next === "FUNDED";
    case "FUNDED":
      return next === "CLAIMABLE" || next === "EXPIRED";
    case "CLAIMABLE":
      return next === "CLAIMING" || next === "EXPIRED";
    case "CLAIMING":
      return next === "CLAIMED";
    case "EXPIRED":
      return next === "REFUNDING";
    case "REFUNDING":
      return next === "REFUNDED";
    case "CLAIMED":
    case "REFUNDED":
      return false;
  }
}

export function transitionRefillTicket(
  ticket: RefillTicket,
  nextStatus: RefillTicketStatus,
  updatedAt = new Date().toISOString(),
): RefillTicket {
  if (ticket.status === nextStatus) {
    return ticket;
  }
  if (!canTransition(ticket.status, nextStatus)) {
    throw new Error(
      `invalid refill ticket transition ${ticket.status} -> ${nextStatus}`,
    );
  }
  return RefillTicketSchema.parse({
    ...ticket,
    status: nextStatus,
    updatedAt,
  });
}

export async function generateRefillTicketSealingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function sealTicket(
  ticket: RefillTicket,
  key: CryptoKey,
  keyName: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const textEncoder = new TextEncoder();
  const plaintext = textEncoder.encode(JSON.stringify(ticket));
  const additionalData = textEncoder.encode(`${ENCRYPTION_CONTEXT}:${keyName}`);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    key,
    plaintext,
  );
  return JSON.stringify({
    schemaVersion: "wrenchless.sealed-refill-ticket.v1",
    algorithm: "AES-GCM-256",
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
  });
}

async function openTicket(
  sealedValue: string,
  key: CryptoKey,
  keyName: string,
): Promise<RefillTicket> {
  let sealed: z.infer<typeof sealedTicketSchema>;
  try {
    sealed = sealedTicketSchema.parse(JSON.parse(sealedValue));
  } catch {
    throw new Error("stored refill ticket envelope is invalid");
  }

  let plaintext: ArrayBuffer;
  try {
    const textEncoder = new TextEncoder();
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: hexToBytes(sealed.iv),
        additionalData: textEncoder.encode(
          `${ENCRYPTION_CONTEXT}:${keyName}`,
        ),
      },
      key,
      hexToBytes(sealed.ciphertext),
    );
  } catch {
    throw new Error("stored refill ticket could not be decrypted");
  }

  try {
    return RefillTicketSchema.parse(
      JSON.parse(new TextDecoder().decode(plaintext)),
    );
  } catch {
    throw new Error("stored refill ticket plaintext is invalid");
  }
}

export function createRefillTicketStore(
  storage: RefillTicketStorage,
  key: CryptoKey,
): RefillTicketStore {
  assertSealingKey(key);

  const get = async (
    stateId: string | bigint,
  ): Promise<RefillTicket | null> => {
    const keyName = storageKey(stateId);
    const sealedValue = storage.getItem(keyName);
    if (sealedValue === null) {
      return null;
    }
    const ticket = await openTicket(sealedValue, key, keyName);
    if (BigInt(ticket.stateId) !== BigInt(toCanonicalFelt(stateId))) {
      throw new Error("stored refill ticket does not match its storage key");
    }
    return ticket;
  };

  return {
    async saveNew(ticket) {
      const parsed = RefillTicketSchema.parse(ticket);
      if (parsed.status !== "CREATED") {
        throw new Error("a new refill ticket must start in CREATED state");
      }
      const keyName = storageKey(parsed.stateId);
      if (storage.getItem(keyName) !== null) {
        throw new Error("refill ticket already exists");
      }
      storage.setItem(keyName, await sealTicket(parsed, key, keyName));
    },

    get,

    async transition(stateId, nextStatus, updatedAt) {
      const ticket = await get(stateId);
      if (ticket === null) {
        throw new Error("refill ticket does not exist");
      }
      const nextTicket = transitionRefillTicket(ticket, nextStatus, updatedAt);
      if (nextTicket === ticket) {
        return ticket;
      }
      const keyName = storageKey(stateId);
      storage.setItem(keyName, await sealTicket(nextTicket, key, keyName));
      return nextTicket;
    },
  };
}
