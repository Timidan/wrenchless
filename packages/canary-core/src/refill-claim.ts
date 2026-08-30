import {
  constants,
  ec,
  hash,
  shortString,
  typedData,
  type TypedData,
} from "starknet";

const CLAIM_OPERATION = "CLAIM";
const FUND_OPERATION_DISCRIMINANT = 0n;
const CLAIM_OPERATION_DISCRIMINANT = 1n;
const REFUND_OPERATION_DISCRIMINANT = 2n;
const INVOKE_SERVER_ACTION_DISCRIMINANT = 10n;
const INVOKE_WITH_COMPUTATION_SERVER_ACTION_DISCRIMINANT = 11n;
const OPTION_SOME_DISCRIMINANT = 0n;
const OPTION_NONE_DISCRIMINANT = 1n;
const OPEN_NOTE_PLACEHOLDER = "${openNoteIds[0]}";
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

const REFILL_RELEASE_TYPES: TypedData["types"] = {
  StarknetDomain: [
    { name: "name", type: "shortstring" },
    { name: "version", type: "shortstring" },
    { name: "chainId", type: "shortstring" },
    { name: "revision", type: "shortstring" },
  ],
  RefillRelease: [
    { name: "operation", type: "shortstring" },
    { name: "stateId", type: "felt" },
    { name: "nonce", type: "felt" },
    { name: "expiry", type: "u128" },
    { name: "token", type: "ContractAddress" },
    { name: "amount", type: "u128" },
    { name: "noteId", type: "felt" },
  ],
};

const SAFE_RETURN_TYPES: TypedData["types"] = {
  StarknetDomain: REFILL_RELEASE_TYPES.StarknetDomain!,
  SafeReturn: [
    { name: "helper", type: "ContractAddress" },
    { name: "stateId", type: "felt" },
    { name: "expiry", type: "u128" },
    { name: "token", type: "ContractAddress" },
    { name: "amount", type: "u128" },
    { name: "noteId", type: "felt" },
  ],
};

export type RefillReleaseSignature = {
  r: string;
  s: string;
};

export type RefillClaimAuthorization = {
  chainId: string;
  helperAddress: string;
  stateId: string | bigint;
  nonce: string | bigint;
  expiry: string | bigint;
  token: string;
  amount: string | bigint;
  noteId: string | bigint;
};

export type RefillRefundAuthorization = Omit<
  RefillClaimAuthorization,
  "nonce"
> & {
  recoveryAccount: string;
};

export type RefillTransferAction = {
  type: "transfer";
  token: string;
  amount: "OPEN";
  recipient: string;
};

export type RefillInvokeAction = {
  type: "invoke";
  contract: string;
  calldata: string[];
};

export type RefillWithdrawAction = {
  type: "withdraw";
  token: string;
  amount: string;
  recipient: string;
};

export type RefillClaimAction = RefillTransferAction | RefillInvokeAction;

export type RefillRefundAction = RefillClaimAction;

export type RefillFundAction = RefillWithdrawAction | RefillInvokeAction;

export type RefillAction = RefillClaimAction | RefillFundAction;

export type PreparedStrk20Call = {
  call: {
    contract_address: string;
    entry_point: string;
    calldata?: string[];
  };
  proof: {
    data: string;
    output: string[];
    proof_facts: string[];
  };
};

export type RefillPrepareWallet = {
  strk20PrepareInvoke(
    actions: RefillAction[],
    simulate?: boolean,
  ): Promise<PreparedStrk20Call>;
};

export type RefillInvokeWallet = {
  strk20InvokeTransaction(
    actions: RefillAction[],
  ): Promise<{ transaction_hash: string }>;
};

export type RefillTypedDataWallet = {
  signTypedData(data: TypedData): Promise<readonly string[]>;
};

