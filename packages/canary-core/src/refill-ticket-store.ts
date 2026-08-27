import { z } from "zod";

const STORAGE_PREFIX = "wrenchless.travel-safe-ticket.v2:";
const ENCRYPTION_CONTEXT = "WRENCHLESS_TRAVEL_SAFE_TICKET_V2";
const V3_STORAGE_PREFIX = "wrenchless.travel-safe-ticket.v3:";
const V3_ENCRYPTION_CONTEXT = "WRENCHLESS_TRAVEL_SAFE_TICKET_V3";
export const LEGACY_TRAVEL_SAFE_HELPER_ADDRESS =
  "0x18f6925422c85da8c9e0c1572adf4316a9821ffabc4b29db37d11c6a0c2844a";
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

const canonicalFeltSchema = z
  .string()
  .regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/, "expected a canonical felt")
  .refine((value) => BigInt(value) < STARK_FIELD_PRIME, "felt exceeds the Stark field");

const nonZeroFeltSchema = canonicalFeltSchema.refine(
  (value) => BigInt(value) !== 0n,
  "expected a non-zero felt",
);

function boundedDecimal(maximum: bigint, label: string) {
  return z
    .string()
    .regex(/^(?:0|[1-9][0-9]*)$/, `expected a canonical decimal ${label}`)
    .refine((value) => BigInt(value) <= maximum, `${label} is too large`);
}

export const TravelSafeTicketStatusSchema = z.enum([
  "READY",
  "FUND_SUBMITTING",
  "FUNDED",
  "RETURN_SUBMITTING",
  "TERMINAL",
]);

export const TravelSafeTicketSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.travel-safe-ticket.v2"),
    role: z.literal("safe"),
    stateId: nonZeroFeltSchema,
    status: TravelSafeTicketStatusSchema,
    recoveryPhrase: z.string().trim().min(1),
    recoveryAccount: nonZeroFeltSchema,
    tokenAddress: nonZeroFeltSchema,
    amountFri: boundedDecimal(U128_MAX, "amount").refine(
      (value) => BigInt(value) > 0n,
      "amount must be positive",
    ),
    returnDateSeconds: boundedDecimal(U64_MAX, "return date").refine(
      (value) => BigInt(value) > 0n,
      "return date must be positive",
    ),
    fundProofExpiresAtBlock: boundedDecimal(
      U64_MAX,
      "FUND proof expiry block",
    )
      .nullable()
      .default(null),
    fundTransactionHash: nonZeroFeltSchema.nullable(),
    returnSubmittedAtBlock: boundedDecimal(
      U64_MAX,
      "return submission block",
    )
      .nullable()
      .default(null),
    returnTransactionHash: nonZeroFeltSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const TravelSafeTicketV3StatusSchema = z.enum([
  "READY",
  "FUND_SUBMITTING",
  "FUNDED",
  "ACTION_SUBMITTING",
  "TERMINAL",
]);

export const TravelSafeTicketV3Schema = z
  .object({
    schemaVersion: z.literal("wrenchless.travel-safe-ticket.v3"),
    contractVersion: z.literal("v3"),
    role: z.literal("safe"),
    helperAddress: nonZeroFeltSchema,
    stateId: nonZeroFeltSchema,
    status: TravelSafeTicketV3StatusSchema,
    recoveryAccount: nonZeroFeltSchema,
    recoverySalt: nonZeroFeltSchema,
    devicePrivateKey: nonZeroFeltSchema,
    tokenAddress: nonZeroFeltSchema,
    tokenSymbol: z.enum(["STRK", "USDC"]),
    tokenDecimals: z.union([z.literal(18), z.literal(6)]),
    amountBaseUnits: boundedDecimal(U128_MAX, "amount").refine(
      (value) => BigInt(value) > 0n,
      "amount must be positive",
    ),
    dailyAmountBaseUnits: boundedDecimal(U128_MAX, "daily amount"),
    firstReleaseSeconds: boundedDecimal(U64_MAX, "first release").refine(
      (value) => BigInt(value) > 0n,
      "first release must be positive",
    ),
    returnDateSeconds: boundedDecimal(U64_MAX, "return date").refine(
      (value) => BigInt(value) > 0n,
      "return date must be positive",
    ),
    fundTransactionHash: nonZeroFeltSchema.nullable(),
    actionTransactionHash: nonZeroFeltSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

const sealedTicketSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.sealed-travel-safe-ticket.v2"),
    algorithm: z.literal("AES-GCM-256"),
    iv: z.string().regex(/^[0-9a-f]{24}$/),
    ciphertext: z.string().regex(/^(?:[0-9a-f]{2})+$/),
  })
  .strict();

