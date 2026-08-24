import { z } from "zod";

import {
  assertReadyCoverContext,
  inspectReadyCoverAccount,
  readReadyPoolFee,
  readReadyShieldedBalance,
  type ReadyCoverWallet,
} from "./ready-cover.js";

const READY_WALLET_API_VERSION = "0.10.3";
const MAINNET_RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const GET_PUBLIC_KEY_SELECTOR =
  "0x01a35984e05126dbecb7c3bb9929e7dd9106d460c59b1633739a5c733a5fb13b";
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const U128_MAX = (1n << 128n) - 1n;

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

const transactionSchema = z.object({
  transaction_hash: z.string().regex(/^0x[0-9a-f]+$/),
});

export type ReadyPrivateReadiness = {
  account: string;
  registered: boolean;
  publicBalanceFri: string;
  shieldedBalanceFri: string;
  poolFeeFri: string;
};

export function minimumReadyPrivateDepositFri(poolFeeFri: string): string {
  if (!/^[0-9]+$/.test(poolFeeFri)) {
    throw new Error("The live private-transfer fee is invalid");
  }
  // Ready takes one pool fee from the public deposit. Leaving one more full
  // fee privately is what lets the first recipient-built claim be submitted.
  return (2n * BigInt(poolFeeFri)).toString();
}

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
  wallet: ReadyCoverWallet;
  poolAddress: string;
  tokenAddress: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<ReadyPrivateReadiness> {
  const fetcher = input.fetcher ?? fetch;
  const accountInput: Parameters<typeof inspectReadyCoverAccount>[0] = {
    wallet: input.wallet,
    tokenAddress: input.tokenAddress,
    fetcher,
  };
  if (input.rpcUrl !== undefined) accountInput.rpcUrl = input.rpcUrl;
  const account = await inspectReadyCoverAccount(accountInput);
  const feeInput: Parameters<typeof readReadyPoolFee>[0] = {
    poolAddress: input.poolAddress,
    fetcher,
  };
  if (input.rpcUrl !== undefined) feeInput.rpcUrl = input.rpcUrl;
  const [registered, shielded, fee] = await Promise.all([
    readRegistration({
      account: account.account,
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
    account: account.account,
    registered,
    publicBalanceFri: account.publicBalanceFri,
    shieldedBalanceFri: shielded.shieldedBalanceFri,
    poolFeeFri: fee.poolFeeFri,
  };
}

export async function submitReadyPrivateDeposit(input: {
  wallet: ReadyCoverWallet;
  tokenAddress: string;
  amountFri: string;
  poolFeeFri: string;
}): Promise<{ transactionHash: string }> {
  await assertReadyCoverContext(input.wallet);
  if (!/^[1-9][0-9]*$/.test(input.amountFri)) {
    throw new Error("Enter an amount greater than zero");
  }
  const amount = BigInt(input.amountFri);
  if (amount > U128_MAX) throw new Error("That amount is too large");
  if (amount < BigInt(minimumReadyPrivateDepositFri(input.poolFeeFri))) {
    throw new Error("Add enough to leave one private-transfer fee after setup");
  }
  const token = canonicalFelt(input.tokenAddress, "token");
  const result = transactionSchema.parse(
    await input.wallet.request<unknown>({
      type: "wallet_strk20InvokeTransaction",
      params: {
        actions: [{ type: "deposit", token, amount: amount.toString() }],
        api_version: READY_WALLET_API_VERSION,
      },
    }),
  );
  return { transactionHash: result.transaction_hash };
}
