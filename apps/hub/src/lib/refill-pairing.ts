import { z } from "zod";

import { fromBase64Url, toBase64Url } from "../adapters/pairing-code.js";
import {
  createCoverRefillRequestBatch,
  createVaultRefillIntent,
  type CoverRefillRequest,
  type VaultRefillIntent,
} from "./refill-ticket.js";

const RECEIPT_PREFIX = "wrr2";

const refillRequestSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.cover-refill-request.v1"),
    stateId: z.string(),
    claimCommitment: z.string(),
    createdAt: z.iso.datetime(),
  })
  .strict();

const carriedReceiptSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.carried-receipt.v2"),
    confirmationCode: z.string().regex(/^[0-9A-F]{4}(?:-[0-9A-F]{4}){2}$/),
    restoreRequests: z.array(refillRequestSchema).min(1).max(3),
  })
  .strict();

export type CarriedReceipt = z.infer<typeof carriedReceiptSchema>;

export type CarriedReceiptResult =
  | { ok: true; receipt: CarriedReceipt }
  | { ok: false; message: string };

export async function createCarriedReceipt(
  confirmationCode: string,
): Promise<{ token: string; receipt: CarriedReceipt }> {
  const restoreRequests = await createCoverRefillRequestBatch();
  const receipt = carriedReceiptSchema.parse({
    schemaVersion: "wrenchless.carried-receipt.v2",
    confirmationCode,
    restoreRequests,
  });
  return {
    receipt,
    token: `${RECEIPT_PREFIX}_${toBase64Url(JSON.stringify(receipt))}`,
  };
}

export function parseCarriedReceipt(input: string): CarriedReceiptResult {
  const cleaned = input.trim().replace(/\s+/g, "").replace(/^["']|["']$/g, "");
  if (!cleaned.startsWith(`${RECEIPT_PREFIX}_`)) {
    return { ok: false, message: "That does not look like the code from the carried phone." };
  }
  try {
    const receipt = carriedReceiptSchema.parse(
      JSON.parse(fromBase64Url(cleaned.slice(RECEIPT_PREFIX.length + 1))),
    );
    return { ok: true, receipt };
  } catch {
    return { ok: false, message: "That carried-phone code is incomplete or invalid." };
  }
}

export async function importCarriedRestoreRequests(
  requests: readonly CoverRefillRequest[],
): Promise<VaultRefillIntent[]> {
  const intents: VaultRefillIntent[] = [];
  for (const request of requests) {
    intents.push(await createVaultRefillIntent(request));
  }
  return intents;
}
