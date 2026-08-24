import {
  HeartbeatEnvelopeSchema,
  openHeartbeat,
  type HeartbeatPlaintext,
} from "@wrenchless/canary-core";
import { z } from "zod";

const mailboxEnrollmentSchema = z
  .object({
    mailboxId: z.string().regex(/^[0-9a-f]{32}$/),
    bindCapability: z.string().regex(/^[0-9a-f]{64}$/),
    receiveCapability: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const mailboxContentsSchema = z
  .object({
    envelopes: z.array(HeartbeatEnvelopeSchema).max(100),
    senderEncryptionPublicKey: z.string().regex(/^04[0-9a-f]{128}$/),
  })
  .strict();

export type GuardianMailboxEnrollment = z.infer<
  typeof mailboxEnrollmentSchema
>;

function mailboxBase(mailboxUrl: string): string {
  const base = mailboxUrl.endsWith("/") ? mailboxUrl : `${mailboxUrl}/`;
  return new URL(base).toString();
}

async function checkedJson<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T> {
  if (!response.ok) {
    throw new Error(`mailbox request failed with HTTP ${response.status}`);
  }
  return schema.parse(await response.json());
}

export async function enrollGuardianMailbox(
  mailboxUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<GuardianMailboxEnrollment> {
  const response = await fetcher(new URL("v1/mailboxes", mailboxBase(mailboxUrl)), {
    method: "POST",
  });
  return checkedJson(response, mailboxEnrollmentSchema);
}

export async function retrieveGuardianHeartbeats(input: {
  mailboxUrl: string;
  mailboxId: string;
  receiveCapability: string;
  guardianPrivateKey: CryptoKey;
  fetcher?: typeof fetch;
}): Promise<{
  events: HeartbeatPlaintext[];
  carriedSenderPublicKey: string | null;
}> {
  const enrollment = mailboxEnrollmentSchema.pick({
    mailboxId: true,
    receiveCapability: true,
  }).parse({
    mailboxId: input.mailboxId,
    receiveCapability: input.receiveCapability,
  });
  const response = await (input.fetcher ?? fetch)(
    new URL(
      `v1/mailboxes/${enrollment.mailboxId}/envelopes`,
      mailboxBase(input.mailboxUrl),
    ),
    {
      method: "GET",
      headers: { Authorization: `Bearer ${enrollment.receiveCapability}` },
    },
  );
  const contents = await checkedJson(response, mailboxContentsSchema);
  const opened: HeartbeatPlaintext[] = [];
  for (const envelope of contents.envelopes) {
    try {
      opened.push(
        await openHeartbeat(
          envelope,
          input.guardianPrivateKey,
          contents.senderEncryptionPublicKey,
        ),
      );
    } catch {
      // Only messages authenticated by the bound carried key are accepted.
    }
  }
  return {
    events: opened,
    carriedSenderPublicKey: contents.senderEncryptionPublicKey,
  };
}
