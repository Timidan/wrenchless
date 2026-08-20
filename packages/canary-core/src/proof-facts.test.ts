import { constants, ec, hash, shortString } from "starknet";
import { describe, expect, it } from "vitest";

import type { RegistrationCanaryArtifact } from "./artifact.js";
import { assertRegistrationProofFacts } from "./proof-facts.js";

const POOL = "0x456";
const POOL_CLASS_HASH = "0x789";
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const CONFIG_HASH_VERSION = "0x537461726b6e65744f73436f6e66696733";

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
  proofFacts: [],
};

function makeProofFacts(baseBlockNumber = 100n): string[] {
  const serverActions = artifact.call.calldata.slice(0, -1);
  const payload = [POOL_CLASS_HASH, ...serverActions];
  const messageHash = ec.starkCurve.poseidonHashMany([
    BigInt(POOL),
    0n,
    BigInt(payload.length),
    ...payload.map(BigInt),
  ]);
  const configHash = hash.computeHashOnElements([
    CONFIG_HASH_VERSION,
    constants.StarknetChainId.SN_MAIN,
    STRK,
  ]);
  return [
    shortString.encodeShortString("PROOF0"),
    shortString.encodeShortString("VIRTUAL_SNOS"),
    "0x3e98c2d7703b03a7edb73ed7f075f97f1dcbaa8f717cdf6e1a57bf058265473",
    shortString.encodeShortString("VIRTUAL_SNOS0"),
    `0x${baseBlockNumber.toString(16)}`,
    "0xbace",
    configHash,
    "0x1",
    `0x${messageHash.toString(16)}`,
  ];
}

function withFacts(proofFacts: string[]): RegistrationCanaryArtifact {
  return { ...artifact, proofFacts };
}

describe("assertRegistrationProofFacts", () => {
  it("accepts proof facts bound to the class, actions, and a safe lifetime", () => {
    expect(
      assertRegistrationProofFacts({
        artifact: withFacts(makeProofFacts()),
        poolClassHash: POOL_CLASS_HASH,
        latestBlockNumber: 120n,
        proofValidityBlocks: 450n,
        minimumRemainingBlocks: 60n,
      }),
    ).toEqual({
      baseBlockNumber: 100n,
      baseBlockHash: "0xbace",
      expiresAtBlock: 550n,
      remainingBlocks: 430n,
    });
  });

  it("rejects an incompatible proof-facts layout", () => {
    expect(() =>
      assertRegistrationProofFacts({
        artifact: withFacts(makeProofFacts().slice(0, -1)),
        poolClassHash: POOL_CLASS_HASH,
        latestBlockNumber: 120n,
        proofValidityBlocks: 450n,
      }),
    ).toThrow("expected exactly nine proof facts");
  });

  it("rejects a wrong proof protocol header", () => {
    const facts = makeProofFacts();
    facts[0] = "0x1";
    expect(() =>
      assertRegistrationProofFacts({
        artifact: withFacts(facts),
        poolClassHash: POOL_CLASS_HASH,
        latestBlockNumber: 120n,
        proofValidityBlocks: 450n,
      }),
    ).toThrow("proof version is incompatible");
  });

  it("rejects a proof for another Starknet configuration", () => {
    const facts = makeProofFacts();
    facts[6] = "0x1";
    expect(() =>
      assertRegistrationProofFacts({
        artifact: withFacts(facts),
        poolClassHash: POOL_CLASS_HASH,
        latestBlockNumber: 120n,
        proofValidityBlocks: 450n,
      }),
    ).toThrow("proof configuration is not Starknet mainnet");
  });

  it("rejects proof facts bound to a different class or action sequence", () => {
    expect(() =>
      assertRegistrationProofFacts({
        artifact: withFacts(makeProofFacts()),
        poolClassHash: "0x999",
        latestBlockNumber: 120n,
        proofValidityBlocks: 450n,
      }),
    ).toThrow("proof message is not bound to this registration call");
  });

  it("rejects a base block that is not older than latest", () => {
    expect(() =>
      assertRegistrationProofFacts({
        artifact: withFacts(makeProofFacts(120n)),
        poolClassHash: POOL_CLASS_HASH,
        latestBlockNumber: 120n,
        proofValidityBlocks: 450n,
      }),
    ).toThrow("proof base block must be older than latest");
  });

  it("rejects a proof too close to expiry", () => {
    expect(() =>
      assertRegistrationProofFacts({
        artifact: withFacts(makeProofFacts()),
        poolClassHash: POOL_CLASS_HASH,
        latestBlockNumber: 500n,
        proofValidityBlocks: 450n,
        minimumRemainingBlocks: 60n,
      }),
    ).toThrow("proof has too few blocks remaining");
  });
});
