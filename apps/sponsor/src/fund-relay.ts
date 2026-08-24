import {
  parseRefillFundArtifact,
  type JsonValue,
  type RefillFundArtifact,
} from "@wrenchless/canary-core";
import type { RelayCanaryConfig } from "@wrenchless/relay-canary/config";
import {
  inspectRefillFund,
  type RefillFundFinalityEvidence,
  type RefillFundInspectionSummary,
} from "@wrenchless/relay-canary/refill-relay";
import { StarknetRegistrationCanaryClient } from "@wrenchless/relay-canary/starknet-client";

import type { SponsorConfig } from "./config.js";
import {
  FundBudgetExceededError,
  FundSpendBudget,
} from "./fund-budget.js";

export type RefillFundSubmission = {
  summary: RefillFundInspectionSummary;
  transactionHash: string;
} & (
  | { status: "submitted" }
  | { status: "finalized"; receipt: RefillFundFinalityEvidence }
);

export type RefillFundRelayErrorCode =
  | "fund_broadcast_disabled"
  | "daily_fund_budget_exhausted"
  | "fund_rejected"
  | "relay_busy";

export class RefillFundRelayError extends Error {
  constructor(
    readonly code: RefillFundRelayErrorCode,
    options: ErrorOptions = {},
  ) {
    super(code, options);
    this.name = "RefillFundRelayError";
  }
}

/**
 * The consumer-facing bridge to the already hardened FUND relay path.
 *
 * A prepared artifact contains a short-lived proof, so it is validated and
 * submitted in one request. Only one request is admitted at a time: the
 * operator account has one nonce stream and parallel estimation would create
 * an ambiguous retry state. No artifact or proof is retained here.
 */
export class RefillFundRelay {
  private busy = false;
  private readonly budget: FundSpendBudget;

  constructor(private readonly config: SponsorConfig) {
    this.budget = new FundSpendBudget(
      config.fundBudgetPath,
      config.maxDailyFundSpendFri,
    );
  }

  async canFundOneMaximumTransaction(): Promise<boolean> {
    return (
      (await this.budget.remainingFri()) >=
      this.config.maxPoolFeeFri + this.config.maxTransactionFeeFri
    );
  }

  async submit(value: JsonValue): Promise<RefillFundSubmission> {
    if (!this.config.refillFundBroadcastEnabled) {
      throw new RefillFundRelayError("fund_broadcast_disabled");
    }
    if (this.busy) throw new RefillFundRelayError("relay_busy");

    let artifact: RefillFundArtifact;
    try {
      artifact = parseRefillFundArtifact(value);
    } catch (cause) {
      throw new RefillFundRelayError("fund_rejected", { cause });
    }

    this.busy = true;
    try {
      const relayConfig: RelayCanaryConfig = {
        artifactPath: "[request-body]",
        rpcUrl: this.config.rpcUrl,
        relayAddress: this.config.accountAddress,
        relayPrivateKey: this.config.accountPrivateKey,
        broadcast: true,
        poolAddress: this.config.poolAddress,
        strkAddress: this.config.tokenAddress,
        maxPoolFeeFri: this.config.maxPoolFeeFri,
        maxTransactionFeeFri: this.config.maxTransactionFeeFri,
      };
      const client = new StarknetRegistrationCanaryClient(
        this.config.rpcUrl,
        this.config.accountAddress,
      );
      const result = await inspectRefillFund({
        artifact,
        config: relayConfig,
        configuredHelperAddress: this.config.helperAddress,
        client,
        minimumAmountFri: this.config.minFundAmountFri,
        minimumRemainingDurationSeconds: this.config.minFundDurationSeconds,
        beforeBroadcast: (maximumSpendFri) =>
          this.budget.reserve(maximumSpendFri),
      });
      if (result.transactionHash === undefined) {
        throw new Error("FUND relay returned no transaction hash");
      }
      if (result.receipt === undefined) {
        return {
          status: "submitted",
          summary: result.summary,
          transactionHash: result.transactionHash,
        };
      }
      return {
        status: "finalized",
        summary: result.summary,
        transactionHash: result.transactionHash,
        receipt: result.receipt,
      };
    } catch (cause) {
      if (cause instanceof RefillFundRelayError) throw cause;
      if (cause instanceof FundBudgetExceededError) {
        throw new RefillFundRelayError("daily_fund_budget_exhausted", {
          cause,
        });
      }
      throw new RefillFundRelayError("fund_rejected", { cause });
    } finally {
      this.busy = false;
    }
  }
}
