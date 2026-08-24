import { describe, expect, it } from "vitest";

import {
  generateGuardianHeartbeatKeypair,
  openHeartbeat,
  sealHeartbeat,
} from "./heartbeat.js";

const NOW = new Date("2026-08-21T18:02:23.270Z");

describe("guardian heartbeat envelopes", () => {
  it("keeps OK and DISTRESS envelopes the same external size", async () => {
    const guardian = await generateGuardianHeartbeatKeypair();
    const sender = await generateGuardianHeartbeatKeypair();
    const ok = await sealHeartbeat(
      {
        signal: "OK",
        coverAlias: "Travel wallet",
        paymentOutcome: "confirmed",
      },
      guardian.publicKey,
      sender.keyPair.privateKey,
      NOW,
    );
    const distress = await sealHeartbeat(
      {
        signal: "DISTRESS",
        coverAlias: "Travel wallet",
        paymentOutcome: "confirmed",
      },
      guardian.publicKey,
      sender.keyPair.privateKey,
      NOW,
    );

    expect(JSON.stringify(ok)).toHaveLength(JSON.stringify(distress).length);
    expect(JSON.stringify(distress)).not.toContain("DISTRESS");
    expect(await openHeartbeat(
      distress,
      guardian.keyPair.privateKey,
      sender.publicKey,
    )).toMatchObject(
      {
        signal: "DISTRESS",
        coverAlias: "Travel wallet",
        paymentOutcome: "confirmed",
        createdAt: "2026-08-21T18:02:00.000Z",
      },
    );
  });

  it("rejects decryption by a different guardian", async () => {
    const guardian = await generateGuardianHeartbeatKeypair();
    const wrongGuardian = await generateGuardianHeartbeatKeypair();
    const sender = await generateGuardianHeartbeatKeypair();
    const envelope = await sealHeartbeat(
      {
        signal: "OK",
        coverAlias: "Daily wallet",
        paymentOutcome: "failed",
        responseInstruction: "Use our agreed call phrase.",
      },
      guardian.publicKey,
      sender.keyPair.privateKey,
      NOW,
    );

    await expect(
      openHeartbeat(envelope, wrongGuardian.keyPair.privateKey, sender.publicKey),
    ).rejects.toThrow("heartbeat could not be decrypted");
  });

  it("rejects a message made by someone holding only the mailbox capability", async () => {
    const guardian = await generateGuardianHeartbeatKeypair();
    const sender = await generateGuardianHeartbeatKeypair();
    const impostor = await generateGuardianHeartbeatKeypair();
    const envelope = await sealHeartbeat(
      {
        signal: "DISTRESS",
        coverAlias: "Daily wallet",
        paymentOutcome: "submitted",
      },
      guardian.publicKey,
      impostor.keyPair.privateKey,
      NOW,
    );

    await expect(
      openHeartbeat(envelope, guardian.keyPair.privateKey, sender.publicKey),
    ).rejects.toThrow("heartbeat could not be decrypted");
  });
});
