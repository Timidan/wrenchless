import {
  assertPreparedStrk20ProofFacts,
  computeTravelSafeV3DeviceCommitment,
  type JsonValue,
} from "@wrenchless/canary-core";
import {
  broadcastOutcomeIsUncertain,
  StarknetRegistrationCanaryClient,
  type PreparedStrk20RelayPlan,
} from "@wrenchless/relay-canary/starknet-client";

import type { SponsorConfig } from "./config.js";
import {
  FundBudgetExceededError,
  FundSpendBudget,
} from "./fund-budget.js";
import {
  assertAcceptedMaximumSpend,
  SponsorRelayGate,
} from "./fund-relay.js";
import {
  parseTravelSafeV3RelayArtifact,
  type TravelSafeV3RelayArtifact,
} from "./travel-safe-v3-policy.js";

const MAX_SAFE_DURATION_SECONDS = 15_552_000n;
const U128_MASK = (1n << 128n) - 1n;

function assertFeeWithinCap(overallFeeFri: bigint, maximumFeeFri: bigint): void {
  if (overallFeeFri <= 0n || overallFeeFri > maximumFeeFri) {
    throw new Error("estimated transaction fee exceeds the configured limit");
  }
}

// Recompute from the release Sierra artifact before declaration.
export const TRAVEL_SAFE_V3_CLASS_HASH =
  "0x0624c6c8f01a6d2d3533f44b3f1d6fb90367fe7fdfe667c94535a7f468b30496";

export type TravelSafeV3RelaySummary = {
  mode: "dry-run" | "broadcast";
  operation: "FUND" | "TOP_UP";
  poolAddress: string;
  poolClassHash: string;
  poolVersion: string;
  helperAddress: string;
  helperClassHash: string;
  stateId: string;
  tokenAddress: string;
  tokenSymbol: string;
  amountBaseUnits: string;
  relayAddress: string;
  poolFeeFri: string;
  estimatedTransactionFeeFri: string;
  maxTransactionFeeFri: string;
  maxSpendFri: string;
  proofBaseBlock: string;
  proofExpiresAtBlock: string;
  proofRemainingBlocks: string;
};

export type TravelSafeV3Estimate = {
  status: "estimated";
  summary: TravelSafeV3RelaySummary;
};

export type TravelSafeV3Submission = {
  status: "submitted";
  summary: TravelSafeV3RelaySummary;
  transactionHash: string;
};

export type TravelSafeV3RelayErrorCode =
  | "travel_safe_v3_disabled"
  | "travel_safe_v3_rejected"
  | "travel_safe_submission_uncertain"
  | "travel_safe_cost_changed"
  | "daily_fund_budget_exhausted"
  | "relay_busy";

export class TravelSafeV3RelayError extends Error {
  constructor(
    readonly code: TravelSafeV3RelayErrorCode,
    options: ErrorOptions = {},
  ) {
    super(code, options);
    this.name = "TravelSafeV3RelayError";
  }
}

function relayPlan(input: {
  artifact: TravelSafeV3RelayArtifact;
  poolAddress: string;
  strkAddress: string;
  poolFeeFri: bigint;
}): PreparedStrk20RelayPlan {
  return {
    calls: [
      {
        contractAddress: input.strkAddress,
        entrypoint: "approve",
        calldata: [
          input.poolAddress,
          (input.poolFeeFri & U128_MASK).toString(),
          (input.poolFeeFri >> 128n).toString(),
        ],
      },
      {
        contractAddress: input.artifact.call.contractAddress,
        entrypoint: input.artifact.call.entrypoint,
        calldata: [...input.artifact.call.calldata],
      },
    ],
  };
}

export class TravelSafeV3Relay {
  constructor(
    private readonly config: SponsorConfig,
    private readonly budget: FundSpendBudget,
    private readonly gate: SponsorRelayGate,
  ) {}

