import type {
  JsonObject,
  JsonValue,
  RefillFundArtifact,
  RefillFundRelayPlan,
  RegistrationCanaryArtifact,
  RegistrationRelayPlan,
} from "@wrenchless/canary-core";
import { jsonValueSchema } from "@wrenchless/canary-core";
import {
  Account,
  constants,
  hash,
  RpcProvider,
  shortString,
  TransactionExecutionStatus,
  TransactionFinalityStatus,
  type ResourceBoundsBN,
} from "starknet";
import { z } from "zod";

import type {
  RefillFundFinalityEvidence,
  RefillFundFinalityRequest,
} from "./refill-inspect.js";
import { RefillFundFinalityUnknownError } from "./refill-inspect.js";
import type {
  RegistrationCanaryClient,
  RegistrationFinalityEvidence,
  RegistrationFinalityRequest,
  RelayFeeEstimate,
} from "./inspect.js";

const DRY_RUN_SIGNER = "0x1";
const RPC_TIMEOUT_MILLISECONDS = 30_000;
const U128_SHIFT = 128n;
const VIEWING_KEY_SET_SELECTOR = hash.getSelectorFromName("ViewingKeySet");
const REFILL_FUNDED_SELECTOR = hash.getSelectorFromName("Funded");
const EXPECTED_SERVER_ACTION_VARIANTS = [
  "WriteOnce",
  "Append",
  "TransferFrom",
  "TransferTo",
  "EmitViewingKeySet",
  "EmitWithdrawal",
  "EmitDeposit",
  "EmitOpenNoteCreated",
  "EmitEncNoteCreated",
  "EmitNoteUsed",
  "Invoke",
  "InvokeWithComputation",
] as const;

const boundedRpcFetch: typeof fetch = (input, init = {}) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.timeout(RPC_TIMEOUT_MILLISECONDS),
  });

type AbiRecord = JsonObject;

const jsonObjectSchema = z.record(z.string(), z.json());
const stringSchema = z.string();
const numberSchema = z.number();

function requireRecord(
  value: JsonValue | undefined,
  label: string,
): JsonObject {
  const result = jsonObjectSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} is not an object`);
  }
  return result.data;
}

function requireString(value: JsonValue | undefined, label: string): string {
  const result = stringSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} is not a string`);
  }
  return result.data;
}

function requireFelt(value: JsonValue | undefined, label: string): bigint {
  const felt = requireString(value, label);
  try {
    return BigInt(felt);
  } catch (error) {
    throw new Error(`${label} is not a felt`, { cause: error });
  }
}

function sameFelt(
  actual: JsonValue | undefined,
  expected: string,
  label: string,
): boolean {
  return requireFelt(actual, label) === BigInt(expected);
}

function requireFinalizedBlockNumber(receipt: JsonObject): number {
  const result = numberSchema
    .int()
    .nonnegative()
    .safeParse(receipt.block_number);
  if (!result.success || !Number.isSafeInteger(result.data)) {
    throw new Error("registration receipt has no finalized block number");
  }
  return result.data;
}

function providerJson<T>(value: T): JsonValue {
  return jsonValueSchema.parse(JSON.parse(JSON.stringify(value)));
}

type RegistrationFinalityInput = {
  request: RegistrationFinalityRequest;
  receipt: JsonValue;
  transaction: JsonValue;
  registeredPublicKey: bigint;
};

