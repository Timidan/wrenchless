import { z } from "zod";

const publicGuardianFields = {
  guardianPublicKey: z.string().regex(/^04[0-9a-f]{128}$/),
  guardianFingerprint: z
    .string()
    .regex(/^[0-9a-f]{4}(?:-[0-9a-f]{4}){4}$/),
  mailboxUrl: z.url(),
  mailboxId: z.string().regex(/^[0-9a-f]{32}$/),
};

const guardianEnrollmentBundleSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.guardian-enrollment.v2"),
    ...publicGuardianFields,
    mailboxBindCapability: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

const coverEnrollmentBundleSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.cover-enrollment.v2"),
    ...publicGuardianFields,
    coverAlias: z.string().trim().min(1).max(48),
    responseInstruction: z.string().trim().min(1).max(160).nullable(),
  })
  .strict();

export type GuardianEnrollmentBundle = z.infer<
  typeof guardianEnrollmentBundleSchema
>;
export type CoverEnrollmentBundle = z.infer<
  typeof coverEnrollmentBundleSchema
>;

function parseJson(text: string) {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    throw new Error("The enrollment bundle is not valid JSON");
  }
}

export function createGuardianEnrollmentBundle(input: Omit<
  GuardianEnrollmentBundle,
  "schemaVersion"
>): GuardianEnrollmentBundle {
  return guardianEnrollmentBundleSchema.parse({
    schemaVersion: "wrenchless.guardian-enrollment.v2",
    ...input,
  });
}

export function parseGuardianEnrollmentBundle(
  text: string,
): GuardianEnrollmentBundle {
  try {
    return guardianEnrollmentBundleSchema.parse(parseJson(text));
  } catch (error) {
    if (error instanceof Error && error.message.includes("valid JSON")) {
      throw error;
    }
    throw new Error("The guardian enrollment bundle is invalid");
  }
}

export function createCoverEnrollmentBundle(input: Omit<
  CoverEnrollmentBundle,
  "schemaVersion"
>): CoverEnrollmentBundle {
  return coverEnrollmentBundleSchema.parse({
    schemaVersion: "wrenchless.cover-enrollment.v2",
    ...input,
  });
}

export function parseCoverEnrollmentBundle(
  text: string,
): CoverEnrollmentBundle {
  try {
    return coverEnrollmentBundleSchema.parse(parseJson(text));
  } catch (error) {
    if (error instanceof Error && error.message.includes("valid JSON")) {
      throw error;
    }
    throw new Error("The cover enrollment bundle is invalid");
  }
}

export function serializeRoleHandoffBundle(
  bundle: GuardianEnrollmentBundle | CoverEnrollmentBundle,
): string {
  return JSON.stringify(bundle, null, 2);
}