const sealedTicketV3Schema = z
  .object({
    schemaVersion: z.literal("wrenchless.sealed-travel-safe-ticket.v3"),
    algorithm: z.literal("AES-GCM-256"),
    iv: z.string().regex(/^[0-9a-f]{24}$/),
    ciphertext: z.string().regex(/^(?:[0-9a-f]{2})+$/),
  })
  .strict();

export type TravelSafeTicketStatus = z.infer<
  typeof TravelSafeTicketStatusSchema
>;
export type TravelSafeTicket = z.infer<typeof TravelSafeTicketSchema>;
export type TravelSafeTicketV3Status = z.infer<
  typeof TravelSafeTicketV3StatusSchema
>;
export type TravelSafeTicketV3 = z.infer<typeof TravelSafeTicketV3Schema>;
export type AnyTravelSafeTicket = TravelSafeTicket | TravelSafeTicketV3;
export type TravelSafeTicketTransitionPatch = Partial<
  Pick<
    TravelSafeTicket,
    | "fundProofExpiresAtBlock"
    | "fundTransactionHash"
    | "returnSubmittedAtBlock"
    | "returnTransactionHash"
  >
>;
export type TravelSafeTicketV3TransitionPatch = Partial<
  Pick<
    TravelSafeTicketV3,
    "fundTransactionHash" | "actionTransactionHash"
  >
>;

export type TravelSafeTicketStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type TravelSafeTicketStore = {
  saveNew(ticket: TravelSafeTicket): Promise<void>;
  get(stateId: string | bigint): Promise<TravelSafeTicket | null>;
  transition(
    stateId: string | bigint,
    nextStatus: TravelSafeTicketStatus,
    patch?: TravelSafeTicketTransitionPatch,
    updatedAt?: string,
  ): Promise<TravelSafeTicket>;
  remove(stateId: string | bigint): void;
};

export type VersionedTravelSafeTicketStore = {
  saveNew(ticket: AnyTravelSafeTicket): Promise<void>;
  get(stateId: string | bigint): Promise<AnyTravelSafeTicket | null>;
  transitionV2(
    stateId: string | bigint,
    nextStatus: TravelSafeTicketStatus,
    patch?: TravelSafeTicketTransitionPatch,
    updatedAt?: string,
  ): Promise<TravelSafeTicket>;
  transitionV3(
    stateId: string | bigint,
    nextStatus: TravelSafeTicketV3Status,
    patch?: TravelSafeTicketV3TransitionPatch,
    updatedAt?: string,
  ): Promise<TravelSafeTicketV3>;
  remove(stateId: string | bigint): void;
};

function toCanonicalFelt(value: string | bigint): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error("Travel Safe state ID is not a felt");
  }
  if (parsed <= 0n || parsed >= STARK_FIELD_PRIME) {
    throw new Error("Travel Safe state ID is outside the non-zero Stark field");
  }
  return `0x${parsed.toString(16)}`;
}

function storageKey(stateId: string | bigint): string {
  return `${STORAGE_PREFIX}${toCanonicalFelt(stateId)}`;
}

function v3StorageKey(stateId: string | bigint): string {
  return `${V3_STORAGE_PREFIX}${toCanonicalFelt(stateId)}`;
}