export function assertRegistrationFinality(
  input: RegistrationFinalityInput,
): RegistrationFinalityEvidence {
  const { request, registeredPublicKey } = input;
  const receipt = requireRecord(input.receipt, "transaction receipt");
  if (receipt.execution_status !== "SUCCEEDED") {
    throw new Error("registration transaction did not succeed");
  }
  if (
    receipt.finality_status !== "ACCEPTED_ON_L2" &&
    receipt.finality_status !== "ACCEPTED_ON_L1"
  ) {
    throw new Error("registration transaction is not finalized");
  }
  if (
    !sameFelt(
      receipt.transaction_hash,
      request.transactionHash,
      "receipt transaction hash",
    )
  ) {
    throw new Error("receipt transaction hash does not match submission");
  }
  const blockNumber = requireFinalizedBlockNumber(receipt);

  const fee = requireRecord(receipt.actual_fee, "receipt actual fee");
  if (fee.unit !== "FRI") {
    throw new Error("registration fee is not denominated in FRI");
  }
  const actualFeeFri = requireFelt(fee.amount, "receipt actual fee amount");

  const transaction = requireRecord(input.transaction, "transaction");
  if (transaction.type !== "INVOKE") {
    throw new Error("registration transaction is not an invoke");
  }
  if (
    !sameFelt(
      transaction.transaction_hash,
      request.transactionHash,
      "transaction hash",
    )
  ) {
    throw new Error("transaction hash does not match submission");
  }
  if (
    !sameFelt(
      transaction.sender_address,
      request.relayAddress,
      "transaction sender",
    )
  ) {
    throw new Error("registration transaction sender does not match relay");
  }

  if (!Array.isArray(receipt.events)) {
    throw new Error("registration receipt has no events");
  }
  const matchingEvents = receipt.events.filter((eventValue) => {
    const event = requireRecord(eventValue, "receipt event");
    if (!Array.isArray(event.keys) || !Array.isArray(event.data)) {
      throw new Error("registration receipt contains a malformed event");
    }
    return (
      event.keys.length === 3 &&
      event.data.length === 3 &&
      sameFelt(event.from_address, request.poolAddress, "event source") &&
      sameFelt(event.keys[0], VIEWING_KEY_SET_SELECTOR, "event selector") &&
      sameFelt(event.keys[1], request.coverAddress, "event viewing-key user") &&
      sameFelt(
        event.keys[2],
        request.viewingPublicKey,
        "event viewing public key",
      )
    );
  });
  if (matchingEvents.length !== 1) {
    throw new Error("receipt does not contain the expected ViewingKeySet event");
  }

  if (registeredPublicKey !== BigInt(request.viewingPublicKey)) {
    throw new Error("finalized registration state does not match artifact");
  }

  return {
    transactionHash: request.transactionHash,
    blockNumber: blockNumber.toString(),
    finalityStatus: receipt.finality_status,
    executionStatus: "SUCCEEDED",
    senderAddress: request.relayAddress,
    actualFeeFri: actualFeeFri.toString(),
    viewingKeyUser: request.coverAddress,
    viewingPublicKey: request.viewingPublicKey,
  };
}

export type RefillStateSnapshot = {
  claimCommitment: string;
  refundPublicKey: string;
  tokenAddress: string;
  amountFri: bigint;
  expiry: bigint;
  status: "Funded" | "Claimed" | "Refunded";
};

type RefillFundFinalityInput = {
  request: RefillFundFinalityRequest;
  receipt: JsonValue;
  transaction: JsonValue;
  state: RefillStateSnapshot;
  totalLiabilityFri: bigint;
  helperBalanceFri: bigint;
};

