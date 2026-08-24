import type { Call } from "starknet";

import type {
  RefillFundArtifact,
  RegistrationCanaryArtifact,
} from "./artifact.js";
import { assertRegistrationOnly } from "./pool-call.js";
import { assertPreparedRefillFund } from "./refill-claim.js";

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
  viewingPublicKey: string;
  poolFeeFri: bigint;
  maxTransactionFeeFri: bigint;
  maxSpendFri: bigint;
};

export type RefillFundRelayPlanInput = {
  artifact: RefillFundArtifact;
  configuredPoolAddress: string;
  configuredHelperAddress: string;
  strkAddress: string;
  relayAddress: string;
  poolFeeFri: bigint;
  maxPoolFeeFri: bigint;
  maxTransactionFeeFri: bigint;
  relayBalanceFri: bigint;
};

export type RefillFundRelayPlan = {
  calls: [Call, Call];
  relayAddress: string;
  helperAddress: string;
  stateId: string;
  tokenAddress: string;
  amountFri: bigint;
  expiry: bigint;
  poolFeeFri: bigint;
  maxTransactionFeeFri: bigint;
  maxSpendFri: bigint;
};

function assertRelayBudget(input: {
  poolFeeFri: bigint;
  maxPoolFeeFri: bigint;
  maxTransactionFeeFri: bigint;
  relayBalanceFri: bigint;
}): bigint {
  if (input.poolFeeFri <= 0n) {
    throw new Error("pool fee must be positive");
  }
  if (input.poolFeeFri > input.maxPoolFeeFri) {
    throw new Error("pool fee exceeds configured cap");
  }
  if (input.maxTransactionFeeFri <= 0n) {
    throw new Error("maximum transaction fee must be positive");
  }
  const maxSpendFri = input.poolFeeFri + input.maxTransactionFeeFri;
  if (input.relayBalanceFri < maxSpendFri) {
    throw new Error("relay balance is below maximum spend");
  }
  return maxSpendFri;
}

function buildRelayCalls(input: {
  poolAddress: string;
  strkAddress: string;
  poolFeeFri: bigint;
  call: RegistrationCanaryArtifact["call"];
}): [Call, Call] {
  return [
    {
      contractAddress: input.strkAddress,
      entrypoint: "approve",
      calldata: [
        input.poolAddress,
        (input.poolFeeFri & U128_MASK).toString(),
        (input.poolFeeFri >> 128n).toString(),
      ],
    },
    {
      contractAddress: input.call.contractAddress,
      entrypoint: input.call.entrypoint,
      calldata: [...input.call.calldata],
    },
  ];
}

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
  const registration = assertRegistrationOnly(
    artifact.call.calldata,
    artifact.coverAddress,
  );
  const maxSpendFri = assertRelayBudget({
    poolFeeFri,
    maxPoolFeeFri,
    maxTransactionFeeFri,
    relayBalanceFri,
  });

  return {
    calls: buildRelayCalls({
      poolAddress: configuredPoolAddress,
      strkAddress,
      poolFeeFri,
      call: artifact.call,
    }),
    relayAddress,
    viewingPublicKey: registration.viewingPublicKey,
    poolFeeFri,
    maxTransactionFeeFri,
    maxSpendFri,
  };
}

export function buildRefillFundRelayPlan(
  input: RefillFundRelayPlanInput,
): RefillFundRelayPlan {
  const {
    artifact,
    configuredPoolAddress,
    configuredHelperAddress,
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
  if (BigInt(artifact.helperAddress) !== BigInt(configuredHelperAddress)) {
    throw new Error("artifact helper does not match configured helper");
  }
  assertPreparedRefillFund(
    {
      call: {
        contract_address: artifact.call.contractAddress,
        entry_point: artifact.call.entrypoint,
        calldata: artifact.call.calldata,
      },
      proof: {
        data: artifact.proof,
        output: [],
        proof_facts: artifact.proofFacts,
      },
    },
    {
      poolAddress: artifact.poolAddress,
      helperAddress: artifact.helperAddress,
      stateId: artifact.stateId,
      claimCommitment: artifact.claimCommitment,
      refundPublicKey: artifact.refundPublicKey,
      token: artifact.tokenAddress,
      amount: artifact.amountFri,
      expiry: artifact.expiry,
    },
  );
  const maxSpendFri = assertRelayBudget({
    poolFeeFri,
    maxPoolFeeFri,
    maxTransactionFeeFri,
    relayBalanceFri,
  });

  return {
    calls: buildRelayCalls({
      poolAddress: configuredPoolAddress,
      strkAddress,
      poolFeeFri,
      call: artifact.call,
    }),
    relayAddress,
    helperAddress: artifact.helperAddress,
    stateId: artifact.stateId,
    tokenAddress: artifact.tokenAddress,
    amountFri: BigInt(artifact.amountFri),
    expiry: BigInt(artifact.expiry),
    poolFeeFri,
    maxTransactionFeeFri,
    maxSpendFri,
  };
}
