import { constants, ec, hash, shortString } from "starknet";

import type { RegistrationCanaryArtifact } from "./artifact.js";
import { assertRegistrationOnly } from "./pool-call.js";

const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const STARKNET_OS_CONFIG_HASH_VERSION =
  "0x537461726b6e65744f73436f6e66696733";
const PROOF_VERSION = shortString.encodeShortString("PROOF0");
const VIRTUAL_SNOS = shortString.encodeShortString("VIRTUAL_SNOS");
const VIRTUAL_SNOS0 = shortString.encodeShortString("VIRTUAL_SNOS0");
const DEFAULT_MINIMUM_REMAINING_BLOCKS = 60n;

export type RegistrationProofFactsSummary = {
  baseBlockNumber: bigint;
  baseBlockHash: string;
  expiresAtBlock: bigint;
  remainingBlocks: bigint;
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

export function assertRegistrationProofFacts(
  input: ProofFactsInput,
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
    configHash,
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
    configHash === undefined ||
    messageCount === undefined ||
    messageHash === undefined
  ) {
    throw new Error("proof facts are incomplete");
  }

  assertFeltEqual(
    proofVersion,
    PROOF_VERSION,
    "proof version is incompatible",
  );
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

  const expectedConfigHash = hash.computeHashOnElements([
    STARKNET_OS_CONFIG_HASH_VERSION,
    constants.StarknetChainId.SN_MAIN,
    STRK_TOKEN_ADDRESS,
  ]);
  assertFeltEqual(
    configHash,
    expectedConfigHash,
    "proof configuration is not Starknet mainnet",
  );

  assertRegistrationOnly(artifact.call.calldata, artifact.coverAddress);
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
    "proof message is not bound to this registration call",
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
