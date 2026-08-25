import { readReadyPoolFee } from "./ready-cover.js";
import { readRefillChainSnapshot } from "./refill-state.js";
import { inspectRefillSponsor } from "./relayed-refill.js";

const PREFLIGHT_STATE_ID = "0x1";

/** Checks the Travel Safe infrastructure without opening or reading a wallet. */
export async function inspectTravelSafePreflight(input: {
  sponsorUrl: string;
  rpcUrl: string;
  poolAddress: string;
  helperAddress: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  const sponsorInput: Parameters<typeof inspectRefillSponsor>[0] = {
    sponsorUrl: input.sponsorUrl,
  };
  const poolInput: Parameters<typeof readReadyPoolFee>[0] = {
    poolAddress: input.poolAddress,
    rpcUrl: input.rpcUrl,
  };
  const helperInput: Parameters<typeof readRefillChainSnapshot>[0] = {
    helperAddress: input.helperAddress,
    stateId: PREFLIGHT_STATE_ID,
    rpcUrl: input.rpcUrl,
  };
  if (input.fetcher !== undefined) {
    sponsorInput.fetcher = input.fetcher;
    poolInput.fetcher = input.fetcher;
    helperInput.fetcher = input.fetcher;
  }
  await Promise.all([
    inspectRefillSponsor(sponsorInput),
    readReadyPoolFee(poolInput),
    readRefillChainSnapshot(helperInput),
  ]);
}
