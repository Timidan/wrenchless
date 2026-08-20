import { describe, expect, it } from "vitest";

import { normalizeReadyRegistrationArtifact } from "./ready-artifact.js";

const input = {
  coverAddress: "0x123",
  poolAddress: "0x456",
  createdAt: "2026-08-20T00:00:00.000Z",
  prepared: {
    call: {
      contract_address: "0x456",
      entry_point: "apply_actions",
      calldata: ["0x3", "0x0"],
    },
    proof: {
      data: "proof-payload",
      output: ["0x1"],
      proof_facts: ["0x2"],
    },
  },
} as const;

describe("normalizeReadyRegistrationArtifact", () => {
  it("normalizes the Ready snake-case result to the relay artifact", () => {
    expect(normalizeReadyRegistrationArtifact(input)).toEqual({
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
      proofFacts: ["0x2"],
    });
  });

  it.each(["privateKey", "viewingKey", "mnemonic", "passphrase"])(
    "rejects a secret-bearing field %s",
    (field) => {
      expect(() =>
        normalizeReadyRegistrationArtifact({ ...input, [field]: "secret" }),
      ).toThrow();
    },
  );

  it("rejects an alternate call target", () => {
    expect(() =>
      normalizeReadyRegistrationArtifact({
        ...input,
        prepared: {
          ...input.prepared,
          call: { ...input.prepared.call, contract_address: "0x999" },
        },
      }),
    ).toThrow("call target does not match the declared pool");
  });

  it("rejects a non-apply_actions call", () => {
    expect(() =>
      normalizeReadyRegistrationArtifact({
        ...input,
        prepared: {
          ...input.prepared,
          call: { ...input.prepared.call, entry_point: "transfer" },
        },
      }),
    ).toThrow();
  });

  it("rejects an unexpected proof side channel", () => {
    expect(() =>
      normalizeReadyRegistrationArtifact({
        ...input,
        prepared: {
          ...input.prepared,
          proof: {
            ...input.prepared.proof,
            additional_data: { screening: "unexpected" },
          },
        },
      }),
    ).toThrow();
  });
});
