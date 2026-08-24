import {
  Aes256Gcm,
  CipherSuite,
  DhkemP256HkdfSha256,
  HkdfSha256,
} from "@hpke/core";
import { z } from "zod";

import {
  HeartbeatEnvelopeSchema,
  type HeartbeatEnvelope,
} from "./heartbeat.js";

const HPKE_INFO = new TextEncoder().encode(
  "WRENCHLESS_CARRIED_PAIRING_HPKE_V1",
);
const PLAINTEXT_SIZE = 512;
const HEADER_SIZE = 2;
const FRAGMENT_SIZE = 180;
const RETENTION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

const suite = new CipherSuite({
  kem: new DhkemP256HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});

const minuteTimestampSchema = z.iso.datetime().refine(
  (value) => value.endsWith(":00.000Z"),
  "carried pairing time must be rounded to one minute",
);

const receiptTokenSchema = z
  .string()
  .min(6)
  .max(4_000)
  .regex(/^wrr2_[A-Za-z0-9_-]+$/);

const carriedReceiptChunkSchema = z
  .object({
    protocolVersion: z.literal("wrenchless.carried-pairing.v1"),
    messageId: z.string().regex(/^[0-9a-f]{32}$/),
    action: z.literal("RETURN_CARRIED_RECEIPT"),
    responseId: z.string().regex(/^[0-9a-f]{32}$/),
    part: z.number().int().min(0).max(31),
    parts: z.number().int().min(1).max(32),
    fragment: z.string().min(1).max(FRAGMENT_SIZE),
    createdAt: minuteTimestampSchema,
    nonce: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict()
  .refine((chunk) => chunk.part < chunk.parts, "carried pairing part is invalid");

type CarriedReceiptChunk = z.infer<typeof carriedReceiptChunkSchema>;

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
    `WRENCHLESS_CARRIED_PAIRING_ENVELOPE_V1:${messageId}:${createdAt}:${expiresAt}`,
  );
}

function padPlaintext(chunk: CarriedReceiptChunk): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(JSON.stringify(chunk));
  if (encoded.length > PLAINTEXT_SIZE - HEADER_SIZE) {
    throw new Error("carried pairing chunk exceeds the fixed envelope size");
  }
  const padded = new Uint8Array(PLAINTEXT_SIZE);
  new DataView(padded.buffer).setUint16(0, encoded.length);
  padded.set(encoded, HEADER_SIZE);
  crypto.getRandomValues(padded.subarray(HEADER_SIZE + encoded.length));
  return padded;
}

function unpadPlaintext(padded: ArrayBuffer): CarriedReceiptChunk {
  if (padded.byteLength !== PLAINTEXT_SIZE) {
    throw new Error("carried pairing plaintext has the wrong fixed size");
  }
  const bytes = new Uint8Array(padded);
  const payloadLength = new DataView(padded).getUint16(0);
  if (payloadLength === 0 || payloadLength > PLAINTEXT_SIZE - HEADER_SIZE) {
    throw new Error("carried pairing plaintext length is invalid");
  }
  try {
    return carriedReceiptChunkSchema.parse(
      JSON.parse(
        new TextDecoder().decode(
          bytes.slice(HEADER_SIZE, HEADER_SIZE + payloadLength),
        ),
      ),
    );
  } catch {
    throw new Error("carried pairing plaintext is invalid");
  }
}

async function sealChunk(
  chunk: CarriedReceiptChunk,
  vaultPublicKey: string,
  carriedPrivateKey: CryptoKey,
  expiresAt: string,
): Promise<HeartbeatEnvelope> {
  if (!/^04[0-9a-f]{128}$/.test(vaultPublicKey)) {
    throw new Error("vault pairing public key is not an encoded P-256 key");
  }
  const recipientPublicKey = await suite.kem.deserializePublicKey(
    hexToBytes(vaultPublicKey),
  );
  const sealed = await suite.seal(
    {
      recipientPublicKey,
      senderKey: carriedPrivateKey,
      info: HPKE_INFO,
    },
    padPlaintext(chunk),
    envelopeAad(chunk.messageId, chunk.createdAt, expiresAt),
  );
  return HeartbeatEnvelopeSchema.parse({
    protocolVersion: "wrenchless.heartbeat.v1",
    suite: "DHKEM-P256-HKDF-SHA256/HKDF-SHA256/AES-256-GCM",
    messageId: chunk.messageId,
    createdAt: chunk.createdAt,
    expiresAt,
    encapsulatedKey: bytesToHex(new Uint8Array(sealed.enc)),
    ciphertext: bytesToHex(new Uint8Array(sealed.ct)),
  });
}

