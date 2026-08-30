import type { SponsorConfig } from "./config.js";
import type { FundSponsorReadiness } from "./fund-readiness.js";

export type RefillFundUnavailableReason =
  | "fund_broadcast_disabled"
  | "fund_relay_balance_low"
  | "helper_configuration_mismatch"
  | "fund_readiness_unavailable"
  | "daily_fund_budget_exhausted";

export type SponsorUnavailableReason = RefillFundUnavailableReason;

export function refillFundUnavailableReason(
  readiness: FundSponsorReadiness,
  config: SponsorConfig,
): RefillFundUnavailableReason | undefined {
  if (!config.refillFundBroadcastEnabled) return "fund_broadcast_disabled";
  if (!readiness.helperMatchesConfiguration) {
    return "helper_configuration_mismatch";
  }
  if (readiness.poolPaused || !readiness.poolFeeWithinLimit) {
    return "fund_readiness_unavailable";
  }
  if (!readiness.fundRelayBalanceReady) return "fund_relay_balance_low";
  return undefined;
}
