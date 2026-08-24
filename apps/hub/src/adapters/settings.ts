import { useSyncExternalStore } from "react";
import { z } from "zod";

import { WRENCHLESS_SERVICES } from "../lib/product-config";
import {
  parseCoverEnrollmentBundle,
  serializeRoleHandoffBundle,
  type CoverEnrollmentBundle,
} from "../lib/role-handoff";

/**
 * What this browser remembers between visits, and nothing more.
 *
 * The wallet's half of the enrollment is stored exactly as the role-handoff
 * module produced it, as one serialized bundle that is re-parsed by that module
 * on the way out. Keeping it whole is deliberate: a record that stored the five
 * fields loosely would be a second place where their shape is defined, and the
 * two would drift.
 *
 * The enrollment bundle contains only the mailbox destination and the vault's
 * public encryption key. Sending is authorized separately by the carried
 * device's non-extractable signing key.
 *
 * Nothing here is safety state. The classification a valid code selects lives
 * inside the session module and never reaches this record or any component.
 */

// The signed-mailbox protocol is intentionally a clean setup boundary. Keeping
// v1 would let an apparently complete setup retain enrollment data that the new
// server must reject.
const STORAGE_KEY = "wrenchless.hub-settings.v2";

/** 100 STRK. A starting ceiling, meant to be changed, never a promise. */
export const DEFAULT_EXPOSURE_CAP_FRI = (100n * 10n ** 18n).toString();

const settingsSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.hub-settings.v2"),
    mailboxUrl: z.string(),
    sponsorUrl: z.string(),
    exposureCapFri: z.string().regex(/^[0-9]+$/),
    /** A serialized `wrenchless.cover-enrollment.v2` bundle, or nothing. */
    coverEnrollmentText: z.string().nullable(),
    /** The reading device's own retrieval capability. Never handed out. */
    inboxId: z.string().nullable(),
    inboxReceiveCapability: z.string().nullable(),
    /** One-time refill codes made or funded in this browser. */
    refillStateIds: z.array(z.string()).max(24),
    /** Set when first-run setup finished on this device. */
    onboardedAt: z.string().nullable(),
    /**
     * This device's own passkey, as the credential ID and public key the
     * verifier needs. Never the private key: that never leaves the
     * authenticator, which is the whole point of it.
     */
    devicePasskeyId: z.string().nullable().default(null),
    devicePasskeyPublicKey: z.string().nullable().default(null),
    /** The Ready Wallet account the home vault holds the reserve in. */
    reserveAccount: z.string().nullable().default(null),
    /** The Ready Wallet account used on this carried device. Never shared. */
    carriedAccount: z.string().nullable().default(null),
    /**
     * Confirmation codes, both directions of one handshake.
     *
     * `deviceCode` is what this device shows after it accepts an invitation;
     * `carriedDeviceCode` is what the home vault recorded when the carried
     * phone read its code back. The vault cannot compute the second one, which
     * is what makes typing it back evidence rather than ceremony.
     */
    deviceCode: z.string().nullable().default(null),
    /**
     * The receipt this device showed after pairing, kept so leaving the screen
     * does not mean minting a second batch of one-time restore requests.
     * It holds public commitments and a confirmation code, and no key.
     */
    deviceReceiptToken: z.string().nullable().default(null),
    /** Set when the person confirmed the other device had read the receipt. */
    deviceReceiptDoneAt: z.string().nullable().default(null),
    /** One-use automatic return path supplied by a v3 carried invitation. */
    pairingResponseMailboxId: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .nullable()
      .default(null),
    pairingResponseBindCapability: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable()
      .default(null),
    pairingResponsePublicKey: z
      .string()
      .regex(/^04[0-9a-f]{128}$/)
      .nullable()
      .default(null),
    carriedDeviceCode: z.string().nullable().default(null),
    carriedPairedAt: z.string().nullable().default(null),
    guardianPairedAt: z.string().nullable().default(null),
    /** Kept only until the guardian confirms the vault copied its reply. */
    guardianResponseToken: z.string().nullable().default(null),
    /** Authenticated carried-message key learned from the home vault. */
    carriedSenderPublicKey: z.string().nullable().default(null),
    /**
     * The home vault's own control inbox: where a guardian's pause command
     * arrives. The vault keeps the retrieval capability. A one-time invitation
     * binds the guardian's signing key to the mailbox, so later writes must be
     * signed and the guardian still cannot read the inbox.
     */
    controlInboxId: z.string().nullable().default(null),
    controlInboxReceiveCapability: z.string().nullable().default(null),
    /** When the home vault last dismissed a pause it had already seen. */
    pauseLiftedAt: z.string().nullable().default(null),
    /**
     * The guardian device's half of the same channel: where to send, what to
     * seal it to, and whose name to put on the screen.
     */
    controlTargetUrl: z.string().nullable().default(null),
    controlTargetId: z.string().nullable().default(null),
    controlTargetPublicKey: z.string().nullable().default(null),
    signalAlias: z.string().nullable().default(null),
    signalInstruction: z.string().nullable().default(null),
  })
  .strict();

