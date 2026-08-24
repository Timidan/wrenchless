import {
  HeartbeatEnvelopeSchema,
  openCarriedPairingReceipt,
  sealCarriedPairingReceipt,
} from "@wrenchless/canary-core";
import { z } from "zod";

import type { StoredCarriedAuthKey } from "./carried-auth-key.js";
import { bindMailboxSender, deliverHeartbeat } from "./mailbox-client.js";

const mailboxContentsSchema = z
  .object({
    envelopes: z.array(HeartbeatEnvelopeSchema).max(100),
    senderEncryptionPublicKey: z
      .string()
      .regex(/^04[0-9a-f]{128}$/)
      .nullable(),
  })
  .strict();

function mailboxBase(mailboxUrl: string): string {
  return new URL(
    mailboxUrl.endsWith("/") ? mailboxUrl : `${mailboxUrl}/`,
  ).toString();
}

export async function sendCarriedPairingReceipt(input: {
  mailboxUrl: string;
  mailboxId: string;
  bindCapability: string;
  vaultPublicKey: string;
  receiptToken: string;
  sender: StoredCarriedAuthKey;
  fetcher?: typeof fetch;
}): Promise<void> {
  const fetcher = input.fetcher ?? fetch;
  await bindMailboxSender({
    mailboxUrl: input.mailboxUrl,
    mailboxId: input.mailboxId,
    bindCapability: input.bindCapability,
    senderSigningPublicKey: input.sender.signingPublicKey,
    senderEncryptionPublicKey: input.sender.publicKey,
    fetcher,
  });
  const envelopes = await sealCarriedPairingReceipt(
    input.receiptToken,
    input.mailboxId,
    input.vaultPublicKey,
    input.sender.privateKey,
  );
  for (const envelope of envelopes) {
    await deliverHeartbeat(
      {
        mailboxUrl: input.mailboxUrl,
        mailboxId: input.mailboxId,
        senderSigningPrivateKey: input.sender.signingPrivateKey,
      },
      envelope,
      fetcher,
    );
  }
}

export async function retrieveCarriedPairingReceipt(input: {
  mailboxUrl: string;
  mailboxId: string;
  receiveCapability: string;
  vaultPrivateKey: CryptoKey;
  fetcher?: typeof fetch;
}): Promise<{
  receiptToken: string;
  carriedPublicKey: string;
} | null> {
  const response = await (input.fetcher ?? fetch)(
    new URL(
      `v1/mailboxes/${input.mailboxId}/envelopes`,
      mailboxBase(input.mailboxUrl),
    ),
    {
      method: "GET",
      headers: { Authorization: `Bearer ${input.receiveCapability}` },
    },
  );
  if (!response.ok) {
    throw new Error(`The pairing inbox returned HTTP ${response.status}`);
  }
  const contents = mailboxContentsSchema.parse(await response.json());
  if (contents.senderEncryptionPublicKey === null) return null;
  const receiptToken = await openCarriedPairingReceipt(
    contents.envelopes,
    input.mailboxId,
    input.vaultPrivateKey,
    contents.senderEncryptionPublicKey,
  );
  if (receiptToken === null) return null;
  return {
    receiptToken,
    carriedPublicKey: contents.senderEncryptionPublicKey,
  };
}
