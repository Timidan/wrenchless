import {
  parseGuardianEnrollmentBundle,
  serializeRoleHandoffBundle,
  type GuardianEnrollmentBundle,
} from "../lib/role-handoff";

/**
 * The invitation, as one line a person can send.
 *
 * The enrollment bundle is a small JSON document with a public key and a
 * delivery capability in it. Showing that document to someone setting up a
 * wallet teaches them nothing and frightens them a little, so it travels as a
 * single opaque token instead.
 *
 * This is transport, not protection. The token is the same bytes in base64url
 * with a version prefix; anyone who intercepts it can read it, exactly as they
 * could read the JSON. It is not encrypted and this module does not pretend
 * otherwise — the bundle's own module still decides what is valid, and the
 * fingerprint check is what actually confirms the pairing.
 */

const PREFIX = "wrl1";

export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(token: string): string {
  const padded = token.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function toPairingCode(bundle: GuardianEnrollmentBundle): string {
  return `${PREFIX}_${toBase64Url(serializeRoleHandoffBundle(bundle))}`;
}

export type PairingCodeResult =
  | { ok: true; bundle: GuardianEnrollmentBundle }
  | { ok: false; message: string };

/**
 * Accepts what a person pastes: extra spaces, a line break from an email
 * client, a stray quote. Rejects anything the bundle module will not accept,
 * and says which of the two went wrong.
 */
export function fromPairingCode(input: string): PairingCodeResult {
  const cleaned = input.trim().replace(/\s+/g, "").replace(/^["']|["']$/g, "");
  if (cleaned.length === 0) {
    return { ok: false, message: "Paste the invitation code first." };
  }
  if (!cleaned.startsWith(`${PREFIX}_`)) {
    return {
      ok: false,
      message: "That does not look like a Wrenchless invitation code.",
    };
  }
  let json: string;
  try {
    json = fromBase64Url(cleaned.slice(PREFIX.length + 1));
  } catch {
    return { ok: false, message: "That invitation code is incomplete." };
  }
  try {
    return { ok: true, bundle: parseGuardianEnrollmentBundle(json) };
  } catch {
    return { ok: false, message: "That invitation code is not valid." };
  }
}