export type PrepareRefillFundInput = {
  wallet: RefillPrepareWallet;
  poolAddress: string;
  helperAddress: string;
  stateId: string | bigint;
  claimCommitment: string;
  recoveryCommitment: string;
  recoveryAccount: string;
  recoverySalt: string;
  token: string;
  amount: string | bigint;
  expiry: string | bigint;
};

export type PrepareRefillClaimInput = Omit<
  RefillClaimAuthorization,
  "noteId"
> & {
  wallet: RefillPrepareWallet;
  poolAddress: string;
  recipient: string;
  claimPrivateKey: string;
  claimPublicKey: string;
};

export type SubmitRefillClaimInput = Omit<PrepareRefillClaimInput, "wallet"> & {
  wallet: RefillPrepareWallet & RefillInvokeWallet;
};

export type PrepareRefillRefundInput = Omit<
  RefillRefundAuthorization,
  "noteId"
> & {
  wallet: RefillPrepareWallet & RefillTypedDataWallet;
  poolAddress: string;
  recipient: string;
  recoverySalt: string;
};

export type SubmitRefillRefundInput = Omit<PrepareRefillRefundInput, "wallet"> & {
  wallet: RefillPrepareWallet & RefillInvokeWallet & RefillTypedDataWallet;
};

export type PreparedRefillClaim = {
  noteId: string;
  signature: RefillReleaseSignature;
  prepared: PreparedStrk20Call;
};

export type SubmittedRefillClaim = {
  noteId: string;
  signature: RefillReleaseSignature;
  transactionHash: string;
};

export type PreparedRefillRefund = {
  noteId: string;
  signature: string[];
  prepared: PreparedStrk20Call;
};
export type SubmittedRefillRefund = {
  noteId: string;
  signature: string[];
  transactionHash: string;
};

export type PreparedRefillFund = {
  prepared: PreparedStrk20Call;
};

export type InvokeServerAction = {
  actionIndex: number;
  discriminant: bigint;
  contractAddress: bigint;
  calldata: bigint[];
};

export type TransferFromServerAction = {
  actionIndex: number;
  from: bigint;
  token: bigint;
  amount: bigint;
};

export type TransferToServerAction = {
  actionIndex: number;
  recipient: bigint;
  token: bigint;
  amount: bigint;
};

export type ParsedServerActions = {
  actionCount: number;
  discriminants: bigint[];
  invokes: InvokeServerAction[];
  transfersFrom: TransferFromServerAction[];
  transfersTo: TransferToServerAction[];
  screening: "None" | "Some";
};

class FeltReader {
  private index = 0;

  constructor(private readonly values: readonly string[]) {}

  read(label: string): bigint {
    const value = this.values[this.index];
    if (value === undefined) {
      throw new Error(`missing ${label}`);
    }
    if (!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(value)) {
      throw new Error(`${label} is not a canonical felt`);
    }
    this.index += 1;
    return BigInt(value);
  }

  readCount(label: string): number {
    const value = this.read(label);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${label} is too large`);
    }
    return Number(value);
  }

  readMany(count: number, label: string): bigint[] {
    const remaining = this.values.length - this.index;
    if (!Number.isSafeInteger(count) || count < 0 || count > remaining) {
      throw new Error(`${label} length exceeds remaining calldata`);
    }
    return Array.from({ length: count }, (_, index) =>
      this.read(`${label} ${index}`),
    );
  }

  skip(count: number, label: string): void {
    this.readMany(count, label);
  }

  hasRemaining(): boolean {
    return this.index < this.values.length;
  }

  assertFinished(): void {
    if (this.index !== this.values.length) {
      throw new Error("unexpected trailing apply_actions calldata");
    }
  }
}

function toFelt(value: string | bigint, label: string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not a felt`);
  }
  if (parsed < 0n || parsed >= constants.PRIME) {
    throw new Error(`${label} is outside the Stark field`);
  }
  return `0x${parsed.toString(16)}`;
}

