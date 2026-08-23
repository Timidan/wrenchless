import { describe, expect, it } from "vitest";

import { computeCoverExposure } from "./cover-exposure";

const fri = (strk: string): string => (BigInt(strk) * 10n ** 18n).toString();

describe("computeCoverExposure", () => {
  it("counts an old private remainder once a claim makes it spendable", () => {
    const exposure = computeCoverExposure({
      publicBalanceFri: "930000000000000000",
      shieldedBalanceFri: "2100000000000000000",
      immediatelyClaimableAmountsFri: ["11000000000000000000"],
      poolFeeFri: "6000000000000000000",
      capFri: "6000000000000000000",
    });

    expect(exposure.privateSpendableFri).toBe("7100000000000000000");
    expect(exposure.totalFri).toBe("8030000000000000000");
    expect(exposure.withinCap).toBe(false);
  });

  it("counts every funded ticket the carried wallet can claim", () => {
    const exposure = computeCoverExposure({
      publicBalanceFri: fri("1"),
      shieldedBalanceFri: fri("2"),
      immediatelyClaimableAmountsFri: [fri("3"), fri("4")],
      poolFeeFri: fri("1"),
      capFri: fri("8"),
    });

    expect(exposure.immediatelyClaimableFri).toBe(fri("7"));
    expect(exposure.privateSpendableFri).toBe(fri("8"));
    expect(exposure.totalFri).toBe(fri("9"));
    expect(exposure.withinCap).toBe(false);
  });
});
