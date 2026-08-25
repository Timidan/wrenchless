import { z } from "zod";

import type { JsonValue } from "./json.js";
import { assertPreparedRefillFund } from "./refill-claim.js";

const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

const feltSchema = z
  .string()
  .regex(/^0x[0-9a-f]+$/, "expected a lowercase 0x-prefixed hexadecimal felt")
  .refine((value) => BigInt(value) < STARK_FIELD_PRIME, "felt exceeds the Stark field");

const callSchema = z
  .object({
    contractAddress: feltSchema,
    entrypoint: z.literal("apply_actions"),
    calldata: z.array(feltSchema).min(1),
  })
  .strict();

function boundedDecimalSchema(maximum: bigint, label: string) {
  return z
    .string()
    .regex(/^(?:0|[1-9][0-9]*)$/, `expected a canonical decimal ${label}`)
    .refine((value) => BigInt(value) <= maximum, `${label} is too large`);
}

const u64DecimalSchema = boundedDecimalSchema(U64_MAX, "u64");
const u128DecimalSchema = boundedDecimalSchema(U128_MAX, "u128");

export const RegistrationCanaryArtifactSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.registration-canary.v1"),
    chainId: z.literal("SN_MAIN"),
    coverAddress: feltSchema,
    poolAddress: feltSchema,
    createdAt: z.iso.datetime(),
    call: callSchema,
    proof: z.string().trim().min(1),
    proofFacts: z.array(feltSchema).min(1),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (BigInt(artifact.call.contractAddress) !== BigInt(artifact.poolAddress)) {
      context.addIssue({
        code: "custom",
        message: "call target does not match the declared pool",
        path: ["call", "contractAddress"],
      });
    }
  });

export type RegistrationCanaryArtifact = z.infer<
  typeof RegistrationCanaryArtifactSchema
>;

export const RefillFundArtifactSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.refill-fund.v2"),
    chainId: z.literal("SN_MAIN"),
    poolAddress: feltSchema,
    helperAddress: feltSchema,
    stateId: feltSchema.refine((value) => BigInt(value) !== 0n, {
      message: "state id must be non-zero",
    }),
    claimCommitment: feltSchema.refine((value) => BigInt(value) !== 0n, {
      message: "claim commitment must be non-zero",
    }),
    recoveryCommitment: feltSchema.refine((value) => BigInt(value) !== 0n, {
      message: "recovery commitment must be non-zero",
    }),
    recoveryAccount: feltSchema.refine((value) => BigInt(value) !== 0n, {
      message: "recovery account must be non-zero",
    }),
    recoverySalt: feltSchema.refine((value) => BigInt(value) !== 0n, {
      message: "recovery salt must be non-zero",
    }),
    recoveryAuthorization: z.array(feltSchema).min(1).max(64),
    tokenAddress: feltSchema,
    amountFri: u128DecimalSchema.refine((value) => BigInt(value) !== 0n, {
      message: "amount must be non-zero",
    }),
    expiry: u64DecimalSchema,
    createdAt: z.iso.datetime(),
    call: callSchema,
    proof: z.string().trim().min(1),
    proofFacts: z.array(feltSchema).min(1),
  })
  .strict()
  .superRefine((artifact, context) => {
    try {
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
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error
            ? error.message
            : "prepared FUND call is invalid",
        path: ["call", "calldata"],
      });
    }
  });

export type RefillFundArtifact = z.infer<typeof RefillFundArtifactSchema>;

export function parseRegistrationArtifact(
  input: JsonValue,
): RegistrationCanaryArtifact {
  return RegistrationCanaryArtifactSchema.parse(input);
}

export function parseRefillFundArtifact(input: JsonValue): RefillFundArtifact {
  return RefillFundArtifactSchema.parse(input);
}
