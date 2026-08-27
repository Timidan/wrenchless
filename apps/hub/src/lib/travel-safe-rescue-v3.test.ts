import {
  computeTravelSafeV3ClaimCommitment,
  deriveTravelSafeSecrets,
} from "@wrenchless/canary-core";
import { describe, expect, it } from "vitest";

import type { TravelSafeV3Snapshot } from "./travel-safe-state-v3";
import { TRAVEL_SAFE_TOKENS } from "./travel-safe-tokens";
import { inspectTravelSafeV3RescueWords } from "./travel-safe-rescue-v3";

const WORDS =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

async function snapshot(
  patch: Partial<NonNullable<TravelSafeV3Snapshot["state"]>> = {},
): Promise<TravelSafeV3Snapshot> {
  const secrets = await deriveTravelSafeSecrets(WORDS);
  return {
    blockNumber: "100",
    chainTimeSeconds: "200",
    state: {
      stateId: secrets.stateId,
      claimCommitment: computeTravelSafeV3ClaimCommitment(
        secrets.stateId,
        secrets.claimPublicKey,
      ),
      deviceCommitment: "0x2",
      recoveryCommitment: "0x3",
      tokenAddress: TRAVEL_SAFE_TOKENS[0].address,
      initialAmount: "100",
      remainingAmount: "80",
      releasedAmount: "20",
      dailyAmount: "10",
      firstReleaseAt: "100",
      returnAt: "300",
      maxReturnAt: "500",
      nonce: "2",
      claimableAmount: "10",
      status: "funded",
      ...patch,
    },
  };
}

describe("Travel Safe v3 rescue inspection", () => {
  it("finds a funded allowance without retaining the phrase", async () => {
    const result = await inspectTravelSafeV3RescueWords({
      words: WORDS,
      helperAddress: "0x123",
      rpcUrl: "https://rpc.test",
      readSnapshot: async () => snapshot(),
    });

    expect(result.availability).toBe("available");
    expect(result.token.symbol).toBe("STRK");
    expect(result).not.toHaveProperty("words");
  });

  it("rejects words that do not own the onchain claim commitment", async () => {
    await expect(
      inspectTravelSafeV3RescueWords({
        words: WORDS,
        helperAddress: "0x123",
        rpcUrl: "https://rpc.test",
        readSnapshot: async () => snapshot({ claimCommitment: "0x999" }),
      }),
    ).rejects.toThrow("No Trip Allowance matches those recovery words");
  });

  it("distinguishes an open dated return from a completed allowance", async () => {
    const returnOpen = await inspectTravelSafeV3RescueWords({
      words: WORDS,
      helperAddress: "0x123",
      rpcUrl: "https://rpc.test",
      readSnapshot: async () => ({
        ...(await snapshot()),
        chainTimeSeconds: "301",
      }),
    });
    const complete = await inspectTravelSafeV3RescueWords({
      words: WORDS,
      helperAddress: "0x123",
      rpcUrl: "https://rpc.test",
      readSnapshot: async () => snapshot({ status: "claimed" }),
    });

    expect(returnOpen.availability).toBe("return_open");
    expect(complete.availability).toBe("complete");
  });
});
