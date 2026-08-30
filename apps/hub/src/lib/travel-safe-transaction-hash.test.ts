import {
  deriveTravelSafeV3PublicKey,
  generateTravelSafeV3PrivateKey,
  jsonValueSchema,
} from "@wrenchless/canary-core";
import { describe, expect, it } from "vitest";

import {
  submitTravelSafeExtend,
  type ReadyTravelSafeV3Wallet,
} from "./ready-travel-safe-v3";

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

const devicePrivateKey = generateTravelSafeV3PrivateKey();
const state = {
  chainId: "0x534e5f4d41494e",
  helperAddress: "0x43d60a5bf9cd864d9d5bb1d86d48a3268d32c3a004db64962b03215d3fdb2ed",
  stateId: "0x400",
  nonce: "0",
  tokenAddress: "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  remainingAmount: "1000",
  firstReleaseAt: "2000",
  returnAt: "3000",
} as const;

async function extendWith(transactionHash: string): Promise<string> {
  const result = await submitTravelSafeExtend({
    wallet: walletReturning(transactionHash),
    state,
    newReturnAt: "4000",
    devicePrivateKey,
    devicePublicKey: deriveTravelSafeV3PublicKey(devicePrivateKey),
  });
  return result.transactionHash;
}

describe("Transaction hashes leaving the wallet", () => {
  it("canonicalises a padded hash so the ticket store accepts it", async () => {
    const padded =
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const transactionHash = await extendWith(padded);
    expect(transactionHash).toBe(
      "0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    expect(BigInt(transactionHash)).toBe(BigInt(padded));
    // The rule the ticket store applies to every felt it is handed.
    expect(transactionHash).toMatch(/^0x(?:0|[1-9a-f][0-9a-f]*)$/);
  });

  it("lower-cases a hash the wallet returned in upper case", async () => {
    expect(await extendWith("0x00ABCDEF")).toBe("0xabcdef");
  });

  it("refuses a zero hash rather than recording one", async () => {
    await expect(extendWith("0x0000000000000000000000000000000000000000")).rejects.toThrow(
      "invalid transaction",
    );
  });
});
