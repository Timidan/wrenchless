import { describe, expect, it } from "vitest";

import type { RefillFundArtifact } from "@wrenchless/canary-core";

import {
  RelayedRefillFundError,
  submitRelayedRefillFund,
} from "./relayed-refill.js";

describe("relayed refill submission", () => {
  it("keeps an uncertain sponsor broadcast in reconciliation mode", async () => {
    // SAFETY: The sponsor error is returned before this boundary uses artifact fields.
    const artifact = {} as RefillFundArtifact;
    const request = submitRelayedRefillFund({
      sponsorUrl: "https://wrenchless.test",
      artifact,
      acceptedMaxSpendFri: "1",
      fetcher: async () =>
        new Response(JSON.stringify({ error: "fund_submission_uncertain" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<RelayedRefillFundError>>({
        ambiguous: true,
      }),
    );
  });
});
