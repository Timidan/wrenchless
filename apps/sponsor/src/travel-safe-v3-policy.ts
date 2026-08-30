import {
  assertSubmittableProof,
  readPreparedServerActions,
  type JsonValue,
  type PreparedStrk20Call,
} from "@wrenchless/canary-core";
import { z } from "zod";

import type { SponsorConfig, TravelSafeTokenPolicy } from "./config.js";

const FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

const feltSchema = z
  .string()
  .regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/, "expected a canonical felt")
  .refine((value) => BigInt(value) < FIELD_PRIME, "felt exceeds the Stark field");
const nonZeroFeltSchema = feltSchema.refine((value) => BigInt(value) !== 0n);

function decimal(maximum: bigint, nonZero = false) {
  return z
    .string()
    .regex(/^(?:0|[1-9][0-9]*)$/)
    .refine((value) => BigInt(value) <= maximum)
    .refine((value) => !nonZero || BigInt(value) > 0n);
}

const callSchema = z
  .object({
    contractAddress: nonZeroFeltSchema,
    entrypoint: z.literal("apply_actions"),
    calldata: z.array(feltSchema).min(1),
  })
  .strict();

const commonArtifact = {
  schemaVersion: z.literal("wrenchless.travel-safe-relay.v3"),
  chainId: z.literal("SN_MAIN"),
  poolAddress: nonZeroFeltSchema,
  helperAddress: nonZeroFeltSchema,
  stateId: nonZeroFeltSchema,
  tokenAddress: nonZeroFeltSchema,
  amountBaseUnits: decimal(U128_MAX, true),
  /**
   * Ordinary funds the same transaction moves into the pool before spending
   * them. A deposit cannot travel on its own — it compiles to a TransferFrom
   * and an event, neither carrying a nullifier or a random, and the pool
   * refuses such a bundle as NO_REPLAY_PROTECTION — so it rides with the
   * withdrawal that funds the Safe. "0" when none is needed.
   *
   * Defaulted rather than required so a browser still running the previous
   * bundle keeps working across the deploy: an artifact without the field is
   * an artifact with no deposit, which is exactly the old behaviour.
   */
  depositBaseUnits: decimal(U128_MAX).default("0"),
  createdAt: z.iso.datetime(),
  call: callSchema,
  proof: z.string().trim().min(1),
  proofFacts: z.array(feltSchema).min(1),
};

const fundArtifactSchema = z
  .object({
    ...commonArtifact,
    operation: z.literal("FUND"),
    claimCommitment: nonZeroFeltSchema,
    deviceCommitment: nonZeroFeltSchema,
    recoveryCommitment: nonZeroFeltSchema,
    dailyAmountBaseUnits: decimal(U128_MAX),
    firstReleaseAt: decimal(U64_MAX),
    returnAt: decimal(U64_MAX, true),
  })
  .strict();

const topUpArtifactSchema = z
  .object({
    ...commonArtifact,
    operation: z.literal("TOP_UP"),
    nonce: decimal(U64_MAX),
    devicePublicKey: nonZeroFeltSchema,
    signatureR: nonZeroFeltSchema,
    signatureS: nonZeroFeltSchema,
  })
  .strict();

export const TravelSafeV3RelayArtifactSchema = z.discriminatedUnion("operation", [
  fundArtifactSchema,
  topUpArtifactSchema,
]);

export type TravelSafeV3RelayArtifact = z.infer<
  typeof TravelSafeV3RelayArtifactSchema
>;

export type TravelSafeV3PolicyResult = {
  artifact: TravelSafeV3RelayArtifact;
  tokenPolicy: TravelSafeTokenPolicy;
};

function same(actual: bigint, expected: string, label: string): void {
  if (actual !== BigInt(expected)) {
    throw new Error(`${label} does not match the prepared action`);
  }
}

function prepared(artifact: TravelSafeV3RelayArtifact): PreparedStrk20Call {
  return {
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
  };
}