  private assertEnabled(): void {
    if (
      !this.config.travelSafeV3BroadcastEnabled ||
      this.config.travelSafeV3HelperAddress === undefined
    ) {
      throw new TravelSafeV3RelayError("travel_safe_v3_disabled");
    }
  }

  async ready(): Promise<boolean> {
    try {
      this.assertEnabled();
      const helperAddress = this.config.travelSafeV3HelperAddress!;
      if (this.config.travelSafeTokenPolicies.length === 0) return false;
      const client = new StarknetRegistrationCanaryClient(
        this.config.rpcUrl,
        this.config.accountAddress,
      );
      await Promise.all([
        client.assertPoolInterface(this.config.poolAddress),
        ...this.config.travelSafeTokenPolicies.map((policy) =>
          client.assertTravelSafeV3Helper(
            helperAddress,
            this.config.poolAddress,
            policy.address,
            TRAVEL_SAFE_V3_CLASS_HASH,
          ),
        ),
      ]);
      const [paused, poolFeeFri, relayBalanceFri, remainingBudgetFri] =
        await Promise.all([
          client.readPoolPaused(this.config.poolAddress),
          client.readPoolFeeFri(this.config.poolAddress),
          client.readRelayBalanceFri(
            this.config.tokenAddress,
            this.config.accountAddress,
          ),
          this.budget.remainingFri(),
        ]);
      const maximumSpendFri = poolFeeFri + this.config.maxTransactionFeeFri;
      return (
        !paused &&
        poolFeeFri > 0n &&
        poolFeeFri <= this.config.maxPoolFeeFri &&
        relayBalanceFri >= maximumSpendFri &&
        remainingBudgetFri >= maximumSpendFri
      );
    } catch {
      return false;
    }
  }

