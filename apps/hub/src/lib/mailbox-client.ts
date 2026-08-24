import {
  HeartbeatEnvelopeSchema,
  heartbeatEnvelopeSigningBytes,
  type HeartbeatEnvelope,
} from "@wrenchless/canary-core";
import { z } from "zod";

const mailboxReceiptSchema = z
  .object({
    messageId: z.string().regex(/^[0-9a-f]{32}$/),
    status: z.literal("stored"),
  })
  .strict();

export type MailboxDelivery = {
  mailboxUrl: string;
  mailboxId: string;
  senderSigningPrivateKey: CryptoKey;
};

export type MailboxDestination = Omit<MailboxDelivery, "senderSigningPrivateKey">;

function envelopeEndpoint(delivery: MailboxDelivery): string {
  if (!/^[0-9a-f]{32}$/.test(delivery.mailboxId)) {
    throw new Error("mailbox ID is invalid");
  }
  const base = delivery.mailboxUrl.endsWith("/")
    ? delivery.mailboxUrl
    : `${delivery.mailboxUrl}/`;
  return new URL(
    `v1/mailboxes/${delivery.mailboxId}/envelopes`,
    base,
  ).toString();
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function bindMailboxSender(input: {
  mailboxUrl: string;
  mailboxId: string;
  bindCapability: string;
  senderSigningPublicKey: string;
  senderEncryptionPublicKey: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  if (!/^[0-9a-f]{32}$/.test(input.mailboxId)) {
    throw new Error("mailbox ID is invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(input.bindCapability)) {
    throw new Error("mailbox binding is invalid");
  }
  if (
    !/^04[0-9a-f]{128}$/.test(input.senderSigningPublicKey) ||
    !/^04[0-9a-f]{128}$/.test(input.senderEncryptionPublicKey)
  ) {
    throw new Error("mailbox sender keys are invalid");
  }
  const base = input.mailboxUrl.endsWith("/")
    ? input.mailboxUrl
    : `${input.mailboxUrl}/`;
  const response = await (input.fetcher ?? fetch)(
    new URL(`v1/mailboxes/${input.mailboxId}/sender`, base),
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${input.bindCapability}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderSigningPublicKey: input.senderSigningPublicKey,
        senderEncryptionPublicKey: input.senderEncryptionPublicKey,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`mailbox sender binding returned HTTP ${response.status}`);
  }
}

export async function deliverHeartbeat(
  delivery: MailboxDelivery,
  envelopeInput: HeartbeatEnvelope,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const envelope = HeartbeatEnvelopeSchema.parse(envelopeInput);
  const signature = bytesToHex(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      delivery.senderSigningPrivateKey,
      heartbeatEnvelopeSigningBytes(envelope),
    ),
  );
  if (!/^[0-9a-f]{128}$/.test(signature)) {
    throw new Error("mailbox sender produced an invalid signature");
  }
  const response = await fetcher(envelopeEndpoint(delivery), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Wrenchless-Signature": signature,
    },
    body: JSON.stringify(envelope),
  });
  const receipt = mailboxReceiptSchema.parse(await response.json());
  if (!response.ok) {
    throw new Error(`mailbox rejected the heartbeat with HTTP ${response.status}`);
  }
  if (receipt.messageId !== envelope.messageId) {
    throw new Error("mailbox returned an unexpected delivery receipt");
  }
}
