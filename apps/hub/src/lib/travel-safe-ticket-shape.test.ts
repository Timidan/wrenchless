import {
  computeTravelSafeV3ClaimCommitment,
  computeTravelSafeV3DeviceCommitment,
  computeTravelSafeV3RecoveryCommitment,
  deriveTravelSafeSecrets,
  deriveTravelSafeV3PublicKey,
  generateTravelSafePhrase,
  generateTravelSafeV3PrivateKey,
  parseTokenAmount,
  TravelSafeTicketV3Schema,
} from "@wrenchless/canary-core";
import { describe, expect, it } from "vitest";

import { WRENCHLESS_MAINNET } from "./product-config";
import { TRAVEL_SAFE_TOKENS } from "./travel-safe-tokens";

/**
 * The exact object `confirmRecoveryWords` writes when somebody presses "I
 * saved them", built from the same generators, registry and parsers, then put
 * through the schema that actually gates the store.
 *
 * Two separate leading-zero felts reached this schema in production and each
 * one killed Safe creation outright, because every other comparison in the app
 * goes through `BigInt` and cannot see the difference. Asserting the fields one
 * at a time would have missed both; only the real parse catches them.
 */
async function buildTicket(tokenIndex: 0 | 1) {
  const token = TRAVEL_SAFE_TOKENS[tokenIndex];
  const recovery = await deriveTravelSafeSecrets(generateTravelSafePhrase());
  const devicePrivateKey = generateTravelSafeV3PrivateKey();
  const account = "0x128cac3d0d6f1b1c2be1a2f8b7c1e8a5c9d3f2e1b0a99887766554433221100";
  const now = new Date().toISOString();
  const returnDateSeconds = String(Math.floor(Date.now() / 1_000) + 86_400 * 30);
  return {
    ticket: {
      schemaVersion: "wrenchless.travel-safe-ticket.v3",
      contractVersion: "v3",
      role: "safe",
      helperAddress:
        WRENCHLESS_MAINNET.tripAllowanceHelperAddress ??
        "0x43d60a5bf9cd864d9d5bb1d86d48a3268d32c3a004db64962b03215d3fdb2ed",
      stateId: recovery.stateId,
      status: "READY",
      recoveryAccount: `0x${BigInt(account).toString(16)}`,
      recoverySalt: recovery.recoverySalt,
      devicePrivateKey,
      tokenAddress: `0x${BigInt(token.address).toString(16)}`,
      tokenSymbol: token.symbol,
      tokenDecimals: token.decimals,
      amountBaseUnits: parseTokenAmount("12.5", token.decimals).toString(),
      dailyAmountBaseUnits: parseTokenAmount("1.25", token.decimals).toString(),
      firstReleaseSeconds: String(Math.floor(Date.now() / 1_000) + 3_600),
      returnDateSeconds,
      fundTransactionHash: null,
      actionTransactionHash: null,
      pendingAction: null,
      createdAt: now,
      updatedAt: now,
    },
    recovery,
    devicePrivateKey,
    account,
  };
}

describe("The ticket written when a Safe is confirmed", () => {
  it.each([0, 1] as const)("passes the store schema for token %i", async (index) => {
    const { ticket } = await buildTicket(index);
    const parsed = TravelSafeTicketV3Schema.safeParse(ticket);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("derives every commitment the FUND proof needs from that ticket", async () => {
    const { ticket, recovery, devicePrivateKey, account } = await buildTicket(0);
    expect(
      computeTravelSafeV3ClaimCommitment(recovery.stateId, recovery.claimPublicKey),
    ).toMatch(/^0x[0-9a-f]+$/);
    expect(
      computeTravelSafeV3DeviceCommitment(
        recovery.stateId,
        deriveTravelSafeV3PublicKey(devicePrivateKey),
      ),
    ).toMatch(/^0x[0-9a-f]+$/);
    expect(
      computeTravelSafeV3RecoveryCommitment(
        recovery.stateId,
        account,
        recovery.recoverySalt,
      ),
    ).toMatch(/^0x[0-9a-f]+$/);
    expect(BigInt(ticket.stateId)).toBe(BigInt(recovery.stateId));
  });
});
