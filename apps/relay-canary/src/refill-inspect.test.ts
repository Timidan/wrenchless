import {
  computeRefillRecoveryCommitment,
  STRK20_SUPPORTED_PROOF_VERSIONS,
  type RefillFundArtifact,
} from "@wrenchless/canary-core";
import { ec, shortString, type ResourceBoundsBN } from "starknet";
import { describe, expect, it } from "vitest";

import type { RelayCanaryConfig } from "./config.js";
import {
  inspectRefillFund,
  type RefillFundClient,
} from "./refill-inspect.js";

const POOL = "0x456";
const HELPER = "0xabc";
const STRK = "0x4718";
const RELAY = "0x789";
const POOL_CLASS_HASH = "0xc1a55";
const POOL_FEE = 6_000_000_000_000_000_000n;
const MAX_TRANSACTION_FEE = 10_000_000_000_000_000_000n;
const ONE_STRK = 1_000_000_000_000_000_000n;
const PROOF_BASE_BLOCK = 100n;
const LATEST_BLOCK = 120n;
const PROOF_VALIDITY_BLOCKS = 450n;

function resourceBounds(multiplier: bigint): ResourceBoundsBN {
  return {
    l1_gas: { max_amount: multiplier, max_price_per_unit: ONE_STRK },
    l1_data_gas: { max_amount: multiplier, max_price_per_unit: ONE_STRK },
    l2_gas: { max_amount: multiplier, max_price_per_unit: ONE_STRK },
  };
}

const recoveryCommitment = computeRefillRecoveryCommitment(
  "0x111",
  "0x444",
  "0x555",
);

const artifactWithoutFacts: RefillFundArtifact = {
  schemaVersion: "wrenchless.refill-fund.v2",
  chainId: "SN_MAIN",
  poolAddress: POOL,
  helperAddress: HELPER,
  stateId: "0x111",
  claimCommitment: "0x222",
  recoveryCommitment,
  recoveryAccount: "0x444",
  recoverySalt: "0x555",
  recoveryAuthorization: ["0xaaa", "0x0"],
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
      recoveryCommitment,
      STRK,
      "0x3e8",
      "0x6b49e010",
      "0x1",
    ],
  },
  proof: "proof-payload",
  proofFacts: [],
};

function makeProofFacts(): string[] {
  const serverActions = artifactWithoutFacts.call.calldata.slice(0, -1);
  const messageHash = ec.starkCurve.poseidonHashMany([
    BigInt(POOL),
    0n,
    BigInt(serverActions.length + 1),
    BigInt(POOL_CLASS_HASH),
    ...serverActions.map(BigInt),
  ]);
  return [
    STRK20_SUPPORTED_PROOF_VERSIONS[1],
    shortString.encodeShortString("VIRTUAL_SNOS"),
    "0x3e98c2d7703b03a7edb73ed7f075f97f1dcbaa8f717cdf6e1a57bf058265473",
    shortString.encodeShortString("VIRTUAL_SNOS0"),
    `0x${PROOF_BASE_BLOCK.toString(16)}`,
    "0xbace",
    "0xabc",
    "0x1",
    `0x${messageHash.toString(16)}`,
  ];
}

const artifact: RefillFundArtifact = {
  ...artifactWithoutFacts,
  proofFacts: makeProofFacts(),
};

const baseConfig: RelayCanaryConfig = {
  artifactPath: "[test]",
  rpcUrl: "https://rpc.example.test",
  relayAddress: RELAY,
  broadcast: false,
  poolAddress: POOL,
  strkAddress: STRK,
  maxPoolFeeFri: POOL_FEE,
  maxTransactionFeeFri: MAX_TRANSACTION_FEE,
};

function makeClient(): RefillFundClient {
  return {
    assertPoolInterface: async () => ({
      chainId: "SN_MAIN",
      classHash: POOL_CLASS_HASH,
    }),
    assertRefillHelper: async () => ({ classHash: "0xfeed" }),
    readPoolVersion: async () => "2.0",
    readLatestBlockNumber: async () => LATEST_BLOCK,
    readLatestBlockTimestamp: async () => 1_800_000_000n,
    readProofValidityBlocks: async () => PROOF_VALIDITY_BLOCKS,
    readBlockHash: async () => "0xbace",
    readPoolPaused: async () => false,
    readPoolFeeFri: async () => POOL_FEE,
    readRelayBalanceFri: async () => POOL_FEE + MAX_TRANSACTION_FEE,
    readRefillStateExists: async () => false,
    estimateUnsigned: async () => ({
      overallFeeFri: 3n * ONE_STRK,
      resourceBounds: resourceBounds(1n),
    }),
    estimateSigned: async () => ({
      overallFeeFri: 4n * ONE_STRK,
      resourceBounds: resourceBounds(2n),
    }),
    broadcast: async () => "0xtransaction",
    waitForRefillFundFinality: async () => ({
      transactionHash: "0xtransaction",
      blockNumber: "123",
      finalityStatus: "ACCEPTED_ON_L2",
      executionStatus: "SUCCEEDED",
      senderAddress: RELAY,
      actualFeeFri: (4n * ONE_STRK).toString(),
      helperAddress: HELPER,
      stateId: artifact.stateId,
      tokenAddress: STRK,
      amountFri: artifact.amountFri,
      expiry: artifact.expiry,
      totalLiabilityFri: artifact.amountFri,
      helperBalanceFri: artifact.amountFri,
    }),
  };
}

describe("inspectRefillFund", () => {
  it("keeps the confirmed maximum stable when the signed estimate is higher", async () => {
    const client = makeClient();
    const estimate = await inspectRefillFund({
      artifact,
      config: baseConfig,
      configuredHelperAddress: HELPER,
      client,
    });

    const acceptedMaximum = BigInt(estimate.summary.maxSpendFri);
    const result = await inspectRefillFund({
      artifact,
      config: {
        ...baseConfig,
        broadcast: true,
        relayPrivateKey: "0xabc",
      },
      configuredHelperAddress: HELPER,
      client,
      beforeBroadcast: async (maximumSpendFri) => {
        expect(maximumSpendFri).toBe(acceptedMaximum);
      },
    });

    expect(result.transactionHash).toBe("0xtransaction");
    expect(result.summary.maxSpendFri).toBe(estimate.summary.maxSpendFri);
  });

  it("returns the transaction hash without waiting for finality", async () => {
    let finalityReads = 0;
    const client: RefillFundClient = {
      ...makeClient(),
      waitForRefillFundFinality: async () => {
        finalityReads += 1;
        throw new Error("finality should continue outside the request");
      },
    };

    const result = await inspectRefillFund({
      artifact,
      config: {
        ...baseConfig,
        broadcast: true,
        relayPrivateKey: "0xabc",
      },
      configuredHelperAddress: HELPER,
      client,
      waitForFinality: false,
    });

    expect(result.transactionHash).toBe("0xtransaction");
    expect(result.receipt).toBeUndefined();
    expect(finalityReads).toBe(0);
  });
});
