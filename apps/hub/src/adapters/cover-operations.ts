import type { CoverSessionController } from "../lib/cover-session";
import {
  flushHeartbeatOutbox,
  readHeartbeatOutboxStatus,
} from "../lib/heartbeat-outbox";
import type { MailboxDestination } from "../lib/mailbox-client";
import { WRENCHLESS_MAINNET } from "../lib/product-config";
import {
  inspectReadyCoverAccount,
  moveReadyAllowanceToCover,
  quoteReadyAllowance,
  readReadyPoolFee,
  readReadyShieldedBalance,
  type ReadyAllowanceQuote,
  type ReadyCoverWallet,
} from "../lib/ready-cover";
import type { ReadyRefillWallet } from "../lib/ready-refill";
import { claimStoredCoverRefill } from "../lib/refill-operations";

import { coverEnrollment, type HubSettings } from "./settings";

/**
 * The wall between the wallet surface and the words it must not contain.
 *
 * Everything the everyday screens need from the protocol passes through here
 * and comes out named for what the person sees: a payment, an outcome, a sync.
 * The screens import this module, never the modules underneath it, so no
 * component file in `surfaces/cover` carries the product's covert vocabulary in
 * an import, a type name, or a comment — and that is checkable by reading one
 * directory.
 *
 * The other half of the wall is stronger than naming. The session controller in
 * `src/lib/cover-session.ts` holds the classification a valid code selects and
 * hands it to the sealing module itself. It is never a parameter here, never a
 * return value, and never reachable from a component. Both paths run this same
 * function with the same calls in the same order, so there is no rendering
 * difference to design away.
 */

/**
 * The other half of the wall: the words that must not come back through it.
 *
 * The modules underneath are written for people who are allowed to read them —
 * the reserve screen quotes the fee by its protocol name before anything is
 * signed. Their error messages carry that same vocabulary, and an error is
 * rendered on whatever screen asked for the operation. On the carried wallet
 * that would put the covert half of the product into a sentence a coercer is
 * reading over someone's shoulder.
 *
 * So everything crossing this wall is screened. A message with none of these
 * words in it is shown exactly as written, because it was written for a person
 * and matching on its text would break the day the wording improves. A message
 * with one of them is replaced whole rather than edited: a redacted sentence is
 * still a sentence about the thing it redacted.
 */
const WALLET_UNSAFE = [
  "vault",
  "guardian",
  "distress",
  "duress",
  "cover",
  "heartbeat",
  "refill",
  "shield",
  "pool",
  "nullifier",
  "note",
  "proof",
  "relay",
  "ticket",
  "claim",
  "pause",
  "allowance",
  "sponsor",
  "mailbox",
  "envelope",
  "private",
] as const;

export function walletSafeReason<T>(error: T): string {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message.trim()
      : "";
  if (message.length === 0) return "That did not go through. Try again.";
  const lowered = message.toLowerCase();
  if (WALLET_UNSAFE.some((word) => lowered.includes(word))) {
    return "That did not go through. Try again in a moment.";
  }
  return message;
}

export type PaymentOutcome = "submitted" | "confirmed" | "rejected" | "failed";

export type PaymentReport = {
  outcome: PaymentOutcome;
  transactionHash: string | null;
  /** Whether the routine post-payment sync completed, queued, or could not run. */
  sync: "stored" | "queued" | "failed";
};

export type SyncReport = { delivered: number; remaining: number };

function requireEnrollment(settings: HubSettings) {
  const enrollment = coverEnrollment(settings);
  if (enrollment === null) {
    throw new Error("This wallet has not finished being set up.");
  }
  return enrollment;
}

function deliveryFrom(settings: HubSettings): MailboxDestination {
  const enrollment = requireEnrollment(settings);
  return {
    mailboxUrl: enrollment.mailboxUrl,
    mailboxId: enrollment.mailboxId,
  };
}

