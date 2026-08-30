import type { TravelSafeToken } from "@wrenchless/canary-core";

/**
 * The private tokens a Travel Safe can hold.
 *
 * Every address here is written as a canonical felt — no leading zero after
 * the `0x`. Explorers and token lists print the zero-padded 64-character form,
 * and pasting that form straight in is what broke Safe creation: the address
 * travels onto the stored ticket unchanged, and the ticket schema rejects any
 * felt with a leading zero. Comparisons in this app are all `BigInt`, so the
 * two forms are interchangeable everywhere except at that one boundary, which
 * is exactly why the padded form survives review. `travel-safe-tokens.test.ts`
 * holds the rule.
 */
export const TRAVEL_SAFE_TOKENS = [
  {
    symbol: "STRK",
    decimals: 18,
    address:
      "0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  },
  {
    symbol: "USDC",
    decimals: 6,
    address:
      "0x53c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8",
  },
] as const satisfies readonly TravelSafeToken[];
