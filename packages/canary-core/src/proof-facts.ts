import { ec, shortString } from "starknet";

import type {
  RefillFundArtifact,
  RegistrationCanaryArtifact,
} from "./artifact.js";
import { assertRegistrationOnly } from "./pool-call.js";
import { assertPreparedRefillFund } from "./refill-claim.js";

export const STRK20_SUPPORTED_PROOF_VERSIONS = [
  shortString.encodeShortString("PROOF0"),
  shortString.encodeShortString("PROOF1"),
] as const;
const VIRTUAL_SNOS = shortString.encodeShortString("VIRTUAL_SNOS");
const VIRTUAL_SNOS0 = shortString.encodeShortString("VIRTUAL_SNOS0");
const DEFAULT_MINIMUM_REMAINING_BLOCKS = 60n;

export type RegistrationProofFactsSummary = {
  baseBlockNumber: bigint;
  baseBlockHash: string;
  expiresAtBlock: bigint;
  remainingBlocks: bigint;
};

export type RefillFundProofFactsSummary = RegistrationProofFactsSummary;

type ProofBoundArtifact = {
  poolAddress: string;
  call: { calldata: readonly string[] };
  proofFacts: readonly string[];
};

type CommonProofFactsInput = {
  artifact: ProofBoundArtifact;
  poolClassHash: string;
  latestBlockNumber: bigint;
  proofValidityBlocks: bigint;
  minimumRemainingBlocks?: bigint;
};

type ProofFactsInput = {
  artifact: RegistrationCanaryArtifact;
  poolClassHash: string;
  latestBlockNumber: bigint;
  proofValidityBlocks: bigint;
  minimumRemainingBlocks?: bigint;
};

function assertFeltEqual(
  actual: string,
  expected: string | bigint,
  message: string,
): void {
  if (BigInt(actual) !== BigInt(expected)) {
    throw new Error(message);
  }
}

function assertStrk20ProofFacts(
  input: CommonProofFactsInput,
  bindingLabel: "registration call" | "FUND call",
): RegistrationProofFactsSummary {
  const {
    artifact,
    poolClassHash,
    latestBlockNumber,
    proofValidityBlocks,
    minimumRemainingBlocks = DEFAULT_MINIMUM_REMAINING_BLOCKS,
  } = input;
  const facts = artifact.proofFacts;
  if (facts.length !== 9) {
    throw new Error("expected exactly nine proof facts");
  }
  const [
    proofVersion,
    programVariant,
    virtualProgramHash,
    osOutputVersion,
    baseBlockNumberValue,
    baseBlockHash,
    ,
    messageCount,
    messageHash,
  ] = facts;
  if (
    proofVersion === undefined ||
    programVariant === undefined ||
    virtualProgramHash === undefined ||
    osOutputVersion === undefined ||
    baseBlockNumberValue === undefined ||
    baseBlockHash === undefined ||
    messageCount === undefined ||
    messageHash === undefined
  ) {
    throw new Error("proof facts are incomplete");
  }

  if (
    !STRK20_SUPPORTED_PROOF_VERSIONS.some(
      (version) => BigInt(version) === BigInt(proofVersion),
    )
  ) {
    throw new Error("proof facts version is not supported");
  }
  assertFeltEqual(
    programVariant,
    VIRTUAL_SNOS,
    "proof program variant is incompatible",
  );
  if (BigInt(virtualProgramHash) === 0n) {
    throw new Error("proof virtual program hash must be non-zero");
  }
  assertFeltEqual(
    osOutputVersion,
    VIRTUAL_SNOS0,
    "proof OS output version is incompatible",
  );
  assertFeltEqual(messageCount, 1n, "proof must contain exactly one L2 message");

  if (BigInt(artifact.call.calldata.at(-1) ?? "0x0") !== 1n) {
    throw new Error("proof-bearing call must use no screening attestation");
  }
  const serializedServerActions = artifact.call.calldata.slice(0, -1);
  const payload = [poolClassHash, ...serializedServerActions];
  const expectedMessageHash = ec.starkCurve.poseidonHashMany([
    BigInt(artifact.poolAddress),
    0n,
    BigInt(payload.length),
    ...payload.map(BigInt),
  ]);
  assertFeltEqual(
    messageHash,
    expectedMessageHash,
    `proof message is not bound to this ${bindingLabel}`,
  );

  if (proofValidityBlocks <= 0n) {
    throw new Error("proof validity interval must be positive");
  }
  if (minimumRemainingBlocks < 0n) {
    throw new Error("minimum remaining blocks cannot be negative");
  }
  const baseBlockNumber = BigInt(baseBlockNumberValue);
  if (baseBlockNumber >= latestBlockNumber) {
    throw new Error("proof base block must be older than latest");
  }
  const expiresAtBlock = baseBlockNumber + proofValidityBlocks;
  const remainingBlocks = expiresAtBlock - latestBlockNumber;
  if (remainingBlocks < minimumRemainingBlocks) {
    throw new Error("proof has too few blocks remaining");
  }

  return {
    baseBlockNumber,
    baseBlockHash,
    expiresAtBlock,
    remainingBlocks,
  };
}

export function assertPreparedStrk20ProofFacts(
  input: CommonProofFactsInput,
): RegistrationProofFactsSummary {
  return assertStrk20ProofFacts(input, "FUND call");
}

export function assertRegistrationProofFacts(
  input: ProofFactsInput,
): RegistrationProofFactsSummary {
  assertRegistrationOnly(input.artifact.call.calldata, input.artifact.coverAddress);
  return assertStrk20ProofFacts(input, "registration call");
}

type RefillFundProofFactsInput = Omit<ProofFactsInput, "artifact"> & {
  artifact: RefillFundArtifact;
};

export function assertRefillFundProofFacts(
  input: RefillFundProofFactsInput,
): RefillFundProofFactsSummary {
  const artifact = input.artifact;
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
      recoveryCommitment: artifact.recoveryCommitment,
      recoveryAccount: artifact.recoveryAccount,
      recoverySalt: artifact.recoverySalt,
      token: artifact.tokenAddress,
      amount: artifact.amountFri,
      expiry: artifact.expiry,
    },
  );
  return assertStrk20ProofFacts(input, "FUND call");
}
