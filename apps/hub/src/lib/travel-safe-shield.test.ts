import { describe, expect, it } from "vitest";

import {
  planShieldDeposits,
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
    ).toEqual([
      { token: STRK, amountBaseUnits: "80", towardAmountBaseUnits: "70", towardReserveBaseUnits: "10" },
    ]);
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
      { token: STRK, amountBaseUnits: "6", towardAmountBaseUnits: "0", towardReserveBaseUnits: "6" },
      { token: USDC, amountBaseUnits: "1500", towardAmountBaseUnits: "1500", towardReserveBaseUnits: "0" },
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
    ).toEqual([
      { token: STRK, amountBaseUnits: "6", towardAmountBaseUnits: "5", towardReserveBaseUnits: "1" },
    ]);
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
    ).toEqual([
      { token: STRK, amountBaseUnits: "6", towardAmountBaseUnits: "0", towardReserveBaseUnits: "6" },
    ]);
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
});
