import { z } from "zod";

import {
  parseRefillFundArtifact,
  type RefillFundArtifact,
} from "./artifact.js";
import type { JsonValue } from "./json.js";

const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;

const readySignatureSchema = z
  .array(
    z
      .string()
      .regex(
        /^(?:0x[0-9a-fA-F]+|(?:0|[1-9][0-9]*))$/,
        "expected a hexadecimal or decimal felt",
      )
      .transform((value) => `0x${BigInt(value).toString(16)}`)
      .refine(
        (value) => BigInt(value) < STARK_FIELD_PRIME,
        "felt exceeds the Stark field",
      ),
  )
  .min(1)
  .max(64);

const readyPreparedCallSchema = z
  .object({
    call: z
      .object({
        contract_address: z.string(),
        entry_point: z.literal("apply_actions"),
        calldata: z.array(z.string()).min(1),
      })
      .strict(),
    proof: z
      .object({
        data: z.string().trim().min(1),
        output: z.array(z.string()),
        proof_facts: z.array(z.string()).min(1),
      })
      .strict(),
  })
  .strict();

const readyPreparedRefillFundSchema = z
  .object({
    poolAddress: z.string(),
    helperAddress: z.string(),
    stateId: z.string(),
    claimCommitment: z.string(),
    recoveryCommitment: z.string(),
    recoveryAccount: z.string(),
    recoverySalt: z.string(),
    recoveryAuthorization: z.array(z.string()).min(1).max(64),
    tokenAddress: z.string(),
    amountFri: z.string(),
    expiry: z.string(),
    createdAt: z.string(),
    prepared: readyPreparedCallSchema,
  })
  .strict();

export function normalizeReadySignature(
  signature: readonly string[],
): string[] {
  return readySignatureSchema.parse(signature);
}

export function normalizeReadyRefillFundArtifact(
  input: JsonValue,
): RefillFundArtifact {
  const value = readyPreparedRefillFundSchema.parse(input);
  return parseRefillFundArtifact({
    schemaVersion: "wrenchless.refill-fund.v2",
    chainId: "SN_MAIN",
    poolAddress: value.poolAddress,
    helperAddress: value.helperAddress,
    stateId: value.stateId,
    claimCommitment: value.claimCommitment,
    recoveryCommitment: value.recoveryCommitment,
    recoveryAccount: value.recoveryAccount,
    recoverySalt: value.recoverySalt,
    recoveryAuthorization: normalizeReadySignature(
      value.recoveryAuthorization,
    ),
    tokenAddress: value.tokenAddress,
    amountFri: value.amountFri,
    expiry: value.expiry,
    createdAt: value.createdAt,
    call: {
      contractAddress: value.prepared.call.contract_address,
      entrypoint: value.prepared.call.entry_point,
      calldata: value.prepared.call.calldata,
    },
    proof: value.prepared.proof.data,
    proofFacts: value.prepared.proof.proof_facts,
  });
}
