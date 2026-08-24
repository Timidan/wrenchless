import {
  assertRefillFundProofFacts,
  buildRefillFundRelayPlan,
  type RefillFundArtifact,
  type RefillFundRelayPlan,
} from "@wrenchless/canary-core";
import type { ResourceBoundsBN } from "starknet";

import type { RelayCanaryConfig } from "./config.js";
import { assertRelayFeeWithinCap, type RelayFeeEstimate } from "./inspect.js";

export type RefillFundFinalityRequest = {
  transactionHash: string;
  poolAddress: string;
  helperAddress: string;
  relayAddress: string;
  stateId: string;
  claimCommitment: string;
  refundPublicKey: string;
  tokenAddress: string;
  amountFri: string;
  expiry: string;
};

export type RefillFundFinalityEvidence = {
  transactionHash: string;
  blockNumber: string;
  finalityStatus: "ACCEPTED_ON_L2" | "ACCEPTED_ON_L1";
  executionStatus: "SUCCEEDED";
  senderAddress: string;
  actualFeeFri: string;
  helperAddress: string;
  stateId: string;
  tokenAddress: string;
  amountFri: string;
  expiry: string;
  totalLiabilityFri: string;
  helperBalanceFri: string;
};

export class RefillFundFinalityUnknownError extends Error {
  constructor(
    readonly transactionHash: string,
    options: ErrorOptions = {},
  ) {
    super("refill FUND finality is not visible yet", options);
    this.name = "RefillFundFinalityUnknownError";
  }
}

export type RefillFundClient = {
  assertPoolInterface(poolAddress: string): Promise<{
    chainId: "SN_MAIN";
    classHash: string;
  }>;
  assertRefillHelper(
    helperAddress: string,
    poolAddress: string,
    tokenAddress: string,
  ): Promise<{ classHash: string }>;
  readPoolVersion(poolAddress: string): Promise<string>;
  readLatestBlockNumber(): Promise<bigint>;
  readLatestBlockTimestamp(): Promise<bigint>;
  readProofValidityBlocks(poolAddress: string): Promise<bigint>;
  readBlockHash(blockNumber: bigint): Promise<string>;
  readPoolPaused(poolAddress: string): Promise<boolean>;
  readPoolFeeFri(poolAddress: string): Promise<bigint>;
  readRelayBalanceFri(strkAddress: string, relayAddress: string): Promise<bigint>;
  readRefillStateExists(helperAddress: string, stateId: string): Promise<boolean>;
  estimateUnsigned(
    plan: RefillFundRelayPlan,
    artifact: RefillFundArtifact,
  ): Promise<RelayFeeEstimate>;
  estimateSigned(
    plan: RefillFundRelayPlan,
    artifact: RefillFundArtifact,
    privateKey: string,
  ): Promise<RelayFeeEstimate>;
  broadcast(
    plan: RefillFundRelayPlan,
    artifact: RefillFundArtifact,
    privateKey: string,
    resourceBounds: ResourceBoundsBN,
  ): Promise<string>;
  waitForRefillFundFinality(
    input: RefillFundFinalityRequest,
  ): Promise<RefillFundFinalityEvidence>;
};

export type RefillFundInspectionSummary = {
  mode: "dry-run" | "broadcast";
  poolAddress: string;
  poolClassHash: string;
  poolVersion: string;
  helperAddress: string;
  helperClassHash: string;
  stateId: string;
  tokenAddress: string;
  amountFri: string;
  expiry: string;
  relayAddress: string;
  poolPaused: false;
  poolFeeFri: string;
  estimatedTransactionFeeFri: string;
  maxTransactionFeeFri: string;
  maxSpendFri: string;
  proofBaseBlock: string;
  proofExpiresAtBlock: string;
  proofRemainingBlocks: string;
};

type RefillFundInspectionInput = {
  artifact: RefillFundArtifact;
  config: RelayCanaryConfig;
  configuredHelperAddress: string;
  client: RefillFundClient;
  minimumAmountFri?: bigint;
  minimumRemainingDurationSeconds?: bigint;
  beforeBroadcast?: (maximumSpendFri: bigint) => Promise<void>;
};

