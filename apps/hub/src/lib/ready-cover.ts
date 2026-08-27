import { z } from "zod";

import type { TravelSafeToken } from "@wrenchless/canary-core";

const READY_WALLET_API_VERSION = "0.10.3";
const MAINNET_CHAIN_ID = "0x534e5f4d41494e";
const MAINNET_RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const GET_FEE_AMOUNT_SELECTOR =
  "0x03d323cd692ad43935b81ce230c47bfc57f69656249c5a33fe5223c17dd32ed2";
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const U128_MAX = (1n << 128n) - 1n;
const RPC_TIMEOUT_MILLISECONDS = 30_000;

export type ReadyPrivateWallet = {
  request<T>(request: { type: string; params?: unknown }): Promise<T>;
  selectedAddress?: string;
};

const shieldedBalanceResponseSchema = z.array(
  z.object({
    token: z.string(),
    balance: z.string(),
  }),
);

const rpcResponseSchema = z.union([
  z.object({
    id: z.number(),
    jsonrpc: z.literal("2.0"),
    result: z.array(z.string()),
  }),
  z.object({
    error: z.object({ code: z.number(), message: z.string() }),
    id: z.number(),
    jsonrpc: z.literal("2.0"),
  }),
]);

function canonicalFelt(value: string, label: string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not a felt`);
  }
  if (parsed <= 0n || parsed >= STARK_FIELD_PRIME) {
    throw new Error(`${label} is outside the non-zero Stark field`);
  }
  return `0x${parsed.toString(16)}`;
}

export async function assertReadyPrivateContext(
  wallet: ReadyPrivateWallet,
): Promise<{ account: string }> {
  const [chainId, versions] = await Promise.all([
    wallet.request<string>({ type: "wallet_requestChainId" }),
    wallet.request<readonly string[]>({ type: "wallet_supportedWalletApi" }),
  ]);
  let onMainnet = false;
  try {
    onMainnet = BigInt(chainId) === BigInt(MAINNET_CHAIN_ID);
  } catch {
    // Invalid wallet output is handled as a network mismatch below.
  }
  if (!onMainnet) {
    throw new Error("Ready must be connected to Starknet mainnet");
  }
  if (!versions.includes(READY_WALLET_API_VERSION)) {
    throw new Error(
      `Ready does not support Wallet API ${READY_WALLET_API_VERSION}`,
    );
  }
  if (!wallet.selectedAddress) {
    throw new Error("Ready has no selected account");
  }
  return { account: canonicalFelt(wallet.selectedAddress, "Ready account") };
}

async function readPoolFee(
  poolAddress: string,
  rpcUrl: string,
  fetcher: typeof fetch,
): Promise<bigint> {
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(RPC_TIMEOUT_MILLISECONDS),
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "starknet_call",
      params: {
        block_id: "latest",
        request: {
          calldata: [],
          contract_address: canonicalFelt(poolAddress, "privacy pool"),
          entry_point_selector: GET_FEE_AMOUNT_SELECTOR,
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Mainnet fee quote returned HTTP ${response.status}`);
  }
  const body = rpcResponseSchema.parse(await response.json());
  if (!("result" in body) || body.result.length !== 1) {
    throw new Error("Could not read the live STRK20 pool fee");
  }
  const fee = body.result[0];
  if (fee === undefined) throw new Error("The STRK20 pool fee is missing");
  const parsed = BigInt(fee);
  if (parsed < 0n || parsed > U128_MAX) {
    throw new Error("The STRK20 pool fee is invalid");
  }
  return parsed;
}

export async function readReadyShieldedBalances(input: {
  wallet: ReadyPrivateWallet;
  tokens: readonly TravelSafeToken[];
  checkContext?: boolean;
}): Promise<
  readonly {
    token: TravelSafeToken;
    shieldedBalanceBaseUnits: string;
    available: boolean;
  }[]
> {
  if (input.checkContext !== false) {
    await assertReadyPrivateContext(input.wallet);
  }
  if (input.tokens.length === 0) {
    throw new Error("Choose at least one private token");
  }

  const requested = input.tokens.map((token) => ({
    token,
    address: canonicalFelt(token.address, `${token.symbol} token address`),
  }));
  const requestedByValue = new Map<string, (typeof requested)[number]>();
  for (const item of requested) {
    const key = BigInt(item.address).toString();
    if (requestedByValue.has(key)) {
      throw new Error("Private token registry contains a duplicate address");
    }
    requestedByValue.set(key, item);
  }

  const response = await input.wallet.request<unknown>({
    type: "wallet_strk20Balances",
    params: {
      tokens: requested.map(({ address }) => address),
      api_version: READY_WALLET_API_VERSION,
    },
  });

  const balances = shieldedBalanceResponseSchema.parse(response);
  const balancesByToken = new Map<string, bigint>();
  for (const entry of balances) {
    const address = canonicalFelt(entry.token, "Ready balance token");
    const key = BigInt(address).toString();
    if (!requestedByValue.has(key)) {
      throw new Error("Ready returned an unrequested private token");
    }
    if (balancesByToken.has(key)) {
      throw new Error("Ready returned a duplicate private token balance");
    }

    let balance: bigint;
    try {
      balance = BigInt(entry.balance);
    } catch {
      throw new Error("Ready returned an invalid shielded balance");
    }
    if (balance < 0n || balance > U128_MAX) {
      throw new Error("Ready returned an invalid shielded balance");
    }
    balancesByToken.set(key, balance);
  }

  return requested.map(({ token, address }) => {
    const balance = balancesByToken.get(BigInt(address).toString());
    return {
      token,
      shieldedBalanceBaseUnits: (balance ?? 0n).toString(),
      available: balance !== undefined,
    };
  });
}

export async function readReadyShieldedBalance(input: {
  wallet: ReadyPrivateWallet;
  tokenAddress: string;
}): Promise<{ tokenAddress: string; shieldedBalanceFri: string }> {
  const tokenAddress = canonicalFelt(input.tokenAddress, "token address");
  const [balance] = await readReadyShieldedBalances({
    wallet: input.wallet,
    tokens: [{ symbol: "STRK", decimals: 18, address: tokenAddress }],
  });
  if (balance === undefined) {
    throw new Error("Ready did not return the STRK private balance");
  }
  return {
    tokenAddress,
    shieldedBalanceFri: balance.shieldedBalanceBaseUnits,
  };
}

export async function readReadyPoolFee(input: {
  poolAddress: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<{ poolFeeFri: string }> {
  const poolFee = await readPoolFee(
    input.poolAddress,
    input.rpcUrl ?? MAINNET_RPC,
    input.fetcher ?? fetch,
  );
  return { poolFeeFri: poolFee.toString() };
}
