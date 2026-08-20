import { z } from "zod";

import {
  parseRegistrationArtifact,
  type RegistrationCanaryArtifact,
} from "./artifact.js";

const readyPreparedRegistrationSchema = z
  .object({
    coverAddress: z.string(),
    poolAddress: z.string(),
    createdAt: z.string(),
    prepared: z
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
      .strict(),
  })
  .strict();

export function normalizeReadyRegistrationArtifact(
  input: unknown,
): RegistrationCanaryArtifact {
  const value = readyPreparedRegistrationSchema.parse(input);
  return parseRegistrationArtifact({
    schemaVersion: "wrenchless.registration-canary.v1",
    chainId: "SN_MAIN",
    coverAddress: value.coverAddress,
    poolAddress: value.poolAddress,
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