function toBoundedInteger(
  value: string | bigint,
  maximum: bigint,
  label: string,
): string {
  const felt = toFelt(value, label);
  if (BigInt(felt) > maximum) {
    throw new Error(`${label} is too large`);
  }
  return felt;
}

function assertSameFelt(actual: bigint, expected: string, label: string): void {
  if (actual !== BigInt(expected)) {
    throw new Error(`${label} does not match the requested refill`);
  }
}

function readSpan(reader: FeltReader, label: string): bigint[] {
  return reader.readMany(reader.readCount(`${label} length`), label);
}

function readServerActions(
  calldata: readonly string[],
  allowMissingScreening = false,
): ParsedServerActions {
  const reader = new FeltReader(calldata);
  const actionCount = reader.readCount("server action count");
  const invokes: InvokeServerAction[] = [];
  const transfersFrom: TransferFromServerAction[] = [];
  const transfersTo: TransferToServerAction[] = [];
  const discriminants: bigint[] = [];

  for (let index = 0; index < actionCount; index += 1) {
    const discriminant = reader.read(`server action ${index} discriminant`);
    discriminants.push(discriminant);
    switch (discriminant) {
      case 0n:
        reader.read(`server action ${index} storage address`);
        readSpan(reader, `server action ${index} write value`);
        break;
      case 1n:
        reader.skip(4, `server action ${index} append value`);
        break;
      case 2n:
        transfersFrom.push({
          actionIndex: index,
          from: reader.read(`server action ${index} deposit source`),
          token: reader.read(`server action ${index} deposit token`),
          amount: reader.read(`server action ${index} deposit amount`),
        });
        break;
      case 6n:
        reader.skip(3, `server action ${index} value`);
        break;
      case 3n:
        transfersTo.push({
          actionIndex: index,
          recipient: reader.read(`server action ${index} transfer recipient`),
          token: reader.read(`server action ${index} transfer token`),
          amount: reader.read(`server action ${index} transfer amount`),
        });
        break;
      case 4n:
      case 7n:
        reader.skip(5, `server action ${index} value`);
        break;
      case 5n:
        reader.skip(6, `server action ${index} value`);
        break;
      case 8n:
        reader.skip(2, `server action ${index} value`);
        break;
      case 9n:
        reader.skip(1, `server action ${index} value`);
        break;
      case INVOKE_SERVER_ACTION_DISCRIMINANT:
      case INVOKE_WITH_COMPUTATION_SERVER_ACTION_DISCRIMINANT:
        invokes.push({
          actionIndex: index,
          discriminant,
          contractAddress: reader.read(
            `server action ${index} invoke contract`,
          ),
          calldata: readSpan(reader, `server action ${index} invoke calldata`),
        });
        break;
      default:
        throw new Error(`unsupported server action discriminant ${discriminant}`);
    }
  }

  if (!reader.hasRemaining() && allowMissingScreening) {
    return {
      actionCount,
      discriminants,
      invokes,
      screening: "None",
      transfersFrom,
      transfersTo,
    };
  }

  const screeningDiscriminant = reader.read("screening option");
  let screening: ParsedServerActions["screening"];
  if (screeningDiscriminant === OPTION_SOME_DISCRIMINANT) {
    reader.skip(3, "screening attestation");
    screening = "Some";
  } else if (screeningDiscriminant === OPTION_NONE_DISCRIMINANT) {
    screening = "None";
  } else {
    throw new Error("invalid screening option");
  }
  reader.assertFinished();
  return { actionCount, discriminants, invokes, screening, transfersFrom, transfersTo };
}

