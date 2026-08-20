import { z } from "zod";

const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;

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

export function parseRegistrationArtifact(
  input: unknown,
): RegistrationCanaryArtifact {
  return RegistrationCanaryArtifactSchema.parse(input);
}
