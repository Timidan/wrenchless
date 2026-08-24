import { z } from "zod";

import {
  assertReadyPrivateContext,
  readReadyPoolFee,
  readReadyShieldedBalance,
  type ReadyPrivateWallet,
} from "./ready-cover.js";

const MAINNET_RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const GET_PUBLIC_KEY_SELECTOR =
  "0x01a35984e05126dbecb7c3bb9929e7dd9106d460c59b1633739a5c733a5fb13b";
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const RPC_TIMEOUT_MILLISECONDS = 30_000;

const rpcCallSchema = z.union([
  z.object({
    jsonrpc: z.literal("2.0"),
    id: z.number(),
    result: z.array(z.string()),
  }),
  z.object({
    jsonrpc: z.literal("2.0"),
    id: z.number(),
    error: z.object({ code: z.number(), message: z.string() }),
  }),
]);

export type ReadyPrivateReadiness = {
  account: string;
  registered: boolean;
  shieldedBalanceFri: string;
  poolFeeFri: string;
};

export type TravelSafeReadiness = ReadyPrivateReadiness & {
  returnReserveFri: string;
  maxParkableFri: string;
  canPark: boolean;
};

function canonicalFelt(value: string, label: string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not a Starknet address`);
  }
  if (parsed <= 0n || parsed >= STARK_FIELD_PRIME) {
    throw new Error(`${label} is not a Starknet address`);
  }
  return `0x${parsed.toString(16)}`;
}

async function readRegistration(input: {
  account: string;
  poolAddress: string;
  rpcUrl: string;
  fetcher: typeof fetch;
}): Promise<boolean> {
  // Called through a local binding, never as `input.fetcher(...)`. A method
  // call would hand `fetch` the input object as its `this`, and the browser
  // refuses that outright — which failed this whole read before it left.
  const { fetcher } = input;
  const response = await fetcher(input.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(RPC_TIMEOUT_MILLISECONDS),
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "starknet_call",
      params: {
        block_id: "latest",
        request: {
          calldata: [canonicalFelt(input.account, "account")],
          contract_address: canonicalFelt(input.poolAddress, "privacy pool"),
          entry_point_selector: GET_PUBLIC_KEY_SELECTOR,
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Mainnet registration read returned HTTP ${response.status}`);
  }
  const body = rpcCallSchema.parse(await response.json());
  if ("error" in body) {
    throw new Error(`Could not read private-token setup: ${body.error.message}`);
  }
  if (body.result.length !== 1 || body.result[0] === undefined) {
    throw new Error("Could not read private-token setup");
  }
  return BigInt(body.result[0]) !== 0n;
}

export async function inspectReadyPrivateReadiness(input: {
  wallet: ReadyPrivateWallet;
  poolAddress: string;
  tokenAddress: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<ReadyPrivateReadiness> {
  const fetcher = input.fetcher ?? fetch;
  const { account } = await assertReadyPrivateContext(input.wallet);
  const feeInput: Parameters<typeof readReadyPoolFee>[0] = {
    poolAddress: input.poolAddress,
    fetcher,
  };
  if (input.rpcUrl !== undefined) feeInput.rpcUrl = input.rpcUrl;
  const [registered, shielded, fee] = await Promise.all([
    readRegistration({
      account,
      poolAddress: input.poolAddress,
      rpcUrl: input.rpcUrl ?? MAINNET_RPC,
      fetcher,
    }),
    readReadyShieldedBalance({
      wallet: input.wallet,
      tokenAddress: input.tokenAddress,
    }),
    readReadyPoolFee(feeInput),
  ]);
  return {
    account,
    registered,
    shieldedBalanceFri: shielded.shieldedBalanceFri,
    poolFeeFri: fee.poolFeeFri,
  };
}

export async function inspectTravelSafeReadiness(input: {
  wallet: ReadyPrivateWallet;
  poolAddress: string;
  tokenAddress: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<TravelSafeReadiness> {
  const readiness = await inspectReadyPrivateReadiness(input);
  const balance = BigInt(readiness.shieldedBalanceFri);
  const reserve = BigInt(readiness.poolFeeFri);
  const maxParkable = balance > reserve ? balance - reserve : 0n;
  return {
    ...readiness,
    returnReserveFri: reserve.toString(),
    maxParkableFri: maxParkable.toString(),
    canPark: readiness.registered && maxParkable > 0n,
  };
}
