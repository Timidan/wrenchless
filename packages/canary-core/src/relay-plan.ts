import type { Call } from "starknet";

import type { RegistrationCanaryArtifact } from "./artifact.js";
import { assertRegistrationOnly } from "./pool-call.js";

const U128_MASK = (1n << 128n) - 1n;

export type RegistrationRelayPlanInput = {
  artifact: RegistrationCanaryArtifact;
  configuredPoolAddress: string;
  strkAddress: string;
  relayAddress: string;
  poolFeeFri: bigint;
  maxPoolFeeFri: bigint;
  maxTransactionFeeFri: bigint;
  relayBalanceFri: bigint;
};

export type RegistrationRelayPlan = {
  calls: [Call, Call];
  relayAddress: string;
  poolFeeFri: bigint;
  maxTransactionFeeFri: bigint;
  maxSpendFri: bigint;
};

export function buildRegistrationRelayPlan(
  input: RegistrationRelayPlanInput,
): RegistrationRelayPlan {
  const {
    artifact,
    configuredPoolAddress,
    strkAddress,
    relayAddress,
    poolFeeFri,
    maxPoolFeeFri,
    maxTransactionFeeFri,
    relayBalanceFri,
  } = input;

  if (BigInt(artifact.poolAddress) !== BigInt(configuredPoolAddress)) {
    throw new Error("artifact pool does not match configured pool");
  }
  if (poolFeeFri <= 0n) {
    throw new Error("pool fee must be positive");
  }
  if (poolFeeFri > maxPoolFeeFri) {
    throw new Error("pool fee exceeds configured cap");
  }
  if (maxTransactionFeeFri <= 0n) {
    throw new Error("maximum transaction fee must be positive");
  }

  assertRegistrationOnly(artifact.call.calldata, artifact.coverAddress);

  const maxSpendFri = poolFeeFri + maxTransactionFeeFri;
  if (relayBalanceFri < maxSpendFri) {
    throw new Error("relay balance is below maximum spend");
  }

  const approveCall: Call = {
    contractAddress: strkAddress,
    entrypoint: "approve",
    calldata: [
      configuredPoolAddress,
      (poolFeeFri & U128_MASK).toString(),
      (poolFeeFri >> 128n).toString(),
    ],
  };
  const applyActionsCall: Call = {
    contractAddress: artifact.call.contractAddress,
    entrypoint: artifact.call.entrypoint,
    calldata: [...artifact.call.calldata],
  };

  return {
    calls: [approveCall, applyActionsCall],
    relayAddress,
    poolFeeFri,
    maxTransactionFeeFri,
    maxSpendFri,
  };
}
