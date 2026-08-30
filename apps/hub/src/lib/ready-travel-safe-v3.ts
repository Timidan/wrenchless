import {
  assertSubmittableProof,
  buildTravelSafeV3ClaimEarlyActions,
  buildTravelSafeV3ExtendActions,
  buildTravelSafeV3FundActions,
  buildTravelSafeV3RefundActions,
  buildTravelSafeV3ReleaseActions,
  buildTravelSafeV3TopUpActions,
  createTravelSafeV3ReturnTypedData,
  deriveTravelSafeV3PublicKey,
  jsonValueSchema,
  readPreparedHelperInvoke,
  signTravelSafeV3Action,
  TRAVEL_SAFE_V3_OPEN_NOTE,
  type PreparedStrk20Call,
  type JsonValue,
  type TravelSafeV3Action,
  type TravelSafeV3StateAuthorization,
} from "@wrenchless/canary-core";
import { z } from "zod";

import { buildShieldActions, type ShieldAmount } from "./travel-safe-shield";

const READY_WALLET_API_VERSION = "0.10.3";
const MAINNET_CHAIN_ID = "0x534e5f4d41494e";

const feltSchema = z.string().regex(/^0x[0-9a-fA-F]+$/);
const preparedSchema = z.object({
  call: z.object({
    contract_address: feltSchema,
    entry_point: z.string().min(1),
    calldata: z.array(z.string()),
  }),
  proof: z.object({
    data: z.string(),
    output: z.array(z.string()),
    proof_facts: z.array(z.string()),
  }),
});
const transactionSchema = z.object({ transaction_hash: feltSchema });
const signatureSchema = z.array(feltSchema).min(1);

export type ReadyTravelSafeV3Wallet = {
  request(request: { type: string; params?: JsonValue }): Promise<JsonValue>;
};

export type ReadyTravelSafeV3State = TravelSafeV3StateAuthorization & {
  claimableAmount: string;
};

export type PreparedTravelSafeV3Fund = { prepared: PreparedStrk20Call };
export type PreparedTravelSafeV3TopUp = {
  prepared: PreparedStrk20Call;
  signature: { r: string; s: string };
  devicePublicKey: string;
};

/**
 * A wallet hands back a `PADDED_TXN_HASH` — 64 hex characters, leading zeros
 * and all, and the spec permits upper case. The ticket store accepts only
 * canonical felts, so a hash copied straight from the wallet is rejected the
 * moment the action is recorded, after the transaction has already been sent.
 * Every hash leaving this module is canonicalised here instead.
 */
function canonicalTransactionHash(value: string): string {
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error("The wallet returned an invalid transaction");
  return `0x${parsed.toString(16)}`;
}

function assertMainnet(chainId: string): void {
  if (BigInt(chainId) !== BigInt(MAINNET_CHAIN_ID)) {
    throw new Error("Switch to Starknet mainnet");
  }
}

function assertMatchingPrivateKey(
  privateKey: string,
  publicKey: string,
  label: string,
): void {
  if (BigInt(deriveTravelSafeV3PublicKey(privateKey)) !== BigInt(publicKey)) {
    throw new Error(`${label} key does not match this Safe`);
  }
}

async function prepare(
  wallet: ReadyTravelSafeV3Wallet,
  actions: TravelSafeV3Action[],
  simulate: boolean,
): Promise<PreparedStrk20Call> {
  return preparedSchema.parse(
    await wallet.request({
      type: "wallet_strk20PrepareInvoke",
      params: { actions, simulate, api_version: READY_WALLET_API_VERSION },
    }),
  );
}

async function invoke(
  wallet: ReadyTravelSafeV3Wallet,
  actions: TravelSafeV3Action[],
): Promise<{ transactionHash: string }> {
  const result = transactionSchema.parse(
    await wallet.request({
      type: "wallet_strk20InvokeTransaction",
      params: { actions, api_version: READY_WALLET_API_VERSION },
    }),
  );
  return { transactionHash: canonicalTransactionHash(result.transaction_hash) };
}

function readPreviewNote(input: {
  prepared: PreparedStrk20Call;
  poolAddress: string;
  helperAddress: string;
  operation: bigint;
  stateId: string;
  nonce: string;
}): string {
  const calldata = readPreparedHelperInvoke(
    input.prepared,
    input.poolAddress,
    input.helperAddress,
  );
  if (
    calldata.length < 4 ||
    calldata[0] !== input.operation ||
    calldata[1] !== BigInt(input.stateId) ||
    calldata[3] !== BigInt(input.nonce)
  ) {
    throw new Error("The private preview does not match this Safe action");
  }
  const noteId = calldata[2];
  if (noteId === undefined || noteId === 0n) {
    throw new Error("The private preview returned no OPEN note");
  }
  return `0x${noteId.toString(16)}`;
}

