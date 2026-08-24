/**
 * The device passkey, and what it is actually worth here.
 *
 * Opening a Travel Safe on this device starts with a
 * user-verifying authenticator: a device passkey, synced passkey, nearby phone
 * or security key. That is a real gate — the browser will not produce an
 * assertion without the person in front of the authenticator — and this module
 * verifies the assertion against the public key recorded at enrolment, so a
 * forged `navigator.credentials` response does not open anything.
 *
 * What it is not is a server-side relying party. There is no backend to hold
 * the challenge, so the challenge is generated and checked in this browser, and
 * the credential's own signature counter is not tracked across devices. That
 * makes this a device gate, not an account credential; it protects a phone
 * someone picked up, not an account someone is attacking remotely. A hosted
 * WebAuthn relying party is the missing piece, and it is named in the handoff
 * rather than papered over here.
 *
 * Only ES256 (`alg: -7`) is accepted. Every platform authenticator this product
 * targets offers it, and accepting a second algorithm would mean a second
 * verification path to keep correct.
 */

import { z } from "zod";

const ES256 = -7;
const RELYING_PARTY_NAME = "Wrenchless";
const TIMEOUT_MILLISECONDS = 60_000;

export type DevicePasskey = {
  /** base64url of the credential's raw ID. */
  credentialId: string;
  /** base64url of the credential's SubjectPublicKeyInfo. */
  publicKey: string;
};

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomChallenge(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Whether this browser can be asked at all.
 *
 * A page served over plain HTTP to another machine on the network is not a
 * secure context, so `navigator.credentials` is simply absent. The screens use
 * this to say so instead of firing a call that rejects with a DOM exception
 * nobody can act on.
 */
export function devicePasskeysAvailable(): boolean {
  return (
    window.isSecureContext &&
    "PublicKeyCredential" in window &&
    "credentials" in navigator
  );
}

function assertAvailable(): void {
  if (devicePasskeysAvailable()) return;
  throw new Error(
    "This browser cannot use a passkey here. Open the page over HTTPS, or on the device itself.",
  );
}

/**
 * Turns the browser's own refusal into something a person can act on.
 *
 * A `DOMException` from this API says things like "This is an invalid domain",
 * which is true, precise, and useless to the person holding the phone. Each
 * name below maps to the one thing they can actually do about it; anything
 * unrecognised keeps its own message rather than being flattened into a shrug.
 */
function passkeyFailure<T>(error: T, verb: "save" | "use"): Error {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "SecurityError") {
    return new Error(
      "Passkeys need a real address. Open this page on localhost or over HTTPS, not an IP address.",
    );
  }
  if (name === "NotAllowedError") {
    return new Error("That was cancelled, or it timed out. Try again.");
  }
  if (name === "InvalidStateError") {
    return new Error("This device already has a passkey for Wrenchless.");
  }
  if (name === "NotSupportedError") {
    return new Error("This device cannot hold a passkey Wrenchless can check.");
  }
  if (error instanceof Error && error.message.trim().length > 0) return error;
  return new Error(
    verb === "save"
      ? "This device did not save a passkey."
      : "The passkey was not accepted.",
  );
}

const clientDataSchema = z
  .object({
    type: z.string(),
    challenge: z.string(),
    origin: z.string(),
    crossOrigin: z.boolean().optional(),
  })
  .loose();

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/** ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }` to the raw r‖s WebCrypto wants. */
function derSignatureToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der[0] !== 0x30) throw new Error("The device returned an unreadable signature.");
  let offset = 2;
  if (der[1] !== undefined && der[1] > 0x80) offset = 3;
  const readInteger = (): Uint8Array => {
    if (der[offset] !== 0x02) {
      throw new Error("The device returned an unreadable signature.");
    }
    const length = der[offset + 1];
    if (length === undefined) {
      throw new Error("The device returned an unreadable signature.");
    }
    const start = offset + 2;
    offset = start + length;
    return der.subarray(start, offset);
  };
  const raw = new Uint8Array(64);
  for (const [index, part] of [readInteger(), readInteger()].entries()) {
    const trimmed = part[0] === 0 ? part.subarray(1) : part;
    if (trimmed.length > 32) {
      throw new Error("The device returned an unreadable signature.");
    }
    raw.set(trimmed, index * 32 + (32 - trimmed.length));
  }
  return raw;
}

