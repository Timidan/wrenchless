import { describe, expect, it } from "vitest";

import type {
  RefillFundArtifact,
  RegistrationCanaryArtifact,
} from "./artifact.js";
import {
  buildRefillFundRelayPlan,
  buildRegistrationRelayPlan,
} from "./relay-plan.js";

const POOL = "0x456";
const STRK = "0x4718";
const RELAY = "0x789";
const POOL_FEE = 6_000_000_000_000_000_000n;
const MAX_TX_FEE = 5_000_000_000_000_000_000n;
const MAX_POOL_FEE = 12_000_000_000_000_000_000n;
const HELPER = "0xabc";

const artifact: RegistrationCanaryArtifact = {
  schemaVersion: "wrenchless.registration-canary.v1",
  chainId: "SN_MAIN",
  coverAddress: "0x123",
  poolAddress: POOL,
  createdAt: "2026-08-20T00:00:00.000Z",
  call: {
    contractAddress: POOL,
    entrypoint: "apply_actions",
    calldata: [
      "0x3",
      "0x0",
      "0xaaa",
      "0x1",
      "0x111",
      "0x0",
      "0xbbb",
      "0x3",
      "0x222",
      "0x333",
      "0x444",
      "0x4",
      "0x123",
      "0x111",
      "0x222",
      "0x333",
      "0x444",
      "0x1",
    ],
  },
  proof: "proof-payload",
  proofFacts: ["0x1"],
};

const validInput = {
  artifact,
  configuredPoolAddress: POOL,
  strkAddress: STRK,
  relayAddress: RELAY,
  poolFeeFri: POOL_FEE,
  maxPoolFeeFri: MAX_POOL_FEE,
  maxTransactionFeeFri: MAX_TX_FEE,
  relayBalanceFri: POOL_FEE + MAX_TX_FEE,
};

describe("buildRegistrationRelayPlan", () => {
  it("builds exactly approve then apply_actions", () => {
    const plan = buildRegistrationRelayPlan(validInput);

    expect(plan.calls).toEqual([
      {
        contractAddress: STRK,
        entrypoint: "approve",
        calldata: [POOL, POOL_FEE.toString(), "0"],
      },
      artifact.call,
    ]);
    expect(plan.maxSpendFri).toBe(POOL_FEE + MAX_TX_FEE);
    expect(plan.relayAddress).toBe(RELAY);
    expect(plan.viewingPublicKey).toBe("0x111");
  });

  it("rejects a pool fee above the configured cap", () => {
    expect(() =>
      buildRegistrationRelayPlan({
        ...validInput,
        poolFeeFri: MAX_POOL_FEE + 1n,
        relayBalanceFri: MAX_POOL_FEE + MAX_TX_FEE + 1n,
      }),
    ).toThrow("pool fee exceeds configured cap");
  });

  it("rejects an underfunded relay", () => {
    expect(() =>
      buildRegistrationRelayPlan({ ...validInput, relayBalanceFri: 1n }),
    ).toThrow("relay balance is below maximum spend");
  });

  it("rejects a zero pool fee", () => {
    expect(() =>
      buildRegistrationRelayPlan({ ...validInput, poolFeeFri: 0n }),
    ).toThrow("pool fee must be positive");
  });

  it("rejects an artifact for a different configured pool", () => {
    expect(() =>
      buildRegistrationRelayPlan({
        ...validInput,
        configuredPoolAddress: "0x999",
      }),
    ).toThrow("artifact pool does not match configured pool");
  });

  it("rejects a non-registration action sequence", () => {
    const unsafeArtifact = {
      ...artifact,
      call: {
        ...artifact.call,
        calldata: artifact.call.calldata.map((felt, index) =>
          index === 1 ? "0x3" : felt,
        ),
      },
    };
    expect(() =>
      buildRegistrationRelayPlan({ ...validInput, artifact: unsafeArtifact }),
    ).toThrow("first action is not WriteOnce");
  });
});

const fundArtifact: RefillFundArtifact = {
  schemaVersion: "wrenchless.refill-fund.v1",
  chainId: "SN_MAIN",
  poolAddress: POOL,
  helperAddress: HELPER,
  stateId: "0x111",
  claimCommitment: "0x222",
  refundPublicKey: "0x333",
  tokenAddress: STRK,
  amountFri: "1000",
  expiry: "1800003600",
  createdAt: "2026-08-21T00:00:00.000Z",
  call: {
    contractAddress: POOL,
    entrypoint: "apply_actions",
    calldata: [
      "0x2",
      "0x3",
      HELPER,
      STRK,
      "0x3e8",
      "0xa",
      HELPER,
      "0x7",
      "0x0",
      "0x111",
      "0x222",
      "0x333",
      STRK,
      "0x3e8",
      "0x6b49e010",
      "0x1",
    ],
  },
  proof: "proof-payload",
  proofFacts: ["0x1"],
};

describe("buildRefillFundRelayPlan", () => {
  it("builds a bounded unrelated-relay FUND submission", () => {
    const plan = buildRefillFundRelayPlan({
      ...validInput,
      artifact: fundArtifact,
      configuredHelperAddress: HELPER,
    });

    expect(plan.calls).toEqual([
      {
        contractAddress: STRK,
        entrypoint: "approve",
        calldata: [POOL, POOL_FEE.toString(), "0"],
      },
      fundArtifact.call,
    ]);
    expect(plan.stateId).toBe(fundArtifact.stateId);
    expect(plan.amountFri).toBe(1000n);
  });

  it("rejects a FUND artifact for a different helper", () => {
    expect(() =>
      buildRefillFundRelayPlan({
        ...validInput,
        artifact: fundArtifact,
        configuredHelperAddress: "0x999",
      }),
    ).toThrow("artifact helper does not match configured helper");
  });
});