export function removeTravelSafeTicket(
  storage: TravelSafeTicketStorage,
  stateId: string | bigint,
): void {
  storage.removeItem(storageKey(stateId));
  storage.removeItem(v3StorageKey(stateId));
}

export function resolveTicketContract(ticket: AnyTravelSafeTicket): {
  contractVersion: "v2" | "v3";
  helperAddress: string;
} {
  if (ticket.schemaVersion === "wrenchless.travel-safe-ticket.v3") {
    return { contractVersion: "v3", helperAddress: ticket.helperAddress };
  }
  return {
    contractVersion: "v2",
    helperAddress: LEGACY_TRAVEL_SAFE_HELPER_ADDRESS,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
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
      "Travel Safe storage requires a non-extractable AES-GCM encrypt/decrypt key",
    );
  }
}

function canTransition(
  current: TravelSafeTicketStatus,
  next: TravelSafeTicketStatus,
): boolean {
  switch (current) {
    case "READY":
      return next === "FUND_SUBMITTING";
    case "FUND_SUBMITTING":
      return next === "READY" || next === "FUNDED";
    case "FUNDED":
      return next === "RETURN_SUBMITTING" || next === "TERMINAL";
    case "RETURN_SUBMITTING":
      return next === "FUNDED" || next === "TERMINAL";
    case "TERMINAL":
      return false;
  }
}

function canTransitionV3(
  current: TravelSafeTicketV3Status,
  next: TravelSafeTicketV3Status,
): boolean {
  switch (current) {
    case "READY":
      return next === "FUND_SUBMITTING";
    case "FUND_SUBMITTING":
      return next === "READY" || next === "FUNDED";
    case "FUNDED":
      return next === "ACTION_SUBMITTING" || next === "TERMINAL";
    case "ACTION_SUBMITTING":
      return next === "FUNDED" || next === "TERMINAL";
    case "TERMINAL":
      return false;
  }
}

export function transitionTravelSafeTicket(
  ticket: TravelSafeTicket,
  nextStatus: TravelSafeTicketStatus,
  patch: TravelSafeTicketTransitionPatch = {},
  updatedAt = new Date().toISOString(),
): TravelSafeTicket {
  if (ticket.status !== nextStatus && !canTransition(ticket.status, nextStatus)) {
    throw new Error(
      `invalid Travel Safe ticket transition ${ticket.status} -> ${nextStatus}`,
    );
  }
  return TravelSafeTicketSchema.parse({
    ...ticket,
    ...patch,
    status: nextStatus,
    updatedAt,
  });
}

export function transitionTravelSafeTicketV3(
  ticket: TravelSafeTicketV3,
  nextStatus: TravelSafeTicketV3Status,
  patch: TravelSafeTicketV3TransitionPatch = {},
  updatedAt = new Date().toISOString(),
): TravelSafeTicketV3 {
  if (
    ticket.status !== nextStatus &&
    !canTransitionV3(ticket.status, nextStatus)
  ) {
    throw new Error(
      `invalid Travel Safe v3 ticket transition ${ticket.status} -> ${nextStatus}`,
    );
  }
  return TravelSafeTicketV3Schema.parse({
    ...ticket,
    ...patch,
    status: nextStatus,
    updatedAt,
  });
}

export async function generateTravelSafeTicketSealingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function sealTicket(
  ticket: TravelSafeTicket,
  key: CryptoKey,
  keyName: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(`${ENCRYPTION_CONTEXT}:${keyName}`),
    },
    key,
    encoder.encode(JSON.stringify(ticket)),
  );
  return JSON.stringify({
    schemaVersion: "wrenchless.sealed-travel-safe-ticket.v2",
    algorithm: "AES-GCM-256",
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
  });
}