export async function prepareTravelSafeV3Fund(input: {
  wallet: ReadyTravelSafeV3Wallet;
  chainId: string;
  poolAddress: string;
  helperAddress: string;
  stateId: string;
  claimCommitment: string;
  deviceCommitment: string;
  recoveryCommitment: string;
  tokenAddress: string;
  amount: string;
  dailyAmount: string;
  firstReleaseAt: string;
  returnAt: string;
}): Promise<PreparedTravelSafeV3Fund> {
  assertMainnet(input.chainId);
  const prepared = await prepare(
    input.wallet,
    buildTravelSafeV3FundActions(input),
    false,
  );
  assertSubmittableProof(prepared, "FUND");
  return { prepared };
}

export async function submitAllowanceRelease(input: {
  wallet: ReadyTravelSafeV3Wallet;
  poolAddress: string;
  state: ReadyTravelSafeV3State;
  recipient: string;
  devicePrivateKey: string;
  devicePublicKey: string;
}): Promise<{ transactionHash: string }> {
  assertMainnet(input.state.chainId);
  assertMatchingPrivateKey(
    input.devicePrivateKey,
    input.devicePublicKey,
    "Device",
  );
  if (BigInt(input.state.claimableAmount) <= 0n) {
    throw new Error("No allowance is ready yet");
  }
  const unsigned = buildTravelSafeV3ReleaseActions({
    helperAddress: input.state.helperAddress,
    stateId: input.state.stateId,
    tokenAddress: input.state.tokenAddress,
    recipient: input.recipient,
    noteId: TRAVEL_SAFE_V3_OPEN_NOTE,
    nonce: input.state.nonce,
    devicePublicKey: input.devicePublicKey,
    signature: { r: "0x1", s: "0x1" },
  });
  const preview = await prepare(input.wallet, unsigned, true);
  const noteId = readPreviewNote({
    prepared: preview,
    poolAddress: input.poolAddress,
    helperAddress: input.state.helperAddress,
    operation: 1n,
    stateId: input.state.stateId,
    nonce: input.state.nonce,
  });
  const signature = signTravelSafeV3Action(input.devicePrivateKey, {
    ...input.state,
    operation: "RELEASE",
    value: input.state.claimableAmount,
    noteId,
  });
  return invoke(
    input.wallet,
    buildTravelSafeV3ReleaseActions({
      helperAddress: input.state.helperAddress,
      stateId: input.state.stateId,
      tokenAddress: input.state.tokenAddress,
      recipient: input.recipient,
      noteId: TRAVEL_SAFE_V3_OPEN_NOTE,
      nonce: input.state.nonce,
      devicePublicKey: input.devicePublicKey,
      signature,
    }),
  );
}

export async function prepareTravelSafeTopUp(input: {
  wallet: ReadyTravelSafeV3Wallet;
  poolAddress: string;
  state: TravelSafeV3StateAuthorization;
  amount: string;
  devicePrivateKey: string;
  devicePublicKey: string;
}): Promise<PreparedTravelSafeV3TopUp> {
  assertMainnet(input.state.chainId);
  assertMatchingPrivateKey(
    input.devicePrivateKey,
    input.devicePublicKey,
    "Device",
  );
  const signature = signTravelSafeV3Action(input.devicePrivateKey, {
    ...input.state,
    operation: "TOP_UP",
    value: input.amount,
    noteId: "0x0",
  });
  const prepared = await prepare(
    input.wallet,
    buildTravelSafeV3TopUpActions({
      helperAddress: input.state.helperAddress,
      stateId: input.state.stateId,
      tokenAddress: input.state.tokenAddress,
      amount: input.amount,
      nonce: input.state.nonce,
      devicePublicKey: input.devicePublicKey,
      signature,
    }),
    false,
  );
  assertSubmittableProof(prepared, "TOP_UP");
  return { prepared, signature, devicePublicKey: input.devicePublicKey };
}

export async function submitTravelSafeExtend(input: {
  wallet: ReadyTravelSafeV3Wallet;
  state: TravelSafeV3StateAuthorization;
  newReturnAt: string;
  devicePrivateKey: string;
  devicePublicKey: string;
}): Promise<{ transactionHash: string }> {
  assertMainnet(input.state.chainId);
  assertMatchingPrivateKey(
    input.devicePrivateKey,
    input.devicePublicKey,
    "Device",
  );
  const signature = signTravelSafeV3Action(input.devicePrivateKey, {
    ...input.state,
    operation: "EXTEND",
    value: input.newReturnAt,
    noteId: "0x0",
  });
  return invoke(
    input.wallet,
    buildTravelSafeV3ExtendActions({
      helperAddress: input.state.helperAddress,
      stateId: input.state.stateId,
      newReturnAt: input.newReturnAt,
      nonce: input.state.nonce,
      devicePublicKey: input.devicePublicKey,
      signature,
    }),
  );
}

