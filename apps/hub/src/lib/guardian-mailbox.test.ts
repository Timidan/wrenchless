import {
  generateGuardianHeartbeatKeypair,
  sealHeartbeat,
} from "@wrenchless/canary-core";
import { describe, expect, it } from "vitest";

import { retrieveGuardianHeartbeats } from "./guardian-mailbox.js";

describe("guardian mailbox", () => {
  it("does not let one unreadable envelope hide a valid signal", async () => {
    const guardian = await generateGuardianHeartbeatKeypair();
    const valid = await sealHeartbeat(
      {
        signal: "DISTRESS",
        coverAlias: "Travel wallet",
        paymentOutcome: "submitted",
      },
      guardian.publicKey,
      new Date("2026-08-21T18:02:23.270Z"),
    );
    const unreadable = {
      ...valid,
      messageId: "f".repeat(32),
    };

    const events = await retrieveGuardianHeartbeats({
      mailboxUrl: "https://mailbox.example/",
      mailboxId: "a".repeat(32),
      receiveCapability: "b".repeat(64),
      guardianPrivateKey: guardian.keyPair.privateKey,
      fetcher: async () =>
        new Response(JSON.stringify({ envelopes: [unreadable, valid] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.signal).toBe("DISTRESS");
  });
});
