const READY_WALLET_API_VERSION = "0.10.3";
const MAINNET_CHAIN_ID = "0x534e5f4d41494e";
const MAINNET_RPC = "https://api.cartridge.gg/x/starknet/mainnet";
const GET_FEE_AMOUNT_SELECTOR =
  "0x03d323cd692ad43935b81ce230c47bfc57f69656249c5a33fe5223c17dd32ed2";
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const U128_MAX = (1n << 128n) - 1n;
const U256_MAX = (1n << 256n) - 1n;
const QUOTE_LIFETIME_MILLISECONDS = 2 * 60_000;

export type ReadyCoverWallet = {
  request<T>(request: { type: string; params?: unknown }): Promise<T>;
  selectedAddress?: string;
};

type ShieldedBalanceEntry = {
  token: string;
  balance: string;
};

type TransactionResult = {
  transaction_hash: string;
};

type RpcResponse =
  | { id: number; jsonrpc: "2.0"; result: string[] }
  | {
      error: { code: number; message: string };
      id: number;
      jsonrpc: "2.0";
    };

type TransactionStatusRpcResponse =
  | {
      id: number;
      jsonrpc: "2.0";
      result: {
        finality_status: string;
        execution_status?: string;
        failure_reason?: string;
      };
    }
  | {
      error: { code: number; message: string };
      id: number;
      jsonrpc: "2.0";
    };

export type ReadyAllowanceQuote = {
  tokenAddress: string;
  recipient: string;
  amountFri: string;
  poolFeeFri: string;
  totalDebitFri: string;
  shieldedBalanceFri: string;
  maximumAmountFri: string;
  canSubmit: boolean;
  quotedAt: string;
};

export type SubmittedCoverTransaction = {
  transactionHash: string;
  tokenAddress: string;
  recipient: string;
  amountFri: string;
};

export type ReadyCoverAccountStatus = {
  account: string;
  tokenAddress: string;
  publicBalanceFri: string;
};

export type CoverTransactionState =
  | { state: "pending" }
  | { state: "confirmed" }
  | { state: "reverted"; reason?: string };

