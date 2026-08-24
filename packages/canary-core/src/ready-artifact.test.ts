import { describe, expect, it } from "vitest";

import { normalizeReadyRefillFundArtifact } from "./ready-artifact.js";

describe("normalizeReadyRefillFundArtifact", () => {
  it("keeps only the public FUND intent and proof-bearing pool call", () => {
    const helper = "0xabc";
    const token = "0x4718";
    const prepared = {
      call: {
        contract_address: "0x456",
        entry_point: "apply_actions",
        calldata: [
          "0x2",
          "0x3",
          helper,
          token,
          "0x3e8",
          "0xa",
          helper,
          "0x7",
          "0x0",
          "0x111",
          "0x222",
          "0x333",
          token,
          "0x3e8",
          "0x6b49e010",
          "0x1",
        ],
      },
      proof: {
        data: "proof-payload",
        output: [],
        proof_facts: ["0x1"],
      },
    } as const;

    expect(
      normalizeReadyRefillFundArtifact({
        poolAddress: "0x456",
        helperAddress: helper,
        stateId: "0x111",
        claimCommitment: "0x222",
        refundPublicKey: "0x333",
        tokenAddress: token,
        amountFri: "1000",
        expiry: "1800003600",
        createdAt: "2026-08-21T00:00:00.000Z",
        prepared,
      }),
    ).toMatchObject({
      schemaVersion: "wrenchless.refill-fund.v1",
      helperAddress: helper,
      stateId: "0x111",
      amountFri: "1000",
      proof: "proof-payload",
    });
  });
});