export async function payFromWallet(input: {
  session: CoverSessionController;
  wallet: ReadyCoverWallet;
  tokenAddress: string;
  recipient: string;
  amountFri: string;
  settings: HubSettings;
}): Promise<PaymentReport> {
  const enrollment = requireEnrollment(input.settings);
  const payment = {
    wallet: input.wallet,
    tokenAddress: input.tokenAddress,
    recipient: input.recipient,
    amountFri: input.amountFri,
    coverAlias: enrollment.coverAlias,
    guardianPublicKey: enrollment.guardianPublicKey,
    mailbox: deliveryFrom(input.settings),
  };
  const result =
    enrollment.responseInstruction === null
      ? await input.session.attemptPayment(payment)
      : await input.session.attemptPayment({
          ...payment,
          responseInstruction: enrollment.responseInstruction,
        });
  return {
    outcome: result.paymentOutcome,
    transactionHash: result.transactionHash ?? null,
    sync: result.heartbeatDelivery,
  };
}

/**
 * The routine sync. It runs the same way and reports the same two numbers
 * whatever the session is, and there is no per-item retry control: a retry
 * button is a place where two paths could start to differ.
 */
export async function syncPendingMessages(
  settings: HubSettings,
): Promise<SyncReport> {
  return flushHeartbeatOutbox(deliveryFrom(settings));
}

/** How many messages are still waiting locally. Never why, never which. */
export function pendingSyncCount(): number {
  return readHeartbeatOutboxStatus().queued;
}

/* ---------- allowance ----------

   The operations underneath call the private balance by its protocol name.
   Nothing in `surfaces/cover` should have to type that word, so the renaming
   happens once, here, and the screens work in the language a person uses.   */

export type AllowanceQuoteView = {
  /** Passed straight back to `moveAllowance`. Opaque to the screens. */
  handle: ReadyAllowanceQuote;
  amountFri: string;
  poolFeeFri: string;
  totalDebitFri: string;
  allowanceFri: string;
  maximumAmountFri: string;
  canSubmit: boolean;
  quotedAt: string;
};

export async function priceAllowanceMove(input: {
  wallet: ReadyCoverWallet;
  amountFri: string;
}): Promise<AllowanceQuoteView> {
  const quote = await quoteReadyAllowance({
    wallet: input.wallet,
    poolAddress: WRENCHLESS_MAINNET.poolAddress,
    tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
    amountFri: input.amountFri,
  });
  return {
    handle: quote,
    amountFri: quote.amountFri,
    poolFeeFri: quote.poolFeeFri,
    totalDebitFri: quote.totalDebitFri,
    allowanceFri: quote.shieldedBalanceFri,
    maximumAmountFri: quote.maximumAmountFri,
    canSubmit: quote.canSubmit,
    quotedAt: quote.quotedAt,
  };
}

export async function moveAllowance(input: {
  wallet: ReadyCoverWallet;
  quote: AllowanceQuoteView;
}): Promise<{ transactionHash: string; amountFri: string }> {
  const submitted = await moveReadyAllowanceToCover(
    input.wallet,
    input.quote.handle,
  );
  return {
    transactionHash: submitted.transactionHash,
    amountFri: submitted.amountFri,
  };
}

/**
 * Collects a funded one-time code.
 *
 * Every check that matters happens inside the operation: it reads the code's
 * live state, proves it matches the sealed ticket, refuses anything that would
 * take this wallet past its ceiling, and only then signs. This wrapper adds
 * nothing but the configuration and the vocabulary.
 */
export async function collectTopUp(input: {
  wallet: ReadyRefillWallet;
  settings: HubSettings;
  account: string;
  stateId: string;
}): Promise<{ transactionHash: string }> {
  const [account, allowance, fee] = await Promise.all([
    inspectReadyCoverAccount({
      wallet: input.wallet,
      tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
    }),
    readReadyShieldedBalance({
      wallet: input.wallet,
      tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
    }),
    readReadyPoolFee({ poolAddress: WRENCHLESS_MAINNET.poolAddress }),
  ]);
  if (BigInt(account.account) !== BigInt(input.account)) {
    throw new Error("The selected Ready Wallet account changed. Switch back and try again.");
  }
  const result = await claimStoredCoverRefill({
    wallet: input.wallet,
    poolAddress: WRENCHLESS_MAINNET.poolAddress,
    helperAddress: WRENCHLESS_MAINNET.helperAddress,
    recipient: input.account,
    stateId: input.stateId,
    knownStateIds: input.settings.refillStateIds,
    publicBalanceFri: account.publicBalanceFri,
    shieldedBalanceFri: allowance.shieldedBalanceFri,
    poolFeeFri: fee.poolFeeFri,
    exposureCapFri: input.settings.exposureCapFri,
  });
  return { transactionHash: result.transactionHash };
}
