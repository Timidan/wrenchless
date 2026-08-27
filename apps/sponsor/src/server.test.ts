import type { AddressInfo } from "node:net";

import type { JsonValue } from "@wrenchless/canary-core";
import { afterEach, describe, expect, it } from "vitest";

import type {
  RefillFundEstimate,
  RefillFundSubmission,
} from "./fund-relay.js";
import type { RecoveryLookupService } from "./recovery-index.js";
import { createSponsorServer } from "./server.js";
import type {
  TravelSafeV3Estimate,
  TravelSafeV3Relay,
} from "./travel-safe-v3-relay.js";

const servers: ReturnType<typeof createSponsorServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

const estimate: RefillFundEstimate = {
  status: "estimated",
  summary: {
    mode: "dry-run",
    poolAddress: "0x1",
    poolClassHash: "0x2",
    poolVersion: "1",
    helperAddress: "0x3",
    helperClassHash: "0x4",
    stateId: "0x5",
    tokenAddress: "0x6",
    amountFri: "1000000000000000000",
    expiry: "2000000000",
    relayAddress: "0x7",
    poolPaused: false,
    poolFeeFri: "6000000000000000000",
    estimatedTransactionFeeFri: "5000000000000000000",
    maxTransactionFeeFri: "10000000000000000000",
    maxSpendFri: "16000000000000000000",
    proofBaseBlock: "100",
    proofExpiresAtBlock: "550",
    proofRemainingBlocks: "450",
  },
};

async function serve(relay: {
  canFundOneMaximumTransaction(): Promise<boolean>;
  estimate(value: JsonValue): Promise<RefillFundEstimate>;
  submit(
    value: JsonValue,
    acceptedMaxSpendFri: bigint,
  ): Promise<RefillFundSubmission>;
}, travelSafeV3Relay?: Pick<TravelSafeV3Relay, "estimate" | "submit">): Promise<string> {
  const options = {
    allowedOrigin: "https://wrenchless.test",
    fundUnavailableReason: async () => undefined,
    requireHttps: false,
    trustProxy: false,
  };
  const server = createSponsorServer(
    relay,
    // SAFETY: recovery routes are not called in these FUND-only server tests.
    {} as RecoveryLookupService,
    travelSafeV3Relay === undefined
      ? options
      : { ...options, travelSafeV3Relay },
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // SAFETY: listen used TCP host 127.0.0.1 and completed before this read.
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

describe("refill FUND cost boundary", () => {
  it("estimates without calling the broadcast method", async () => {
    let estimates = 0;
    let submissions = 0;
    const base = await serve({
      canFundOneMaximumTransaction: async () => true,
      async estimate() {
        estimates += 1;
        return estimate;
      },
      async submit() {
        submissions += 1;
        throw new Error("must not broadcast");
      },
    });

    const response = await fetch(`${base}/v1/refill-funds/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifact: "prepared-proof" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(estimate);
    expect(estimates).toBe(1);
    expect(submissions).toBe(0);
  });

  it("passes the confirmed maximum spend to the broadcast method", async () => {
    let accepted: bigint | null = null;
    const submission: RefillFundSubmission = {
      status: "submitted",
      summary: { ...estimate.summary, mode: "broadcast" },
      transactionHash: "0x123",
    };
    const base = await serve({
      canFundOneMaximumTransaction: async () => true,
      estimate: async () => estimate,
      async submit(_artifact, acceptedMaxSpendFri) {
        accepted = acceptedMaxSpendFri;
        return submission;
      },
    });

    const response = await fetch(`${base}/v1/refill-funds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        artifact: { prepared: "proof" },
        acceptedMaxSpendFri: "16000000000000000000",
      }),
    });

    expect(response.status).toBe(202);
    expect(accepted).toBe(16_000_000_000_000_000_000n);
  });
});

describe("Travel Safe v3 routes", () => {
  it("keeps FUND and top-up estimates on distinct endpoints", async () => {
    let operation: "FUND" | "TOP_UP" | undefined;
    const v3Estimate: TravelSafeV3Estimate = {
      status: "estimated",
      summary: {
        mode: "dry-run",
        operation: "TOP_UP",
        poolAddress: "0x1",
        poolClassHash: "0x2",
        poolVersion: "1",
        helperAddress: "0x3",
        helperClassHash: "0x4",
        stateId: "0x5",
        tokenAddress: "0x6",
        tokenSymbol: "STRK",
        amountBaseUnits: "100",
        relayAddress: "0x7",
        poolFeeFri: "8",
        estimatedTransactionFeeFri: "9",
        maxTransactionFeeFri: "10",
        maxSpendFri: "18",
        proofBaseBlock: "100",
        proofExpiresAtBlock: "550",
        proofRemainingBlocks: "450",
      },
    };
    const base = await serve(
      {
        canFundOneMaximumTransaction: async () => true,
        estimate: async () => estimate,
        submit: async () => {
          throw new Error("must not broadcast");
        },
      },
      {
        async estimate(_value, expectedOperation) {
          operation = expectedOperation;
          return v3Estimate;
        },
        async submit() {
          throw new Error("must not broadcast");
        },
      },
    );
    const response = await fetch(`${base}/v3/top-up/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "TOP_UP" }),
    });
    expect(response.status).toBe(200);
    expect(operation).toBe("TOP_UP");
    expect(await response.json()).toEqual(v3Estimate);
  });
});
