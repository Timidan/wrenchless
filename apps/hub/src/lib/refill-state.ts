import type { JsonValue } from "@wrenchless/canary-core";
import { z } from "zod";

const MAINNET_RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const STATE_EXISTS_SELECTOR =
  "0x008bef61fcd2d29beac02c40e29ac0f7b11f5e15da6bb8a0a909cb1237a46f76";
const GET_STATE_SELECTOR =
  "0x03593f537ca0121e22c58378d40e0f5e2ba89b1c6d92a6990ab3066b68088f9c";
const GET_PROOF_VALIDITY_BLOCKS_SELECTOR =
  "0x11d6d65b366023adbdaeaa04008285431f4509d78e78cda7067e58fbba35147";
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const RPC_TIMEOUT_MILLISECONDS = 30_000;

const rpcErrorSchema = z.object({
  error: z.object({ code: z.number(), message: z.string() }),
  id: z.number(),
  jsonrpc: z.literal("2.0"),
});

const rpcIntegerSchema = z.union([
  z.number().int().safe().positive(),
  z.string().regex(/^[1-9][0-9]*$/),
]);

const latestBlockSchema = z.object({
  block_number: rpcIntegerSchema,
  timestamp: rpcIntegerSchema,
});

const callResultSchema = z.array(z.string());
const transactionReceiptSchema = z
  .object({
    transaction_hash: z.string(),
    execution_status: z.enum(["SUCCEEDED", "REVERTED"]).optional(),
    finality_status: z
      .enum(["RECEIVED", "ACCEPTED_ON_L2", "ACCEPTED_ON_L1"])
      .optional(),
    revert_reason: z.string().optional(),
  })
  .passthrough();

type RpcInteger = z.infer<typeof rpcIntegerSchema>;

export type RefillChainState = {
  stateId: string;
  claimCommitment: string;
  recoveryCommitment: string;
  tokenAddress: string;
  amountFri: string;
  returnDateSeconds: string;
  status: "funded" | "claimed" | "refunded";
};

export type RefillChainSnapshot = {
  blockNumber: string;
  chainTimeSeconds: string;
  state: RefillChainState | null;
};

export type TransactionReceiptStatus =
  | { name: "not-found" }
  | { name: "pending" }
  | { name: "accepted" }
  | { name: "reverted"; reason: string };

