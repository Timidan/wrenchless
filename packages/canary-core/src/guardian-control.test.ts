import { describe, expect, it } from "vitest";

import {
  generateGuardianControlKeypair,
  openGuardianControl,
  resolveRestorePause,
  sealRestorePause,
} from "./guardian-control.js";

const NOW = new Date("2026-08-21T18:02:23.270Z");

describe("guardian restore pause", () => {
  it("uses a fixed opaque envelope and opens only for the vault", async () => {
    const vault = await generateGuardianControlKeypair();
    const guardian = await generateGuardianControlKeypair();
    const wrongVault = await generateGuardianControlKeypair();
    const envelope = await sealRestorePause(
      vault.publicKey,
      guardian.keyPair.privateKey,
      NOW,
    );

    expect(envelope.ciphertext).toHaveLength(1056);
    expect(JSON.stringify(envelope)).not.toContain("PAUSE_NEW_RESTORES");
    await expect(
      openGuardianControl(
        envelope,
        wrongVault.keyPair.privateKey,
        guardian.publicKey,
      ),
    ).rejects.toThrow("guardian control could not be decrypted");

    const command = await openGuardianControl(
      envelope,
      vault.keyPair.privateKey,
      guardian.publicKey,
    );
    expect(command).toMatchObject({
      action: "PAUSE_NEW_RESTORES",
      requestedAt: "2026-08-21T18:02:00.000Z",
      restoresBlockedUntil: "2026-08-22T18:02:00.000Z",
    });
  });

  it("expires automatically and lets the home vault lift an observed pause", async () => {
    const vault = await generateGuardianControlKeypair();
    const guardian = await generateGuardianControlKeypair();
    const envelope = await sealRestorePause(
      vault.publicKey,
      guardian.keyPair.privateKey,
      NOW,
    );
    const command = await openGuardianControl(
      envelope,
      vault.keyPair.privateKey,
      guardian.publicKey,
    );

    expect(
      resolveRestorePause([command], null, new Date("2026-08-22T10:00:00Z")),
    ).toEqual({
      active: true,
      blockedUntil: "2026-08-22T18:02:00.000Z",
    });
    expect(
      resolveRestorePause(
        [command],
        "2026-08-21T19:00:00.000Z",
        new Date("2026-08-22T10:00:00Z"),
      ).active,
    ).toBe(false);
    expect(
      resolveRestorePause([command], null, new Date("2026-08-22T18:02:00Z"))
        .active,
    ).toBe(false);
  });
});
