import { describe, expect, it } from "vitest";

import {
  computeClaimableAllowance,
  formatTokenAmount,
  parseTokenAmount,
} from "./travel-safe-v3.js";

const DAY = 86_400n;

function schedule(overrides: Partial<{
  initialAmount: bigint;
  remainingAmount: bigint;
  releasedAmount: bigint;
  dailyAmount: bigint;
  firstReleaseAt: bigint;
  returnAt: bigint;
}> = {}) {
  return {
    initialAmount: 100n,
    remainingAmount: 100n,
    releasedAmount: 0n,
    dailyAmount: 10n,
    firstReleaseAt: 1_000n,
    returnAt: 1_000n + 10n * DAY,
    ...overrides,
  };
}

describe("Travel Safe v3 allowance math", () => {
  it("releases only elapsed daily allowance and accumulates missed days", () => {
    expect(computeClaimableAllowance(schedule(), 999n)).toBe(0n);
    expect(computeClaimableAllowance(schedule(), 1_000n)).toBe(10n);
    expect(
      computeClaimableAllowance(
        schedule({ remainingAmount: 80n, releasedAmount: 20n }),
        1_000n + 4n * DAY,
      ),
    ).toBe(30n);
  });

  it("caps availability at the initial entitlement and remaining liability", () => {
    expect(
      computeClaimableAllowance(
        schedule({ remainingAmount: 125n, returnAt: 1_000n + 30n * DAY }),
        1_000n + 20n * DAY,
      ),
    ).toBe(100n);
    expect(
      computeClaimableAllowance(
        schedule({ remainingAmount: 3n, releasedAmount: 20n }),
        1_000n + 4n * DAY,
      ),
    ).toBe(3n);
  });

  it("returns no scheduled allowance after the final return boundary", () => {
    expect(
      computeClaimableAllowance(schedule(), 1_000n + 10n * DAY + 1n),
    ).toBe(0n);
  });

  it("rejects internally inconsistent schedules", () => {
    expect(() =>
      computeClaimableAllowance(
        schedule({ releasedAmount: 20n }),
        1_000n,
      ),
    ).toThrow("released allowance exceeds entitlement");
    expect(() =>
      computeClaimableAllowance(schedule({ dailyAmount: -1n }), 1_000n),
    ).toThrow("non-negative");
  });
});

describe("Travel Safe token amounts", () => {
  it("parses STRK and USDC without floating point", () => {
    expect(parseTokenAmount("1.000000000000000001", 18)).toBe(
      1_000_000_000_000_000_001n,
    );
    expect(parseTokenAmount("12.345678", 6)).toBe(12_345_678n);
    expect(parseTokenAmount("0", 6)).toBe(0n);
  });

  it("formats base units without insignificant zeroes", () => {
    expect(formatTokenAmount(1_000_000_000_000_000_001n, 18)).toBe(
      "1.000000000000000001",
    );
    expect(formatTokenAmount(12_340_000n, 6)).toBe("12.34");
    expect(formatTokenAmount(0n, 6)).toBe("0");
  });

  it("rejects malformed or over-precise values", () => {
    expect(() => parseTokenAmount("1.0000001", 6)).toThrow(
      "at most 6 decimal places",
    );
    expect(() => parseTokenAmount("-1", 18)).toThrow("non-negative decimal");
    expect(() => formatTokenAmount(-1n, 18)).toThrow("non-negative");
  });
});
