import { z } from "zod";

import { fromBase64Url, toBase64Url } from "./pairing-code";

/**
 * The two invitations the home vault hands out.
 *
 * Setup happens in one place, on the device that holds the money, and the other
 * two devices are equipped from there. Each of them needs a different thing, so
 * each gets its own token with its own prefix: a code pasted into the wrong box
 * is refused by shape rather than by a confusing validation error further in.
 *
 * This is transport, not protection. Both tokens are the same bytes in
 * base64url; anyone who reads one over your shoulder holds what it holds. Both
 * are shown once, on the vault's own screen, and the confirmation step that
 * follows is what establishes that the right device received it.
 *
 * They travel inside a URL fragment. A fragment is never sent to a server, so
 * the invitation reaches the phone's browser and nothing else — which matters,
 * because each of these carries a bearer capability.
 */

const GUARDIAN_PREFIX = "wrg1";
const CARRIED_PREFIX = "wrc1";

const guardianInvitationSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.guardian-invitation.v1"),
    /** The name the reader will see, chosen by the person being watched. */
    alias: z.string().trim().min(1).max(48),
    /** What the two of them agreed the reader should do. Optional by design. */
    instruction: z.string().trim().min(1).max(160).nullable(),
    /** Where a pause goes, and the key it is sealed to. */
    controlMailboxUrl: z.url(),
    controlMailboxId: z.string().regex(/^[0-9a-f]{32}$/),
    controlSendCapability: z.string().regex(/^[0-9a-f]{64}$/),
    controlPublicKey: z.string().regex(/^04[0-9a-f]{128}$/),
  })
  .strict();

const carriedInvitationSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.carried-invitation.v1"),
    /** A serialized `wrenchless.cover-enrollment.v1` bundle. */
    enrollmentText: z.string().min(1).max(4000),
    /** The serialized access-code configuration. Verifiers, never codes. */
    accessConfigText: z.string().min(1).max(2000),
    exposureCapFri: z.string().regex(/^[0-9]+$/),
  })
  .strict();

export type GuardianInvitation = z.infer<typeof guardianInvitationSchema>;
export type CarriedInvitation = z.infer<typeof carriedInvitationSchema>;

export type InvitationResult<T> =
  | { ok: true; invitation: T }
  | { ok: false; message: string };

function clean(input: string): string {
  return input.trim().replace(/\s+/g, "").replace(/^["']|["']$/g, "");
}

function encode<T>(prefix: string, value: T): string {
  return `${prefix}_${toBase64Url(JSON.stringify(value))}`;
}

function decode<T>(
  input: string,
  prefix: string,
  schema: z.ZodType<T>,
  noun: string,
): InvitationResult<T> {
  const cleaned = clean(input);
  if (cleaned.length === 0) {
    return { ok: false, message: `Paste the ${noun} first.` };
  }
  if (!cleaned.startsWith(`${prefix}_`)) {
    return { ok: false, message: `That does not look like a ${noun}.` };
  }
  let json: string;
  try {
    json = fromBase64Url(cleaned.slice(prefix.length + 1));
  } catch {
    return { ok: false, message: `That ${noun} is incomplete.` };
  }
  try {
    return { ok: true, invitation: schema.parse(JSON.parse(json)) };
  } catch {
    return { ok: false, message: `That ${noun} is not valid.` };
  }
}

export function toGuardianInvitation(
  input: Omit<GuardianInvitation, "schemaVersion">,
): string {
  return encode(
    GUARDIAN_PREFIX,
    guardianInvitationSchema.parse({
      schemaVersion: "wrenchless.guardian-invitation.v1",
      ...input,
    }),
  );
}

export function fromGuardianInvitation(
  input: string,
): InvitationResult<GuardianInvitation> {
  return decode(input, GUARDIAN_PREFIX, guardianInvitationSchema, "invitation");
}

export function toCarriedInvitation(
  input: Omit<CarriedInvitation, "schemaVersion">,
): string {
  return encode(
    CARRIED_PREFIX,
    carriedInvitationSchema.parse({
      schemaVersion: "wrenchless.carried-invitation.v1",
      ...input,
    }),
  );
}

export function fromCarriedInvitation(
  input: string,
): InvitationResult<CarriedInvitation> {
  return decode(input, CARRIED_PREFIX, carriedInvitationSchema, "invitation");
}

/**
 * The link a camera opens.
 *
 * The token rides in the fragment so it reaches the browser and no server, and
 * the receiving screen strips it from the address bar the moment it is read.
 */
export function invitationLink(route: string, token: string): string {
  const origin =
    import.meta.env.VITE_PAIRING_ORIGIN?.trim().replace(/\/+$/, "") ||
    window.location.origin;
  return `${origin}${route}#i=${token}`;
}

export function readInvitationFromLocation(): string | null {
  const match = /^#i=(.+)$/.exec(window.location.hash);
  const token = match?.[1];
  if (token === undefined) return null;
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
  return token;
}

/**
 * The receipt a paired device reads back.
 *
 * It is random and generated on the device that accepted an invitation, so the
 * vault cannot compute it from anything it already holds. Typing it back is
 * therefore evidence that the invitation arrived somewhere, which is the whole
 * job — it is not a key and protects nothing on its own.
 */
export function createConfirmationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`.toUpperCase();
}
