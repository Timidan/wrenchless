import {
  Aes256Gcm,
  CipherSuite,
  DhkemP256HkdfSha256,
  HkdfSha256,
} from "@hpke/core";
import { z } from "zod";

import {
  generateGuardianHeartbeatKeypair,
  HeartbeatEnvelopeSchema,
  type GuardianHeartbeatKeypair,
  type HeartbeatEnvelope,
} from "./heartbeat.js";

const HPKE_INFO = new TextEncoder().encode("WRENCHLESS_GUARDIAN_CONTROL_HPKE_V1");
const PLAINTEXT_SIZE = 512;
const HEADER_SIZE = 2;
const MAILBOX_RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const RESTORE_PAUSE_MILLISECONDS = 24 * 60 * 60 * 1_000;

const suite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

const minuteTimestampSchema = z.iso.datetime().refine(
  (value) => value.endsWith(":00.000Z"),
  "guardian control time must be rounded to one minute",
);

const guardianControlPlaintextSchema = z
  .object({
    protocolVersion: z.literal("wrenchless.guardian-control.v1"),
    messageId: z.string().regex(/^[0-9a-f]{32}$/),
    action: z.literal("PAUSE_NEW_RESTORES"),
    requestedAt: minuteTimestampSchema,
    restoresBlockedUntil: minuteTimestampSchema,
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict()
  .superRefine((message, context) => {
    if (
      Date.parse(message.restoresBlockedUntil) -
        Date.parse(message.requestedAt) !==
      RESTORE_PAUSE_MILLISECONDS
    ) {
      context.addIssue({
        code: "custom",
        message: "guardian pause must last exactly 24 hours",
        path: ["restoresBlockedUntil"],
      });
    }
  });

export type GuardianControlPlaintext = z.infer<
  typeof guardianControlPlaintextSchema
>;

export type RestorePauseState = {
  active: boolean;
  blockedUntil: string | null;
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

function randomHex(byteLength: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function minuteTimestamp(date: Date): string {
  const rounded = new Date(date);
  rounded.setUTCSeconds(0, 0);
  return rounded.toISOString();
}

function envelopeAad(
  messageId: string,
  createdAt: string,
  expiresAt: string,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    `WRENCHLESS_GUARDIAN_CONTROL_ENVELOPE_V1:${messageId}:${createdAt}:${expiresAt}`,
  );
}

function padPlaintext(
  plaintext: GuardianControlPlaintext,
): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(JSON.stringify(plaintext));
  if (encoded.length > PLAINTEXT_SIZE - HEADER_SIZE) {
    throw new Error("guardian control plaintext exceeds the fixed envelope size");
  }
  const padded = new Uint8Array(PLAINTEXT_SIZE);
  new DataView(padded.buffer).setUint16(0, encoded.length);
  padded.set(encoded, HEADER_SIZE);
  crypto.getRandomValues(padded.subarray(HEADER_SIZE + encoded.length));
  return padded;
}

function unpadPlaintext(padded: ArrayBuffer): GuardianControlPlaintext {
  if (padded.byteLength !== PLAINTEXT_SIZE) {
    throw new Error("guardian control plaintext has the wrong fixed size");
  }
  const bytes = new Uint8Array(padded);
  const payloadLength = new DataView(padded).getUint16(0);
  if (payloadLength === 0 || payloadLength > PLAINTEXT_SIZE - HEADER_SIZE) {
    throw new Error("guardian control plaintext length is invalid");
  }
  try {
    return guardianControlPlaintextSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          bytes.slice(HEADER_SIZE, HEADER_SIZE + payloadLength),
        ),
      ),
    );
  } catch {
    throw new Error("guardian control plaintext is invalid");
  }
}

/** Creates a distinct key for the guardian-to-vault control mailbox. */
export async function generateGuardianControlKeypair(): Promise<GuardianHeartbeatKeypair> {
  return generateGuardianHeartbeatKeypair();
}