export async function submitTravelSafeClaimEarly(input: {
  wallet: ReadyTravelSafeV3Wallet;
  poolAddress: string;
  state: TravelSafeV3StateAuthorization;
  recipient: string;
  claimPrivateKey: string;
  claimPublicKey: string;
}): Promise<{ transactionHash: string }> {
  assertMainnet(input.state.chainId);
  assertMatchingPrivateKey(
    input.claimPrivateKey,
    input.claimPublicKey,
    "Recovery",
  );
  const preview = await prepare(
    input.wallet,
    buildTravelSafeV3ClaimEarlyActions({
      helperAddress: input.state.helperAddress,
      stateId: input.state.stateId,
      tokenAddress: input.state.tokenAddress,
      recipient: input.recipient,
      noteId: TRAVEL_SAFE_V3_OPEN_NOTE,
      nonce: input.state.nonce,
      claimPublicKey: input.claimPublicKey,
      signature: { r: "0x1", s: "0x1" },
    }),
    true,
  );
  const noteId = readPreviewNote({
    prepared: preview,
    poolAddress: input.poolAddress,
    helperAddress: input.state.helperAddress,
    operation: 4n,
    stateId: input.state.stateId,
    nonce: input.state.nonce,
  });
  const signature = signTravelSafeV3Action(input.claimPrivateKey, {
    ...input.state,
    operation: "CLAIM_EARLY",
    value: input.state.remainingAmount,
    noteId,
  });
  return invoke(
    input.wallet,
    buildTravelSafeV3ClaimEarlyActions({
      helperAddress: input.state.helperAddress,
      stateId: input.state.stateId,
      tokenAddress: input.state.tokenAddress,
      recipient: input.recipient,
      noteId: TRAVEL_SAFE_V3_OPEN_NOTE,
      nonce: input.state.nonce,
      claimPublicKey: input.claimPublicKey,
      signature,
    }),
  );
}

export async function submitTravelSafeV3Refund(input: {
  wallet: ReadyTravelSafeV3Wallet;
  poolAddress: string;
  state: TravelSafeV3StateAuthorization;
  recipient: string;
  recoveryAccount: string;
  recoverySalt: string;
}): Promise<{ transactionHash: string }> {
  assertMainnet(input.state.chainId);
  const preview = await prepare(
    input.wallet,
    buildTravelSafeV3RefundActions({
      helperAddress: input.state.helperAddress,
      stateId: input.state.stateId,
      tokenAddress: input.state.tokenAddress,
      recipient: input.recipient,
      noteId: TRAVEL_SAFE_V3_OPEN_NOTE,
      nonce: input.state.nonce,
      recoveryAccount: input.recoveryAccount,
      recoverySalt: input.recoverySalt,
      signature: ["0x1"],
    }),
    true,
  );
  const noteId = readPreviewNote({
    prepared: preview,
    poolAddress: input.poolAddress,
    helperAddress: input.state.helperAddress,
    operation: 5n,
    stateId: input.state.stateId,
    nonce: input.state.nonce,
  });
  const signature = signatureSchema.parse(
    await input.wallet.request({
      type: "wallet_signTypedData",
      params: jsonValueSchema.parse({
        ...createTravelSafeV3ReturnTypedData({
          ...input.state,
          recoveryAccount: input.recoveryAccount,
          noteId,
        }),
        api_version: READY_WALLET_API_VERSION,
      }),
    }),
  );
  return invoke(
    input.wallet,
    buildTravelSafeV3RefundActions({
      helperAddress: input.state.helperAddress,
      stateId: input.state.stateId,
      tokenAddress: input.state.tokenAddress,
      recipient: input.recipient,
      noteId: TRAVEL_SAFE_V3_OPEN_NOTE,
      nonce: input.state.nonce,
      recoveryAccount: input.recoveryAccount,
      recoverySalt: input.recoverySalt,
      signature,
    }),
  );
}

/**
 * Move ordinary balances into the private pool, in one wallet-signed STRK20
 * transaction. This is the only step Wrenchless asks the account itself to
 * send: the wallet shows its own approval, pays its own fee, and returns a
 * hash the caller must confirm before any private proof is prepared.
 */
export async function submitShieldDeposits(input: {
  wallet: ReadyTravelSafeV3Wallet;
  chainId: string;
  deposits: readonly ShieldAmount[];
}): Promise<{ transactionHash: string }> {
  assertMainnet(input.chainId);
  const actions = buildShieldActions(input.deposits);
  const result = transactionSchema.parse(
    await input.wallet.request({
      type: "wallet_strk20InvokeTransaction",
      params: { actions, api_version: READY_WALLET_API_VERSION },
    }),
  );
  return { transactionHash: canonicalTransactionHash(result.transaction_hash) };
}