export async function inspectRefillFund(
  input: RefillFundInspectionInput,
): Promise<{
  summary: RefillFundInspectionSummary;
  transactionHash?: string;
  receipt?: RefillFundFinalityEvidence;
}> {
  const { artifact, config, configuredHelperAddress, client } = input;
  const [poolIdentity, helperIdentity] = await Promise.all([
    client.assertPoolInterface(config.poolAddress),
    client.assertRefillHelper(
      configuredHelperAddress,
      config.poolAddress,
      config.strkAddress,
    ),
  ]);
  const [
    poolVersion,
    latestBlockNumber,
    latestBlockTimestamp,
    proofValidityBlocks,
    poolPaused,
    poolFeeFri,
    relayBalanceFri,
    stateExists,
  ] = await Promise.all([
    client.readPoolVersion(config.poolAddress),
    client.readLatestBlockNumber(),
    client.readLatestBlockTimestamp(),
    client.readProofValidityBlocks(config.poolAddress),
    client.readPoolPaused(config.poolAddress),
    client.readPoolFeeFri(config.poolAddress),
    client.readRelayBalanceFri(config.strkAddress, config.relayAddress),
    client.readRefillStateExists(configuredHelperAddress, artifact.stateId),
  ]);
  if (poolPaused) {
    throw new Error("pool is paused");
  }
  if (stateExists) {
    throw new Error("refill state already exists");
  }
  if (BigInt(artifact.expiry) <= latestBlockTimestamp) {
    throw new Error("refill ticket is already expired");
  }
  if (
    input.minimumAmountFri !== undefined &&
    BigInt(artifact.amountFri) < input.minimumAmountFri
  ) {
    throw new Error("refill amount is below the sponsor minimum");
  }
  if (
    input.minimumRemainingDurationSeconds !== undefined &&
    BigInt(artifact.expiry) - latestBlockTimestamp <
      input.minimumRemainingDurationSeconds
  ) {
    throw new Error("refill duration is below the sponsor minimum");
  }

  const proofSummary = assertRefillFundProofFacts({
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

  const plan = buildRefillFundRelayPlan({
    artifact,
    configuredPoolAddress: config.poolAddress,
    configuredHelperAddress,
    strkAddress: config.strkAddress,
    relayAddress: config.relayAddress,
    poolFeeFri,
    maxPoolFeeFri: config.maxPoolFeeFri,
    maxTransactionFeeFri: config.maxTransactionFeeFri,
    relayBalanceFri,
  });
  const unsignedEstimate = await client.estimateUnsigned(plan, artifact);
  assertRelayFeeWithinCap(unsignedEstimate, config.maxTransactionFeeFri, "estimated");

  let estimatedFee = unsignedEstimate;
  let transactionHash: string | undefined;
  let receipt: RefillFundFinalityEvidence | undefined;
  if (config.broadcast) {
    if (config.relayPrivateKey === undefined) {
      throw new Error("relay private key is required for broadcast");
    }
    estimatedFee = await client.estimateSigned(
      plan,
      artifact,
      config.relayPrivateKey,
    );
    assertRelayFeeWithinCap(estimatedFee, config.maxTransactionFeeFri, "signed");
    await input.beforeBroadcast?.(plan.maxSpendFri);
    transactionHash = await client.broadcast(
      plan,
      artifact,
      config.relayPrivateKey,
      estimatedFee.resourceBounds,
    );
    try {
      receipt = await client.waitForRefillFundFinality({
        transactionHash,
        poolAddress: config.poolAddress,
        helperAddress: configuredHelperAddress,
        relayAddress: config.relayAddress,
        stateId: artifact.stateId,
        claimCommitment: artifact.claimCommitment,
        refundPublicKey: artifact.refundPublicKey,
        tokenAddress: artifact.tokenAddress,
        amountFri: artifact.amountFri,
        expiry: artifact.expiry,
      });
    } catch {
      // Submission already returned a transaction hash. Finality, RPC, and
      // post-state reads are reconciled by hash; none is safe grounds to
      // prepare and broadcast a second FUND transaction.
    }
  }

  const summary: RefillFundInspectionSummary = {
    mode: config.broadcast ? "broadcast" : "dry-run",
    poolAddress: config.poolAddress,
    poolClassHash: poolIdentity.classHash,
    poolVersion,
    helperAddress: configuredHelperAddress,
    helperClassHash: helperIdentity.classHash,
    stateId: artifact.stateId,
    tokenAddress: artifact.tokenAddress,
    amountFri: artifact.amountFri,
    expiry: artifact.expiry,
    relayAddress: config.relayAddress,
    poolPaused: false,
    poolFeeFri: plan.poolFeeFri.toString(),
    estimatedTransactionFeeFri: estimatedFee.overallFeeFri.toString(),
    maxTransactionFeeFri: config.maxTransactionFeeFri.toString(),
    maxSpendFri: plan.maxSpendFri.toString(),
    proofBaseBlock: proofSummary.baseBlockNumber.toString(),
    proofExpiresAtBlock: proofSummary.expiresAtBlock.toString(),
    proofRemainingBlocks: proofSummary.remainingBlocks.toString(),
  };

  if (transactionHash !== undefined && receipt !== undefined) {
    return { summary, transactionHash, receipt };
  }
  if (transactionHash !== undefined) return { summary, transactionHash };
  return { summary };
}
