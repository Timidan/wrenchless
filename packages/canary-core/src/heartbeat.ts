import {
  Aes256Gcm,
  CipherSuite,
  DhkemP256HkdfSha256,
  HkdfSha256,
} from "@hpke/core";
import { z } from "zod";

const HPKE_INFO = new TextEncoder().encode("WRENCHLESS_HEARTBEAT_HPKE_V1");
const PLAINTEXT_SIZE = 512;
const HEADER_SIZE = 2;
const RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

const suite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

const coarseTimestampSchema = z
  .iso
  .datetime()
  .refine(
    (value) => value.endsWith(":00.000Z"),
    "heartbeat time must be rounded to one minute",
  );

const heartbeatPlaintextSchema = z
  .object({
    protocolVersion: z.literal("wrenchless.heartbeat.v1"),
    messageId: z.string().regex(/^[0-9a-f]{32}$/),
    signal: z.enum(["OK", "DISTRESS"]),
    coverAlias: z.string().trim().min(1).max(48),
    paymentOutcome: z.enum([
      "submitted",
      "confirmed",
      "rejected",
      "failed",
    ]),
    createdAt: coarseTimestampSchema,
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
    responseInstruction: z.string().trim().min(1).max(160).nullable(),
  })
  .strict();

export const HeartbeatEnvelopeSchema = z
  .object({
    protocolVersion: z.literal("wrenchless.heartbeat.v1"),
    suite: z.literal("DHKEM-P256-HKDF-SHA256/HKDF-SHA256/AES-256-GCM"),
    messageId: z.string().regex(/^[0-9a-f]{32}$/),
    createdAt: coarseTimestampSchema,
    expiresAt: z.iso.datetime(),
    encapsulatedKey: z.string().regex(/^[0-9a-f]{130}$/),
    ciphertext: z.string().regex(/^[0-9a-f]{1056}$/),
  })
  .strict()
  .superRefine((envelope, context) => {
    if (Date.parse(envelope.expiresAt) <= Date.parse(envelope.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "heartbeat expiry must follow creation",
        path: ["expiresAt"],
      });
    }
  });

export type HeartbeatSignal = "OK" | "DISTRESS";
export type HeartbeatPaymentOutcome =
  | "submitted"
  | "confirmed"
  | "rejected"
  | "failed";

export type SealHeartbeatInput = {
  signal: HeartbeatSignal;
  coverAlias: string;
  paymentOutcome: HeartbeatPaymentOutcome;
  responseInstruction?: string;
};

export type HeartbeatEnvelope = z.infer<typeof HeartbeatEnvelopeSchema>;
export type HeartbeatPlaintext = z.infer<typeof heartbeatPlaintextSchema>;

export type GuardianHeartbeatKeypair = {
  keyPair: CryptoKeyPair;
  publicKey: string;
  fingerprint: string;
};

export type MailboxSigningKeypair = {
  privateKey: CryptoKey;
  publicKey: string;
};

export function heartbeatEnvelopeSigningBytes(
  envelopeInput: HeartbeatEnvelope,
): Uint8Array<ArrayBuffer> {
  const envelope = HeartbeatEnvelopeSchema.parse(envelopeInput);
  return new TextEncoder().encode(
    `WRENCHLESS_MAILBOX_DELIVERY_V1:${JSON.stringify(envelope)}`,
  );
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
    `WRENCHLESS_HEARTBEAT_ENVELOPE_V1:${messageId}:${createdAt}:${expiresAt}`,
  );
}

function padPlaintext(plaintext: HeartbeatPlaintext): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(JSON.stringify(plaintext));
  if (encoded.length > PLAINTEXT_SIZE - HEADER_SIZE) {
    throw new Error("heartbeat plaintext exceeds the fixed envelope size");
  }

  const padded = new Uint8Array(PLAINTEXT_SIZE);
  new DataView(padded.buffer).setUint16(0, encoded.length);
  padded.set(encoded, HEADER_SIZE);
  crypto.getRandomValues(padded.subarray(HEADER_SIZE + encoded.length));
  return padded;
}

function unpadPlaintext(padded: ArrayBuffer): HeartbeatPlaintext {
  if (padded.byteLength !== PLAINTEXT_SIZE) {
    throw new Error("heartbeat plaintext has the wrong fixed size");
  }
  const bytes = new Uint8Array(padded);
  const payloadLength = new DataView(padded).getUint16(0);
  if (payloadLength === 0 || payloadLength > PLAINTEXT_SIZE - HEADER_SIZE) {
    throw new Error("heartbeat plaintext length is invalid");
  }
  try {
    return heartbeatPlaintextSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          bytes.slice(HEADER_SIZE, HEADER_SIZE + payloadLength),
        ),
      ),
    );
  } catch {
    throw new Error("heartbeat plaintext is invalid");
  }
}