function canonicalFelt(value: string, label: string): string {
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

function positiveInteger(
  value: string,
  maximum: bigint,
  label: string,
): bigint {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive decimal integer`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new Error(`${label} is too large`);
  return parsed;
}

function nonnegativeInteger(
  value: string,
  maximum: bigint,
  label: string,
): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a non-negative decimal integer`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new Error(`${label} is too large`);
  return parsed;
}

function transactionHash(result: TransactionResult): string {
  if (!/^0x[0-9a-f]+$/.test(result.transaction_hash)) {
    throw new Error("Ready returned an invalid transaction hash");
  }
  return result.transaction_hash;
}

async function readyCoverContext(
  wallet: ReadyCoverWallet,
): Promise<{ recipient: string }> {
  const [chainId, versions] = await Promise.all([
    wallet.request<string>({ type: "wallet_requestChainId" }),
    wallet.request<readonly string[]>({ type: "wallet_supportedWalletApi" }),
  ]);
  if (BigInt(chainId) !== BigInt(MAINNET_CHAIN_ID)) {
    throw new Error("The cover wallet must be connected to Starknet mainnet");
  }
  if (!versions.includes(READY_WALLET_API_VERSION)) {
    throw new Error(
      `The connected wallet does not support Wallet API ${READY_WALLET_API_VERSION}`,
    );
  }
  if (!wallet.selectedAddress) {
    throw new Error("The cover wallet has no selected account");
  }
  return { recipient: canonicalFelt(wallet.selectedAddress, "cover address") };
}

export async function assertReadyCoverContext(
  wallet: ReadyCoverWallet,
): Promise<{ recipient: string }> {
  return readyCoverContext(wallet);
}

async function readPoolFee(
  poolAddress: string,
  rpcUrl: string,
  fetcher: typeof fetch,
): Promise<bigint> {
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "starknet_call",
      params: {
        block_id: "latest",
        request: {
          calldata: [],
          contract_address: canonicalFelt(poolAddress, "privacy pool"),
          entry_point_selector: GET_FEE_AMOUNT_SELECTOR,
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Mainnet fee quote returned HTTP ${response.status}`);
  }
  // SAFETY: The discriminated result shape and exact felt count are checked below.
  // SAFETY: the result shape and both u256 limbs are checked before conversion.
  const body = (await response.json()) as RpcResponse;
  if (!("result" in body) || body.result.length !== 1) {
    throw new Error("Could not read the live STRK20 pool fee");
  }
  const fee = body.result[0];
  if (fee === undefined) throw new Error("The STRK20 pool fee is missing");
  return BigInt(fee);
}

async function readShieldedBalance(
  wallet: ReadyCoverWallet,
  tokenAddress: string,
): Promise<bigint> {
  const balances = await wallet.request<ShieldedBalanceEntry[]>({
    type: "wallet_strk20Balances",
    params: {
      tokens: [tokenAddress],
      api_version: READY_WALLET_API_VERSION,
    },
  });
  const balance = balances.find(
    (entry) => BigInt(entry.token) === BigInt(tokenAddress),
  );
  if (balance === undefined) return 0n;
  const parsed = BigInt(balance.balance);
  if (parsed < 0n || parsed > U128_MAX) {
    throw new Error("Ready returned an invalid shielded balance");
  }
  return parsed;
}

export async function readReadyShieldedBalance(input: {
  wallet: ReadyCoverWallet;
  tokenAddress: string;
}): Promise<{ tokenAddress: string; shieldedBalanceFri: string }> {
  await readyCoverContext(input.wallet);
  const tokenAddress = canonicalFelt(input.tokenAddress, "token address");
  const balance = await readShieldedBalance(input.wallet, tokenAddress);
  return {
    tokenAddress,
    shieldedBalanceFri: balance.toString(),
  };
}

export async function readReadyPoolFee(input: {
  poolAddress: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<{ poolFeeFri: string; quotedAt: string }> {
  const poolFee = await readPoolFee(
    input.poolAddress,
    input.rpcUrl ?? MAINNET_RPC,
    input.fetcher ?? fetch,
  );
  return {
    poolFeeFri: poolFee.toString(),
    quotedAt: new Date().toISOString(),
  };
}

async function readPublicBalance(
  account: string,
  tokenAddress: string,
  rpcUrl: string,
  fetcher: typeof fetch,
): Promise<bigint> {
  const response = await fetcher(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "starknet_call",
      params: {
        block_id: "latest",
        request: {
          calldata: [account],
          contract_address: tokenAddress,
          entry_point_selector:
            "0x035a73cd311a05d46deda634c5ee045db92f811b4e74bca4437fcb5302b7af33",
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Mainnet balance read returned HTTP ${response.status}`);
  }
  // SAFETY: the result variant, limb count, and both limbs are checked below.
  const body = (await response.json()) as RpcResponse;
  if (!("result" in body) || body.result.length !== 2) {
    throw new Error("Could not read the public cover balance");
  }
  const low = body.result[0];
  const high = body.result[1];
  if (low === undefined || high === undefined) {
    throw new Error("The public token balance is incomplete");
  }
  const balance = BigInt(low) + (BigInt(high) << 128n);
  if (balance < 0n || balance > U256_MAX) {
    throw new Error("The public token balance is invalid");
  }
  return balance;
}

export async function inspectReadyCoverAccount(input: {
  wallet: ReadyCoverWallet;
  tokenAddress: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<ReadyCoverAccountStatus> {
  const { recipient } = await readyCoverContext(input.wallet);
  const tokenAddress = canonicalFelt(input.tokenAddress, "token address");
  const balance = await readPublicBalance(
    recipient,
    tokenAddress,
    input.rpcUrl ?? MAINNET_RPC,
    input.fetcher ?? fetch,
  );
  return {
    account: recipient,
    tokenAddress,
    publicBalanceFri: balance.toString(),
  };
}

export async function readCoverTransactionState(input: {
  transactionHash: string;
  rpcUrl?: string;
  fetcher?: typeof fetch;
}): Promise<CoverTransactionState> {
  const transactionHashValue = canonicalFelt(
    input.transactionHash,
    "transaction hash",
  );
  const response = await (input.fetcher ?? fetch)(input.rpcUrl ?? MAINNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "starknet_getTransactionStatus",
      params: { transaction_hash: transactionHashValue },
    }),
  });
  if (!response.ok) {
    throw new Error(`Mainnet transaction status returned HTTP ${response.status}`);
  }
  // SAFETY: the discriminated error/result branches are checked before field access.
  const body = (await response.json()) as TransactionStatusRpcResponse;
  if ("error" in body) {
    if (body.error.code === 29) return { state: "pending" };
    throw new Error(`Transaction status failed: ${body.error.message}`);
  }
  if (body.result.execution_status === "REVERTED") {
    const reason = body.result.failure_reason?.trim();
    return reason
      ? { state: "reverted", reason }
      : { state: "reverted" };
  }
  if (
    (body.result.finality_status === "ACCEPTED_ON_L1" ||
      body.result.finality_status === "ACCEPTED_ON_L2") &&
    body.result.execution_status === "SUCCEEDED"
  ) {
    return { state: "confirmed" };
  }
  return { state: "pending" };
}