  private async inspect(
    artifact: TravelSafeV3RelayArtifact,
    tokenSymbol: string,
    broadcast: boolean,
    acceptedMaxSpendFri?: bigint,
  ): Promise<{
    summary: TravelSafeV3RelaySummary;
    transactionHash: string | undefined;
    client: StarknetRegistrationCanaryClient;
    reservationId: string;
    poolFeeFri: bigint;
  }> {
    const helperAddress = this.config.travelSafeV3HelperAddress!;
    const client = new StarknetRegistrationCanaryClient(
      this.config.rpcUrl,
      this.config.accountAddress,
    );
    const [poolIdentity, helperIdentity] = await Promise.all([
      client.assertPoolInterface(this.config.poolAddress),
      client.assertTravelSafeV3Helper(
        helperAddress,
        this.config.poolAddress,
        artifact.tokenAddress,
        TRAVEL_SAFE_V3_CLASS_HASH,
      ),
    ]);
    const [
      poolVersion,
      latestBlockNumber,
      latestTimestamp,
      proofValidityBlocks,
      poolPaused,
      poolFeeFri,
      relayBalanceFri,
      state,
    ] = await Promise.all([
      client.readPoolVersion(this.config.poolAddress),
      client.readLatestBlockNumber(),
      client.readLatestBlockTimestamp(),
      client.readProofValidityBlocks(this.config.poolAddress),
      client.readPoolPaused(this.config.poolAddress),
      client.readPoolFeeFri(this.config.poolAddress),
      client.readRelayBalanceFri(
        this.config.tokenAddress,
        this.config.accountAddress,
      ),
      client.readTravelSafeV3State(helperAddress, artifact.stateId),
    ]);
    if (poolPaused) throw new Error("privacy pool is paused");
    if (poolFeeFri <= 0n || poolFeeFri > this.config.maxPoolFeeFri) {
      throw new Error("privacy fee exceeds the configured limit");
    }
    const maximumSpendFri = poolFeeFri + this.config.maxTransactionFeeFri;
    if (relayBalanceFri < maximumSpendFri) {
      throw new Error("relay balance is below the maximum fee");
    }
    if ((await this.budget.remainingFri()) < maximumSpendFri) {
      throw new TravelSafeV3RelayError("daily_fund_budget_exhausted");
    }

    if (artifact.operation === "FUND") {
      if (state !== null) throw new Error("Travel Safe state already exists");
      const returnAt = BigInt(artifact.returnAt);
      if (
        returnAt <= latestTimestamp ||
        returnAt > latestTimestamp + MAX_SAFE_DURATION_SECONDS
      ) {
        throw new Error("return date is outside the supported lifetime");
      }
      if (
        BigInt(artifact.dailyAmountBaseUnits) > 0n &&
        BigInt(artifact.firstReleaseAt) < latestTimestamp
      ) {
        throw new Error("first release is already in the past");
      }
    } else {
      if (
        state === null ||
        state.status !== "Funded" ||
        BigInt(state.tokenAddress) !== BigInt(artifact.tokenAddress) ||
        state.nonce !== BigInt(artifact.nonce) ||
        latestTimestamp >= state.returnAt
      ) {
        throw new Error("top-up does not match the current Safe state");
      }
      if (
        BigInt(
          computeTravelSafeV3DeviceCommitment(
            artifact.stateId,
            artifact.devicePublicKey,
          ),
        ) !== BigInt(state.deviceCommitment)
      ) {
        throw new Error("top-up device does not match the Safe");
      }
    }

    const proofSummary = assertPreparedStrk20ProofFacts({
      artifact,
      poolClassHash: poolIdentity.classHash,
      latestBlockNumber,
      proofValidityBlocks,
    });
    if (
      BigInt(await client.readBlockHash(proofSummary.baseBlockNumber)) !==
      BigInt(proofSummary.baseBlockHash)
    ) {
      throw new Error("proof base block does not match mainnet");
    }
    const plan = relayPlan({
      artifact,
      poolAddress: this.config.poolAddress,
      strkAddress: this.config.tokenAddress,
      poolFeeFri,
    });
    const unsigned = await client.estimateUnsigned(plan, artifact);
    assertFeeWithinCap(unsigned.overallFeeFri, this.config.maxTransactionFeeFri);

    let estimate = unsigned;
    let transactionHash: string | undefined;
    const reservationId = `${artifact.operation}:${BigInt(artifact.stateId).toString(16)}`;
    if (broadcast) {
      estimate = await client.estimateSigned(
        plan,
        artifact,
        this.config.accountPrivateKey,
      );
      assertFeeWithinCap(estimate.overallFeeFri, this.config.maxTransactionFeeFri);
      if (acceptedMaxSpendFri === undefined) {
        throw new Error("accepted maximum spend is missing");
      }
      assertAcceptedMaximumSpend(maximumSpendFri, acceptedMaxSpendFri);
      await this.budget.reserve(reservationId, maximumSpendFri);
      try {
        transactionHash = await client.broadcast(
          plan,
          artifact,
          this.config.accountPrivateKey,
          estimate.resourceBounds,
        );
      } catch (cause) {
        if (broadcastOutcomeIsUncertain(cause)) {
          await this.budget.settleMaximum(reservationId).catch(() => undefined);
          throw new TravelSafeV3RelayError("travel_safe_submission_uncertain", {
            cause,
          });
        }
        await this.budget.settle(reservationId, 0n).catch(() => undefined);
        throw cause;
      }
    }

    return {
      client,
      reservationId,
      poolFeeFri,
      transactionHash,
      summary: {
        mode: broadcast ? "broadcast" : "dry-run",
        operation: artifact.operation,
        poolAddress: this.config.poolAddress,
        poolClassHash: poolIdentity.classHash,
        poolVersion,
        helperAddress,
        helperClassHash: helperIdentity.classHash,
        stateId: artifact.stateId,
        tokenAddress: artifact.tokenAddress,
        tokenSymbol,
        amountBaseUnits: artifact.amountBaseUnits,
        relayAddress: this.config.accountAddress,
        poolFeeFri: poolFeeFri.toString(),
        estimatedTransactionFeeFri: estimate.overallFeeFri.toString(),
        maxTransactionFeeFri: this.config.maxTransactionFeeFri.toString(),
        maxSpendFri: maximumSpendFri.toString(),
        proofBaseBlock: proofSummary.baseBlockNumber.toString(),
        proofExpiresAtBlock: proofSummary.expiresAtBlock.toString(),
        proofRemainingBlocks: proofSummary.remainingBlocks.toString(),
      },
    };
  }

