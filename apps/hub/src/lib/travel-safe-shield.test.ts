import { describe, expect, it } from "vitest";

import {
  buildShieldActions,
  planShieldDeposits,
  shieldLeftTheWallet,
  shieldShortfalls,
  type ShieldableBalance,
} from "./travel-safe-shield";
import { TRAVEL_SAFE_TOKENS } from "./travel-safe-tokens";

const [STRK, USDC] = TRAVEL_SAFE_TOKENS;

function balances(input: {
  strkShielded?: string;
  strkPublic?: string;
  usdcShielded?: string;
  usdcPublic?: string;
  strkShieldedAvailable?: boolean;
}): ShieldableBalance[] {
  return [
    {
      token: STRK,
      shieldedBalanceBaseUnits: input.strkShielded ?? "0",
      shieldedAvailable: input.strkShieldedAvailable ?? true,
      publicBalanceBaseUnits: input.strkPublic ?? "0",
      publicAvailable: true,
    },
    {
      token: USDC,
      shieldedBalanceBaseUnits: input.usdcShielded ?? "0",
      shieldedAvailable: true,
      publicBalanceBaseUnits: input.usdcPublic ?? "0",
      publicAvailable: true,
    },
  ];
}

describe("Shield planning", () => {
  it("needs nothing when the private balance already covers amount and reserve", () => {
    expect(
      planShieldDeposits({
        tokenAddress: STRK.address,
        amountBaseUnits: "100",
        poolFeeFri: "10",
        balances: balances({ strkShielded: "110", strkPublic: "0" }),
      }),
    ).toEqual([]);
  });

  it("shields only the STRK shortfall from the ordinary balance", () => {
    expect(
      planShieldDeposits({
        tokenAddress: STRK.address,
        amountBaseUnits: "100",
        poolFeeFri: "10",
        balances: balances({ strkShielded: "30", strkPublic: "500" }),
      }),
    ).toEqual([{ token: STRK, amountBaseUnits: "80" }]);
  });

  it("shields the STRK reserve alongside a USDC deposit", () => {
    expect(
      planShieldDeposits({
        tokenAddress: USDC.address,
        amountBaseUnits: "2000",
        poolFeeFri: "10",
        balances: balances({
          strkShielded: "4",
          strkPublic: "6",
          usdcShielded: "500",
          usdcPublic: "1500",
        }),
      }),
    ).toEqual([
      { token: STRK, amountBaseUnits: "6" },
      { token: USDC, amountBaseUnits: "1500" },
    ]);
  });

  it("treats an unreadable private balance as empty rather than as funds", () => {
    expect(
      shieldShortfalls({
        tokenAddress: STRK.address,
        amountBaseUnits: "5",
        poolFeeFri: "1",
        balances: balances({ strkShielded: "999", strkShieldedAvailable: false }),
      }),
    ).toEqual([{ token: STRK, amountBaseUnits: "6" }]);
  });

  it("refuses when the ordinary balance cannot cover the shortfall", () => {
    expect(() =>
      planShieldDeposits({
        tokenAddress: STRK.address,
        amountBaseUnits: "100",
        poolFeeFri: "10",
        balances: balances({ strkShielded: "30", strkPublic: "79" }),
      }),
    ).toThrow("STRK balance is too low");
  });

  /**
   * A release, extension or return parks nothing — it only has to pay the pool
   * fee out of the private balance — so the plan for those asks for the
   * reserve alone.
   */
  it("plans the reserve alone when no amount is being parked", () => {
    expect(
      planShieldDeposits({
        tokenAddress: USDC.address,
        amountBaseUnits: "0",
        poolFeeFri: "10",
        balances: balances({ strkShielded: "4", strkPublic: "50", usdcShielded: "999" }),
      }),
    ).toEqual([{ token: STRK, amountBaseUnits: "6" }]);
    expect(
      planShieldDeposits({
        tokenAddress: USDC.address,
        amountBaseUnits: "0",
        poolFeeFri: "10",
        balances: balances({ strkShielded: "10", usdcShielded: "999" }),
      }),
    ).toEqual([]);
  });

  it("refuses an unknown token before planning anything", () => {
    expect(() =>
      planShieldDeposits({
        tokenAddress: "0x999",
        amountBaseUnits: "1",
        poolFeeFri: "0",
        balances: balances({}),
      }),
    ).toThrow("Choose a supported private token");
  });

  it("builds canonical deposit actions and refuses empty or zero deposits", () => {
    expect(
      buildShieldActions([
        { token: STRK, amountBaseUnits: "255" },
        { token: USDC, amountBaseUnits: "1" },
      ]),
    ).toEqual([
      { type: "deposit", token: `0x${BigInt(STRK.address).toString(16)}`, amount: "0xff" },
      { type: "deposit", token: `0x${BigInt(USDC.address).toString(16)}`, amount: "0x1" },
    ]);
    expect(() => buildShieldActions([])).toThrow("Nothing needs shielding");
    expect(() => buildShieldActions([{ token: STRK, amountBaseUnits: "0" }])).toThrow(
      "Shield amounts must be positive",
    );
  });
});

describe("Reading a shield off the chain instead of the wallet", () => {
  const deposits = [
    { token: STRK, amountBaseUnits: "100" },
    { token: USDC, amountBaseUnits: "50" },
  ];
  const before = balances({ strkPublic: "1000", usdcPublic: "500" });

  it("sees the deposits once every token has fallen by its amount", () => {
    expect(
      shieldLeftTheWallet({
        deposits,
        baseline: before,
        // STRK also paid the wallet's own network fee, so it fell further.
        current: balances({ strkPublic: "880", usdcPublic: "450" }),
      }),
    ).toBe(true);
  });

  it("waits while only one of the two tokens has moved", () => {
    expect(
      shieldLeftTheWallet({
        deposits,
        baseline: before,
        current: balances({ strkPublic: "880", usdcPublic: "500" }),
      }),
    ).toBe(false);
  });

  it("treats an unreadable balance as no evidence rather than as a drop", () => {
    const current = balances({ strkPublic: "880", usdcPublic: "450" }).map((entry) =>
      entry.token.symbol === "USDC" ? { ...entry, publicAvailable: false } : entry,
    );
    expect(shieldLeftTheWallet({ deposits, baseline: before, current })).toBe(false);
  });

  it("claims nothing when there are no deposits to see", () => {
    expect(
      shieldLeftTheWallet({ deposits: [], baseline: before, current: before }),
    ).toBe(false);
  });
});
