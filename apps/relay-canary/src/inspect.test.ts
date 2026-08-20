import type {
  RegistrationCanaryArtifact,
  RegistrationRelayPlan,
} from "@wrenchless/canary-core";
import { describe, expect, it } from "vitest";

import type { RelayCanaryConfig } from "./config.js";
import {
  inspectRegistrationCanary,
  type RegistrationCanaryClient,
} from "./inspect.js";

const POOL =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
const STRK =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
const POOL_FEE = 6_000_000_000_000_000_000n;
const ESTIMATED_FEE = 3_000_000_000_000_000_000n;
const MAX_TRANSACTION_FEE = 10_000_000_000_000_000_000n;

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

const baseConfig: RelayCanaryConfig = {
  artifactPath: "artifact.json",
  rpcUrl: "https://rpc.example.test",
  relayAddress: "0x789",
  broadcast: false,
  poolAddress: POOL,
  strkAddress: STRK,
  maxPoolFeeFri: 12_000_000_000_000_000_000n,
  maxTransactionFeeFri: MAX_TRANSACTION_FEE,
};

function makeClient(overrides: Partial<RegistrationCanaryClient> = {}) {
  let broadcasts = 0;
  const client: RegistrationCanaryClient = {
    assertPoolInterface: async () => ({
      chainId: "SN_MAIN",
      classHash: "0xclass",
    }),
    readPoolVersion: async () => "2.0",
    readPoolPaused: async () => false,
    readPoolFeeFri: async () => POOL_FEE,
    readCoverPublicKey: async () => 0n,
    readRelayBalanceFri: async () => POOL_FEE + MAX_TRANSACTION_FEE,
    estimateUnsigned: async () => ({
      overallFeeFri: ESTIMATED_FEE,
      resourceBounds: { marker: "unsigned" },
    }),
    estimateSigned: async () => ({
      overallFeeFri: ESTIMATED_FEE + 1n,
      resourceBounds: { marker: "signed" },
    }),
    broadcast: async (_plan, _artifact, _privateKey, resourceBounds) => {
      broadcasts += 1;
      expect(resourceBounds).toEqual({ marker: "signed" });
      return "0xtransaction";
    },
    ...overrides,
  };

  return { client, broadcastCount: () => broadcasts };
}

describe("inspectRegistrationCanary", () => {
  it("returns a deterministic dry-run summary without broadcasting", async () => {
    const fake = makeClient();

    const result = await inspectRegistrationCanary({
      artifact,
      config: baseConfig,
      client: fake.client,
    });

    expect(result).toEqual({
      summary: {
        mode: "dry-run",
        poolAddress: POOL,
        poolClassHash: "0xclass",
        poolVersion: "2.0",
        strkAddress: STRK,
        coverAddress: "0x123",
        relayAddress: "0x789",
        poolPaused: false,
        coverRegistered: false,
        poolFeeFri: POOL_FEE.toString(),
        estimatedTransactionFeeFri: ESTIMATED_FEE.toString(),
        maxTransactionFeeFri: MAX_TRANSACTION_FEE.toString(),
        maxSpendFri: (POOL_FEE + MAX_TRANSACTION_FEE).toString(),
      },
    });
    expect(fake.broadcastCount()).toBe(0);
  });

  it("rejects a paused pool before estimation", async () => {
    const fake = makeClient({ readPoolPaused: async () => true });

    await expect(
      inspectRegistrationCanary({
        artifact,
        config: baseConfig,
        client: fake.client,
      }),
    ).rejects.toThrow("pool is paused");
    expect(fake.broadcastCount()).toBe(0);
  });

  it("rejects a cover that is already registered", async () => {
    const fake = makeClient({ readCoverPublicKey: async () => 1n });

    await expect(
      inspectRegistrationCanary({
        artifact,
        config: baseConfig,
        client: fake.client,
      }),
    ).rejects.toThrow("cover is already registered");
    expect(fake.broadcastCount()).toBe(0);
  });

  it("rejects an unsigned estimate above the hard transaction cap", async () => {
    const fake = makeClient({
      estimateUnsigned: async () => ({
        overallFeeFri: MAX_TRANSACTION_FEE + 1n,
        resourceBounds: {},
      }),
    });

    await expect(
      inspectRegistrationCanary({
        artifact,
        config: baseConfig,
        client: fake.client,
      }),
    ).rejects.toThrow("estimated transaction fee exceeds configured cap");
    expect(fake.broadcastCount()).toBe(0);
  });

  it("performs a signed estimate and one broadcast only in broadcast mode", async () => {
    let signedEstimates = 0;
    const fake = makeClient({
      estimateSigned: async () => {
        signedEstimates += 1;
        return {
          overallFeeFri: ESTIMATED_FEE + 1n,
          resourceBounds: { marker: "signed" },
        };
      },
    });
    const config: RelayCanaryConfig = {
      ...baseConfig,
      broadcast: true,
      relayPrivateKey: "0xabc",
    };

    const result = await inspectRegistrationCanary({
      artifact,
      config,
      client: fake.client,
    });

    expect(result.transactionHash).toBe("0xtransaction");
    expect(result.summary.mode).toBe("broadcast");
    expect(result.summary.estimatedTransactionFeeFri).toBe(
      (ESTIMATED_FEE + 1n).toString(),
    );
    expect(signedEstimates).toBe(1);
    expect(fake.broadcastCount()).toBe(1);
  });

  it("never broadcasts when the signed estimate exceeds the cap", async () => {
    const fake = makeClient({
      estimateSigned: async () => ({
        overallFeeFri: MAX_TRANSACTION_FEE + 1n,
        resourceBounds: {},
      }),
    });

    await expect(
      inspectRegistrationCanary({
        artifact,
        config: {
          ...baseConfig,
          broadcast: true,
          relayPrivateKey: "0xabc",
        },
        client: fake.client,
      }),
    ).rejects.toThrow("signed transaction fee exceeds configured cap");
    expect(fake.broadcastCount()).toBe(0);
  });
});
