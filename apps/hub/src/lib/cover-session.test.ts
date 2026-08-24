import { describe, expect, it } from "vitest";

import { accessCodeIssue, accessCodesAreTooSimilar } from "./cover-session";

describe("cover access-code policy", () => {
  it("accepts non-patterned four-digit codes", () => {
    expect(accessCodeIssue("5831")).toBeNull();
  });

  it.each(["123", "1234", "1212", "1122", "7777", "2580"])(
    "rejects predictable code %s",
    (code) => {
      expect(accessCodeIssue(code)).not.toBeNull();
    },
  );

  it("keeps the normal and duress codes meaningfully different", () => {
    expect(accessCodesAreTooSimilar("5831", "5832")).toBe(true);
    expect(accessCodesAreTooSimilar("5831", "1385")).toBe(true);
    expect(accessCodesAreTooSimilar("5831", "5937")).toBe(false);
  });
});