function buildFundActions(
  input: Omit<PrepareRefillFundInput, "wallet" | "poolAddress">,
): RefillFundAction[] {
  const stateId = toFelt(input.stateId, "state id");
  if (BigInt(stateId) === 0n) {
    throw new Error("state id must be non-zero");
  }
  const amount = toBoundedInteger(input.amount, U128_MAX, "amount");
  if (BigInt(amount) === 0n) {
    throw new Error("amount must be non-zero");
  }

  const helperAddress = toFelt(input.helperAddress, "helper address");
  const token = toFelt(input.token, "token");
  if (
    BigInt(input.recoveryCommitment) !==
    BigInt(
      computeRefillRecoveryCommitment(
        stateId,
        input.recoveryAccount,
        input.recoverySalt,
      ),
    )
  ) {
    throw new Error("recovery commitment does not match the Ready account");
  }
  return [
    {
      type: "withdraw",
      token,
      amount,
      recipient: helperAddress,
    },
    {
      type: "invoke",
      contract: helperAddress,
      calldata: [
        toFelt(FUND_OPERATION_DISCRIMINANT, "fund operation"),
        stateId,
        toFelt(input.claimCommitment, "claim commitment"),
        toFelt(input.recoveryCommitment, "recovery commitment"),
        token,
        amount,
        toBoundedInteger(input.expiry, U64_MAX, "expiry"),
      ],
    },
  ];
}

function buildClaimActions(
  input: Omit<PrepareRefillClaimInput, "wallet" | "poolAddress">,
  noteId: string,
  signature: RefillReleaseSignature,
): RefillClaimAction[] {
  return [
    {
      type: "transfer",
      token: toFelt(input.token, "token"),
      amount: "OPEN",
      recipient: toFelt(input.recipient, "recipient"),
    },
    {
      type: "invoke",
      contract: toFelt(input.helperAddress, "helper address"),
      calldata: [
        toFelt(CLAIM_OPERATION_DISCRIMINANT, "claim operation"),
        toFelt(input.stateId, "state id"),
        noteId,
        toFelt(input.nonce, "nonce"),
        toFelt(input.claimPublicKey, "claim public key"),
        toFelt(signature.r, "signature r"),
        toFelt(signature.s, "signature s"),
      ],
    },
  ];
}

function buildRefundActions(
  input: Omit<PrepareRefillRefundInput, "wallet" | "poolAddress">,
  noteId: string,
  signature: readonly string[],
): RefillRefundAction[] {
  return [
    {
      type: "transfer",
      token: toFelt(input.token, "token"),
      amount: "OPEN",
      recipient: toFelt(input.recipient, "recipient"),
    },
    {
      type: "invoke",
      contract: toFelt(input.helperAddress, "helper address"),
      calldata: [
        toFelt(REFUND_OPERATION_DISCRIMINANT, "refund operation"),
        toFelt(input.stateId, "state id"),
        noteId,
        toFelt(input.recoveryAccount, "recovery account"),
        toFelt(input.recoverySalt, "recovery salt"),
        toFelt(BigInt(signature.length), "signature length"),
        ...signature.map((value) => toFelt(value, "signature felt")),
      ],
    },
  ];
}

export function readPreparedServerActions(
  prepared: PreparedStrk20Call,
  poolAddress: string,
): ParsedServerActions {
  if (prepared.call.entry_point !== "apply_actions") {
    throw new Error("prepared call does not target apply_actions");
  }
  const pool = toFelt(poolAddress, "pool address");
  if (BigInt(prepared.call.contract_address) !== BigInt(pool)) {
    throw new Error("prepared call targets the wrong privacy pool");
  }
  if (prepared.call.calldata === undefined) {
    throw new Error("prepared call has no calldata");
  }

  const isSimulation =
    prepared.proof.data.trim().length === 0 &&
    prepared.proof.proof_facts.length === 0;
  return readServerActions(prepared.call.calldata, isSimulation);
}

export function readPreparedHelperInvoke(
  prepared: PreparedStrk20Call,
  poolAddress: string,
  helperAddress: string,
): bigint[] {
  const helper = toFelt(helperAddress, "helper address");
  const { invokes } = readPreparedServerActions(prepared, poolAddress);
  if (
    invokes.length !== 1 ||
    invokes[0]?.discriminant !== INVOKE_SERVER_ACTION_DISCRIMINANT ||
    invokes[0].contractAddress !== BigInt(helper)
  ) {
    throw new Error("prepared call must contain exactly one helper invoke");
  }

  return invokes[0].calldata;
}

