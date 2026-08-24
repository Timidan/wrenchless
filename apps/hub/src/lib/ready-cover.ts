import { z } from "zod";

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

type ShieldedBalanceEntry = {
  token: string;
  balance: string;
};

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
  if (BigInt(chainId) !== BigInt(MAINNET_CHAIN_ID)) {
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

async function readShieldedBalance(
  wallet: ReadyPrivateWallet,
  tokenAddress: string,
): Promise<bigint> {
  const balances = await wallet.request<ShieldedBalanceEntry[]>({
    type: "wallet_strk20Balances",
    params: {
      tokens: [tokenAddress],
      api_version: READY_WALLET_API_VERSION,
    },
  });
  const balance = balances.find(
    (entry) => BigInt(entry.token) === BigInt(tokenAddress),
  );
  if (balance === undefined) return 0n;
  const parsed = BigInt(balance.balance);
  if (parsed < 0n || parsed > U128_MAX) {
    throw new Error("Ready returned an invalid shielded balance");
  }
  return parsed;
}

export async function readReadyShieldedBalance(input: {
  wallet: ReadyPrivateWallet;
  tokenAddress: string;
}): Promise<{ tokenAddress: string; shieldedBalanceFri: string }> {
  await assertReadyPrivateContext(input.wallet);
  const tokenAddress = canonicalFelt(input.tokenAddress, "token address");
  const balance = await readShieldedBalance(input.wallet, tokenAddress);
  return {
    tokenAddress,
    shieldedBalanceFri: balance.toString(),
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
