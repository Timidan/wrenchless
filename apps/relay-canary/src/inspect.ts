import {
  buildRegistrationRelayPlan,
  type RegistrationCanaryArtifact,
  type RegistrationRelayPlan,
} from "@wrenchless/canary-core";

import type { RelayCanaryConfig } from "./config.js";

export type RelayFeeEstimate = {
  overallFeeFri: bigint;
  resourceBounds: unknown;
};

export type RegistrationCanaryClient = {
  assertPoolInterface(poolAddress: string): Promise<{
    chainId: "SN_MAIN";
    classHash: string;
  }>;
  readPoolVersion(poolAddress: string): Promise<string>;
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
    resourceBounds: unknown,
  ): Promise<string>;
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
};

type InspectionInput = {
  artifact: RegistrationCanaryArtifact;
  config: RelayCanaryConfig;
  client: RegistrationCanaryClient;
};

function assertFeeWithinCap(
  fee: bigint,
  cap: bigint,
  label: "estimated" | "signed",
): void {
  if (fee <= 0n) {
    throw new Error(`${label} transaction fee must be positive`);
  }
  if (fee > cap) {
    throw new Error(`${label} transaction fee exceeds configured cap`);
  }
}

function makeSummary(
  config: RelayCanaryConfig,
  artifact: RegistrationCanaryArtifact,
  plan: RegistrationRelayPlan,
  estimatedFeeFri: bigint,
  poolIdentity: { chainId: "SN_MAIN"; classHash: string },
  poolVersion: string,
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
  };
}

export async function inspectRegistrationCanary(
  input: InspectionInput,
): Promise<{ summary: InspectionSummary; transactionHash?: string }> {
  const { artifact, config, client } = input;

  const poolIdentity = await client.assertPoolInterface(config.poolAddress);
  const [poolVersion, poolPaused, poolFeeFri, coverPublicKey, relayBalanceFri] =
    await Promise.all([
      client.readPoolVersion(config.poolAddress),
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
  assertFeeWithinCap(
    unsignedEstimate.overallFeeFri,
    config.maxTransactionFeeFri,
    "estimated",
  );

  if (!config.broadcast) {
    return {
      summary: makeSummary(
        config,
        artifact,
        plan,
        unsignedEstimate.overallFeeFri,
        poolIdentity,
        poolVersion,
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
  assertFeeWithinCap(
    signedEstimate.overallFeeFri,
    config.maxTransactionFeeFri,
    "signed",
  );

  const transactionHash = await client.broadcast(
    plan,
    artifact,
    config.relayPrivateKey,
    signedEstimate.resourceBounds,
  );

  return {
    summary: makeSummary(
      config,
      artifact,
      plan,
      signedEstimate.overallFeeFri,
      poolIdentity,
      poolVersion,
    ),
    transactionHash,
  };
}