function assertPreparedFund(
  prepared: PreparedStrk20Call,
  input: Omit<PrepareRefillFundInput, "wallet">,
): void {
  const helper = toFelt(input.helperAddress, "helper address");
  const token = toFelt(input.token, "token");
  const amount = toBoundedInteger(input.amount, U128_MAX, "amount");
  if (
    BigInt(input.recoveryCommitment) !==
    BigInt(
      computeRefillRecoveryCommitment(
        input.stateId,
        input.recoveryAccount,
        input.recoverySalt,
      ),
    )
  ) {
    throw new Error("recovery commitment does not match the Ready account");
  }
  const { actionCount, discriminants, invokes, screening, transfersTo } = readPreparedServerActions(
    prepared,
    input.poolAddress,
  );

  if (screening !== "None") {
    throw new Error("prepared FUND must not include a screening attestation");
  }

  const transfer = transfersTo[0];
  if (transfersTo.length !== 1 || transfer === undefined) {
    throw new Error("prepared FUND must contain exactly one helper withdrawal");
  }
  if (actionCount !== 2 && actionCount !== 3) {
    throw new Error("prepared FUND contains unexpected server actions");
  }
  const expectedDiscriminants = actionCount === 2 ? [3n, 10n] : [3n, 5n, 10n];
  if (discriminants.some((value, index) => value !== expectedDiscriminants[index])) {
    throw new Error("prepared FUND contains unexpected server actions");
  }
  assertSameFelt(transfer.recipient, helper, "withdrawal recipient");
  assertSameFelt(transfer.token, token, "withdrawal token");
  assertSameFelt(transfer.amount, amount, "withdrawal amount");

  const invoke = invokes[0];
  if (
    invokes.length !== 1 ||
    invoke === undefined ||
    invoke.discriminant !== INVOKE_SERVER_ACTION_DISCRIMINANT ||
    invoke.contractAddress !== BigInt(helper)
  ) {
    throw new Error("prepared FUND must contain exactly one helper invoke");
  }
  if (transfer.actionIndex >= invoke.actionIndex) {
    throw new Error("prepared FUND must withdraw before invoking the helper");
  }

  const fund = invoke.calldata;
  if (fund.length !== 7) {
    throw new Error("prepared helper invoke has an invalid FUND shape");
  }
  const expected = [
    toFelt(FUND_OPERATION_DISCRIMINANT, "fund operation"),
    toFelt(input.stateId, "state id"),
    toFelt(input.claimCommitment, "claim commitment"),
    toFelt(input.recoveryCommitment, "recovery commitment"),
    token,
    amount,
    toBoundedInteger(input.expiry, U64_MAX, "expiry"),
  ];
  expected.forEach((value, index) => {
    assertSameFelt(fund[index]!, value, `FUND calldata ${index}`);
  });
}

export function assertSubmittableProof(
  prepared: PreparedStrk20Call,
  operation: "FUND" | "TOP_UP" | "CLAIM" | "REFUND",
): void {
  if (
    prepared.proof.data.trim().length === 0 ||
    prepared.proof.proof_facts.length === 0
  ) {
    throw new Error(`wallet returned a non-submittable ${operation} proof`);
  }
}

export function assertPreparedRefillFund(
  prepared: PreparedStrk20Call,
  input: Omit<PrepareRefillFundInput, "wallet">,
): void {
  assertSubmittableProof(prepared, "FUND");
  assertPreparedFund(prepared, input);
}

