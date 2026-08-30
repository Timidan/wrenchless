import { jsonValueSchema } from "@wrenchless/canary-core";
import { describe, expect, it } from "vitest";

import {
  submitShieldDeposits,
  type ReadyTravelSafeV3Wallet,
} from "./ready-travel-safe-v3";
import { TRAVEL_SAFE_TOKENS } from "./travel-safe-tokens";

/**
 * The wallet API returns a `PADDED_TXN_HASH`: 64 hex characters with the
 * leading zeros left on, and upper case permitted. That hash is written onto
 * the ticket, whose schema takes canonical felts only — so a padded hash is
 * rejected after the transaction has already been broadcast, which is the
 * worst moment to discover it.
 */
function walletReturning(transactionHash: string): ReadyTravelSafeV3Wallet {
  return {
    async request(request) {
      if (request.type !== "wallet_strk20InvokeTransaction") {
        throw new Error(`Unexpected request: ${request.type}`);
      }
      return jsonValueSchema.parse({ transaction_hash: transactionHash });
    },
  };
}

const MAINNET = "0x534e5f4d41494e";
const deposits = [{ token: TRAVEL_SAFE_TOKENS[0], amountBaseUnits: "1000" }];

describe("Transaction hashes leaving the wallet", () => {
  it("canonicalises a padded hash so the ticket store accepts it", async () => {
    const padded =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const { transactionHash } = await submitShieldDeposits({
      wallet: walletReturning(padded),
      chainId: MAINNET,
      deposits,
    });
    expect(transactionHash).toBe(
      "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    expect(BigInt(transactionHash)).toBe(BigInt(padded));
    // The rule the ticket store applies to every felt it is handed.
    expect(transactionHash).toMatch(/^0x(?:0|[1-9a-f][0-9a-f]*)$/);
  });

  it("lower-cases a hash the wallet returned in upper case", async () => {
    const { transactionHash } = await submitShieldDeposits({
      wallet: walletReturning("0x00ABCDEF"),
      chainId: MAINNET,
      deposits,
    });
    expect(transactionHash).toBe("0xabcdef");
  });

  it("refuses a zero hash rather than recording one", async () => {
    await expect(
      submitShieldDeposits({
        wallet: walletReturning("0x0000000000000000000000000000000000000000"),
        chainId: MAINNET,
        deposits,
      }),
    ).rejects.toThrow("invalid transaction");
  });
});