/**
 * Enrols this device.
 *
 * The browser may use any authenticator that can verify its user. Constraining
 * this to a built-in platform authenticator excludes valid synced passkeys,
 * nearby phones and security keys. `residentKey` is preferred rather than
 * required because the credential ID is kept here anyway.
 */
export async function createDevicePasskey(
  accountLabel: string,
): Promise<DevicePasskey> {
  assertAvailable();
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: RELYING_PARTY_NAME },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: accountLabel,
        displayName: accountLabel,
      },
      pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      attestation: "none",
      timeout: TIMEOUT_MILLISECONDS,
    },
    });
  } catch (caught) {
    throw passkeyFailure(caught, "save");
  }
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("This device did not create a passkey.");
  }
  const response = credential.response;
  if (!(response instanceof AuthenticatorAttestationResponse)) {
    throw new Error("This device did not create a passkey.");
  }
  if (response.getPublicKeyAlgorithm() !== ES256) {
    throw new Error("This device offered a passkey type Wrenchless cannot check.");
  }
  const publicKey = response.getPublicKey();
  if (publicKey === null) {
    throw new Error("This device did not return a passkey public key.");
  }
  return {
    credentialId: toBase64Url(credential.rawId),
    publicKey: toBase64Url(publicKey),
  };
}

/**
 * Asks for the passkey and checks the answer.
 *
 * Everything that could make an assertion meaningless is checked here: that it
 * is an assertion rather than a registration, that it answers the challenge
 * this call generated, that the user was actually verified, and that the
 * signature is the enrolled key's over the bytes the authenticator says it
 * signed. Any of those failing is one message, because a person's next action
 * is the same in every case.
 */
export async function verifyDevicePasskey(passkey: DevicePasskey): Promise<void> {
  assertAvailable();
  const challenge = randomChallenge();
  let assertion: Credential | null;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          { type: "public-key", id: fromBase64Url(passkey.credentialId) },
        ],
        userVerification: "required",
        timeout: TIMEOUT_MILLISECONDS,
      },
    });
  } catch (caught) {
    throw passkeyFailure(caught, "use");
  }
  if (!(assertion instanceof PublicKeyCredential)) {
    throw new Error("The passkey was not accepted.");
  }
  if (toBase64Url(assertion.rawId) !== passkey.credentialId) {
    throw new Error("A different passkey answered this request.");
  }
  const response = assertion.response;
  if (!(response instanceof AuthenticatorAssertionResponse)) {
    throw new Error("The passkey was not accepted.");
  }

  // The authenticator's own account of what it was asked. It is parsed rather
  // than cast: this is the only place the challenge this call generated can be
  // tied to the signature that comes back, so a shape that does not match is a
  // failure, not a field to read optimistically.
  let decodedClientData: unknown;
  try {
    decodedClientData = JSON.parse(
      new TextDecoder().decode(response.clientDataJSON),
    );
  } catch {
    throw new Error("The passkey returned an unreadable answer.");
  }
  const clientData = clientDataSchema.safeParse(decodedClientData);
  if (
    !clientData.success ||
    clientData.data.type !== "webauthn.get" ||
    clientData.data.challenge !== toBase64Url(challenge.buffer) ||
    clientData.data.origin !== window.location.origin ||
    clientData.data.crossOrigin === true
  ) {
    throw new Error("The passkey answered a different request.");
  }

  const authenticatorData = new Uint8Array(response.authenticatorData);
  if (authenticatorData.length < 37) {
    throw new Error("The passkey returned an unreadable answer.");
  }
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(window.location.hostname),
    ),
  );
  if (!sameBytes(authenticatorData.subarray(0, 32), expectedRpIdHash)) {
    throw new Error("The passkey belongs to a different site.");
  }
  const flags = authenticatorData[32];
  // Bit 0 is user present, bit 2 is user verified. Both are required: an
  // assertion nobody touched proves the device is nearby, not that it is theirs.
  if (flags === undefined || (flags & 0x01) === 0 || (flags & 0x04) === 0) {
    throw new Error("The passkey was not confirmed on this device.");
  }

  const key = await crypto.subtle.importKey(
    "spki",
    fromBase64Url(passkey.publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", response.clientDataJSON),
  );
  const signed = new Uint8Array(authenticatorData.length + clientDataHash.length);
  signed.set(authenticatorData, 0);
  signed.set(clientDataHash, authenticatorData.length);

  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    derSignatureToRaw(new Uint8Array(response.signature)),
    signed,
  );
  if (!valid) throw new Error("The passkey was not accepted.");
}
