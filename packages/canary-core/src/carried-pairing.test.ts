import { describe, expect, it } from "vitest";

import { generateGuardianControlKeypair } from "./guardian-control.js";
import {
  openCarriedPairingReceipt,
  sealCarriedPairingReceipt,
} from "./carried-pairing.js";

const NOW = new Date("2026-08-24T14:28:14.000Z");

describe("carried wallet pairing", () => {
  it("reassembles a long authenticated receipt delivered out of order", async () => {
    const vault = await generateGuardianControlKeypair();
    const carried = await generateGuardianControlKeypair();
    const receipt = `wrr2_${"A".repeat(1_200)}`;
    const responseId = "a".repeat(32);

    const envelopes = await sealCarriedPairingReceipt(
      receipt,
      responseId,
      vault.publicKey,
      carried.keyPair.privateKey,
      NOW,
    );

    expect(envelopes.length).toBeGreaterThan(1);
    expect(envelopes.every((envelope) => envelope.ciphertext.length === 1056)).toBe(
      true,
    );
    expect(JSON.stringify(envelopes)).not.toContain(receipt.slice(0, 80));
    await expect(
      openCarriedPairingReceipt(
        [...envelopes].reverse(),
        responseId,
        vault.keyPair.privateKey,
        carried.publicKey,
      ),
    ).resolves.toBe(receipt);
  });
});
