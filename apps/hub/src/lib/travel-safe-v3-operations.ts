import type { TravelSafeTicketV3 } from "@wrenchless/canary-core";

import {
  prepareTravelSafeTopUp,
  prepareTravelSafeV3Fund,
  type ReadyTravelSafeV3Wallet,
} from "./ready-travel-safe-v3";
import {
  estimateTravelSafeV3Relay,
  submitTravelSafeV3Relay,
  type TravelSafeV3RelayArtifact,
  type TravelSafeV3RelayEstimate,
} from "./relayed-travel-safe-v3";
import type { TravelSafeV3ChainState } from "./travel-safe-state-v3";

function felt(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function normalizePrepared(input: {
  call: {
    contract_address: string;
    entry_point: string;
    calldata?: string[];
  };
  proof: { data: string; proof_facts: string[] };
}): Pick<TravelSafeV3RelayArtifact, "call" | "proof" | "proofFacts"> {
  if (input.call.entry_point !== "apply_actions" || input.call.calldata === undefined) {
    throw new Error("The private proof targets an unsupported action");
  }
  if (input.proof.data.trim().length === 0 || input.proof.proof_facts.length === 0) {
    throw new Error("The private proof is incomplete");
  }
  return {
    call: {
      contractAddress: felt(input.call.contract_address),
      entrypoint: "apply_actions",
      calldata: input.call.calldata.map(felt),
    },
    proof: input.proof.data,
    proofFacts: input.proof.proof_facts.map(felt),
  };
}

export type PreparedTravelSafeV3Relay = {
  account: string;
  artifact: TravelSafeV3RelayArtifact;
  estimate: TravelSafeV3RelayEstimate;
};

export async function prepareTravelSafeV3FundRelay(input: {
  wallet: ReadyTravelSafeV3Wallet;
  account: string;
  chainId: string;
  poolAddress: string;
  ticket: TravelSafeTicketV3;
  claimCommitment: string;
  deviceCommitment: string;
  recoveryCommitment: string;
  sponsorUrl: string;
  /** Ordinary funds shielded inside the same transaction. "0" for none. */
  depositBaseUnits?: string;
  fetcher?: typeof fetch;
}): Promise<PreparedTravelSafeV3Relay> {
  const depositBaseUnits = input.depositBaseUnits ?? "0";
  const result = await prepareTravelSafeV3Fund({
    wallet: input.wallet,
    chainId: input.chainId,
    poolAddress: input.poolAddress,
    helperAddress: input.ticket.helperAddress,
    stateId: input.ticket.stateId,
    claimCommitment: input.claimCommitment,
    deviceCommitment: input.deviceCommitment,
    recoveryCommitment: input.recoveryCommitment,
    tokenAddress: input.ticket.tokenAddress,
    amount: input.ticket.amountBaseUnits,
    dailyAmount: input.ticket.dailyAmountBaseUnits,
    firstReleaseAt: input.ticket.firstReleaseSeconds,
    returnAt: input.ticket.returnDateSeconds,
    depositAmount: depositBaseUnits,
  });
  const artifact: TravelSafeV3RelayArtifact = {
    schemaVersion: "wrenchless.travel-safe-relay.v3",
    chainId: "SN_MAIN",
    operation: "FUND",
    poolAddress: felt(input.poolAddress),
    helperAddress: felt(input.ticket.helperAddress),
    stateId: felt(input.ticket.stateId),
    claimCommitment: felt(input.claimCommitment),
    deviceCommitment: felt(input.deviceCommitment),
    recoveryCommitment: felt(input.recoveryCommitment),
    tokenAddress: felt(input.ticket.tokenAddress),
    amountBaseUnits: input.ticket.amountBaseUnits,
    dailyAmountBaseUnits: input.ticket.dailyAmountBaseUnits,
    firstReleaseAt: input.ticket.firstReleaseSeconds,
    returnAt: input.ticket.returnDateSeconds,
    depositBaseUnits,
    createdAt: new Date().toISOString(),
    ...normalizePrepared(result.prepared),
  };
  const estimateInput: Parameters<typeof estimateTravelSafeV3Relay>[0] = {
    sponsorUrl: input.sponsorUrl,
    artifact,
  };
  if (input.fetcher !== undefined) estimateInput.fetcher = input.fetcher;
  return {
    account: felt(input.account),
    artifact,
    estimate: await estimateTravelSafeV3Relay(estimateInput),
  };
}

export async function prepareTravelSafeV3TopUpRelay(input: {
  wallet: ReadyTravelSafeV3Wallet;
  account: string;
  poolAddress: string;
  state: TravelSafeV3ChainState;
  ticket: TravelSafeTicketV3;
  amountBaseUnits: string;
  devicePublicKey: string;
  sponsorUrl: string;
  /** Ordinary funds shielded inside the same transaction. "0" for none. */
  depositBaseUnits?: string;
  fetcher?: typeof fetch;
}): Promise<PreparedTravelSafeV3Relay> {
  const depositBaseUnits = input.depositBaseUnits ?? "0";
  const result = await prepareTravelSafeTopUp({
    wallet: input.wallet,
    poolAddress: input.poolAddress,
    state: {
      chainId: "0x534e5f4d41494e",
      helperAddress: input.ticket.helperAddress,
      stateId: input.ticket.stateId,
      nonce: input.state.nonce,
      tokenAddress: input.state.tokenAddress,
      remainingAmount: input.state.remainingAmount,
      firstReleaseAt: input.state.firstReleaseAt,
      returnAt: input.state.returnAt,
    },
    amount: input.amountBaseUnits,
    devicePrivateKey: input.ticket.devicePrivateKey,
    devicePublicKey: input.devicePublicKey,
    depositAmount: depositBaseUnits,
  });
  const artifact: TravelSafeV3RelayArtifact = {
    schemaVersion: "wrenchless.travel-safe-relay.v3",
    chainId: "SN_MAIN",
    operation: "TOP_UP",
    poolAddress: felt(input.poolAddress),
    helperAddress: felt(input.ticket.helperAddress),
    stateId: felt(input.ticket.stateId),
    tokenAddress: felt(input.ticket.tokenAddress),
    amountBaseUnits: input.amountBaseUnits,
    nonce: input.state.nonce,
    devicePublicKey: felt(result.devicePublicKey),
    signatureR: felt(result.signature.r),
    signatureS: felt(result.signature.s),
    depositBaseUnits,
    createdAt: new Date().toISOString(),
    ...normalizePrepared(result.prepared),
  };
  const estimateInput: Parameters<typeof estimateTravelSafeV3Relay>[0] = {
    sponsorUrl: input.sponsorUrl,
    artifact,
  };
  if (input.fetcher !== undefined) estimateInput.fetcher = input.fetcher;
  return {
    account: felt(input.account),
    artifact,
    estimate: await estimateTravelSafeV3Relay(estimateInput),
  };
}

export async function submitPreparedTravelSafeV3Relay(input: {
  prepared: PreparedTravelSafeV3Relay;
  sponsorUrl: string;
  fetcher?: typeof fetch;
}): Promise<{ transactionHash: string }> {
  const request: Parameters<typeof submitTravelSafeV3Relay>[0] = {
    sponsorUrl: input.sponsorUrl,
    artifact: input.prepared.artifact,
    acceptedMaxSpendFri: input.prepared.estimate.summary.maxSpendFri,
  };
  if (input.fetcher !== undefined) request.fetcher = input.fetcher;
  return submitTravelSafeV3Relay(request);
}
