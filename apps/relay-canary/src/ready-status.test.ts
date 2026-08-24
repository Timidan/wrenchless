import { describe, expect, it } from "vitest";

import { chooseReadyNextAction } from "./ready-status.js";

describe("chooseReadyNextAction", () => {
  it.each([
    [false, 0n, 6n, 0n, "fund_and_activate"],
    [false, 6n, 6n, 0n, "activate_account"],
    [true, 5n, 6n, 0n, "fund_registration_fee"],
    [true, 6n, 6n, 0n, "enable_private_tokens"],
    [true, 0n, 6n, 42n, "ready"],
  ] as const)(
    "classifies the account and registration state",
    (accountDeployed, publicStrkBalanceFri, registrationFeeFri, viewingPublicKey, expected) => {
      expect(
        chooseReadyNextAction({
          accountDeployed,
          publicStrkBalanceFri,
          registrationFeeFri,
          viewingPublicKey,
        }),
      ).toBe(expected);
    },
  );
});