async function sealTicketV3(
  ticket: TravelSafeTicketV3,
  key: CryptoKey,
  keyName: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(`${V3_ENCRYPTION_CONTEXT}:${keyName}`),
    },
    key,
    encoder.encode(JSON.stringify(ticket)),
  );
  return JSON.stringify({
    schemaVersion: "wrenchless.sealed-travel-safe-ticket.v3",
    algorithm: "AES-GCM-256",
    iv: bytesToHex(iv),
    ciphertext: bytesToHex(new Uint8Array(ciphertext)),
  });
}

async function openTicket(
  sealedValue: string,
  key: CryptoKey,
  keyName: string,
): Promise<TravelSafeTicket> {
  let sealed: z.infer<typeof sealedTicketSchema>;
  try {
    sealed = sealedTicketSchema.parse(JSON.parse(sealedValue));
  } catch {
    throw new Error("stored Travel Safe ticket envelope is invalid");
  }
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: hexToBytes(sealed.iv),
        additionalData: new TextEncoder().encode(
          `${ENCRYPTION_CONTEXT}:${keyName}`,
        ),
      },
      key,
      hexToBytes(sealed.ciphertext),
    );
  } catch {
    throw new Error("stored Travel Safe ticket could not be decrypted");
  }
  try {
    return TravelSafeTicketSchema.parse(
      JSON.parse(new TextDecoder().decode(plaintext)),
    );
  } catch {
    throw new Error("stored Travel Safe ticket plaintext is invalid");
  }
}

async function openTicketV3(
  sealedValue: string,
  key: CryptoKey,
  keyName: string,
): Promise<TravelSafeTicketV3> {
  let sealed: z.infer<typeof sealedTicketV3Schema>;
  try {
    sealed = sealedTicketV3Schema.parse(JSON.parse(sealedValue));
  } catch {
    throw new Error("stored Travel Safe v3 ticket envelope is invalid");
  }
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: hexToBytes(sealed.iv),
        additionalData: new TextEncoder().encode(
          `${V3_ENCRYPTION_CONTEXT}:${keyName}`,
        ),
      },
      key,
      hexToBytes(sealed.ciphertext),
    );
  } catch {
    throw new Error("stored Travel Safe v3 ticket could not be decrypted");
  }
  try {
    return TravelSafeTicketV3Schema.parse(
      JSON.parse(new TextDecoder().decode(plaintext)),
    );
  } catch {
    throw new Error("stored Travel Safe v3 ticket plaintext is invalid");
  }
}

export function createTravelSafeTicketStore(
  storage: TravelSafeTicketStorage,
  key: CryptoKey,
): TravelSafeTicketStore {
  assertSealingKey(key);
  const get = async (
    stateId: string | bigint,
  ): Promise<TravelSafeTicket | null> => {
    const keyName = storageKey(stateId);
    const sealedValue = storage.getItem(keyName);
    if (sealedValue === null) return null;
    const ticket = await openTicket(sealedValue, key, keyName);
    if (BigInt(ticket.stateId) !== BigInt(toCanonicalFelt(stateId))) {
      throw new Error("stored Travel Safe ticket does not match its storage key");
    }
    return ticket;
  };

  return {
    async saveNew(ticket) {
      const parsed = TravelSafeTicketSchema.parse(ticket);
      if (parsed.status !== "READY") {
        throw new Error("a new Travel Safe ticket must start ready to fund");
      }
      const keyName = storageKey(parsed.stateId);
      if (storage.getItem(keyName) !== null) {
        throw new Error("Travel Safe ticket already exists");
      }
      storage.setItem(keyName, await sealTicket(parsed, key, keyName));
    },
    get,
    async transition(stateId, nextStatus, patch = {}, updatedAt) {
      const ticket = await get(stateId);
      if (ticket === null) throw new Error("Travel Safe ticket does not exist");
      const nextTicket = transitionTravelSafeTicket(
        ticket,
        nextStatus,
        patch,
        updatedAt,
      );
      const keyName = storageKey(stateId);
      storage.setItem(keyName, await sealTicket(nextTicket, key, keyName));
      return nextTicket;
    },
    remove(stateId) {
      removeTravelSafeTicket(storage, stateId);
    },
  };
}

