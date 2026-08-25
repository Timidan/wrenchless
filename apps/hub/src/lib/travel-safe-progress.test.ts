import { describe, expect, it } from "vitest";

import {
  deriveTravelSafeFundProgress,
  type TravelSafeFundMoment,
} from "./travel-safe-progress";

describe("deriveTravelSafeFundProgress", () => {
  it.each<
    [TravelSafeFundMoment, string | null, string, string]
  >([
    ["approving", "approve", "not-sent", "No transaction sent"],
    ["estimating", "cost", "not-sent", "No transaction sent"],
    ["cost-ready", "cost", "not-sent", "No transaction sent"],
    ["submitting", "submit", "unknown", "Checking whether it was sent"],
    ["unknown", "submit", "unknown", "Submission status unknown"],
    ["confirming", "confirm", "submitted", "Transaction submitted"],
    ["confirmed", null, "locked", "Safe locked"],
  ])(
    "maps %s to factual progress",
    (moment, currentStep, money, moneyLabel) => {
      const progress = deriveTravelSafeFundProgress(moment);
      expect(
        progress.steps.find((step) => step.state === "current")?.id ?? null,
      ).toBe(currentStep);
      expect(progress.money).toBe(money);
      expect(progress.moneyLabel).toBe(moneyLabel);
    },
  );
});