function felt(value: string, label: string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not a felt`);
  }
  if (parsed <= 0n || parsed >= STARK_FIELD_PRIME) {
    throw new Error(`${label} is outside the non-zero Stark field`);
  }
  return `0x${parsed.toString(16)}`;
}

async function rpc<Result>(input: {
  rpcUrl: string;
  method: string;
  params: JsonValue;
  fetcher: typeof fetch;
  resultSchema: z.ZodType<Result>;
}): Promise<Result> {
  const { fetcher } = input;
  const response = await fetcher(input.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(RPC_TIMEOUT_MILLISECONDS),
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: input.method,
      params: input.params,
    }),
  });
  if (!response.ok) {
    throw new Error(`Mainnet Travel Safe read returned HTTP ${response.status}`);
  }
  const body = z
    .union([
      z.object({
        id: z.number(),
        jsonrpc: z.literal("2.0"),
        result: input.resultSchema,
      }),
      rpcErrorSchema,
    ])
    .parse(await response.json());
  if (!("result" in body)) {
    throw new Error(`Mainnet Travel Safe read failed: ${body.error.message}`);
  }
  return body.result;
}

function positiveInteger(value: RpcInteger, label: string): bigint {
  const parsed = BigInt(value);
  if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`The latest block returned an invalid ${label}`);
  }
  return parsed;
}

async function call(input: {
  contractAddress: string;
  selector: string;
  calldata: string[];
  blockNumber: bigint;
  rpcUrl: string;
  fetcher: typeof fetch;
}): Promise<string[]> {
  const result = await rpc({
    rpcUrl: input.rpcUrl,
    fetcher: input.fetcher,
    method: "starknet_call",
    resultSchema: callResultSchema,
    params: {
      block_id: { block_number: Number(input.blockNumber) },
      request: {
        contract_address: input.contractAddress,
        entry_point_selector: input.selector,
        calldata: input.calldata,
      },
    },
  });
  return result;
}

export async function readTransactionReceiptStatus(input: {
  transactionHash: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<TransactionReceiptStatus> {
  const transactionHash = felt(input.transactionHash, "transaction hash");
  const rpcUrl = input.rpcUrl ?? MAINNET_RPC;
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(RPC_TIMEOUT_MILLISECONDS),
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "starknet_getTransactionReceipt",
      params: { transaction_hash: transactionHash },
    }),
  });
  if (!response.ok) {
    throw new Error(`Mainnet receipt read returned HTTP ${response.status}`);
  }
  const body = z
    .union([
      z.object({
        id: z.number(),
        jsonrpc: z.literal("2.0"),
        result: transactionReceiptSchema,
      }),
      rpcErrorSchema,
    ])
    .parse(await response.json());
  if (!("result" in body)) {
    if (
      body.error.code === 29 ||
      /not found|not received|unknown transaction/iu.test(body.error.message)
    ) {
      return { name: "not-found" };
    }
    throw new Error(`Mainnet receipt read failed: ${body.error.message}`);
  }
  if (BigInt(body.result.transaction_hash) !== BigInt(transactionHash)) {
    throw new Error("Mainnet receipt does not match the submitted transaction");
  }
  if (body.result.execution_status === "REVERTED") {
    return {
      name: "reverted",
      reason: body.result.revert_reason ?? "The transaction was reverted",
    };
  }
  if (
    body.result.execution_status === "SUCCEEDED" &&
    (body.result.finality_status === "ACCEPTED_ON_L2" ||
      body.result.finality_status === "ACCEPTED_ON_L1")
  ) {
    return { name: "accepted" };
  }
  return { name: "pending" };
}

export async function readRefillProofExpiryBlock(input: {
  poolAddress: string;
  proofFacts: readonly string[];
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<string> {
  const poolAddress = felt(input.poolAddress, "privacy pool");
  const baseBlockValue = input.proofFacts[4];
  if (baseBlockValue === undefined) {
    throw new Error("The wallet returned incomplete proof facts");
  }
  let baseBlock: bigint;
  try {
    baseBlock = BigInt(baseBlockValue);
  } catch {
    throw new Error("The wallet returned an invalid proof base block");
  }
  if (baseBlock < 0n) {
    throw new Error("The wallet returned an invalid proof base block");
  }
  const rpcUrl = input.rpcUrl ?? MAINNET_RPC;
  const fetcher = input.fetcher ?? fetch;
  const block = await rpc({
    rpcUrl,
    fetcher,
    method: "starknet_getBlockWithTxHashes",
    params: { block_id: "latest" },
    resultSchema: latestBlockSchema,
  });
  const blockNumber = positiveInteger(block.block_number, "block number");
  const validity = await call({
    contractAddress: poolAddress,
    selector: GET_PROOF_VALIDITY_BLOCKS_SELECTOR,
    calldata: [],
    blockNumber,
    rpcUrl,
    fetcher,
  });
  if (validity.length !== 1 || validity[0] === undefined) {
    throw new Error("The privacy pool returned an invalid proof lifetime");
  }
  const validityBlocks = BigInt(validity[0]);
  if (validityBlocks <= 0n) {
    throw new Error("The privacy pool returned an invalid proof lifetime");
  }
  return (baseBlock + validityBlocks).toString();
}

export async function readRefillChainSnapshot(input: {
  helperAddress: string;
  stateId: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<RefillChainSnapshot> {
  const helperAddress = felt(input.helperAddress, "Travel Safe helper");
  const stateId = felt(input.stateId, "Travel Safe state ID");
  const rpcUrl = input.rpcUrl ?? MAINNET_RPC;
  const fetcher = input.fetcher ?? fetch;
  const block = await rpc({
    rpcUrl,
    fetcher,
    method: "starknet_getBlockWithTxHashes",
    params: { block_id: "latest" },
    resultSchema: latestBlockSchema,
  });
  const blockNumber = positiveInteger(block.block_number, "block number");
  const chainTime = positiveInteger(block.timestamp, "timestamp");

  const exists = await call({
    contractAddress: helperAddress,
    selector: STATE_EXISTS_SELECTOR,
    calldata: [stateId],
    blockNumber,
    rpcUrl,
    fetcher,
  });
  if (exists.length !== 1 || exists[0] === undefined) {
    throw new Error("The Travel Safe helper returned an invalid existence check");
  }
  const existsValue = BigInt(exists[0]);
  if (existsValue === 0n) {
    return {
      blockNumber: blockNumber.toString(),
      chainTimeSeconds: chainTime.toString(),
      state: null,
    };
  }
  if (existsValue !== 1n) {
    throw new Error("The Travel Safe helper returned an invalid existence value");
  }

  const result = await call({
    contractAddress: helperAddress,
    selector: GET_STATE_SELECTOR,
    calldata: [stateId],
    blockNumber,
    rpcUrl,
    fetcher,
  });
  if (result.length !== 6) {
    throw new Error("The Travel Safe helper returned an invalid state");
  }
  const [claimCommitment, recoveryCommitment, tokenAddress, amount, returnDate, status] =
    result;
  if (
    claimCommitment === undefined ||
    recoveryCommitment === undefined ||
    tokenAddress === undefined ||
    amount === undefined ||
    returnDate === undefined ||
    status === undefined
  ) {
    throw new Error("The Travel Safe helper returned an incomplete state");
  }
  const statusValue = BigInt(status);
  const statusName =
    statusValue === 1n
      ? "funded"
      : statusValue === 2n
        ? "claimed"
        : statusValue === 3n
          ? "refunded"
          : null;
  const amountValue = BigInt(amount);
  const returnDateValue = BigInt(returnDate);
  if (statusName === null || amountValue <= 0n || returnDateValue <= 0n) {
    throw new Error("The Travel Safe helper returned invalid state data");
  }
  return {
    blockNumber: blockNumber.toString(),
    chainTimeSeconds: chainTime.toString(),
    state: {
      stateId,
      claimCommitment: felt(claimCommitment, "claim commitment"),
      recoveryCommitment: felt(recoveryCommitment, "recovery commitment"),
      tokenAddress: felt(tokenAddress, "Travel Safe token"),
      amountFri: amountValue.toString(),
      returnDateSeconds: returnDateValue.toString(),
      status: statusName,
    },
  };
}