function assertPreparedActions(artifact: TravelSafeV3RelayArtifact): void {
  const value = prepared(artifact);
  assertSubmittableProof(
    value,
    artifact.operation === "FUND" ? "FUND" : "TOP_UP",
  );
  const actions = readPreparedServerActions(value, artifact.poolAddress);
  const deposits = BigInt(artifact.depositBaseUnits) > 0n ? 1 : 0;
  if (
    actions.screening !== "None" ||
    actions.transfersTo.length !== 1 ||
    actions.invokes.length !== 1 ||
    actions.transfersFrom.length !== deposits
  ) {
    throw new Error("prepared action must contain one withdrawal and one helper invoke");
  }
  /**
   * A deposit compiles to a TransferFrom and a Deposit event ahead of the
   * withdrawal, so the accepted shapes double rather than change: the
   * withdrawal and the helper invoke still have to be exactly one each, in
   * that order, and nothing else may appear.
   */
  const withdrawalSequences = [
    [3n, 10n],
    [3n, 5n, 10n],
  ];
  const accepted = withdrawalSequences.map((sequence) =>
    deposits === 1 ? [2n, 6n, ...sequence] : sequence,
  );
  const matches = accepted.some(
    (sequence) =>
      sequence.length === actions.discriminants.length &&
      sequence.every((value, index) => actions.discriminants[index] === value),
  );
  if (!matches) {
    throw new Error("prepared action contains an unexpected server action");
  }
  if (deposits === 1) {
    const deposited = actions.transfersFrom[0]!;
    same(deposited.token, artifact.tokenAddress, "deposit token");
    same(deposited.amount, artifact.depositBaseUnits, "deposit amount");
    if (BigInt(deposited.amount) > BigInt(artifact.amountBaseUnits)) {
      throw new Error("deposit exceeds the amount being funded");
    }
  }
  const withdrawal = actions.transfersTo[0]!;
  const invoke = actions.invokes[0]!;
  if (withdrawal.actionIndex >= invoke.actionIndex || invoke.discriminant !== 10n) {
    throw new Error("prepared action order is invalid");
  }
  same(withdrawal.recipient, artifact.helperAddress, "withdrawal recipient");
  same(withdrawal.token, artifact.tokenAddress, "withdrawal token");
  same(withdrawal.amount, artifact.amountBaseUnits, "withdrawal amount");
  same(invoke.contractAddress, artifact.helperAddress, "helper address");

  const expected =
    artifact.operation === "FUND"
      ? [
          "0",
          artifact.stateId,
          artifact.claimCommitment,
          artifact.deviceCommitment,
          artifact.recoveryCommitment,
          artifact.tokenAddress,
          artifact.amountBaseUnits,
          artifact.dailyAmountBaseUnits,
          artifact.firstReleaseAt,
          artifact.returnAt,
        ]
      : [
          "2",
          artifact.stateId,
          artifact.tokenAddress,
          artifact.amountBaseUnits,
          artifact.nonce,
          artifact.devicePublicKey,
          artifact.signatureR,
          artifact.signatureS,
        ];
  if (invoke.calldata.length !== expected.length) {
    throw new Error("prepared helper calldata has the wrong length");
  }
  expected.forEach((expectedValue, index) => {
    same(invoke.calldata[index]!, expectedValue, `helper calldata ${index}`);
  });
}

export function parseTravelSafeV3RelayArtifact(
  value: JsonValue,
  config: Pick<
    SponsorConfig,
    | "poolAddress"
    | "travelSafeV3HelperAddress"
    | "travelSafeTokenPolicies"
  >,
): TravelSafeV3PolicyResult {
  const artifact = TravelSafeV3RelayArtifactSchema.parse(value);
  if (config.travelSafeV3HelperAddress === undefined) {
    throw new Error("Travel Safe v3 is not configured");
  }
  if (BigInt(artifact.poolAddress) !== BigInt(config.poolAddress)) {
    throw new Error("artifact pool does not match the configured pool");
  }
  if (BigInt(artifact.helperAddress) !== BigInt(config.travelSafeV3HelperAddress)) {
    throw new Error("artifact helper does not match the configured helper");
  }
  if (BigInt(artifact.call.contractAddress) !== BigInt(config.poolAddress)) {
    throw new Error("prepared call targets the wrong privacy pool");
  }
  const tokenPolicy = config.travelSafeTokenPolicies.find(
    (policy) => BigInt(policy.address) === BigInt(artifact.tokenAddress),
  );
  if (tokenPolicy === undefined) {
    throw new Error("token is not enabled for Travel Safe");
  }
  const amount = BigInt(artifact.amountBaseUnits);
  if (
    amount < BigInt(tokenPolicy.minAmountBaseUnits) ||
    amount > BigInt(tokenPolicy.maxAmountBaseUnits)
  ) {
    throw new Error("amount is outside the token policy");
  }
  if (artifact.operation === "FUND") {
    if (BigInt(artifact.dailyAmountBaseUnits) > amount) {
      throw new Error("daily amount exceeds the Safe amount");
    }
    if (BigInt(artifact.firstReleaseAt) > BigInt(artifact.returnAt)) {
      throw new Error("first release is after the return date");
    }
    if (
      BigInt(artifact.dailyAmountBaseUnits) === 0n &&
      BigInt(artifact.firstReleaseAt) !== BigInt(artifact.returnAt)
    ) {
      throw new Error("single-return Safe has an invalid schedule");
    }
  }
  assertPreparedActions(artifact);
  return { artifact, tokenPolicy };
}