export function assertRefillFundFinality(
  input: RefillFundFinalityInput,
): RefillFundFinalityEvidence {
  const { request, state, totalLiabilityFri, helperBalanceFri } = input;
  const receipt = requireRecord(input.receipt, "transaction receipt");
  if (receipt.execution_status !== "SUCCEEDED") {
    throw new Error("refill FUND transaction did not succeed");
  }
  if (
    receipt.finality_status !== "ACCEPTED_ON_L2" &&
    receipt.finality_status !== "ACCEPTED_ON_L1"
  ) {
    throw new Error("refill FUND transaction is not finalized");
  }
  if (
    !sameFelt(
      receipt.transaction_hash,
      request.transactionHash,
      "receipt transaction hash",
    )
  ) {
    throw new Error("receipt transaction hash does not match submission");
  }
  const blockNumber = requireFinalizedBlockNumber(receipt);
  const fee = requireRecord(receipt.actual_fee, "receipt actual fee");
  if (fee.unit !== "FRI") {
    throw new Error("refill FUND fee is not denominated in FRI");
  }
  const actualFeeFri = requireFelt(fee.amount, "receipt actual fee amount");

  const transaction = requireRecord(input.transaction, "transaction");
  if (transaction.type !== "INVOKE") {
    throw new Error("refill FUND transaction is not an invoke");
  }
  if (
    !sameFelt(
      transaction.transaction_hash,
      request.transactionHash,
      "transaction hash",
    )
  ) {
    throw new Error("transaction hash does not match submission");
  }
  if (
    !sameFelt(
      transaction.sender_address,
      request.relayAddress,
      "transaction sender",
    )
  ) {
    throw new Error("refill FUND transaction sender does not match relay");
  }

  if (!Array.isArray(receipt.events)) {
    throw new Error("refill FUND receipt has no events");
  }
  const matchingEvents = receipt.events.filter((eventValue) => {
    const event = requireRecord(eventValue, "receipt event");
    if (!Array.isArray(event.keys) || !Array.isArray(event.data)) {
      throw new Error("refill FUND receipt contains a malformed event");
    }
    return (
      event.keys.length === 3 &&
      event.data.length === 2 &&
      sameFelt(event.from_address, request.helperAddress, "event source") &&
      sameFelt(event.keys[0], REFILL_FUNDED_SELECTOR, "event selector") &&
      sameFelt(event.keys[1], request.stateId, "event state id") &&
      sameFelt(event.keys[2], request.tokenAddress, "event token") &&
      sameFelt(event.data[0], request.amountFri, "event amount") &&
      sameFelt(event.data[1], request.expiry, "event expiry")
    );
  });
  if (matchingEvents.length !== 1) {
    throw new Error("receipt does not contain the expected Funded event");
  }

  if (
    BigInt(state.claimCommitment) !== BigInt(request.claimCommitment) ||
    BigInt(state.refundPublicKey) !== BigInt(request.refundPublicKey) ||
    BigInt(state.tokenAddress) !== BigInt(request.tokenAddress) ||
    state.amountFri !== BigInt(request.amountFri) ||
    state.expiry !== BigInt(request.expiry) ||
    state.status !== "Funded"
  ) {
    throw new Error("finalized helper state does not match FUND artifact");
  }
  if (helperBalanceFri < totalLiabilityFri) {
    throw new Error("helper token balance is below its recorded liability");
  }

  return {
    transactionHash: request.transactionHash,
    blockNumber: blockNumber.toString(),
    finalityStatus: receipt.finality_status,
    executionStatus: "SUCCEEDED",
    senderAddress: request.relayAddress,
    actualFeeFri: actualFeeFri.toString(),
    helperAddress: request.helperAddress,
    stateId: request.stateId,
    tokenAddress: request.tokenAddress,
    amountFri: request.amountFri,
    expiry: request.expiry,
    totalLiabilityFri: totalLiabilityFri.toString(),
    helperBalanceFri: helperBalanceFri.toString(),
  };
}

function parseAbi(abi: JsonValue): readonly JsonValue[] {
  const serialized = stringSchema.safeParse(abi);
  const parsed = serialized.success
    ? jsonValueSchema.parse(JSON.parse(serialized.data))
    : abi;
  const result = z.array(z.json()).safeParse(parsed);
  if (!result.success) {
    throw new Error("pool class does not expose a Cairo ABI array");
  }
  return result.data;
}

function collectAbiRecords(entries: readonly JsonValue[]): AbiRecord[] {
  const records: AbiRecord[] = [];
  for (const entry of entries) {
    const recordResult = jsonObjectSchema.safeParse(entry);
    if (!recordResult.success) {
      continue;
    }
    const record = recordResult.data;
    records.push(record);
    const itemsResult = z.array(z.json()).safeParse(record.items);
    if (itemsResult.success) {
      records.push(...collectAbiRecords(itemsResult.data));
    }
  }
  return records;
}

function requireFunction(
  records: readonly AbiRecord[],
  name: string,
  inputCount: number,
): void {
  const entry = records.find(
    (record) => record.type === "function" && record.name === name,
  );
  if (entry === undefined) {
    throw new Error(`pool ABI is missing ${name}`);
  }
  if (!Array.isArray(entry.inputs) || entry.inputs.length !== inputCount) {
    throw new Error(`pool ${name} signature is incompatible`);
  }
}

export function assertPrivacyPoolAbi(abi: JsonValue): void {
  let records: AbiRecord[];
  try {
    records = collectAbiRecords(parseAbi(abi));
  } catch (error) {
    throw new Error("pool class does not expose a readable Cairo ABI", {
      cause: error,
    });
  }

  requireFunction(records, "apply_actions", 2);
  requireFunction(records, "get_public_key", 1);
  requireFunction(records, "get_fee_amount", 0);
  requireFunction(records, "get_version", 0);
  requireFunction(records, "get_proof_validity_blocks", 0);
  requireFunction(records, "is_paused", 0);

  const serverAction = records.find(
    (record) =>
      record.type === "enum" &&
      stringSchema.safeParse(record.name).success &&
      requireString(record.name, "pool enum name").endsWith("::ServerAction"),
  );
  if (serverAction === undefined) {
    throw new Error("pool ABI is missing the ServerAction enum");
  }
  const variantsResult = z
    .array(z.object({ name: z.string() }))
    .safeParse(serverAction.variants);
  if (!variantsResult.success) {
    throw new Error("pool ServerAction enum contains an invalid variant");
  }
  const actualVariants = variantsResult.data.map((variant) => variant.name);
  if (
    actualVariants.length !== EXPECTED_SERVER_ACTION_VARIANTS.length ||
    actualVariants.some(
      (variant, index) => variant !== EXPECTED_SERVER_ACTION_VARIANTS[index],
    )
  ) {
    throw new Error(
      "pool ServerAction layout does not match the canary decoder",
    );
  }
}