export async function sealCarriedPairingReceipt(
  receiptToken: string,
  responseId: string,
  vaultPublicKey: string,
  carriedPrivateKey: CryptoKey,
  now = new Date(),
): Promise<HeartbeatEnvelope[]> {
  const receipt = receiptTokenSchema.parse(receiptToken);
  const parsedResponseId = z.string().regex(/^[0-9a-f]{32}$/).parse(responseId);
  const fragments = receipt.match(new RegExp(`.{1,${String(FRAGMENT_SIZE)}}`, "g"));
  if (fragments === null || fragments.length > 32) {
    throw new Error("carried pairing receipt is too large");
  }
  const createdAt = minuteTimestamp(now);
  const expiresAt = new Date(
    Date.parse(createdAt) + RETENTION_MILLISECONDS,
  ).toISOString();
  return Promise.all(
    fragments.map((fragment, part) => {
      const chunk = carriedReceiptChunkSchema.parse({
        protocolVersion: "wrenchless.carried-pairing.v1",
        messageId: randomHex(16),
        action: "RETURN_CARRIED_RECEIPT",
        responseId: parsedResponseId,
        part,
        parts: fragments.length,
        fragment,
        createdAt,
        nonce: randomHex(16),
      });
      return sealChunk(chunk, vaultPublicKey, carriedPrivateKey, expiresAt);
    }),
  );
}

async function openChunk(
  envelopeInput: HeartbeatEnvelope,
  vaultPrivateKey: CryptoKey,
  carriedPublicKey: string,
): Promise<CarriedReceiptChunk> {
  const envelope = HeartbeatEnvelopeSchema.parse(envelopeInput);
  if (!/^04[0-9a-f]{128}$/.test(carriedPublicKey)) {
    throw new Error("carried pairing public key is not an encoded P-256 key");
  }
  const authenticatedCarried = await suite.kem.deserializePublicKey(
    hexToBytes(carriedPublicKey),
  );
  let padded: ArrayBuffer;
  try {
    padded = await suite.open(
      {
        recipientKey: vaultPrivateKey,
        senderPublicKey: authenticatedCarried,
        enc: hexToBytes(envelope.encapsulatedKey),
        info: HPKE_INFO,
      },
      hexToBytes(envelope.ciphertext),
      envelopeAad(envelope.messageId, envelope.createdAt, envelope.expiresAt),
    );
  } catch {
    throw new Error("carried pairing receipt could not be decrypted");
  }
  const chunk = unpadPlaintext(padded);
  if (
    chunk.messageId !== envelope.messageId ||
    chunk.createdAt !== envelope.createdAt
  ) {
    throw new Error("carried pairing chunk does not match its envelope");
  }
  return chunk;
}

export async function openCarriedPairingReceipt(
  envelopes: readonly HeartbeatEnvelope[],
  responseId: string,
  vaultPrivateKey: CryptoKey,
  carriedPublicKey: string,
): Promise<string | null> {
  const parsedResponseId = z.string().regex(/^[0-9a-f]{32}$/).parse(responseId);
  const chunks = await Promise.all(
    envelopes.map((envelope) =>
      openChunk(envelope, vaultPrivateKey, carriedPublicKey),
    ),
  );
  const matching = chunks.filter((chunk) => chunk.responseId === parsedResponseId);
  if (matching.length === 0) return null;

  const parts = matching[0]?.parts;
  if (parts === undefined || matching.some((chunk) => chunk.parts !== parts)) {
    throw new Error("carried pairing chunks disagree on their total");
  }
  const fragments = new Map<number, string>();
  for (const chunk of matching) {
    const existing = fragments.get(chunk.part);
    if (existing !== undefined && existing !== chunk.fragment) {
      throw new Error("carried pairing contains conflicting chunks");
    }
    fragments.set(chunk.part, chunk.fragment);
  }
  if (fragments.size !== parts) return null;

  const receipt = Array.from({ length: parts }, (_, part) => fragments.get(part))
    .join("");
  return receiptTokenSchema.parse(receipt);
}
