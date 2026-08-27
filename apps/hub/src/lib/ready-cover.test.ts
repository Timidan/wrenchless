import { describe, expect, it } from "vitest";

import { TRAVEL_SAFE_TOKENS } from "./travel-safe-tokens.js";
import {
  readReadyShieldedBalances,
  type ReadyPrivateWallet,
} from "./ready-cover.js";

const MAINNET_CHAIN_ID = "0x534e5f4d41494e";

function walletWithBalances(result: unknown): ReadyPrivateWallet {
  return {
    selectedAddress: "0x123",
    async request<T>(request: { type: string; params?: unknown }): Promise<T> {
      const { type } = request;
      if (type === "wallet_requestChainId") return MAINNET_CHAIN_ID as T;
      if (type === "wallet_supportedWalletApi") return ["0.10.3"] as T;
      if (type === "wallet_strk20Balances") return result as T;
      throw new Error(`Unexpected request: ${type}`);
    },
  };
}

describe("Ready shielded token balances", () => {
  it("maps one validated response without fabricating a missing token", async () => {
    const [strk] = TRAVEL_SAFE_TOKENS;
    if (strk === undefined) throw new Error("STRK token missing from registry");

    await expect(
      readReadyShieldedBalances({
        wallet: walletWithBalances([
          { token: `0x0${strk.address.slice(2)}`, balance: "25" },
        ]),
        tokens: TRAVEL_SAFE_TOKENS,
      }),
    ).resolves.toEqual([
      { token: strk, shieldedBalanceBaseUnits: "25", available: true },
      {
        token: TRAVEL_SAFE_TOKENS[1],
        shieldedBalanceBaseUnits: "0",
        available: false,
      },
    ]);
  });

  it("rejects an invalid wallet response instead of partially trusting it", async () => {
    const [strk] = TRAVEL_SAFE_TOKENS;
    if (strk === undefined) throw new Error("STRK token missing from registry");

    await expect(
      readReadyShieldedBalances({
        wallet: walletWithBalances([
          { token: strk.address, balance: "not-a-number" },
        ]),
        tokens: TRAVEL_SAFE_TOKENS,
      }),
    ).rejects.toThrow();
  });
});