function parseSingleFelt(result: readonly string[], label: string): bigint {
  if (result.length !== 1 || result[0] === undefined) {
    throw new Error(`${label} returned an incompatible value`);
  }
  return BigInt(result[0]);
}

function parseU256(result: readonly string[], label: string): bigint {
  if (result.length !== 2 || result[0] === undefined || result[1] === undefined) {
    throw new Error(`${label} returned an incompatible u256`);
  }
  return BigInt(result[0]) + (BigInt(result[1]) << U128_SHIFT);
}

function parseRefillState(result: readonly string[]): RefillStateSnapshot {
  const parsed = z
    .tuple([
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
    ])
    .safeParse(result);
  if (!parsed.success) {
    throw new Error("get_state returned an incompatible refill state");
  }
  const [claimCommitment, refundPublicKey, tokenAddress, amount, expiry, status] =
    parsed.data;
  const statusValue = BigInt(status);
  const statusName =
    statusValue === 1n
      ? "Funded"
      : statusValue === 2n
        ? "Claimed"
        : statusValue === 3n
          ? "Refunded"
          : undefined;
  if (statusName === undefined) {
    throw new Error("get_state returned an invalid refill status");
  }
  return {
    claimCommitment,
    refundPublicKey,
    tokenAddress,
    amountFri: BigInt(amount),
    expiry: BigInt(expiry),
    status: statusName,
  };
}