export async function sealRestorePause(
  vaultControlPublicKey: string,
  guardianPrivateKey: CryptoKey,
  now = new Date(),
): Promise<HeartbeatEnvelope> {
  if (!/^04[0-9a-f]{128}$/.test(vaultControlPublicKey)) {
    throw new Error("vault control public key is not an encoded P-256 key");
  }
  const messageId = randomHex(16);
  const requestedAt = minuteTimestamp(now);
  const restoresBlockedUntil = new Date(
    Date.parse(requestedAt) + RESTORE_PAUSE_MILLISECONDS,
  ).toISOString();
  const envelopeExpiresAt = new Date(
    Date.parse(requestedAt) + MAILBOX_RETENTION_MILLISECONDS,
  ).toISOString();
  const plaintext = guardianControlPlaintextSchema.parse({
    protocolVersion: "wrenchless.guardian-control.v1",
    messageId,
    action: "PAUSE_NEW_RESTORES",
    requestedAt,
    restoresBlockedUntil,
    nonce: randomHex(16),
  });
  const recipientPublicKey = await suite.kem.deserializePublicKey(
    hexToBytes(vaultControlPublicKey),
  );
  const sealed = await suite.seal(
    {
      recipientPublicKey,
      senderKey: guardianPrivateKey,
      info: HPKE_INFO,
    },
    padPlaintext(plaintext),
    envelopeAad(messageId, requestedAt, envelopeExpiresAt),
  );
  return HeartbeatEnvelopeSchema.parse({
    protocolVersion: "wrenchless.heartbeat.v1",
    suite: "DHKEM-P256-HKDF-SHA256/HKDF-SHA256/AES-256-GCM",
    messageId,
    createdAt: requestedAt,
    expiresAt: envelopeExpiresAt,
    encapsulatedKey: bytesToHex(new Uint8Array(sealed.enc)),
    ciphertext: bytesToHex(new Uint8Array(sealed.ct)),
  });
}

export async function openGuardianControl(
  envelopeInput: HeartbeatEnvelope,
  vaultControlPrivateKey: CryptoKey,
  guardianPublicKey: string,
): Promise<GuardianControlPlaintext> {
  const envelope = HeartbeatEnvelopeSchema.parse(envelopeInput);
  if (!/^04[0-9a-f]{128}$/.test(guardianPublicKey)) {
    throw new Error("guardian public key is not an encoded P-256 key");
  }
  const authenticatedGuardian = await suite.kem.deserializePublicKey(
    hexToBytes(guardianPublicKey),
  );
  let padded: ArrayBuffer;
  try {
    padded = await suite.open(
      {
        recipientKey: vaultControlPrivateKey,
        senderPublicKey: authenticatedGuardian,
        enc: hexToBytes(envelope.encapsulatedKey),
        info: HPKE_INFO,
      },
      hexToBytes(envelope.ciphertext),
      envelopeAad(envelope.messageId, envelope.createdAt, envelope.expiresAt),
    );
  } catch {
    throw new Error("guardian control could not be decrypted");
  }
  const plaintext = unpadPlaintext(padded);
  if (
    plaintext.messageId !== envelope.messageId ||
    plaintext.requestedAt !== envelope.createdAt
  ) {
    throw new Error("guardian control plaintext does not match its envelope");
  }
  return plaintext;
}

/**
 * Computes the current local gate. A home-vault lift only dismisses commands
 * it has already seen; a later guardian command can start a fresh 24-hour pause.
 */
export function resolveRestorePause(
  messages: readonly GuardianControlPlaintext[],
  liftedAt: string | null,
  now = new Date(),
): RestorePauseState {
  const parsed = messages.map((message) =>
    guardianControlPlaintextSchema.parse(message),
  );
  const latest = parsed.sort(
    (left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt),
  )[0];
  if (latest === undefined) return { active: false, blockedUntil: null };

  const liftTime =
    liftedAt === null
      ? null
      : Date.parse(z.iso.datetime().parse(liftedAt));
  const requestedAt = Date.parse(latest.requestedAt);
  const blockedUntil = Date.parse(latest.restoresBlockedUntil);
  return {
    active:
      blockedUntil > now.getTime() &&
      (liftTime === null || liftTime < requestedAt),
    blockedUntil: latest.restoresBlockedUntil,
  };
}
