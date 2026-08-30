import { z } from "zod";

import type { RefillFundArtifact } from "@wrenchless/canary-core";

const relayResultSchema = z.object({
  status: z.enum(["submitted", "finalized"]),
  transactionHash: z.string().regex(/^0x[0-9a-f]+$/),
});

const relayEstimateSchema = z.object({
  status: z.literal("estimated"),
  summary: z.object({
    mode: z.literal("dry-run"),
    poolFeeFri: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
    estimatedTransactionFeeFri: z.string().regex(/^[1-9][0-9]*$/),
    maxTransactionFeeFri: z.string().regex(/^[1-9][0-9]*$/),
    maxSpendFri: z.string().regex(/^[1-9][0-9]*$/),
    proofExpiresAtBlock: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
  }),
});

const relayErrorSchema = z.object({
  error: z.string(),
  reason: z.string().optional(),
});

const readinessSchema = z.object({ status: z.literal("ready") });

export type RelayedRefillFundResult = z.infer<typeof relayResultSchema>;
export type RelayedRefillFundEstimate = z.infer<typeof relayEstimateSchema>;

const FUND_REQUEST_TIMEOUT_MILLISECONDS = 60_000;

export class RelayedRefillFundError extends Error {
  constructor(
    message: string,
    readonly ambiguous: boolean,
  ) {
    super(message);
    this.name = "RelayedRefillFundError";
  }
}

function endpoint(sponsorUrl: string): string {
  const base = sponsorUrl.endsWith("/") ? sponsorUrl : `${sponsorUrl}/`;
  return new URL("v1/refill-funds", base).toString();
}

function estimateEndpoint(sponsorUrl: string): string {
  const base = sponsorUrl.endsWith("/") ? sponsorUrl : `${sponsorUrl}/`;
  return new URL("v1/refill-funds/estimate", base).toString();
}

function readinessEndpoint(sponsorUrl: string): string {
  const base = sponsorUrl.endsWith("/") ? sponsorUrl : `${sponsorUrl}/`;
  return new URL("readyz", base).toString();
}

function publicMessage(code: string, reason?: string): string {
  if (
    code === "fund_broadcast_disabled" ||
    code === "fund_relay_balance_low" ||
    code === "sponsor_unavailable" ||
    code === "helper_configuration_mismatch" ||
    code === "fund_readiness_unavailable" ||
    reason === "fund_broadcast_disabled" ||
    reason === "fund_relay_balance_low" ||
    reason === "helper_configuration_mismatch" ||
    reason === "fund_readiness_unavailable"
  ) {
    return "Private parking is temporarily unavailable.";
  }
  if (code === "relay_busy") {
    return "Another safe is being parked. Try again shortly.";
  }
  if (code === "active_safe_exists") {
    return "This account already has an active Travel Safe.";
  }
  if (code === "fund_cost_changed") {
    return "Not sent. The cost limit changed. Prepare it again.";
  }
  if (code === "recovery_not_approved") {
    return "The wallet did not approve recovery.";
  }
  if (code === "rate_limited") {
    return "Too many parking attempts. Try again later.";
  }
  if (code === "daily_fund_budget_exhausted") {
    return "Private parking is paused until the daily relay budget resets.";
  }
  if (code === "fund_rejected" || code === "invalid_request") {
    return "This safe could not be parked. Prepare it again.";
  }
  return "The parking service could not be reached. Try again.";
}

export async function submitRelayedRefillFund(input: {
  sponsorUrl: string;
  artifact: RefillFundArtifact;
  acceptedMaxSpendFri: string;
  fetcher?: typeof fetch;
}): Promise<RelayedRefillFundResult> {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(endpoint(input.sponsorUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifact: input.artifact,
        acceptedMaxSpendFri: input.acceptedMaxSpendFri,
      }),
      signal: AbortSignal.timeout(FUND_REQUEST_TIMEOUT_MILLISECONDS),
    });
  } catch {
    throw new RelayedRefillFundError(
      "The parking service could not be reached. The safe may still land; check the chain before trying again.",
      true,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RelayedRefillFundError(
      "The parking service returned an unreadable response. The safe may still land; check the chain before trying again.",
      true,
    );
  }

  if (!response.ok) {
    const parsed = relayErrorSchema.safeParse(body);
    const ambiguous =
      parsed.success && parsed.data.error === "fund_submission_uncertain";
    throw new RelayedRefillFundError(
      ambiguous
        ? "The safe may still be landing. Checking Starknet before another attempt."
        : parsed.success
        ? publicMessage(parsed.data.error, parsed.data.reason)
        : "The parking service could not complete this request.",
      ambiguous,
    );
  }

  const parsed = relayResultSchema.safeParse(body);
  if (!parsed.success) {
    throw new RelayedRefillFundError(
      "The parking service returned an invalid transaction reference. The safe may still land; check the chain before trying again.",
      true,
    );
  }
  return parsed.data;
}

export async function estimateRelayedRefillFund(input: {
  sponsorUrl: string;
  artifact: RefillFundArtifact;
  fetcher?: typeof fetch;
}): Promise<RelayedRefillFundEstimate> {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(estimateEndpoint(input.sponsorUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.artifact),
      signal: AbortSignal.timeout(FUND_REQUEST_TIMEOUT_MILLISECONDS),
    });
  } catch {
    throw new RelayedRefillFundError(
      "The parking service could not prepare a cost estimate.",
      false,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RelayedRefillFundError(
      "The parking service returned an unreadable cost estimate.",
      false,
    );
  }
  if (!response.ok) {
    const parsed = relayErrorSchema.safeParse(body);
    throw new RelayedRefillFundError(
      parsed.success
        ? publicMessage(parsed.data.error, parsed.data.reason)
        : "The parking service could not prepare a cost estimate.",
      false,
    );
  }
  const parsed = relayEstimateSchema.safeParse(body);
  if (!parsed.success) {
    throw new RelayedRefillFundError(
      "The parking service returned an invalid cost estimate.",
      false,
    );
  }
  return parsed.data;
}

export async function inspectRefillSponsor(input: {
  sponsorUrl: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(
      readinessEndpoint(input.sponsorUrl),
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    throw new Error("The Travel Safe sponsor could not be reached");
  }
  if (!response.ok) {
    throw new Error("Private parking is temporarily unavailable");
  }
  if (!readinessSchema.safeParse(await response.json()).success) {
    throw new Error("The Travel Safe sponsor returned an invalid readiness check");
  }
}
