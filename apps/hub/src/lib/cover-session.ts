import { z } from "zod";

import {
  attemptCoverPayment,
  type CoverPaymentResult,
} from "./cover-payment.js";

const PIN_CONFIG_KEY = "wrenchless.cover-pin-config.v1";
const PIN_ITERATIONS = 310_000;
const SESSION_LIFETIME_MILLISECONDS = 5 * 60_000;

const pinConfigSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.cover-pin-config.v1"),
    algorithm: z.literal("PBKDF2-HMAC-SHA256"),
    iterations: z.literal(PIN_ITERATIONS),
    normalSalt: z.string().regex(/^[0-9a-f]{32}$/),
    normalVerifier: z.string().regex(/^[0-9a-f]{64}$/),
    distressSalt: z.string().regex(/^[0-9a-f]{32}$/),
    distressVerifier: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

type CoverPaymentInput = Omit<
  Parameters<typeof attemptCoverPayment>[0],
  "sessionSignal"
>;

export type NeutralCoverSessionState =
  | { state: "setup_required" }
  | { state: "locked" }
  | { state: "unlocked"; expiresAt: string };

export type CoverSessionController = {
  state(): NeutralCoverSessionState;
  setup(normalPin: string, distressPin: string): Promise<NeutralCoverSessionState>;
  unlock(pin: string): Promise<NeutralCoverSessionState>;
  lock(): void;
  attemptPayment(input: CoverPaymentInput): Promise<CoverPaymentResult>;
};

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

/**
 * Every message thrown from here is rendered to a person, on setup or on the
 * lock screen, so all of them are written for one. None of them says which of
 * the two codes was involved: on the lock screen that would be the whole
 * product given away, and on setup it would only tell someone what they can
 * already see above the field.
 */
function validatePin(pin: string): void {
  if (!/^\d{6,12}$/.test(pin)) {
    throw new Error("Use six digits.");
  }
  if (/^(\d)\1+$/.test(pin)) {
    throw new Error("Do not use the same digit over and over.");
  }
}

function pinsAreTriviallyRelated(first: string, second: string): boolean {
  if (first === second || first === Array.from(second).reverse().join("")) {
    return true;
  }
  if (first.length !== second.length) return false;
  let differences = 0;
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) differences += 1;
  }
  return differences <= 1;
}

async function deriveVerifier(pin: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: PIN_ITERATIONS,
      salt: hexToBytes(saltHex),
    },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function equalVerifier(first: string, second: string): boolean {
  if (first.length !== second.length) return false;
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }
  return difference === 0;
}

function readPinConfig(storage: Storage) {
  const stored = storage.getItem(PIN_CONFIG_KEY);
  if (stored === null) return null;
  try {
    return pinConfigSchema.parse(JSON.parse(stored));
  } catch {
    throw new Error("The access codes on this device cannot be read.");
  }
}

/**
 * The access-code configuration, as the opaque record it already is.
 *
 * Setup happens on the home vault and the wallet runs on another device, so the
 * two verifiers and their salts have to travel. What travels is exactly what is
 * already stored: PBKDF2 verifiers, never a code. Deriving the same record on
 * the second device would mean asking for both codes again on the one screen
 * that must never mention that there are two.
 *
 * Reading and writing go through the same schema as everything else here, so a
 * record from an older or forged sender is refused rather than half-installed.
 */
export function exportCoverAccessConfig(
  storage: Storage = localStorage,
): string | null {
  const config = readPinConfig(storage);
  return config === null ? null : JSON.stringify(config);
}

export function importCoverAccessConfig(
  text: string,
  storage: Storage = localStorage,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The access codes did not arrive intact");
  }
  storage.setItem(
    PIN_CONFIG_KEY,
    JSON.stringify(pinConfigSchema.parse(parsed)),
  );
}

export function createCoverSessionController(options: {
  storage?: Storage;
  now?: () => number;
  sessionLifetimeMilliseconds?: number;
} = {}): CoverSessionController {
  const storage = options.storage ?? localStorage;
  const now = options.now ?? Date.now;
  const sessionLifetime =
    options.sessionLifetimeMilliseconds ?? SESSION_LIFETIME_MILLISECONDS;
  if (!Number.isSafeInteger(sessionLifetime) || sessionLifetime <= 0) {
    throw new Error("cover session lifetime must be a positive integer");
  }

  let signal: "OK" | "DISTRESS" | null = null;
  let expiresAt = 0;

  const lock = (): void => {
    signal = null;
    expiresAt = 0;
  };

  const state = (): NeutralCoverSessionState => {
    if (readPinConfig(storage) === null) return { state: "setup_required" };
    if (signal === null || expiresAt <= now()) {
      lock();
      return { state: "locked" };
    }
    return { state: "unlocked", expiresAt: new Date(expiresAt).toISOString() };
  };

  return {
    state,

    async setup(normalPin, distressPin) {
      validatePin(normalPin);
      validatePin(distressPin);
      if (pinsAreTriviallyRelated(normalPin, distressPin)) {
        throw new Error("The two codes are too alike. Change one of them.");
      }
      const normalSalt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
      const distressSalt = bytesToHex(
        crypto.getRandomValues(new Uint8Array(16)),
      );
      const [normalVerifier, distressVerifier] = await Promise.all([
        deriveVerifier(normalPin, normalSalt),
        deriveVerifier(distressPin, distressSalt),
      ]);
      storage.setItem(
        PIN_CONFIG_KEY,
        JSON.stringify({
          schemaVersion: "wrenchless.cover-pin-config.v1",
          algorithm: "PBKDF2-HMAC-SHA256",
          iterations: PIN_ITERATIONS,
          normalSalt,
          normalVerifier,
          distressSalt,
          distressVerifier,
        }),
      );
      lock();
      return state();
    },

    async unlock(pin) {
      if (!/^\d{6,12}$/.test(pin)) {
        throw new Error("That code was not accepted.");
      }
      const config = readPinConfig(storage);
      if (config === null) {
        throw new Error("This wallet is not set up on this device yet.");
      }
      const [normalVerifier, distressVerifier] = await Promise.all([
        deriveVerifier(pin, config.normalSalt),
        deriveVerifier(pin, config.distressSalt),
      ]);
      const normalMatch = equalVerifier(normalVerifier, config.normalVerifier);
      const distressMatch = equalVerifier(
        distressVerifier,
        config.distressVerifier,
      );
      if (!normalMatch && !distressMatch) {
        lock();
        throw new Error("That code was not accepted.");
      }
      signal = normalMatch ? "OK" : "DISTRESS";
      expiresAt = now() + sessionLifetime;
      return state();
    },

    lock,

    async attemptPayment(input) {
      if (state().state !== "unlocked" || signal === null) {
        throw new Error("Open the wallet before paying.");
      }
      return attemptCoverPayment({ ...input, sessionSignal: signal });
    },
  };
}
