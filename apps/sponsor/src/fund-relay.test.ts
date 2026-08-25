import { describe, expect, it } from "vitest";

import {
  assertAcceptedMaximumSpend,
  RefillFundRelayError,
} from "./fund-relay.js";

describe("assertAcceptedMaximumSpend", () => {
  it("allows the displayed ceiling and rejects a higher broadcast ceiling", () => {
    expect(() => assertAcceptedMaximumSpend(16n, 16n)).not.toThrow();
    expect(() => assertAcceptedMaximumSpend(17n, 16n)).toThrow(
      expect.objectContaining<Partial<RefillFundRelayError>>({
        code: "fund_cost_changed",
      }),
    );
  });
});
