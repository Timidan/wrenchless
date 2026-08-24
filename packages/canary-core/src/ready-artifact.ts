import { z } from "zod";

import {
  parseRefillFundArtifact,
  type RefillFundArtifact,
} from "./artifact.js";
import type { JsonValue } from "./json.js";

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
    refundPublicKey: z.string(),
    tokenAddress: z.string(),
    amountFri: z.string(),
    expiry: z.string(),
    createdAt: z.string(),
    prepared: readyPreparedCallSchema,
  })
  .strict();

export function normalizeReadyRefillFundArtifact(
  input: JsonValue,
): RefillFundArtifact {
  const value = readyPreparedRefillFundSchema.parse(input);
  return parseRefillFundArtifact({
    schemaVersion: "wrenchless.refill-fund.v1",
    chainId: "SN_MAIN",
    poolAddress: value.poolAddress,
    helperAddress: value.helperAddress,
    stateId: value.stateId,
    claimCommitment: value.claimCommitment,
    refundPublicKey: value.refundPublicKey,
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
