import { z } from "zod";

import type { RefillFundArtifact } from "@wrenchless/canary-core";

const relayResultSchema = z.object({
  status: z.enum(["submitted", "finalized"]),
  transactionHash: z.string().regex(/^0x[0-9a-f]+$/),
});

const relayErrorSchema = z.object({
  error: z.string(),
  reason: z.string().optional(),
});

export type RelayedRefillFundResult = z.infer<typeof relayResultSchema>;

function endpoint(sponsorUrl: string): string {
  const base = sponsorUrl.endsWith("/") ? sponsorUrl : `${sponsorUrl}/`;
  return new URL("v1/refill-funds", base).toString();
}

function publicMessage(code: string, reason?: string): string {
  if (
    code === "fund_broadcast_disabled" ||
    code === "fund_relay_balance_low" ||
    code === "sponsor_unavailable" ||
    reason === "fund_broadcast_disabled" ||
    reason === "fund_relay_balance_low"
  ) {
    return "Private restores are temporarily unavailable.";
  }
  if (code === "relay_busy") {
    return "Another restore is being sent. Try again shortly.";
  }
  if (code === "rate_limited") {
    return "Too many restore attempts. Try again later.";
  }
  if (code === "daily_fund_budget_exhausted") {
    return "Private restores are paused until the daily relay budget resets.";
  }
  if (code === "fund_rejected" || code === "invalid_request") {
    return "This restore could not be sent. Prepare it again.";
  }
  return "The restore service could not be reached. Try again.";
}

export async function submitRelayedRefillFund(input: {
  sponsorUrl: string;
  artifact: RefillFundArtifact;
  fetcher?: typeof fetch;
}): Promise<RelayedRefillFundResult> {
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(endpoint(input.sponsorUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.artifact),
    });
  } catch {
    throw new Error("The restore service could not be reached. Try again.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("The restore service returned an unreadable response.");
  }

  if (!response.ok) {
    const parsed = relayErrorSchema.safeParse(body);
    throw new Error(
      parsed.success
        ? publicMessage(parsed.data.error, parsed.data.reason)
        : "The restore service could not complete this request.",
    );
  }

  const parsed = relayResultSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("The restore service returned an invalid transaction reference.");
  }
  return parsed.data;
}