function readClaimNoteId(
  prepared: PreparedStrk20Call,
  input: Omit<PrepareRefillClaimInput, "wallet" | "claimPrivateKey">,
  expectedSignature?: RefillReleaseSignature,
): string {
  const claim = readPreparedHelperInvoke(
    prepared,
    input.poolAddress,
    input.helperAddress,
  );

  if (claim.length !== 7) {
    throw new Error("prepared helper invoke has an invalid claim shape");
  }
  assertSameFelt(claim[0]!, toFelt(1n, "claim operation"), "operation");
  assertSameFelt(claim[1]!, toFelt(input.stateId, "state id"), "state id");
  assertSameFelt(claim[3]!, toFelt(input.nonce, "nonce"), "nonce");
  assertSameFelt(
    claim[4]!,
    toFelt(input.claimPublicKey, "claim public key"),
    "claim public key",
  );
  if (expectedSignature !== undefined) {
    assertSameFelt(
      claim[5]!,
      toFelt(expectedSignature.r, "signature r"),
      "signature r",
    );
    assertSameFelt(
      claim[6]!,
      toFelt(expectedSignature.s, "signature s"),
      "signature s",
    );
  }
  return toFelt(claim[2]!, "OPEN note id");
}

function readRefundNoteId(
  prepared: PreparedStrk20Call,
  input: Omit<PrepareRefillRefundInput, "wallet">,
  expectedSignature?: readonly string[],
): string {
  const refund = readPreparedHelperInvoke(
    prepared,
    input.poolAddress,
    input.helperAddress,
  );

  if (refund.length < 6) {
    throw new Error("prepared helper invoke has an invalid refund shape");
  }
  assertSameFelt(refund[0]!, toFelt(2n, "refund operation"), "operation");
  assertSameFelt(refund[1]!, toFelt(input.stateId, "state id"), "state id");
  assertSameFelt(
    refund[3]!,
    toFelt(input.recoveryAccount, "recovery account"),
    "recovery account",
  );
  assertSameFelt(
    refund[4]!,
    toFelt(input.recoverySalt, "recovery salt"),
    "recovery salt",
  );
  const signatureLength = refund[5]!;
  if (
    signatureLength > BigInt(Number.MAX_SAFE_INTEGER) ||
    refund.length !== 6 + Number(signatureLength)
  ) {
    throw new Error("prepared helper invoke has an invalid refund signature");
  }
  if (expectedSignature !== undefined) {
    if (Number(signatureLength) !== expectedSignature.length) {
      throw new Error("prepared helper invoke changed the refund signature length");
    }
    expectedSignature.forEach((value, index) => {
      assertSameFelt(
        refund[6 + index]!,
        toFelt(value, "signature felt"),
        `signature felt ${index}`,
      );
    });
  }
  return toFelt(refund[2]!, "OPEN note id");
}

export function computeRefillClaimCommitment(
  stateId: string | bigint,
  claimPublicKey: string,
): string {
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString("WR_CLAIM_KEY_V1"),
    toFelt(stateId, "state id"),
    toFelt(claimPublicKey, "claim public key"),
  ]);
}

export function computeRefillRecoveryCommitment(
  stateId: string | bigint,
  recoveryAccount: string,
  recoverySalt: string,
): string {
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString("WR_RECOVERY_ACCOUNT_V1"),
    toFelt(stateId, "state id"),
    toFelt(recoveryAccount, "recovery account"),
    toFelt(recoverySalt, "recovery salt"),
  ]);
}

function computeRefillReleaseHashForOperation(
  operation: typeof CLAIM_OPERATION,
  authorization: RefillClaimAuthorization,
): string {
  const expiry = toBoundedInteger(authorization.expiry, U64_MAX, "expiry");
  const amount = toBoundedInteger(authorization.amount, U128_MAX, "amount");
  const message: TypedData = {
    types: REFILL_RELEASE_TYPES,
    primaryType: "RefillRelease",
    domain: {
      name: "WrenchlessRefill",
      version: "1",
      chainId: authorization.chainId,
      revision: "1",
    },
    message: {
      operation,
      stateId: toFelt(authorization.stateId, "state id"),
      nonce: toFelt(authorization.nonce, "nonce"),
      expiry,
      token: toFelt(authorization.token, "token"),
      amount,
      noteId: toFelt(authorization.noteId, "OPEN note id"),
    },
  };
  return typedData.getMessageHash(
    message,
    toFelt(authorization.helperAddress, "helper address"),
  );
}

