import { describe, expect, it } from "vitest";
import { z } from "zod";

import { reasonFrom } from "./amount";

/**
 * A `ZodError` keeps its issue list as its `message`. Showing that verbatim is
 * how a raw JSON array ended up on the recovery screen in front of a person
 * who had just written down twelve words.
 */
describe("Turning a failure into something a person can read", () => {
  const ticketish = z.object({ tokenAddress: z.string().regex(/^0x[1-9a-f]/) });

  it("names the field in the product's words, not the schema's", () => {
    const failure = ticketish.safeParse({ tokenAddress: "0x0abc" });
    expect(failure.success).toBe(false);
    const reason = failure.success ? "" : reasonFrom(failure.error);
    expect(reason).toBe(
      "Wrenchless could not accept the token for this Safe, so nothing was sent.",
    );
  });

  it("never leaks the issue list", () => {
    const failure = ticketish.safeParse({ tokenAddress: "0x0abc" });
    const reason = failure.success ? "" : reasonFrom(failure.error);
    expect(reason).not.toContain("invalid_format");
    expect(reason).not.toContain("[");
    expect(reason).not.toContain("tokenAddress");
  });

  it("still says something true for a field it has no words for", () => {
    const failure = z.object({ mysteryField: z.string() }).safeParse({});
    const reason = failure.success ? "" : reasonFrom(failure.error);
    expect(reason).toBe(
      "Some of this Safe's details were not in the form Wrenchless accepts, so nothing was sent.",
    );
  });

  it("leaves an ordinary error's own wording alone", () => {
    expect(reasonFrom(new Error("Keep enough private STRK for the return fee"))).toBe(
      "Keep enough private STRK for the return fee",
    );
    expect(reasonFrom(null)).toBe("The operation did not complete.");
  });
});
