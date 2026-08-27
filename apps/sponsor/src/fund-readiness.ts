import { RpcProvider, constants } from "starknet";
import { MAINNET_REFILL_HELPER_CLASS_HASH } from "@wrenchless/relay-canary/config";

import type { SponsorConfig } from "./config.js";

const U128_SHIFT = 128n;
const RPC_TIMEOUT_MILLISECONDS = 30_000;

const boundedRpcFetch: typeof fetch = (input, init = {}) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.timeout(RPC_TIMEOUT_MILLISECONDS),
  });

export type FundSponsorReadiness = {
  chainId: string;
  poolFeeFri: string;
  poolFeeWithinLimit: boolean;
  poolPaused: boolean;
  accountPublicBalanceFri: string;
  fundRelayMinimumBalanceFri: string;
  fundRelayBalanceReady: boolean;
  fundRelayBroadcastEnabled: boolean;
  helperMatchesConfiguration: boolean;
};

function parseSingleFelt(result: readonly string[], label: string): bigint {
  if (result.length !== 1 || result[0] === undefined) {
    throw new Error(`${label} returned an incompatible value`);
  }
  return BigInt(result[0]);
}

function parseU256(result: readonly string[], label: string): bigint {
  if (result.length !== 2 || result[0] === undefined || result[1] === undefined) {
    throw new Error(`${label} returned an incompatible u256`);
  }
  return BigInt(result[0]) + (BigInt(result[1]) << U128_SHIFT);
}

export async function inspectFundSponsorReadiness(
  config: SponsorConfig,
): Promise<FundSponsorReadiness> {
  const provider = new RpcProvider({
    nodeUrl: config.rpcUrl,
    baseFetch: boundedRpcFetch,
  });
  const chainId = await provider.getChainId();
  if (chainId !== constants.StarknetChainId.SN_MAIN) {
    throw new Error(`sponsor RPC is not Starknet mainnet: ${chainId}`);
  }
  const [poolFee, poolPaused, helperClassHash, publicBalance, helperPool, helperToken] =
    await Promise.all([
      provider.callContract(
      {
        contractAddress: config.poolAddress,
        entrypoint: "get_fee_amount",
        calldata: [],
      },
      "latest",
    ),
    provider.callContract(
      {
        contractAddress: config.poolAddress,
        entrypoint: "is_paused",
        calldata: [],
      },
      "latest",
    ),
    provider.getClassHashAt(config.helperAddress, "latest"),
    provider.callContract(
      {
        contractAddress: config.tokenAddress,
        entrypoint: "balance_of",
        calldata: [config.accountAddress],
      },
      "latest",
    ),
    provider.callContract(
      {
        contractAddress: config.helperAddress,
        entrypoint: "privacy_pool",
        calldata: [],
      },
      "latest",
    ),
    provider.callContract(
      {
        contractAddress: config.helperAddress,
        entrypoint: "allowed_token",
        calldata: [],
      },
      "latest",
    ),
    ]);
  const poolFeeFri = parseSingleFelt(poolFee, "get_fee_amount");
  const poolPausedValue = parseSingleFelt(poolPaused, "is_paused");
  if (poolPausedValue !== 0n && poolPausedValue !== 1n) {
    throw new Error("is_paused returned an incompatible value");
  }
  const accountPublicBalanceFri = parseU256(publicBalance, "balance_of");
  const fundRelayMinimumBalanceFri = poolFeeFri + config.maxTransactionFeeFri;
  return {
    chainId,
    poolFeeFri: poolFeeFri.toString(),
    poolFeeWithinLimit:
      poolFeeFri > 0n && poolFeeFri <= config.maxPoolFeeFri,
    poolPaused: poolPausedValue === 1n,
    accountPublicBalanceFri: accountPublicBalanceFri.toString(),
    fundRelayMinimumBalanceFri: fundRelayMinimumBalanceFri.toString(),
    fundRelayBalanceReady:
      accountPublicBalanceFri >= fundRelayMinimumBalanceFri,
    fundRelayBroadcastEnabled: config.refillFundBroadcastEnabled,
    helperMatchesConfiguration:
      BigInt(helperClassHash) === BigInt(MAINNET_REFILL_HELPER_CLASS_HASH) &&
      parseSingleFelt(helperPool, "privacy_pool") === BigInt(config.poolAddress) &&
      parseSingleFelt(helperToken, "allowed_token") === BigInt(config.tokenAddress),
  };
}
