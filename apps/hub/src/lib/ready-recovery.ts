import {
  createRecoveryLookupTypedData,
  normalizeReadySignature,
  type JsonValue,
} from "@wrenchless/canary-core";
import { z } from "zod";

import type { ReadyRefillWallet } from "./ready-refill.js";

const READY_WALLET_API_VERSION = "0.10.3";
const MAINNET_CHAIN_ID = "0x534e5f4d41494e";
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const challengeSchema = z
  .object({
    token: z.string().min(1).max(4_096),
    challenge: z.string().regex(/^0x[0-9a-f]+$/),
    expiresAt: z.string().regex(/^[1-9][0-9]*$/),
  })
  .passthrough();
const locatorSchema = z
  .object({
    stateId: z
      .string()
      .regex(/^0x[0-9a-f]+$/)
      .refine((value) => BigInt(value) !== 0n),
    recoverySalt: z
      .string()
      .regex(/^0x[0-9a-f]+$/)
      .refine((value) => BigInt(value) !== 0n),
  })
  .strict();

function endpoint(sponsorUrl: string, path: string): string {
  return new URL(
    path,
    sponsorUrl.endsWith("/") ? sponsorUrl : `${sponsorUrl}/`,
  ).toString();
}

function canonicalAddress(value: string): string {
  try {
    const address = BigInt(value);
    if (address <= 0n || address >= STARK_FIELD_PRIME) throw new Error();
    return `0x${address.toString(16)}`;
  } catch {
    throw new Error("The wallet returned an invalid account address");
  }
}

async function post(
  sponsorUrl: string,
  path: string,
  body: JsonValue,
  fetcher: typeof fetch,
): Promise<{ response: Response; body: unknown }> {
  const response = await fetcher(endpoint(sponsorUrl, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error("The recovery service returned an unreadable response");
  }
  return { response, body: parsed };
}

export async function requestReadyRecoveryLocator(input: {
  wallet: ReadyRefillWallet;
  account: string;
  sponsorUrl: string;
  fetcher?: typeof fetch;
}): Promise<{ stateId: string; recoverySalt: string }> {
  const fetcher = input.fetcher ?? fetch;
  const account = canonicalAddress(input.account);
  const chainId = await input.wallet.request<string>({
    type: "wallet_requestChainId",
  });
  let onMainnet = false;
  try {
    onMainnet = BigInt(chainId) === BigInt(MAINNET_CHAIN_ID);
  } catch {
    // Invalid wallet output is handled as a network mismatch below.
  }
  if (!onMainnet) {
    throw new Error("Connect your wallet to Starknet mainnet");
  }
  let challenged: Awaited<ReturnType<typeof post>>;
  try {
    challenged = await post(
      input.sponsorUrl,
      "v1/recovery/challenge",
      { account },
      fetcher,
    );
  } catch {
    throw new Error("The recovery service could not be reached");
  }
  if (!challenged.response.ok) {
    throw new Error("The recovery service is unavailable");
  }
  const challenge = challengeSchema.parse(challenged.body);
  const signature = await input.wallet.request<string[]>({
    type: "wallet_signTypedData",
    params: {
      ...createRecoveryLookupTypedData({
        chainId,
        recoveryAccount: account,
        challenge: challenge.challenge,
        expiresAt: challenge.expiresAt,
      }),
      api_version: READY_WALLET_API_VERSION,
    },
  });
  let lookedUp: Awaited<ReturnType<typeof post>>;
  try {
    lookedUp = await post(
      input.sponsorUrl,
      "v1/recovery/lookup",
      {
        account,
        token: challenge.token,
        signature: normalizeReadySignature(signature),
      },
      fetcher,
    );
  } catch {
    throw new Error("The recovery service could not be reached");
  }
  if (lookedUp.response.status === 404) {
    throw new Error("No Travel Safe was found for this wallet account");
  }
  if (!lookedUp.response.ok) {
    throw new Error("The wallet did not approve this recovery");
  }
  return locatorSchema.parse(lookedUp.body);
}
