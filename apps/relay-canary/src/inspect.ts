import {
  assertRegistrationProofFacts,
  buildRegistrationRelayPlan,
  type RegistrationCanaryArtifact,
  type RegistrationRelayPlan,
} from "@wrenchless/canary-core";
import type { ResourceBoundsBN } from "starknet";

import type { RelayCanaryConfig } from "./config.js";

export type RelayFeeEstimate = {
  overallFeeFri: bigint;
  resourceBounds: ResourceBoundsBN;
};

export type RegistrationFinalityRequest = {
  transactionHash: string;
  poolAddress: string;
  coverAddress: string;
  relayAddress: string;
  viewingPublicKey: string;
};

export type RegistrationFinalityEvidence = {
  transactionHash: string;
  blockNumber: string;
  finalityStatus: "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1";
  executionStatus: "SUCCEEDED";
  senderAddress: string;
  actualFeeFri: string;
  viewingKeyUser: string;
  viewingPublicKey: string;
};

export type RegistrationCanaryClient = {
  assertPoolInterface(poolAddress: string): Promise<{
    chainId: "SN_MAIN";
    classHash: string;
  }>;
  readPoolVersion(poolAddress: string): Promise<string>;
  readLatestBlockNumber(): Promise<bigint>;
  readProofValidityBlocks(poolAddress: string): Promise<bigint>;
  readBlockHash(blockNumber: bigint): Promise<string>;
  readPoolPaused(poolAddress: string): Promise<boolean>;
  readPoolFeeFri(poolAddress: string): Promise<bigint>;
  readCoverPublicKey(poolAddress: string, coverAddress: string): Promise<bigint>;
  readRelayBalanceFri(strkAddress: string, relayAddress: string): Promise<bigint>;
  estimateUnsigned(
    plan: RegistrationRelayPlan,
    artifact: RegistrationCanaryArtifact,
  ): Promise<RelayFeeEstimate>;
  estimateSigned(
    plan: RegistrationRelayPlan,
    artifact: RegistrationCanaryArtifact,
    privateKey: string,
  ): Promise<RelayFeeEstimate>;
  broadcast(
    plan: RegistrationRelayPlan,
    artifact: RegistrationCanaryArtifact,
    privateKey: string,
    resourceBounds: ResourceBoundsBN,
  ): Promise<string>;
  waitForRegistrationFinality(
    input: RegistrationFinalityRequest,
  ): Promise<RegistrationFinalityEvidence>;
};

export type InspectionSummary = {
  mode: "dry-run" | "broadcast";
  poolAddress: string;
  poolClassHash: string;
  poolVersion: string;
  strkAddress: string;
  coverAddress: string;
  relayAddress: string;
  poolPaused: false;
  coverRegistered: false;
  poolFeeFri: string;
  estimatedTransactionFeeFri: string;
  maxTransactionFeeFri: string;
  maxSpendFri: string;
  proofBaseBlock: string;
  proofExpiresAtBlock: string;
  proofRemainingBlocks: string;
};

type InspectionInput = {
  artifact: RegistrationCanaryArtifact;
  config: RelayCanaryConfig;
  client: RegistrationCanaryClient;
};

export function assertRelayFeeWithinCap(
  estimate: RelayFeeEstimate,
  cap: bigint,
  label: "estimated" | "signed",
): void {
  const fee = estimate.overallFeeFri;
  if (fee <= 0n) {
    throw new Error(`${label} transaction fee must be positive`);
  }
  if (fee > cap) {
    throw new Error(`${label} transaction fee exceeds configured cap`);
  }
  const maximumAuthorizedFee =
    estimate.resourceBounds.l1_gas.max_amount *
      estimate.resourceBounds.l1_gas.max_price_per_unit +
    estimate.resourceBounds.l1_data_gas.max_amount *
      estimate.resourceBounds.l1_data_gas.max_price_per_unit +
    estimate.resourceBounds.l2_gas.max_amount *
      estimate.resourceBounds.l2_gas.max_price_per_unit;
  if (maximumAuthorizedFee > cap) {
    throw new Error(`${label} transaction resource bounds exceed configured cap`);
  }
}

