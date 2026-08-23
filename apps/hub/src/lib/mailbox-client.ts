import {
  HeartbeatEnvelopeSchema,
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
  sendCapability: string;
};

function envelopeEndpoint(delivery: MailboxDelivery): string {
  if (!/^[0-9a-f]{32}$/.test(delivery.mailboxId)) {
    throw new Error("mailbox ID is invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(delivery.sendCapability)) {
    throw new Error("mailbox send capability is invalid");
  }
  const base = delivery.mailboxUrl.endsWith("/")
    ? delivery.mailboxUrl
    : `${delivery.mailboxUrl}/`;
  return new URL(
    `v1/mailboxes/${delivery.mailboxId}/envelopes`,
    base,
  ).toString();
}

export async function deliverHeartbeat(
  delivery: MailboxDelivery,
  envelopeInput: HeartbeatEnvelope,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const envelope = HeartbeatEnvelopeSchema.parse(envelopeInput);
  const response = await fetcher(envelopeEndpoint(delivery), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${delivery.sendCapability}`,
      "Content-Type": "application/json",
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
