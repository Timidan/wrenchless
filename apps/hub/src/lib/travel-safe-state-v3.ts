import type { JsonValue } from "@wrenchless/canary-core";
import { z } from "zod";

const MAINNET_RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const STATE_EXISTS_SELECTOR =
  "0x008bef61fcd2d29beac02c40e29ac0f7b11f5e15da6bb8a0a909cb1237a46f76";
const GET_STATE_SELECTOR =
  "0x03593f537ca0121e22c58378d40e0f5e2ba89b1c6d92a6990ab3066b68088f9c";
const CLAIMABLE_AMOUNT_SELECTOR =
  "0x03f7c509dc42a0befd0310667054f49da162848f76aee5f4107f8b7c7b1af9bc";
const FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const RPC_TIMEOUT_MILLISECONDS = 30_000;

const rpcIntegerSchema = z.union([
  z.number().int().safe().positive(),
  z.string().regex(/^[1-9][0-9]*$/),
]);
const latestBlockSchema = z.object({
  block_number: rpcIntegerSchema,
  timestamp: rpcIntegerSchema,
});
const callResultSchema = z.array(z.string());
const rpcErrorSchema = z.object({
  error: z.object({ code: z.number(), message: z.string() }),
  id: z.number(),
  jsonrpc: z.literal("2.0"),
});

function safeRpcInteger(value: z.infer<typeof rpcIntegerSchema>, label: string): bigint {
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`The latest block returned an invalid ${label}`);
  }
  return parsed;
}

export type TravelSafeV3ChainState = {
  stateId: string;
  claimCommitment: string;
  deviceCommitment: string;
  recoveryCommitment: string;
  tokenAddress: string;
  initialAmount: string;
  remainingAmount: string;
  releasedAmount: string;
  dailyAmount: string;
  firstReleaseAt: string;
  returnAt: string;
  maxReturnAt: string;
  nonce: string;
  claimableAmount: string;
  status: "funded" | "claimed" | "refunded";
};

export type TravelSafeV3Snapshot = {
  blockNumber: string;
  chainTimeSeconds: string;
  state: TravelSafeV3ChainState | null;
};

function felt(value: string, label: string, allowZero = false): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not a felt`);
  }
  if (parsed < 0n || parsed >= FIELD_PRIME || (!allowZero && parsed === 0n)) {
    throw new Error(`${label} is outside the Stark field`);
  }
  return `0x${parsed.toString(16)}`;
}

function unsigned(value: string, label: string, allowZero = true): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not an integer`);
  }
  if (parsed < 0n || (!allowZero && parsed === 0n)) {
    throw new Error(`${label} is invalid`);
  }
  return parsed.toString();
}

async function rpc<Result>(input: {
  rpcUrl: string;
  method: string;
  params: JsonValue;
  fetcher: typeof fetch;
  resultSchema: z.ZodType<Result>;
}): Promise<Result> {
  // Through a local binding, never as `input.fetcher(...)`. Calling it as a
  // method hands `fetch` this input object as its `this`, and the browser
  // refuses outright with "Illegal invocation" — so every chain read for a
  // Safe failed before it left the page. The same trap is commented at the
  // other RPC reader in `ready-private-setup.ts`.
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
    throw new Error(`Travel Safe read returned HTTP ${response.status}`);
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
    throw new Error(`Travel Safe read failed: ${body.error.message}`);
  }
  return body.result;
}

async function call(input: {
  contractAddress: string;
  selector: string;
  calldata: string[];
  blockNumber: bigint;
  rpcUrl: string;
  fetcher: typeof fetch;
}): Promise<string[]> {
  return rpc({
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
}

export async function readTravelSafeV3Snapshot(input: {
  helperAddress: string;
  stateId: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<TravelSafeV3Snapshot> {
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
  const blockNumber = safeRpcInteger(block.block_number, "block number");
  const chainTime = safeRpcInteger(block.timestamp, "timestamp");

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
  if (BigInt(exists[0]) === 0n) {
    return {
      blockNumber: blockNumber.toString(),
      chainTimeSeconds: chainTime.toString(),
      state: null,
    };
  }
  if (BigInt(exists[0]) !== 1n) {
    throw new Error("The Travel Safe helper returned an invalid existence value");
  }

  const [rawState, rawClaimable] = await Promise.all([
    call({
      contractAddress: helperAddress,
      selector: GET_STATE_SELECTOR,
      calldata: [stateId],
      blockNumber,
      rpcUrl,
      fetcher,
    }),
    call({
      contractAddress: helperAddress,
      selector: CLAIMABLE_AMOUNT_SELECTOR,
      calldata: [stateId],
      blockNumber,
      rpcUrl,
      fetcher,
    }),
  ]);
  if (rawState.length !== 13 || rawClaimable.length !== 1) {
    throw new Error("The Travel Safe helper returned an invalid state");
  }
  const [
    claimCommitment,
    deviceCommitment,
    recoveryCommitment,
    tokenAddress,
    initialAmount,
    remainingAmount,
    releasedAmount,
    dailyAmount,
    firstReleaseAt,
    returnAt,
    maxReturnAt,
    nonce,
    status,
  ] = rawState;
  if (
    claimCommitment === undefined ||
    deviceCommitment === undefined ||
    recoveryCommitment === undefined ||
    tokenAddress === undefined ||
    initialAmount === undefined ||
    remainingAmount === undefined ||
    releasedAmount === undefined ||
    dailyAmount === undefined ||
    firstReleaseAt === undefined ||
    returnAt === undefined ||
    maxReturnAt === undefined ||
    nonce === undefined ||
    status === undefined ||
    rawClaimable[0] === undefined
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
  if (statusName === null) {
    throw new Error("The Travel Safe helper returned an invalid status");
  }

  return {
    blockNumber: blockNumber.toString(),
    chainTimeSeconds: chainTime.toString(),
    state: {
      stateId,
      claimCommitment: felt(claimCommitment, "claim commitment"),
      deviceCommitment: felt(deviceCommitment, "device commitment"),
      recoveryCommitment: felt(recoveryCommitment, "recovery commitment"),
      tokenAddress: felt(tokenAddress, "Travel Safe token"),
      initialAmount: unsigned(initialAmount, "initial amount", false),
      remainingAmount: unsigned(remainingAmount, "remaining amount"),
      releasedAmount: unsigned(releasedAmount, "released amount"),
      dailyAmount: unsigned(dailyAmount, "daily amount"),
      firstReleaseAt: unsigned(firstReleaseAt, "first release"),
      returnAt: unsigned(returnAt, "return date", false),
      maxReturnAt: unsigned(maxReturnAt, "maximum return date", false),
      nonce: unsigned(nonce, "action nonce"),
      claimableAmount: unsigned(rawClaimable[0], "claimable amount"),
      status: statusName,
    },
  };
}
