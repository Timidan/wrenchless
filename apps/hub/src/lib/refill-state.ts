const MAINNET_RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const STATE_EXISTS_SELECTOR =
  "0x008bef61fcd2d29beac02c40e29ac0f7b11f5e15da6bb8a0a909cb1237a46f76";
const GET_STATE_SELECTOR =
  "0x03593f537ca0121e22c58378d40e0f5e2ba89b1c6d92a6990ab3066b68088f9c";
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;

type RpcResponse =
  | { id: number; jsonrpc: "2.0"; result: string[] }
  | {
      error: { code: number; message: string };
      id: number;
      jsonrpc: "2.0";
    };

export type RefillChainState = {
  stateId: string;
  claimCommitment: string;
  refundPublicKey: string;
  tokenAddress: string;
  amountFri: string;
  expiry: string;
  status: "funded" | "claimed" | "refunded";
};

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

async function call(input: {
  contractAddress: string;
  selector: string;
  calldata: string[];
  rpcUrl: string;
  fetcher: typeof fetch;
}): Promise<string[]> {
  // A local binding, never `input.fetcher(...)`. Calling it as a method hands
  // `fetch` the input object as its `this`, which the browser refuses outright.
  const { fetcher } = input;
  const response = await fetcher(input.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "starknet_call",
      params: {
        block_id: "latest",
        request: {
          contract_address: input.contractAddress,
          entry_point_selector: input.selector,
          calldata: input.calldata,
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Mainnet refill state read returned HTTP ${response.status}`);
  }
  // SAFETY: every field is checked below before it is read as a successful response.
  const body = (await response.json()) as RpcResponse;
  if (!("result" in body)) {
    throw new Error(`Mainnet refill state read failed: ${body.error.message}`);
  }
  return body.result;
}

export async function readRefillChainState(input: {
  helperAddress: string;
  stateId: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<RefillChainState | null> {
  const helperAddress = felt(input.helperAddress, "refill helper");
  const stateId = felt(input.stateId, "refill state ID");
  const rpcUrl = input.rpcUrl ?? MAINNET_RPC;
  const fetcher = input.fetcher ?? fetch;
  const exists = await call({
    contractAddress: helperAddress,
    selector: STATE_EXISTS_SELECTOR,
    calldata: [stateId],
    rpcUrl,
    fetcher,
  });
  if (exists.length !== 1 || exists[0] === undefined) {
    throw new Error("The refill helper returned an invalid existence check");
  }
  if (BigInt(exists[0]) === 0n) return null;
  if (BigInt(exists[0]) !== 1n) {
    throw new Error("The refill helper returned an invalid existence value");
  }

  const result = await call({
    contractAddress: helperAddress,
    selector: GET_STATE_SELECTOR,
    calldata: [stateId],
    rpcUrl,
    fetcher,
  });
  if (result.length !== 6) {
    throw new Error("The refill helper returned an invalid state");
  }
  const [claimCommitment, refundPublicKey, tokenAddress, amount, expiry, status] =
    result;
  if (
    claimCommitment === undefined ||
    refundPublicKey === undefined ||
    tokenAddress === undefined ||
    amount === undefined ||
    expiry === undefined ||
    status === undefined
  ) {
    throw new Error("The refill helper returned an incomplete state");
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
    throw new Error("The refill helper returned an unknown status");
  }
  const amountValue = BigInt(amount);
  const expiryValue = BigInt(expiry);
  if (amountValue <= 0n || expiryValue <= 0n) {
    throw new Error("The refill helper returned invalid amount or expiry data");
  }
  return {
    stateId,
    claimCommitment: felt(claimCommitment, "claim commitment"),
    refundPublicKey: felt(refundPublicKey, "refund public key"),
    tokenAddress: felt(tokenAddress, "refill token"),
    amountFri: amountValue.toString(),
    expiry: expiryValue.toString(),
    status: statusName,
  };
}
