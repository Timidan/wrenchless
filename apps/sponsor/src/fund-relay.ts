import {
  computeRecoveryRegistrationHash,
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
import type {
  ReadyAccountSignatureVerifier,
  RecoveryIndex,
} from "./recovery-index.js";

export type RefillFundSubmission = {
  summary: RefillFundInspectionSummary;
  transactionHash: string;
} & (
  | { status: "submitted" }
  | { status: "finalized"; receipt: RefillFundFinalityEvidence }
);

export type RefillFundEstimate = {
  status: "estimated";
  summary: RefillFundInspectionSummary;
};

export type RefillFundRelayErrorCode =
  | "fund_broadcast_disabled"
  | "daily_fund_budget_exhausted"
  | "active_safe_exists"
  | "recovery_not_approved"
  | "fund_cost_changed"
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

export function assertAcceptedMaximumSpend(
  maximumSpendFri: bigint,
  acceptedMaxSpendFri: bigint,
): void {
  if (maximumSpendFri > acceptedMaxSpendFri) {
    throw new RefillFundRelayError("fund_cost_changed");
  }
}

/**
 * The consumer-facing bridge to the already hardened FUND relay path.
 *
 * A prepared artifact contains a short-lived proof. Estimation and submission
 * are separate requests, but the service never retains the artifact. Only one
 * request is admitted at a time because the operator has one nonce stream.
 * The submitter must repeat the maximum spend shown during estimation; a
 * changed server ceiling is rejected before any budget is reserved or any
 * transaction is broadcast.
 */
export class RefillFundRelay {
  private busy = false;
  private readonly budget: FundSpendBudget;

  constructor(
    private readonly config: SponsorConfig,
    private readonly recoveryIndex: RecoveryIndex,
    private readonly signatureVerifier: ReadyAccountSignatureVerifier,
  ) {
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

  private async assertRecoveryApproved(
    artifact: RefillFundArtifact,
    client: StarknetRegistrationCanaryClient,
  ): Promise<void> {
    const recoveryApproved = await this.signatureVerifier.verify(
      artifact.recoveryAccount,
      computeRecoveryRegistrationHash({
        chainId: artifact.chainId,
        recoveryAccount: artifact.recoveryAccount,
        helperAddress: artifact.helperAddress,
        stateId: artifact.stateId,
        claimCommitment: artifact.claimCommitment,
        recoveryCommitment: artifact.recoveryCommitment,
        tokenAddress: artifact.tokenAddress,
        amountFri: artifact.amountFri,
        expiry: artifact.expiry,
      }),
      artifact.recoveryAuthorization,
    );
    if (!recoveryApproved) {
      throw new RefillFundRelayError("recovery_not_approved");
    }
    const previous = await this.recoveryIndex.get(artifact.recoveryAccount);
    if (previous === null || BigInt(previous.stateId) === BigInt(artifact.stateId)) {
      return;
    }
    const previousState = await client.readRefillState(
      this.config.helperAddress,
      previous.stateId,
    );
    if (previousState?.status === "Funded") {
      throw new RefillFundRelayError("active_safe_exists");
    }
  }

  private relayConfig(broadcast: boolean): RelayCanaryConfig {
    const config: RelayCanaryConfig = {
      artifactPath: "[request-body]",
      rpcUrl: this.config.rpcUrl,
      relayAddress: this.config.accountAddress,
      broadcast,
      poolAddress: this.config.poolAddress,
      strkAddress: this.config.tokenAddress,
      maxPoolFeeFri: this.config.maxPoolFeeFri,
      maxTransactionFeeFri: this.config.maxTransactionFeeFri,
    };
    if (broadcast) config.relayPrivateKey = this.config.accountPrivateKey;
    return config;
  }

  private releaseAfterFinality(
    client: StarknetRegistrationCanaryClient,
    artifact: RefillFundArtifact,
    transactionHash: string,
  ): void {
    void client
      .waitForRefillFundFinality({
        transactionHash,
        poolAddress: this.config.poolAddress,
        helperAddress: this.config.helperAddress,
        relayAddress: this.config.accountAddress,
        stateId: artifact.stateId,
        claimCommitment: artifact.claimCommitment,
        recoveryCommitment: artifact.recoveryCommitment,
        tokenAddress: artifact.tokenAddress,
        amountFri: artifact.amountFri,
        expiry: artifact.expiry,
      })
      .catch(() => undefined)
      .finally(() => {
        this.busy = false;
      });
  }

  async estimate(value: JsonValue): Promise<RefillFundEstimate> {
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
      const client = new StarknetRegistrationCanaryClient(
        this.config.rpcUrl,
        this.config.accountAddress,
      );
      await this.assertRecoveryApproved(artifact, client);
      const result = await inspectRefillFund({
        artifact,
        config: this.relayConfig(false),
        configuredHelperAddress: this.config.helperAddress,
        client,
        minimumAmountFri: this.config.minFundAmountFri,
        minimumRemainingDurationSeconds: this.config.minFundDurationSeconds,
        maximumRemainingDurationSeconds: this.config.maxFundDurationSeconds,
      });
      return { status: "estimated", summary: result.summary };
    } catch (cause) {
      if (cause instanceof RefillFundRelayError) throw cause;
      throw new RefillFundRelayError("fund_rejected", { cause });
    } finally {
      this.busy = false;
    }
  }

  async submit(
    value: JsonValue,
    acceptedMaxSpendFri: bigint,
  ): Promise<RefillFundSubmission> {
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
    let finalityContinuesInBackground = false;
    try {
      const client = new StarknetRegistrationCanaryClient(
        this.config.rpcUrl,
        this.config.accountAddress,
      );
      await this.assertRecoveryApproved(artifact, client);
      const result = await inspectRefillFund({
        artifact,
        config: this.relayConfig(true),
        configuredHelperAddress: this.config.helperAddress,
        client,
        minimumAmountFri: this.config.minFundAmountFri,
        minimumRemainingDurationSeconds: this.config.minFundDurationSeconds,
        maximumRemainingDurationSeconds: this.config.maxFundDurationSeconds,
        waitForFinality: false,
        beforeBroadcast: async (maximumSpendFri) => {
          assertAcceptedMaximumSpend(maximumSpendFri, acceptedMaxSpendFri);
          await this.recoveryIndex.put(artifact.recoveryAccount, {
            stateId: artifact.stateId,
            recoverySalt: artifact.recoverySalt,
          });
          await this.budget.reserve(maximumSpendFri);
        },
      });
      if (result.transactionHash === undefined) {
        throw new Error("FUND relay returned no transaction hash");
      }
      if (result.receipt === undefined) {
        finalityContinuesInBackground = true;
        this.releaseAfterFinality(client, artifact, result.transactionHash);
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
      if (!finalityContinuesInBackground) this.busy = false;
    }
  }
}
