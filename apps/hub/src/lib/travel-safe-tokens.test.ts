import { describe, expect, it } from "vitest";

import { WRENCHLESS_MAINNET } from "./product-config";
import { TRAVEL_SAFE_TOKENS } from "./travel-safe-tokens";

/**
 * A ticket carries its token address exactly as the registry wrote it, and the
 * ticket schema accepts only canonical felts. A padded address — the form every
 * explorer prints — therefore fails at the moment a Safe is created and nowhere
 * earlier, because every other comparison in the app goes through `BigInt`.
 * These hold the whole convention at the source instead.
 */
const CANONICAL_FELT = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;

describe("Configured Starknet addresses", () => {
  it.each(TRAVEL_SAFE_TOKENS)(
    "writes the $symbol token address as a canonical, non-zero felt",
    (token) => {
      expect(token.address).toMatch(CANONICAL_FELT);
      expect(BigInt(token.address)).toBeGreaterThan(0n);
    },
  );

  it("writes the pool and legacy helper addresses the same way", () => {
    expect(WRENCHLESS_MAINNET.poolAddress).toMatch(CANONICAL_FELT);
    expect(WRENCHLESS_MAINNET.legacyHelperAddress).toMatch(CANONICAL_FELT);
    expect(WRENCHLESS_MAINNET.strkTokenAddress).toMatch(CANONICAL_FELT);
  });

  it("keeps the STRK entry and the standalone STRK address the same token", () => {
    expect(BigInt(TRAVEL_SAFE_TOKENS[0].address)).toBe(
      BigInt(WRENCHLESS_MAINNET.strkTokenAddress),
    );
  });
});
