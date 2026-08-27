import { describe, expect, it } from "vitest";

import {
  assertPrivateReturnFeeReserve,
  reconcileTravelSafeAction,
  retainPreparedForAccount,
} from "./travel-safe-action-state";
import type { TravelSafeV3ChainState } from "./travel-safe-state-v3";

const funded: TravelSafeV3ChainState = {
  stateId: "0x1",
  claimCommitment: "0x2",
  deviceCommitment: "0x3",
  recoveryCommitment: "0x4",
  tokenAddress: "0x5",
  initialAmount: "100",
  remainingAmount: "100",
  releasedAmount: "0",
  dailyAmount: "10",
  firstReleaseAt: "1000",
  returnAt: "2000",
  maxReturnAt: "3000",
  nonce: "0",
  claimableAmount: "0",
  status: "funded",
};

describe("Travel Safe action reconciliation", () => {
  it("trusts helper state after a timeout and keeps pending state truthful", () => {
    expect(
      reconcileTravelSafeAction({
        transactionHash: "0xaa",
        receipt: { name: "not-found" },
        state: funded,
        target: { operation: "FUND" },
      }),
    ).toMatchObject({ name: "confirmed", label: "Already completed" });
    expect(
      reconcileTravelSafeAction({
        transactionHash: "0xaa",
        receipt: { name: "pending" },
        state: null,
        target: { operation: "FUND" },
      }),
    ).toEqual({ name: "confirming", transactionHash: "0xaa" });
  });

  it("makes a reverted unchanged action retryable but recognizes stale nonce completion", () => {
    expect(
      reconcileTravelSafeAction({
        transactionHash: "0xaa",
        receipt: { name: "reverted", reason: "INVALID_NONCE" },
        state: funded,
        target: { operation: "EXTEND", previousNonce: "0", returnAt: "2500" },
      }),
    ).toEqual({ name: "failed", message: "INVALID_NONCE", retryable: true });
    expect(
      reconcileTravelSafeAction({
        transactionHash: "0xaa",
        receipt: { name: "reverted", reason: "INVALID_NONCE" },
        state: { ...funded, nonce: "1", returnAt: "2500" },
        target: { operation: "EXTEND", previousNonce: "0", returnAt: "2500" },
      }),
    ).toMatchObject({ name: "confirmed", label: "Already completed" });
  });

  it("accepts a partial release and discards estimates after an account switch", () => {
    expect(
      reconcileTravelSafeAction({
        transactionHash: "0xaa",
        receipt: { name: "accepted" },
        state: { ...funded, nonce: "1", remainingAmount: "90", releasedAmount: "10" },
        target: { operation: "RELEASE", previousNonce: "0", maximumRemaining: "90" },
      }),
    ).toMatchObject({ name: "confirmed" });
    expect(retainPreparedForAccount({ account: "0x1", proof: "x" }, "0x2"))
      .toBeNull();
  });

  it("blocks FUND, top-up, and extend unless a fresh STRK reserve is proven", () => {
    expect(() =>
      assertPrivateReturnFeeReserve({
        strkAvailable: false,
        shieldedStrkBaseUnits: "100",
        requiredBaseUnits: "10",
      }),
    ).toThrow("unavailable");
    expect(() =>
      assertPrivateReturnFeeReserve({
        strkAvailable: true,
        shieldedStrkBaseUnits: "100",
        requiredBaseUnits: "10",
        additionalStrkSpendBaseUnits: "95",
      }),
    ).toThrow("return fee");
  });
});