export async function generateGuardianHeartbeatKeypair(): Promise<GuardianHeartbeatKeypair> {
  const keyPair = await suite.kem.generateKeyPair();
  const publicKeyBytes = new Uint8Array(
    await suite.kem.serializePublicKey(keyPair.publicKey),
  );
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", publicKeyBytes),
  );
  const fingerprintHex = bytesToHex(digest.slice(0, 10));
  return {
    keyPair,
    publicKey: bytesToHex(publicKeyBytes),
    fingerprint: fingerprintHex.match(/.{4}/g)?.join("-") ?? fingerprintHex,
  };
}

/**
 * Makes the separate key used to authenticate mailbox delivery.
 *
 * HPKE keys are ECDH keys and WebCrypto will not use one for ECDSA. The
 * generated private material is therefore re-imported as non-extractable
 * before it is returned or stored; only the public point leaves this function.
 */
export async function generateMailboxSigningKeypair(): Promise<MailboxSigningKeypair> {
  const generated = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const [publicBytes, privateJwk] = await Promise.all([
    crypto.subtle.exportKey("raw", generated.publicKey),
    crypto.subtle.exportKey("jwk", generated.privateKey),
  ]);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return {
    privateKey,
    publicKey: bytesToHex(new Uint8Array(publicBytes)),
  };
}

export async function sealHeartbeat(
  input: SealHeartbeatInput,
  guardianPublicKey: string,
  senderPrivateKey: CryptoKey,
  now = new Date(),
): Promise<HeartbeatEnvelope> {
  if (!/^04[0-9a-f]{128}$/.test(guardianPublicKey)) {
    throw new Error("guardian public key is not an encoded P-256 key");
  }
  const messageId = randomHex(16);
  const createdAt = minuteTimestamp(now);
  const expiresAt = new Date(
    Date.parse(createdAt) + RETENTION_MILLISECONDS,
  ).toISOString();
  const plaintext = heartbeatPlaintextSchema.parse({
    protocolVersion: "wrenchless.heartbeat.v1",
    messageId,
    signal: input.signal,
    coverAlias: input.coverAlias,
    paymentOutcome: input.paymentOutcome,
    createdAt,
    nonce: randomHex(16),
    responseInstruction: input.responseInstruction ?? null,
  });

  const recipientPublicKey = await suite.kem.deserializePublicKey(
    hexToBytes(guardianPublicKey),
  );
  const sealed = await suite.seal(
    { recipientPublicKey, senderKey: senderPrivateKey, info: HPKE_INFO },
    padPlaintext(plaintext),
    envelopeAad(messageId, createdAt, expiresAt),
  );
  return HeartbeatEnvelopeSchema.parse({
    protocolVersion: "wrenchless.heartbeat.v1",
    suite: "DHKEM-P256-HKDF-SHA256/HKDF-SHA256/AES-256-GCM",
    messageId,
    createdAt,
    expiresAt,
    encapsulatedKey: bytesToHex(new Uint8Array(sealed.enc)),
    ciphertext: bytesToHex(new Uint8Array(sealed.ct)),
  });
}

export async function openHeartbeat(
  envelopeInput: HeartbeatEnvelope,
  guardianPrivateKey: CryptoKey,
  senderPublicKey: string,
): Promise<HeartbeatPlaintext> {
  const envelope = HeartbeatEnvelopeSchema.parse(envelopeInput);
  if (!/^04[0-9a-f]{128}$/.test(senderPublicKey)) {
    throw new Error("heartbeat sender public key is not an encoded P-256 key");
  }
  const authenticatedSender = await suite.kem.deserializePublicKey(
    hexToBytes(senderPublicKey),
  );
  let padded: ArrayBuffer;
  try {
    padded = await suite.open(
      {
        recipientKey: guardianPrivateKey,
        senderPublicKey: authenticatedSender,
        enc: hexToBytes(envelope.encapsulatedKey),
        info: HPKE_INFO,
      },
      hexToBytes(envelope.ciphertext),
      envelopeAad(envelope.messageId, envelope.createdAt, envelope.expiresAt),
    );
  } catch {
    throw new Error("heartbeat could not be decrypted");
  }

  const plaintext = unpadPlaintext(padded);
  if (
    plaintext.messageId !== envelope.messageId ||
    plaintext.createdAt !== envelope.createdAt
  ) {
    throw new Error("heartbeat plaintext does not match its envelope");
  }
  return plaintext;
}
