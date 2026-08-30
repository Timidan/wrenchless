import { describe, expect, it } from "vitest";

import { readTransactionReceiptStatus } from "./refill-state";

describe("Travel Safe receipt status", () => {
  it("keeps a pre-confirmed transaction in the confirming state", async () => {
    await expect(
      readTransactionReceiptStatus({
        transactionHash: "0xabc",
        rpcUrl: "https://rpc.wrenchless.test",
        fetcher: async () =>
          new Response(
            JSON.stringify({
              id: 1,
              jsonrpc: "2.0",
              result: {
                transaction_hash: "0xabc",
                execution_status: "SUCCEEDED",
                finality_status: "PRE_CONFIRMED",
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
      }),
    ).resolves.toEqual({ name: "pending" });
  });
});
