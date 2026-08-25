import { describe, expect, it } from "vitest";

import { computeRecoveryRegistrationHash } from "./recovery-lookup.js";

describe("Ready recovery registration", () => {
  it("binds the early-return claim commitment", () => {
    const registration = {
      chainId: "SN_MAIN",
      recoveryAccount: "0x123",
      helperAddress: "0x456",
      stateId: "0x789",
      claimCommitment: "0xaaa",
      recoveryCommitment: "0xbbb",
      tokenAddress: "0xccc",
      amountFri: "1000000000000000000",
      expiry: "1787702400",
    };

    expect(computeRecoveryRegistrationHash(registration)).not.toBe(
      computeRecoveryRegistrationHash({
        ...registration,
        claimCommitment: "0xaab",
      }),
    );
  });
});
