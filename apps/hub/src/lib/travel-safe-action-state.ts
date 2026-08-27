import type { TravelSafeTicketV3PendingAction } from "@wrenchless/canary-core";

import type { TransactionReceiptStatus } from "./refill-state";
import type { TravelSafeV3ChainState } from "./travel-safe-state-v3";
import type { SafeActionState } from "../surfaces/safe/travel-safe-model";

export type TravelSafeActionTarget = TravelSafeTicketV3PendingAction;

export function travelSafeTargetCompleted(
  state: TravelSafeV3ChainState | null,
  target: TravelSafeActionTarget,
): boolean {
  if (state === null) return false;
  switch (target.operation) {
    case "FUND":
      return state.status === "funded";
    case "TOP_UP":
      return (
        BigInt(state.nonce) > BigInt(target.previousNonce) &&
        BigInt(state.remainingAmount) >= BigInt(target.minimumRemaining)
      );
    case "RELEASE":
      return (
        BigInt(state.nonce) > BigInt(target.previousNonce) &&
        BigInt(state.remainingAmount) <= BigInt(target.maximumRemaining)
      );
    case "EXTEND":
      return (
        BigInt(state.nonce) > BigInt(target.previousNonce) &&
        BigInt(state.returnAt) === BigInt(target.returnAt)
      );
    case "TERMINAL":
      return (
        BigInt(state.nonce) > BigInt(target.previousNonce) &&
        state.status !== "funded"
      );
  }
}

export function reconcileTravelSafeAction(input: {
  transactionHash: string;
  receipt: TransactionReceiptStatus;
  state: TravelSafeV3ChainState | null;
  target: TravelSafeActionTarget;
}): SafeActionState {
  if (travelSafeTargetCompleted(input.state, input.target)) {
    const confirmed: SafeActionState = {
      name: "confirmed",
      transactionHash: input.transactionHash,
    };
    if (input.receipt.name === "reverted" || input.receipt.name === "not-found") {
      confirmed.label = "Already completed";
    }
    return confirmed;
  }
  if (input.receipt.name === "reverted") {
    return {
      name: "failed",
      message: input.receipt.reason,
      retryable: true,
    };
  }
  return { name: "confirming", transactionHash: input.transactionHash };
}

export function confirmedTravelSafeAction(
  transactionHash: string | null,
  label = "Already completed",
): SafeActionState {
  return { name: "confirmed", transactionHash, label };
}

export function retainPreparedForAccount<Prepared extends { account: string }>(
  prepared: Prepared | null,
  account: string,
): Prepared | null {
  if (prepared === null) return null;
  return BigInt(prepared.account) === BigInt(account) ? prepared : null;
}

export function assertPrivateReturnFeeReserve(input: {
  strkAvailable: boolean;
  shieldedStrkBaseUnits: string;
  requiredBaseUnits: string;
  additionalStrkSpendBaseUnits?: string;
}): void {
  if (!input.strkAvailable) {
    throw new Error("Private STRK balance is unavailable");
  }
  const required =
    BigInt(input.requiredBaseUnits) +
    BigInt(input.additionalStrkSpendBaseUnits ?? "0");
  if (BigInt(input.shieldedStrkBaseUnits) < required) {
    throw new Error("Keep enough private STRK for the return fee");
  }
}
