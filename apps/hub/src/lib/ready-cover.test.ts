import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { JsonValue } from "@wrenchless/canary-core";

import {
  readPublicBalances,
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

describe("Public token balances", () => {
  const [strk, usdc] = TRAVEL_SAFE_TOKENS;

  const callRequestSchema = z.object({
    params: z.object({
      request: z.object({
        contract_address: z.string(),
        entry_point_selector: z.string(),
      }),
    }),
  });
  type CallRequest = z.infer<typeof callRequestSchema>["params"]["request"];
  type RpcReply =
    | { result: string[] }
    | { error: { code: number; message: string } };

  function rpc(handler: (request: CallRequest) => RpcReply): typeof fetch {
    return async (_url: string | URL | Request, init?: RequestInit) => {
      const body = callRequestSchema.parse(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ id: 1, jsonrpc: "2.0", ...handler(body.params.request) }),
        { status: 200 },
      );
    };
  }

  it("reads a u256 per token and falls back to the camelCase entry point", async () => {
    const seen: string[] = [];
    const fetcher = rpc(({ contract_address, entry_point_selector }) => {
      seen.push(entry_point_selector);
      if (BigInt(contract_address) === BigInt(usdc.address)) {
        return entry_point_selector ===
          "0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e"
          ? { result: ["0x5", "0x0"] }
          : { error: { code: 21, message: "Invalid message selector" } };
      }
      return { result: ["0x1", "0x1"] };
    });
    await expect(
      readPublicBalances({ account: "0x123", tokens: TRAVEL_SAFE_TOKENS, fetcher }),
    ).resolves.toEqual([
      {
        token: strk,
        publicBalanceBaseUnits: ((1n << 128n) + 1n).toString(),
        available: true,
        reason: null,
      },
      { token: usdc, publicBalanceBaseUnits: "5", available: true, reason: null },
    ]);
    expect(seen).toHaveLength(3);
  });

  it("reports a failed read as unavailable instead of as an empty balance", async () => {
    const fetcher = rpc(({ contract_address }) =>
      BigInt(contract_address) === BigInt(strk.address)
        ? { result: ["0x7", "0x0"] }
        : { error: { code: 21, message: "Contract not found" } },
    );
    const [strkBalance, usdcBalance] = await readPublicBalances({
      account: "0x123",
      tokens: TRAVEL_SAFE_TOKENS,
      fetcher,
    });
    expect(strkBalance).toMatchObject({ publicBalanceBaseUnits: "7", available: true });
    expect(usdcBalance).toMatchObject({ publicBalanceBaseUnits: "0", available: false });
    expect(usdcBalance?.reason).toContain("Contract not found");
  });
});
