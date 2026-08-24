import {
  sealHeartbeat,
  type HeartbeatEnvelope,
  type HeartbeatPaymentOutcome,
  type HeartbeatSignal,
  type SealHeartbeatInput,
} from "@wrenchless/canary-core";
import { z } from "zod";

import { queueHeartbeat } from "./heartbeat-outbox.js";
import { readCarriedAuthKey } from "./carried-auth-key.js";
import {
  deliverHeartbeat,
  type MailboxDestination,
} from "./mailbox-client.js";
import {
  submitReadyCoverPayment,
  type ReadyCoverWallet,
} from "./ready-cover.js";

export type CoverPaymentResult = {
  paymentOutcome: HeartbeatPaymentOutcome;
  transactionHash?: string;
  heartbeat: HeartbeatEnvelope;
  heartbeatDelivery: "stored" | "queued" | "failed";
};

const walletFailureSchema = z
  .object({
    code: z.union([z.literal(4001), z.literal("USER_REFUSED_OP")]).optional(),
    message: z.string().optional(),
  })
  .passthrough();

function assertHeartbeatSetup(input: {
  guardianPublicKey: string;
  coverAlias: string;
  mailbox: MailboxDestination;
}): void {
  if (!/^04[0-9a-f]{128}$/.test(input.guardianPublicKey)) {
    throw new Error("guardian public key is invalid");
  }
  if (input.coverAlias.trim().length === 0 || input.coverAlias.trim().length > 48) {
    throw new Error("cover alias must contain 1 to 48 characters");
  }
  if (!/^[0-9a-f]{32}$/.test(input.mailbox.mailboxId)) {
    throw new Error("mailbox ID is invalid");
  }
  new URL(input.mailbox.mailboxUrl);
}

export async function attemptCoverPayment(input: {
  wallet: ReadyCoverWallet;
  tokenAddress: string;
  recipient: string;
  amountFri: string;
  sessionSignal: HeartbeatSignal;
  coverAlias: string;
  guardianPublicKey: string;
  mailbox: MailboxDestination;
  responseInstruction?: string;
  fetcher?: typeof fetch;
  storage?: Storage;
}): Promise<CoverPaymentResult> {
  assertHeartbeatSetup(input);
  const sender = await readCarriedAuthKey();
  if (sender === null) {
    throw new Error("This wallet must be paired again before it can send");
  }
  let paymentOutcome: HeartbeatPaymentOutcome;
  let submittedHash: string | undefined;
  try {
    const submitted = await submitReadyCoverPayment({
      wallet: input.wallet,
      tokenAddress: input.tokenAddress,
      recipient: input.recipient,
      amountFri: input.amountFri,
    });
    submittedHash = submitted.transactionHash;
    paymentOutcome = "submitted";
  } catch (error) {
    const walletFailure = walletFailureSchema.safeParse(error);
    paymentOutcome =
      walletFailure.success &&
      (walletFailure.data.code !== undefined ||
        /refus|reject|cancel/i.test(walletFailure.data.message ?? ""))
        ? "rejected"
        : "failed";
  }

  const heartbeatInput: SealHeartbeatInput = {
    signal: input.sessionSignal,
    coverAlias: input.coverAlias,
    paymentOutcome,
  };
  if (input.responseInstruction !== undefined) {
    heartbeatInput.responseInstruction = input.responseInstruction;
  }
  const heartbeat = await sealHeartbeat(
    heartbeatInput,
    input.guardianPublicKey,
    sender.privateKey,
  );

  let heartbeatDelivery: CoverPaymentResult["heartbeatDelivery"] = "stored";
  try {
    await deliverHeartbeat(
      {
        ...input.mailbox,
        senderSigningPrivateKey: sender.signingPrivateKey,
      },
      heartbeat,
      input.fetcher ?? fetch,
    );
  } catch {
    try {
      queueHeartbeat(heartbeat, input.storage ?? localStorage);
      heartbeatDelivery = "queued";
    } catch {
      heartbeatDelivery = "failed";
    }
  }

  const result: CoverPaymentResult = {
    paymentOutcome,
    heartbeat,
    heartbeatDelivery,
  };
  if (submittedHash !== undefined) result.transactionHash = submittedHash;
  return result;
}