export type HubSettings = z.infer<typeof settingsSchema>;

const EMPTY: HubSettings = {
  schemaVersion: "wrenchless.hub-settings.v2",
  mailboxUrl: WRENCHLESS_SERVICES.mailboxUrl,
  sponsorUrl: WRENCHLESS_SERVICES.sponsorUrl,
  exposureCapFri: DEFAULT_EXPOSURE_CAP_FRI,
  coverEnrollmentText: null,
  inboxId: null,
  inboxReceiveCapability: null,
  refillStateIds: [],
  onboardedAt: null,
  devicePasskeyId: null,
  devicePasskeyPublicKey: null,
  reserveAccount: null,
  carriedAccount: null,
  deviceCode: null,
  deviceReceiptToken: null,
  deviceReceiptDoneAt: null,
  pairingResponseMailboxId: null,
  pairingResponseBindCapability: null,
  pairingResponsePublicKey: null,
  carriedDeviceCode: null,
  carriedPairedAt: null,
  guardianPairedAt: null,
  guardianResponseToken: null,
  carriedSenderPublicKey: null,
  controlInboxId: null,
  controlInboxReceiveCapability: null,
  pauseLiftedAt: null,
  controlTargetUrl: null,
  controlTargetId: null,
  controlTargetPublicKey: null,
  signalAlias: null,
  signalInstruction: null,
};

function load(): HubSettings {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === null) return EMPTY;
  // A record this browser can no longer read is replaced, not repaired: a
  // half-parsed capability is worse than asking for setup again.
  try {
    const parsed = settingsSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

let snapshot: HubSettings = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function current(): HubSettings {
  if (!loaded) {
    snapshot = load();
    loaded = true;
  }
  return snapshot;
}

export function writeSettings(
  patch: Partial<Omit<HubSettings, "schemaVersion">>,
): void {
  snapshot = settingsSchema.parse({ ...current(), ...patch });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  for (const listener of listeners) listener();
}

/**
 * Declared once, outside the hook.
 *
 * `useSyncExternalStore` compares the subscribe function by identity: a fresh
 * arrow on every render makes React tear the subscription down and set it up
 * again on every commit.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emptySettings(): HubSettings {
  return EMPTY;
}

export function useSettings(): HubSettings {
  return useSyncExternalStore(subscribe, current, emptySettings);
}

export function readSettings(): HubSettings {
  return current();
}

export function rememberRefillStateId(stateId: string): void {
  const existing = current().refillStateIds;
  if (existing.includes(stateId)) return;
  writeSettings({ refillStateIds: [stateId, ...existing].slice(0, 24) });
}

/**
 * The stored enrollment, re-parsed by the module that defined it.
 *
 * Returns null rather than throwing when the record is absent or no longer
 * valid, because both cases mean the same thing to every caller: this device
 * is not set up, and the screens must say so instead of half-working.
 */
export function coverEnrollment(
  settings: HubSettings,
): CoverEnrollmentBundle | null {
  if (settings.coverEnrollmentText === null) return null;
  try {
    return parseCoverEnrollmentBundle(settings.coverEnrollmentText);
  } catch {
    return null;
  }
}

export function markOnboarded(): void {
  if (current().onboardedAt !== null) return;
  writeSettings({ onboardedAt: new Date().toISOString() });
}

/**
 * Whether this browser can act as the wallet at all.
 *
 * Both halves have to be present: a paired reader, and a pair of access codes.
 * The codes live in the session module's own storage, so the caller passes what
 * that module reported rather than this record guessing at it.
 */
export function walletIsReady(
  settings: HubSettings,
  codesAreSet: boolean,
): boolean {
  return coverEnrollment(settings) !== null && codesAreSet;
}

export function storeCoverEnrollment(bundle: CoverEnrollmentBundle): void {
  writeSettings({
    coverEnrollmentText: serializeRoleHandoffBundle(bundle),
    mailboxUrl: bundle.mailboxUrl,
  });
}