  async estimate(
    value: JsonValue,
    expectedOperation?: "FUND" | "TOP_UP",
  ): Promise<TravelSafeV3Estimate> {
    this.assertEnabled();
    let parsed: ReturnType<typeof parseTravelSafeV3RelayArtifact>;
    try {
      parsed = parseTravelSafeV3RelayArtifact(value, this.config);
      if (
        expectedOperation !== undefined &&
        parsed.artifact.operation !== expectedOperation
      ) {
        throw new Error("operation does not match this endpoint");
      }
    } catch (cause) {
      throw new TravelSafeV3RelayError("travel_safe_v3_rejected", { cause });
    }
    if (!this.gate.tryLock()) throw new TravelSafeV3RelayError("relay_busy");
    try {
      const result = await this.inspect(
        parsed.artifact,
        parsed.tokenPolicy.symbol,
        false,
      );
      return { status: "estimated", summary: result.summary };
    } catch (cause) {
      if (cause instanceof TravelSafeV3RelayError) throw cause;
      throw new TravelSafeV3RelayError("travel_safe_v3_rejected", { cause });
    } finally {
      this.gate.unlock();
    }
  }

  async submit(
    value: JsonValue,
    acceptedMaxSpendFri: bigint,
    expectedOperation?: "FUND" | "TOP_UP",
  ): Promise<TravelSafeV3Submission> {
    this.assertEnabled();
    let parsed: ReturnType<typeof parseTravelSafeV3RelayArtifact>;
    try {
      parsed = parseTravelSafeV3RelayArtifact(value, this.config);
      if (
        expectedOperation !== undefined &&
        parsed.artifact.operation !== expectedOperation
      ) {
        throw new Error("operation does not match this endpoint");
      }
    } catch (cause) {
      throw new TravelSafeV3RelayError("travel_safe_v3_rejected", { cause });
    }
    if (!this.gate.tryLock()) throw new TravelSafeV3RelayError("relay_busy");
    let finalityContinues = false;
    try {
      const result = await this.inspect(
        parsed.artifact,
        parsed.tokenPolicy.symbol,
        true,
        acceptedMaxSpendFri,
      );
      if (result.transactionHash === undefined) {
        throw new Error("Travel Safe relay returned no transaction hash");
      }
      finalityContinues = true;
      void result.client
        .waitForSponsoredInvokeFinality(result.transactionHash)
        .then((receipt) =>
          this.budget.settle(
            result.reservationId,
            BigInt(receipt.actualFeeFri) +
              (receipt.succeeded ? result.poolFeeFri : 0n),
          ),
        )
        .catch(() => this.budget.settleMaximum(result.reservationId))
        .catch(() => undefined)
        .finally(() => this.gate.unlock());
      return {
        status: "submitted",
        summary: result.summary,
        transactionHash: result.transactionHash,
      };
    } catch (cause) {
      if (cause instanceof FundBudgetExceededError) {
        throw new TravelSafeV3RelayError("daily_fund_budget_exhausted", {
          cause,
        });
      }
      if (cause instanceof TravelSafeV3RelayError) throw cause;
      if (
        cause instanceof Error &&
        cause.message === "fund_cost_changed"
      ) {
        throw new TravelSafeV3RelayError("travel_safe_cost_changed", { cause });
      }
      throw new TravelSafeV3RelayError("travel_safe_v3_rejected", { cause });
    } finally {
      if (!finalityContinues) this.gate.unlock();
    }
  }
}
