import {
  HeartbeatEnvelopeSchema,
  type HeartbeatEnvelope,
} from "@wrenchless/canary-core";

import { readCarriedAuthKey } from "./carried-auth-key.js";
import {
  deliverHeartbeat,
  type MailboxDestination,
} from "./mailbox-client.js";

const OUTBOX_KEY = "wrenchless-heartbeat-outbox-v1";
const MAX_QUEUED_ENVELOPES = 256;

function readOutbox(storage: Storage, now = Date.now()): HeartbeatEnvelope[] {
  const stored = storage.getItem(OUTBOX_KEY);
  if (stored === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new Error("heartbeat outbox is corrupted");
  }
  if (!Array.isArray(parsed)) throw new Error("heartbeat outbox is invalid");
  return parsed
    .map((value) => HeartbeatEnvelopeSchema.parse(value))
    .filter((envelope) => Date.parse(envelope.expiresAt) > now);
}

function writeOutbox(storage: Storage, envelopes: HeartbeatEnvelope[]): void {
  if (envelopes.length === 0) {
    storage.removeItem(OUTBOX_KEY);
    return;
  }
  storage.setItem(OUTBOX_KEY, JSON.stringify(envelopes));
}

export function queueHeartbeat(
  envelopeInput: HeartbeatEnvelope,
  storage: Storage = localStorage,
): void {
  const envelope = HeartbeatEnvelopeSchema.parse(envelopeInput);
  const outbox = readOutbox(storage);
  if (outbox.some((queued) => queued.messageId === envelope.messageId)) return;
  if (outbox.length >= MAX_QUEUED_ENVELOPES) {
    throw new Error("heartbeat outbox is full");
  }
  writeOutbox(storage, [...outbox, envelope]);
}

export function readHeartbeatOutboxStatus(
  storage: Storage = localStorage,
) {
  return { queued: readOutbox(storage).length };
}

export async function flushHeartbeatOutbox(
  destination: MailboxDestination,
  options: { storage?: Storage; fetcher?: typeof fetch } = {},
): Promise<{ delivered: number; remaining: number }> {
  const storage = options.storage ?? localStorage;
  const fetcher = options.fetcher ?? fetch;
  const outbox = readOutbox(storage);
  const sender = await readCarriedAuthKey();
  if (sender === null) {
    throw new Error("This wallet must be paired again before it can sync");
  }
  const delivery = {
    ...destination,
    senderSigningPrivateKey: sender.signingPrivateKey,
  };
  const remaining: HeartbeatEnvelope[] = [];
  let delivered = 0;
  for (const envelope of outbox) {
    try {
      await deliverHeartbeat(delivery, envelope, fetcher);
      delivered += 1;
    } catch {
      remaining.push(envelope);
    }
  }
  writeOutbox(storage, remaining);
  return { delivered, remaining: remaining.length };
}