export function computeRefillReleaseHash(
  authorization: RefillClaimAuthorization,
): string {
  return computeRefillReleaseHashForOperation(CLAIM_OPERATION, authorization);
}

export function computeRefillRefundHash(
  authorization: RefillRefundAuthorization,
): string {
  return typedData.getMessageHash(
    createRefillRefundTypedData(authorization),
    toFelt(authorization.recoveryAccount, "recovery account"),
  );
}

export function createRefillRefundTypedData(
  authorization: RefillRefundAuthorization,
): TypedData {
  return {
    types: SAFE_RETURN_TYPES,
    primaryType: "SafeReturn",
    domain: {
      name: "WrenchlessSafe",
      version: "2",
      chainId: authorization.chainId,
      revision: "1",
    },
    message: {
      helper: toFelt(authorization.helperAddress, "helper address"),
      stateId: toFelt(authorization.stateId, "state id"),
      expiry: toBoundedInteger(authorization.expiry, U64_MAX, "expiry"),
      token: toFelt(authorization.token, "token"),
      amount: toBoundedInteger(authorization.amount, U128_MAX, "amount"),
      noteId: toFelt(authorization.noteId, "OPEN note id"),
    },
  };
}

export function signRefillClaim(
  claimPrivateKey: string,
  authorization: RefillClaimAuthorization,
): RefillReleaseSignature {
  const signature = ec.starkCurve.sign(
    computeRefillReleaseHash(authorization),
    claimPrivateKey,
  );
  return {
    r: toFelt(signature.r, "signature r"),
    s: toFelt(signature.s, "signature s"),
  };
}

async function requestRefillRefundSignature(
  wallet: RefillTypedDataWallet,
  authorization: RefillRefundAuthorization,
): Promise<string[]> {
  const signature = [
    ...(await wallet.signTypedData(createRefillRefundTypedData(authorization))),
  ];
  if (signature.length === 0) throw new Error("Ready returned an empty signature");
  return signature.map((value) => toFelt(value, "signature felt"));
}

export async function prepareRefillClaim(
  input: PrepareRefillClaimInput,
): Promise<PreparedRefillClaim> {
  const derivedPublicKey = ec.starkCurve.getStarkKey(input.claimPrivateKey);
  if (BigInt(derivedPublicKey) !== BigInt(input.claimPublicKey)) {
    throw new Error("claim private key does not match the funded public key");
  }

  const previewActions = buildClaimActions(
    input,
    OPEN_NOTE_PLACEHOLDER,
    { r: "0x0", s: "0x0" },
  );
  const preview = await input.wallet.strk20PrepareInvoke(previewActions, true);
  const candidateNoteId = readClaimNoteId(preview, input);
  const signature = signRefillClaim(input.claimPrivateKey, {
    chainId: input.chainId,
    helperAddress: input.helperAddress,
    stateId: input.stateId,
    nonce: input.nonce,
    expiry: input.expiry,
    token: input.token,
    amount: input.amount,
    noteId: candidateNoteId,
  });

  const prepared = await input.wallet.strk20PrepareInvoke(
    buildClaimActions(input, OPEN_NOTE_PLACEHOLDER, signature),
    false,
  );
  assertSubmittableProof(prepared, "CLAIM");
  const preparedNoteId = readClaimNoteId(prepared, input, signature);
  if (BigInt(preparedNoteId) !== BigInt(candidateNoteId)) {
    throw new Error(
      "OPEN note changed after preview; discard this proof and prepare the claim again",
    );
  }

  return { noteId: preparedNoteId, signature, prepared };
}