export async function quoteReadyAllowance(
  input: {
    wallet: ReadyCoverWallet;
    poolAddress: string;
    tokenAddress: string;
    amountFri: string;
    rpcUrl?: string;
    fetcher?: typeof fetch;
  },
  now = new Date(),
): Promise<ReadyAllowanceQuote> {
  const { recipient } = await readyCoverContext(input.wallet);
  const tokenAddress = canonicalFelt(input.tokenAddress, "token address");
  const amount = positiveInteger(input.amountFri, U128_MAX, "allowance amount");
  const [poolFee, shieldedBalance] = await Promise.all([
    readPoolFee(
      input.poolAddress,
      input.rpcUrl ?? MAINNET_RPC,
      input.fetcher ?? fetch,
    ),
    readShieldedBalance(input.wallet, tokenAddress),
  ]);
  const totalDebit = amount + poolFee;
  const maximumAmount =
    shieldedBalance > poolFee ? shieldedBalance - poolFee : 0n;
  return {
    tokenAddress,
    recipient,
    amountFri: amount.toString(),
    poolFeeFri: poolFee.toString(),
    totalDebitFri: totalDebit.toString(),
    shieldedBalanceFri: shieldedBalance.toString(),
    maximumAmountFri: maximumAmount.toString(),
    canSubmit: shieldedBalance >= totalDebit,
    quotedAt: now.toISOString(),
  };
}

export async function moveReadyAllowanceToCover(
  wallet: ReadyCoverWallet,
  quote: ReadyAllowanceQuote,
  now = new Date(),
): Promise<SubmittedCoverTransaction> {
  const { recipient } = await readyCoverContext(wallet);
  if (BigInt(recipient) !== BigInt(quote.recipient)) {
    throw new Error("The selected cover account changed after the fee quote");
  }
  const quotedAt = Date.parse(quote.quotedAt);
  if (
    Number.isNaN(quotedAt) ||
    quotedAt > now.getTime() ||
    now.getTime() - quotedAt > QUOTE_LIFETIME_MILLISECONDS
  ) {
    throw new Error("The allowance fee quote expired; refresh it before continuing");
  }
  const amount = positiveInteger(quote.amountFri, U128_MAX, "allowance amount");
  const poolFee = positiveInteger(quote.poolFeeFri, U128_MAX, "pool fee");
  const totalDebit = positiveInteger(
    quote.totalDebitFri,
    U128_MAX,
    "total private debit",
  );
  const shieldedBalance = nonnegativeInteger(
    quote.shieldedBalanceFri,
    U128_MAX,
    "shielded balance",
  );
  if (totalDebit !== amount + poolFee) {
    throw new Error("The allowance quote has inconsistent fee totals");
  }
  if (!quote.canSubmit || shieldedBalance < totalDebit) {
    throw new Error("Shielded balance is below the allowance plus live pool fee");
  }
  const tokenAddress = canonicalFelt(quote.tokenAddress, "token address");
  const result = await wallet.request<TransactionResult>({
    type: "wallet_strk20InvokeTransaction",
    params: {
      actions: [
        {
          type: "withdraw",
          token: tokenAddress,
          amount: `0x${amount.toString(16)}`,
          recipient,
        },
      ],
      api_version: READY_WALLET_API_VERSION,
    },
  });
  return {
    transactionHash: transactionHash(result),
    tokenAddress,
    recipient,
    amountFri: amount.toString(),
  };
}

export async function submitReadyCoverPayment(input: {
  wallet: ReadyCoverWallet;
  tokenAddress: string;
  recipient: string;
  amountFri: string;
}): Promise<SubmittedCoverTransaction> {
  await readyCoverContext(input.wallet);
  const tokenAddress = canonicalFelt(input.tokenAddress, "token address");
  const recipient = canonicalFelt(input.recipient, "payment recipient");
  const amount = positiveInteger(input.amountFri, U256_MAX, "payment amount");
  const low = amount & U128_MAX;
  const high = amount >> 128n;
  const result = await input.wallet.request<TransactionResult>({
    type: "wallet_addInvokeTransaction",
    params: {
      calls: [
        {
          contract_address: tokenAddress,
          entry_point: "transfer",
          calldata: [
            recipient,
            `0x${low.toString(16)}`,
            `0x${high.toString(16)}`,
          ],
        },
      ],
      api_version: READY_WALLET_API_VERSION,
    },
  });
  return {
    transactionHash: transactionHash(result),
    tokenAddress,
    recipient,
    amountFri: amount.toString(),
  };
}