export class StarknetRegistrationCanaryClient
  implements RegistrationCanaryClient
{
  private readonly provider: RpcProvider;

  constructor(
    rpcUrl: string,
    private readonly relayAddress: string,
    provider?: RpcProvider,
  ) {
    this.provider =
      provider ?? new RpcProvider({ nodeUrl: rpcUrl, baseFetch: boundedRpcFetch });
  }

  async assertPoolInterface(poolAddress: string): Promise<{
    chainId: "SN_MAIN";
    classHash: string;
  }> {
    const [chainId, classHash] = await Promise.all([
      this.provider.getChainId(),
      this.provider.getClassHashAt(poolAddress, "latest"),
    ]);
    if (chainId !== constants.StarknetChainId.SN_MAIN) {
      throw new Error(`RPC is not Starknet mainnet: ${chainId}`);
    }
    const contractClass = await this.provider.getClassByHash(classHash);
    if (!("abi" in contractClass)) {
      throw new Error("pool class response does not contain an ABI");
    }
    assertPrivacyPoolAbi(jsonValueSchema.parse(contractClass.abi));
    return { chainId: "SN_MAIN", classHash };
  }

  async assertRefillHelper(
    helperAddress: string,
    poolAddress: string,
    tokenAddress: string,
  ): Promise<{ classHash: string }> {
    const [classHash, configuredPool, configuredToken] = await Promise.all([
      this.provider.getClassHashAt(helperAddress, "latest"),
      this.provider.callContract(
        {
          contractAddress: helperAddress,
          entrypoint: "privacy_pool",
          calldata: [],
        },
        "latest",
      ),
      this.provider.callContract(
        {
          contractAddress: helperAddress,
          entrypoint: "allowed_token",
          calldata: [],
        },
        "latest",
      ),
    ]);
    if (parseSingleFelt(configuredPool, "privacy_pool") !== BigInt(poolAddress)) {
      throw new Error("refill helper is configured for a different privacy pool");
    }
    if (
      parseSingleFelt(configuredToken, "allowed_token") !== BigInt(tokenAddress)
    ) {
      throw new Error("refill helper is configured for a different token");
    }
    return { classHash };
  }

  async readPoolVersion(poolAddress: string): Promise<string> {
    const result = await this.provider.callContract(
      { contractAddress: poolAddress, entrypoint: "get_version", calldata: [] },
      "latest",
    );
    const version = parseSingleFelt(result, "get_version");
    try {
      return shortString.decodeShortString(`0x${version.toString(16)}`);
    } catch (error) {
      throw new Error("pool returned an invalid short-string version", {
        cause: error,
      });
    }
  }

  async readLatestBlockNumber(): Promise<bigint> {
    return BigInt(await this.provider.getBlockNumber());
  }

  async readLatestBlockTimestamp(): Promise<bigint> {
    const block = await this.provider.getBlock("latest");
    const result = z.object({ timestamp: z.number().int().nonnegative() }).safeParse(
      block,
    );
    if (!result.success || !Number.isSafeInteger(result.data.timestamp)) {
      throw new Error("RPC returned a block without a valid timestamp");
    }
    return BigInt(result.data.timestamp);
  }

  async readProofValidityBlocks(poolAddress: string): Promise<bigint> {
    return parseSingleFelt(
      await this.provider.callContract(
        {
          contractAddress: poolAddress,
          entrypoint: "get_proof_validity_blocks",
          calldata: [],
        },
        "latest",
      ),
      "get_proof_validity_blocks",
    );
  }

  async readBlockHash(blockNumber: bigint): Promise<string> {
    if (blockNumber > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("block number exceeds JavaScript's safe integer range");
    }
    const block = await this.provider.getBlock(Number(blockNumber));
    const result = z.object({ block_hash: z.string() }).safeParse(block);
    if (!result.success) {
      throw new Error("RPC returned a block without a canonical hash");
    }
    return result.data.block_hash;
  }

  async readPoolPaused(poolAddress: string): Promise<boolean> {
    const result = await this.provider.callContract(
      { contractAddress: poolAddress, entrypoint: "is_paused", calldata: [] },
      "latest",
    );
    const value = parseSingleFelt(result, "is_paused");
    if (value !== 0n && value !== 1n) {
      throw new Error("is_paused returned a non-boolean value");
    }
    return value === 1n;
  }

  async readPoolFeeFri(poolAddress: string): Promise<bigint> {
    return parseSingleFelt(
      await this.provider.callContract(
        {
          contractAddress: poolAddress,
          entrypoint: "get_fee_amount",
          calldata: [],
        },
        "latest",
      ),
      "get_fee_amount",
    );
  }

  async readCoverPublicKey(
    poolAddress: string,
    coverAddress: string,
  ): Promise<bigint> {
    return parseSingleFelt(
      await this.provider.callContract(
        {
          contractAddress: poolAddress,
          entrypoint: "get_public_key",
          calldata: [coverAddress],
        },
        "latest",
      ),
      "get_public_key",
    );
  }

  async readRelayBalanceFri(
    strkAddress: string,
    relayAddress: string,
  ): Promise<bigint> {
    return parseU256(
      await this.provider.callContract(
        {
          contractAddress: strkAddress,
          entrypoint: "balance_of",
          calldata: [relayAddress],
        },
        "latest",
      ),
      "STRK balance_of",
    );
  }

  async readRefillStateExists(
    helperAddress: string,
    stateId: string,
  ): Promise<boolean> {
    const value = parseSingleFelt(
      await this.provider.callContract(
        {
          contractAddress: helperAddress,
          entrypoint: "state_exists",
          calldata: [stateId],
        },
        "latest",
      ),
      "state_exists",
    );
    if (value !== 0n && value !== 1n) {
      throw new Error("state_exists returned a non-boolean value");
    }
    return value === 1n;
  }

  private makeAccount(signer: string): Account {
    return new Account({
      provider: this.provider,
      address: this.relayAddress,
      signer,
    });
  }

  private async estimate(
    plan: RegistrationRelayPlan | RefillFundRelayPlan,
    artifact: RegistrationCanaryArtifact | RefillFundArtifact,
    signer: string,
    skipValidate: boolean,
  ): Promise<RelayFeeEstimate> {
    const estimate = await this.makeAccount(signer).estimateInvokeFee(
      plan.calls,
      {
        blockIdentifier: "latest",
        tip: 0n,
        proofFacts: artifact.proofFacts,
        proof: artifact.proof,
        skipValidate,
      },
    );
    return {
      overallFeeFri: estimate.overall_fee,
      resourceBounds: estimate.resourceBounds,
    };
  }

  async estimateUnsigned(
    plan: RegistrationRelayPlan | RefillFundRelayPlan,
    artifact: RegistrationCanaryArtifact | RefillFundArtifact,
  ): Promise<RelayFeeEstimate> {
    return this.estimate(plan, artifact, DRY_RUN_SIGNER, true);
  }

  async estimateSigned(
    plan: RegistrationRelayPlan | RefillFundRelayPlan,
    artifact: RegistrationCanaryArtifact | RefillFundArtifact,
    privateKey: string,
  ): Promise<RelayFeeEstimate> {
    return this.estimate(plan, artifact, privateKey, false);
  }

  async broadcast(
    plan: RegistrationRelayPlan | RefillFundRelayPlan,
    artifact: RegistrationCanaryArtifact | RefillFundArtifact,
    privateKey: string,
    resourceBounds: ResourceBoundsBN,
  ): Promise<string> {
    const result = await this.makeAccount(privateKey).execute(plan.calls, {
      tip: 0n,
      proofFacts: artifact.proofFacts,
      proof: artifact.proof,
      resourceBounds,
    });
    return result.transaction_hash;
  }

  async waitForRegistrationFinality(
    request: RegistrationFinalityRequest,
  ): Promise<RegistrationFinalityEvidence> {
    const receipt = await this.provider.waitForTransaction(
      request.transactionHash,
      {
        successStates: [
          TransactionFinalityStatus.ACCEPTED_ON_L2,
          TransactionFinalityStatus.ACCEPTED_ON_L1,
        ],
        errorStates: [TransactionExecutionStatus.REVERTED],
      },
    );
    const receiptValue = providerJson(receipt);
    const receiptRecord = requireRecord(receiptValue, "transaction receipt");
    const blockNumber = requireFinalizedBlockNumber(receiptRecord);
    const [transaction, publicKeyResult] = await Promise.all([
      this.provider.getTransactionByHash(request.transactionHash),
      this.provider.callContract(
        {
          contractAddress: request.poolAddress,
          entrypoint: "get_public_key",
          calldata: [request.coverAddress],
        },
        blockNumber,
      ),
    ]);

    return assertRegistrationFinality({
      request,
      receipt: receiptValue,
      transaction: providerJson(transaction),
      registeredPublicKey: parseSingleFelt(
        publicKeyResult,
        "get_public_key at registration block",
      ),
    });
  }

  async waitForRefillFundFinality(
    request: RefillFundFinalityRequest,
  ): Promise<RefillFundFinalityEvidence> {
    let receipt: Awaited<ReturnType<RpcProvider["waitForTransaction"]>>;
    try {
      receipt = await this.provider.waitForTransaction(
        request.transactionHash,
        {
          retries: 20,
          retryInterval: 2_500,
          successStates: [
            TransactionFinalityStatus.ACCEPTED_ON_L2,
            TransactionFinalityStatus.ACCEPTED_ON_L1,
          ],
          errorStates: [TransactionExecutionStatus.REVERTED],
        },
      );
    } catch (cause) {
      if (
        cause instanceof Error &&
        cause.message.includes("waitForTransaction timed-out")
      ) {
        throw new RefillFundFinalityUnknownError(request.transactionHash, {
          cause,
        });
      }
      throw cause;
    }
    const receiptValue = providerJson(receipt);
    const receiptRecord = requireRecord(receiptValue, "transaction receipt");
    const blockNumber = requireFinalizedBlockNumber(receiptRecord);
    const [transaction, stateResult, liabilityResult, helperBalanceResult] =
      await Promise.all([
        this.provider.getTransactionByHash(request.transactionHash),
        this.provider.callContract(
          {
            contractAddress: request.helperAddress,
            entrypoint: "get_state",
            calldata: [request.stateId],
          },
          blockNumber,
        ),
        this.provider.callContract(
          {
            contractAddress: request.helperAddress,
            entrypoint: "total_liability",
            calldata: [],
          },
          blockNumber,
        ),
        this.provider.callContract(
          {
            contractAddress: request.tokenAddress,
            entrypoint: "balance_of",
            calldata: [request.helperAddress],
          },
          blockNumber,
        ),
      ]);

    return assertRefillFundFinality({
      request,
      receipt: receiptValue,
      transaction: providerJson(transaction),
      state: parseRefillState(stateResult),
      totalLiabilityFri: parseU256(liabilityResult, "total_liability"),
      helperBalanceFri: parseU256(helperBalanceResult, "helper STRK balance"),
    });
  }
}