export async function submitRefillClaim(
  input: SubmitRefillClaimInput,
): Promise<SubmittedRefillClaim> {
  const derivedPublicKey = ec.starkCurve.getStarkKey(input.claimPrivateKey);
  if (BigInt(derivedPublicKey) !== BigInt(input.claimPublicKey)) {
    throw new Error("claim private key does not match the funded public key");
  }

  const preview = await input.wallet.strk20PrepareInvoke(
    buildClaimActions(input, OPEN_NOTE_PLACEHOLDER, { r: "0x0", s: "0x0" }),
    true,
  );
  const noteId = readClaimNoteId(preview, input);
  const signature = signRefillClaim(input.claimPrivateKey, {
    chainId: input.chainId,
    helperAddress: input.helperAddress,
    stateId: input.stateId,
    nonce: input.nonce,
    expiry: input.expiry,
    token: input.token,
    amount: input.amount,
    noteId,
  });
  const result = await input.wallet.strk20InvokeTransaction(
    buildClaimActions(input, OPEN_NOTE_PLACEHOLDER, signature),
  );
  const transactionHash = toFelt(result.transaction_hash, "transaction hash");
  if (BigInt(transactionHash) === 0n) {
    throw new Error("transaction hash must be non-zero");
  }
  return { noteId, signature, transactionHash };
}

export async function prepareRefillRefund(
  input: PrepareRefillRefundInput,
): Promise<PreparedRefillRefund> {
  const previewActions = buildRefundActions(
    input,
    OPEN_NOTE_PLACEHOLDER,
    [],
  );
  const preview = await input.wallet.strk20PrepareInvoke(previewActions, true);
  const candidateNoteId = readRefundNoteId(preview, input);
  const signature = await requestRefillRefundSignature(input.wallet, {
    chainId: input.chainId,
    helperAddress: input.helperAddress,
    stateId: input.stateId,
    expiry: input.expiry,
    token: input.token,
    amount: input.amount,
    noteId: candidateNoteId,
    recoveryAccount: input.recoveryAccount,
  });

  const prepared = await input.wallet.strk20PrepareInvoke(
    buildRefundActions(input, OPEN_NOTE_PLACEHOLDER, signature),
    false,
  );
  assertSubmittableProof(prepared, "REFUND");
  const preparedNoteId = readRefundNoteId(prepared, input, signature);
  if (BigInt(preparedNoteId) !== BigInt(candidateNoteId)) {
    throw new Error(
      "OPEN note changed after preview; discard this proof and prepare the refund again",
    );
  }

  return { noteId: preparedNoteId, signature, prepared };
}

export async function submitRefillRefund(
  input: SubmitRefillRefundInput,
): Promise<SubmittedRefillRefund> {
  const preview = await input.wallet.strk20PrepareInvoke(
    buildRefundActions(input, OPEN_NOTE_PLACEHOLDER, []),
    true,
  );
  const noteId = readRefundNoteId(preview, input);
  const signature = await requestRefillRefundSignature(input.wallet, {
    chainId: input.chainId,
    helperAddress: input.helperAddress,
    stateId: input.stateId,
    expiry: input.expiry,
    token: input.token,
    amount: input.amount,
    noteId,
    recoveryAccount: input.recoveryAccount,
  });
  const result = await input.wallet.strk20InvokeTransaction(
    buildRefundActions(input, OPEN_NOTE_PLACEHOLDER, signature),
  );
  const transactionHash = toFelt(result.transaction_hash, "transaction hash");
  if (BigInt(transactionHash) === 0n) {
    throw new Error("transaction hash must be non-zero");
  }
  return { noteId, signature, transactionHash };
}

export async function prepareRefillFund(
  input: PrepareRefillFundInput,
): Promise<PreparedRefillFund> {
  const prepared = await input.wallet.strk20PrepareInvoke(
    buildFundActions(input),
    false,
  );
  assertPreparedRefillFund(prepared, input);
  return { prepared };
}