export function createVersionedTravelSafeTicketStore(
  storage: TravelSafeTicketStorage,
  key: CryptoKey,
): VersionedTravelSafeTicketStore {
  assertSealingKey(key);
  const get = async (
    stateId: string | bigint,
  ): Promise<AnyTravelSafeTicket | null> => {
    const canonicalStateId = toCanonicalFelt(stateId);
    const v3KeyName = v3StorageKey(canonicalStateId);
    const sealedV3 = storage.getItem(v3KeyName);
    if (sealedV3 !== null) {
      const ticket = await openTicketV3(sealedV3, key, v3KeyName);
      if (BigInt(ticket.stateId) !== BigInt(canonicalStateId)) {
        throw new Error(
          "stored Travel Safe v3 ticket does not match its storage key",
        );
      }
      return ticket;
    }

    const v2KeyName = storageKey(canonicalStateId);
    const sealedV2 = storage.getItem(v2KeyName);
    if (sealedV2 === null) return null;
    const ticket = await openTicket(sealedV2, key, v2KeyName);
    if (BigInt(ticket.stateId) !== BigInt(canonicalStateId)) {
      throw new Error("stored Travel Safe ticket does not match its storage key");
    }
    return ticket;
  };

  return {
    async saveNew(ticket) {
      const canonicalStateId = toCanonicalFelt(ticket.stateId);
      if (
        storage.getItem(storageKey(canonicalStateId)) !== null ||
        storage.getItem(v3StorageKey(canonicalStateId)) !== null
      ) {
        throw new Error("Travel Safe ticket already exists");
      }

      if (ticket.schemaVersion === "wrenchless.travel-safe-ticket.v2") {
        const parsed = TravelSafeTicketSchema.parse(ticket);
        if (parsed.status !== "READY") {
          throw new Error("a new Travel Safe ticket must start ready to fund");
        }
        const keyName = storageKey(canonicalStateId);
        storage.setItem(keyName, await sealTicket(parsed, key, keyName));
        return;
      }

      const parsed = TravelSafeTicketV3Schema.parse(ticket);
      if (parsed.status !== "READY") {
        throw new Error("a new Travel Safe v3 ticket must start ready to fund");
      }
      const keyName = v3StorageKey(canonicalStateId);
      storage.setItem(keyName, await sealTicketV3(parsed, key, keyName));
    },
    get,
    async transitionV2(stateId, nextStatus, patch = {}, updatedAt) {
      const ticket = await get(stateId);
      if (ticket === null) throw new Error("Travel Safe ticket does not exist");
      if (ticket.schemaVersion !== "wrenchless.travel-safe-ticket.v2") {
        throw new Error("Travel Safe ticket is not v2");
      }
      const nextTicket = transitionTravelSafeTicket(
        ticket,
        nextStatus,
        patch,
        updatedAt,
      );
      const keyName = storageKey(stateId);
      storage.setItem(keyName, await sealTicket(nextTicket, key, keyName));
      return nextTicket;
    },
    async transitionV3(stateId, nextStatus, patch = {}, updatedAt) {
      const ticket = await get(stateId);
      if (ticket === null) throw new Error("Travel Safe ticket does not exist");
      if (ticket.schemaVersion !== "wrenchless.travel-safe-ticket.v3") {
        throw new Error("Travel Safe ticket is not v3");
      }
      const nextTicket = transitionTravelSafeTicketV3(
        ticket,
        nextStatus,
        patch,
        updatedAt,
      );
      const keyName = v3StorageKey(stateId);
      storage.setItem(keyName, await sealTicketV3(nextTicket, key, keyName));
      return nextTicket;
    },
    remove(stateId) {
      removeTravelSafeTicket(storage, stateId);
    },
  };
}
