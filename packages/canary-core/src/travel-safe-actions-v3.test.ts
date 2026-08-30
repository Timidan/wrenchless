import { ec } from "starknet";
import { describe, expect, it } from "vitest";

import {
  buildTravelSafeV3ClaimEarlyActions,
  buildTravelSafeV3ExtendActions,
  buildTravelSafeV3FundActions,
  buildTravelSafeV3RefundActions,
  buildTravelSafeV3ReleaseActions,
  buildTravelSafeV3TopUpActions,
  computeTravelSafeV3ActionHash,
  computeTravelSafeV3ClaimCommitment,
  computeTravelSafeV3DeviceCommitment,
  computeTravelSafeV3RecoveryCommitment,
  deriveTravelSafeV3PublicKey,
  generateTravelSafeV3PrivateKey,
  signTravelSafeV3Action,
  TRAVEL_SAFE_V3_OPEN_NOTE,
} from "./travel-safe-actions-v3.js";

const helper = "0x123";
const stateId = "0x456";
const token = "0x789";
const recipient = "0xabc";
const devicePrivateKey = "0x111";
const devicePublicKey = ec.starkCurve.getStarkKey(devicePrivateKey);
const signature = { r: "0x12", s: "0x13" };

describe("Travel Safe v3 action vectors", () => {
  it("builds the exact FUND withdrawal and helper calldata", () => {
    expect(
      buildTravelSafeV3FundActions({
        helperAddress: helper,
        stateId,
        claimCommitment: "0x1",
        deviceCommitment: "0x2",
        recoveryCommitment: "0x3",
        tokenAddress: token,
        amount: "1000",
        dailyAmount: "100",
        firstReleaseAt: "2000",
        returnAt: "3000",
      }),
    ).toEqual([
      { type: "withdraw", token, amount: "0x3e8", recipient: helper },
      {
        type: "invoke",
        contract: helper,
        calldata: [
          "0x0",
          stateId,
          "0x1",
          "0x2",
          "0x3",
          token,
          "0x3e8",
          "0x64",
          "0x7d0",
          "0xbb8",
        ],
      },
    ]);
  });

  it("builds release, top-up, and extension calldata with their ABI discriminants", () => {
    expect(
      buildTravelSafeV3ReleaseActions({
        helperAddress: helper,
        stateId,
        tokenAddress: token,
        recipient,
        noteId: TRAVEL_SAFE_V3_OPEN_NOTE,
        nonce: "2",
        devicePublicKey,
        signature,
      }),
    ).toEqual([
      { type: "transfer", token, amount: "OPEN", recipient },
      {
        type: "invoke",
        contract: helper,
        calldata: [
          "0x1",
          stateId,
          TRAVEL_SAFE_V3_OPEN_NOTE,
          "0x2",
          devicePublicKey,
          signature.r,
          signature.s,
        ],
      },
    ]);

    expect(
      buildTravelSafeV3TopUpActions({
        helperAddress: helper,
        stateId,
        tokenAddress: token,
        amount: "16",
        nonce: "2",
        devicePublicKey,
        signature,
      })[1],
    ).toEqual({
      type: "invoke",
      contract: helper,
      calldata: [
        "0x2",
        stateId,
        token,
        "0x10",
        "0x2",
        devicePublicKey,
        signature.r,
        signature.s,
      ],
    });

    expect(
      buildTravelSafeV3ExtendActions({
        helperAddress: helper,
        stateId,
        newReturnAt: "4000",
        nonce: "2",
        devicePublicKey,
        signature,
      }),
    ).toEqual([
      {
        type: "invoke",
        contract: helper,
        calldata: [
          "0x3",
          stateId,
          "0xfa0",
          "0x2",
          devicePublicKey,
          signature.r,
          signature.s,
        ],
      },
    ]);
  });

  it("builds exact early-claim and final-return value actions", () => {
    expect(
      buildTravelSafeV3ClaimEarlyActions({
        helperAddress: helper,
        stateId,
        tokenAddress: token,
        recipient,
        noteId: "0x99",
        nonce: "3",
        claimPublicKey: "0x44",
        signature,
      })[1],
    ).toEqual({
      type: "invoke",
      contract: helper,
      calldata: [
        "0x4",
        stateId,
        "0x99",
        "0x3",
        "0x44",
        signature.r,
        signature.s,
      ],
    });

    expect(
      buildTravelSafeV3RefundActions({
        helperAddress: helper,
        stateId,
        tokenAddress: token,
        recipient,
        noteId: "0x99",
        nonce: "3",
        recoveryAccount: "0x55",
        recoverySalt: "0x66",
        signature: ["0x77", "0x88"],
      })[1],
    ).toEqual({
      type: "invoke",
      contract: helper,
      calldata: [
        "0x5",
        stateId,
        "0x99",
        "0x3",
        "0x55",
        "0x66",
        "0x2",
        "0x77",
        "0x88",
      ],
    });
  });

  it("matches keys, commitments, and deterministic device signatures", () => {
    const authorization = {
      chainId: "0x534e5f4d41494e",
      helperAddress: helper,
      stateId,
      nonce: "2",
      tokenAddress: token,
      remainingAmount: "1000",
      firstReleaseAt: "2000",
      returnAt: "3000",
      operation: "RELEASE" as const,
      value: "100",
      noteId: "0x99",
    };
    const signed = signTravelSafeV3Action(devicePrivateKey, authorization);
    expect(
      ec.starkCurve.verify(
        new ec.starkCurve.Signature(BigInt(signed.r), BigInt(signed.s)),
        computeTravelSafeV3ActionHash(authorization),
        ec.starkCurve.getPublicKey(devicePrivateKey),
      ),
    ).toBe(true);
    expect(computeTravelSafeV3ClaimCommitment(stateId, "0x44")).toMatch(/^0x/);
    expect(computeTravelSafeV3DeviceCommitment(stateId, devicePublicKey)).toMatch(
      /^0x/,
    );
    expect(
      computeTravelSafeV3RecoveryCommitment(stateId, "0x55", "0x66"),
    ).toMatch(/^0x/);
  });

  it("rejects malformed schedules, zero state IDs, and empty return signatures", () => {
    expect(() =>
      buildTravelSafeV3FundActions({
        helperAddress: helper,
        stateId: "0x0",
        claimCommitment: "0x1",
        deviceCommitment: "0x2",
        recoveryCommitment: "0x3",
        tokenAddress: token,
        amount: "10",
        dailyAmount: "11",
        firstReleaseAt: "20",
        returnAt: "10",
      }),
    ).toThrow();
    expect(() =>
      buildTravelSafeV3RefundActions({
        helperAddress: helper,
        stateId,
        tokenAddress: token,
        recipient,
        noteId: "0x99",
        nonce: "0",
        recoveryAccount: "0x55",
        recoverySalt: "0x66",
        signature: [],
      }),
    ).toThrow("return signature cannot be empty");
  });

  /**
   * Every Stark key is below 2^251, so the zero-padded byte string this used
   * to hand back always began `0x0` and never passed the ticket store's
   * canonical-felt check. That rejected every new Safe, so the property is
   * held here rather than left to a caller to notice again.
   */
  it("generates canonical, non-zero device keys that still derive a public key", () => {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const privateKey = generateTravelSafeV3PrivateKey();
      expect(privateKey).toMatch(/^0x(?:0|[1-9a-f][0-9a-f]*)$/);
      expect(BigInt(privateKey)).toBeGreaterThan(0n);
      expect(deriveTravelSafeV3PublicKey(privateKey)).toMatch(/^0x[0-9a-f]+$/);
    }
  });
});
