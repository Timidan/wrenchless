import { describe, expect, it } from "vitest";

import { parseRegistrationArtifact } from "./artifact.js";

const validArtifact = {
  schemaVersion: "wrenchless.registration-canary.v1",
  chainId: "SN_MAIN",
  coverAddress: "0x123",
  poolAddress: "0x456",
  createdAt: "2026-08-20T00:00:00.000Z",
  call: {
    contractAddress: "0x456",
    entrypoint: "apply_actions",
    calldata: ["0x3", "0x0"],
  },
  proof: "proof-payload",
  proofFacts: ["0x1"],
} as const;

describe("parseRegistrationArtifact", () => {
  it("accepts a canonical registration artifact", () => {
    expect(parseRegistrationArtifact(validArtifact)).toEqual(validArtifact);
  });

  it.each(["privateKey", "viewingKey", "passphrase", "mnemonic"])(
    "rejects secret-bearing field %s",
    (field) => {
      expect(() =>
        parseRegistrationArtifact({ ...validArtifact, [field]: "secret" }),
      ).toThrow();
    },
  );

  it("rejects a non-mainnet artifact", () => {
    expect(() =>
      parseRegistrationArtifact({ ...validArtifact, chainId: "SN_SEPOLIA" }),
    ).toThrow();
  });

  it("rejects a non-apply_actions artifact", () => {
    expect(() =>
      parseRegistrationArtifact({
        ...validArtifact,
        call: { ...validArtifact.call, entrypoint: "transfer" },
      }),
    ).toThrow();
  });

  it("rejects an empty proof-facts list", () => {
    expect(() =>
      parseRegistrationArtifact({ ...validArtifact, proofFacts: [] }),
    ).toThrow();
  });

  it("rejects non-canonical felt strings", () => {
    expect(() =>
      parseRegistrationArtifact({ ...validArtifact, coverAddress: "123" }),
    ).toThrow();
  });
});