function makeSummary(
  config: RelayCanaryConfig,
  artifact: RegistrationCanaryArtifact,
  plan: RegistrationRelayPlan,
  estimatedFeeFri: bigint,
  poolIdentity: { chainId: "SN_MAIN"; classHash: string },
  poolVersion: string,
  proofSummary: {
    baseBlockNumber: bigint;
    expiresAtBlock: bigint;
    remainingBlocks: bigint;
  },
): InspectionSummary {
  return {
    mode: config.broadcast ? "broadcast" : "dry-run",
    poolAddress: config.poolAddress,
    poolClassHash: poolIdentity.classHash,
    poolVersion,
    strkAddress: config.strkAddress,
    coverAddress: artifact.coverAddress,
    relayAddress: config.relayAddress,
    poolPaused: false,
    coverRegistered: false,
    poolFeeFri: plan.poolFeeFri.toString(),
    estimatedTransactionFeeFri: estimatedFeeFri.toString(),
    maxTransactionFeeFri: config.maxTransactionFeeFri.toString(),
    maxSpendFri: plan.maxSpendFri.toString(),
    proofBaseBlock: proofSummary.baseBlockNumber.toString(),
    proofExpiresAtBlock: proofSummary.expiresAtBlock.toString(),
    proofRemainingBlocks: proofSummary.remainingBlocks.toString(),
  };
}

export async function inspectRegistrationCanary(
  input: InspectionInput,
): Promise<{
  summary: InspectionSummary;
  transactionHash?: string;
  receipt?: RegistrationFinalityEvidence;
}> {
  const { artifact, config, client } = input;

  const poolIdentity = await client.assertPoolInterface(config.poolAddress);
  const [
    poolVersion,
    latestBlockNumber,
    proofValidityBlocks,
    poolPaused,
    poolFeeFri,
    coverPublicKey,
    relayBalanceFri,
  ] = await Promise.all([
    client.readPoolVersion(config.poolAddress),
    client.readLatestBlockNumber(),
    client.readProofValidityBlocks(config.poolAddress),
    client.readPoolPaused(config.poolAddress),
    client.readPoolFeeFri(config.poolAddress),
    client.readCoverPublicKey(config.poolAddress, artifact.coverAddress),
    client.readRelayBalanceFri(config.strkAddress, config.relayAddress),
  ]);

  if (poolPaused) {
    throw new Error("pool is paused");
  }
  if (coverPublicKey !== 0n) {
    throw new Error("cover is already registered");
  }
  const proofSummary = assertRegistrationProofFacts({
    artifact,
    poolClassHash: poolIdentity.classHash,
    latestBlockNumber,
    proofValidityBlocks,
  });
  const canonicalBaseBlockHash = await client.readBlockHash(
    proofSummary.baseBlockNumber,
  );
  if (BigInt(canonicalBaseBlockHash) !== BigInt(proofSummary.baseBlockHash)) {
    throw new Error("proof base-block hash does not match mainnet");
  }

  const plan = buildRegistrationRelayPlan({
    artifact,
    configuredPoolAddress: config.poolAddress,
    strkAddress: config.strkAddress,
    relayAddress: config.relayAddress,
    poolFeeFri,
    maxPoolFeeFri: config.maxPoolFeeFri,
    maxTransactionFeeFri: config.maxTransactionFeeFri,
    relayBalanceFri,
  });

  const unsignedEstimate = await client.estimateUnsigned(plan, artifact);
  assertRelayFeeWithinCap(unsignedEstimate, config.maxTransactionFeeFri, "estimated");

  if (!config.broadcast) {
    return {
      summary: makeSummary(
        config,
        artifact,
        plan,
        unsignedEstimate.overallFeeFri,
        poolIdentity,
        poolVersion,
        proofSummary,
      ),
    };
  }

  if (config.relayPrivateKey === undefined) {
    throw new Error("relay private key is required for broadcast");
  }
  const signedEstimate = await client.estimateSigned(
    plan,
    artifact,
    config.relayPrivateKey,
  );
  assertRelayFeeWithinCap(signedEstimate, config.maxTransactionFeeFri, "signed");

  const transactionHash = await client.broadcast(
    plan,
    artifact,
    config.relayPrivateKey,
    signedEstimate.resourceBounds,
  );
  const receipt = await client.waitForRegistrationFinality({
    transactionHash,
    poolAddress: config.poolAddress,
    coverAddress: artifact.coverAddress,
    relayAddress: config.relayAddress,
    viewingPublicKey: plan.viewingPublicKey,
  });

  return {
    summary: makeSummary(
      config,
      artifact,
      plan,
      signedEstimate.overallFeeFri,
      poolIdentity,
      poolVersion,
      proofSummary,
    ),
    transactionHash,
    receipt,
  };
}
