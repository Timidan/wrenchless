import { describe, expect, it } from "vitest";

import type { JsonValue } from "@wrenchless/canary-core";

import {
  readReadyShieldedBalances,
  type ReadyPrivateWallet,
} from "./ready-cover.js";
import { TRAVEL_SAFE_TOKENS } from "./travel-safe-tokens.js";

const MAINNET_CHAIN_ID = "0x534e5f4d41494e";

function testWalletValue<T>(value: JsonValue): T {
  // SAFETY: This helper intentionally emulates an untrusted wallet boundary;
  // the production reader must validate every returned value before use.
  return value as T;
}

function walletWithBalances(result: JsonValue): ReadyPrivateWallet {
  return {
    selectedAddress: "0x123",
    async request<T>(request: { type: string; params?: unknown }): Promise<T> {
      const { type } = request;
      if (type === "wallet_requestChainId") return testWalletValue(MAINNET_CHAIN_ID);
      if (type === "wallet_supportedWalletApi") return testWalletValue(["0.10.3"]);
      if (type === "wallet_strk20Balances") return testWalletValue(result);
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
