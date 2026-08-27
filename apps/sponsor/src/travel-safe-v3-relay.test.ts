import { describe, expect, it } from "vitest";

import type { TravelSafeTokenPolicy } from "./config.js";
import { parseTravelSafeV3RelayArtifact } from "./travel-safe-v3-policy.js";

const pool = "0x100";
const helper = "0x200";
const token = "0x300";
const stateId = "0x400";
const tokenPolicy: TravelSafeTokenPolicy = {
  address: token,
  symbol: "STRK",
  decimals: 18,
  minAmountBaseUnits: "100",
  maxAmountBaseUnits: "1000",
};
const config = {
  poolAddress: pool,
  travelSafeV3HelperAddress: helper,
  travelSafeTokenPolicies: [tokenPolicy],
};

function preparedCalldata(helperCalldata: string[], amount = "500") {
  return [
    "0x3",
    "0x3",
    helper,
    token,
    `0x${BigInt(amount).toString(16)}`,
    "0x5",
    "0x1",
    helper,
    token,
    `0x${BigInt(amount).toString(16)}`,
    "0x1",
    "0x2",
    "0xa",
    helper,
    `0x${helperCalldata.length.toString(16)}`,
    ...helperCalldata,
    "0x1",
  ];
}

function fundArtifact(amount = "500") {
  const helperCalldata = [
    "0x0",
    stateId,
    "0x11",
    "0x12",
    "0x13",
    token,
    `0x${BigInt(amount).toString(16)}`,
    "0x32",
    "0x7d0",
    "0xbb8",
  ];
  return {
    schemaVersion: "wrenchless.travel-safe-relay.v3",
    chainId: "SN_MAIN",
    operation: "FUND",
    poolAddress: pool,
    helperAddress: helper,
    stateId,
    claimCommitment: "0x11",
    deviceCommitment: "0x12",
    recoveryCommitment: "0x13",
    tokenAddress: token,
    amountBaseUnits: amount,
    dailyAmountBaseUnits: "50",
    firstReleaseAt: "2000",
    returnAt: "3000",
    createdAt: "2026-08-27T00:00:00.000Z",
    call: {
      contractAddress: pool,
      entrypoint: "apply_actions",
      calldata: preparedCalldata(helperCalldata, amount),
    },
    proof: "proof",
    proofFacts: ["0x1"],
  } as const;
}

function topUpArtifact() {
  const helperCalldata = [
    "0x2",
    stateId,
    token,
    "0x1f4",
    "0x2",
    "0x14",
    "0x15",
    "0x16",
  ];
  return {
    schemaVersion: "wrenchless.travel-safe-relay.v3",
    chainId: "SN_MAIN",
    operation: "TOP_UP",
    poolAddress: pool,
    helperAddress: helper,
    stateId,
    tokenAddress: token,
    amountBaseUnits: "500",
    nonce: "2",
    devicePublicKey: "0x14",
    signatureR: "0x15",
    signatureS: "0x16",
    createdAt: "2026-08-27T00:00:00.000Z",
    call: {
      contractAddress: pool,
      entrypoint: "apply_actions",
      calldata: preparedCalldata(helperCalldata),
    },
    proof: "proof",
    proofFacts: ["0x1"],
  } as const;
}

describe("Travel Safe v3 relay policy", () => {
  it("accepts exact FUND and top-up vectors at configured token bounds", () => {
    expect(parseTravelSafeV3RelayArtifact(fundArtifact("100"), config).artifact)
      .toMatchObject({ operation: "FUND", amountBaseUnits: "100" });
    expect(parseTravelSafeV3RelayArtifact(topUpArtifact(), config).artifact)
      .toMatchObject({ operation: "TOP_UP", nonce: "2" });
    expect(parseTravelSafeV3RelayArtifact(fundArtifact("1000"), config).artifact)
      .toMatchObject({ amountBaseUnits: "1000" });
  });

  it("rejects a wrong helper, token amount, or changed helper calldata", () => {
    expect(() =>
      parseTravelSafeV3RelayArtifact(
        { ...fundArtifact(), helperAddress: "0x999" },
        config,
      ),
    ).toThrow("configured helper");
    expect(() => parseTravelSafeV3RelayArtifact(fundArtifact("1001"), config))
      .toThrow("outside the token policy");
    const changed = fundArtifact();
    changed.call.calldata[changed.call.calldata.length - 3] = "0x999";
    expect(() => parseTravelSafeV3RelayArtifact(changed, config)).toThrow();
  });

  it("rejects secret fields and malformed schedules", () => {
    expect(() =>
      parseTravelSafeV3RelayArtifact(
        { ...fundArtifact(), devicePrivateKey: "0x123" },
        config,
      ),
    ).toThrow();
    expect(() =>
      parseTravelSafeV3RelayArtifact(
        { ...fundArtifact(), firstReleaseAt: "3001" },
        config,
      ),
    ).toThrow("first release");
  });
});
