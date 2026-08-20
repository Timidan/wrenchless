import { describe, expect, it } from "vitest";

import { assertRegistrationOnly } from "./pool-call.js";

const COVER = "0x123";

const registrationCalldata = [
  "0x3",
  "0x0",
  "0xaaa",
  "0x1",
  "0x111",
  "0x0",
  "0xbbb",
  "0x3",
  "0x222",
  "0x333",
  "0x444",
  "0x4",
  COVER,
  "0x111",
  "0x222",
  "0x333",
  "0x444",
  "0x1",
];

function replaceAt(values: readonly string[], index: number, value: string): string[] {
  const next = [...values];
  next[index] = value;
  return next;
}

describe("assertRegistrationOnly", () => {
  it("accepts exactly two WriteOnce actions and one ViewingKeySet", () => {
    expect(assertRegistrationOnly(registrationCalldata, COVER)).toEqual({
      coverAddress: COVER,
      actionKinds: ["WriteOnce", "WriteOnce", "EmitViewingKeySet"],
      screening: "None",
    });
  });

  it("rejects a transfer action", () => {
    const calldata = replaceAt(registrationCalldata, 1, "0x3");
    expect(() => assertRegistrationOnly(calldata, COVER)).toThrow(
      "first action is not WriteOnce",
    );
  });

  it("rejects an invoke action", () => {
    const calldata = replaceAt(registrationCalldata, 5, "0xa");
    expect(() => assertRegistrationOnly(calldata, COVER)).toThrow(
      "second action is not WriteOnce",
    );
  });

  it("rejects a missing WriteOnce action", () => {
    const calldata = replaceAt(registrationCalldata, 0, "0x2");
    expect(() => assertRegistrationOnly(calldata, COVER)).toThrow(
      "expected exactly three server actions",
    );
  });

  it("rejects a different emitted cover address", () => {
    const calldata = replaceAt(registrationCalldata, 12, "0x999");
    expect(() => assertRegistrationOnly(calldata, COVER)).toThrow(
      "viewing-key user does not match cover",
    );
  });

  it("rejects screening Some", () => {
    const calldata = replaceAt(registrationCalldata, 17, "0x0");
    expect(() => assertRegistrationOnly(calldata, COVER)).toThrow(
      "registration screening must be None",
    );
  });

  it("rejects trailing calldata", () => {
    const calldata = [...registrationCalldata, "0xdead"];
    expect(() => assertRegistrationOnly(calldata, COVER)).toThrow(
      "unexpected trailing calldata",
    );
  });

  it("rejects inconsistent public-key commitments", () => {
    const calldata = replaceAt(registrationCalldata, 13, "0x999");
    expect(() => assertRegistrationOnly(calldata, COVER)).toThrow(
      "public key does not match WriteOnce value",
    );
  });

  it("rejects inconsistent encrypted-key commitments", () => {
    const calldata = replaceAt(registrationCalldata, 16, "0x999");
    expect(() => assertRegistrationOnly(calldata, COVER)).toThrow(
      "encrypted key does not match WriteOnce value",
    );
  });
});
