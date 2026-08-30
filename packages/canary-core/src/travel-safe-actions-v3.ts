import {
  constants,
  ec,
  hash,
  shortString,
  typedData,
  type TypedData,
} from "starknet";

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

export const TRAVEL_SAFE_V3_OPEN_NOTE = "${openNoteIds[0]}";

const OPERATION = {
  fund: 0n,
  release: 1n,
  topUp: 2n,
  extend: 3n,
  claimEarly: 4n,
  refund: 5n,
} as const;

const ACTION_TYPES: TypedData["types"] = {
  StarknetDomain: [
    { name: "name", type: "shortstring" },
    { name: "version", type: "shortstring" },
    { name: "chainId", type: "shortstring" },
    { name: "revision", type: "shortstring" },
  ],
  TravelSafeAction: [
    { name: "operation", type: "shortstring" },
    { name: "stateId", type: "felt" },
    { name: "nonce", type: "u128" },
    { name: "token", type: "ContractAddress" },
    { name: "remainingAmount", type: "u128" },
    { name: "value", type: "u128" },
    { name: "firstReleaseAt", type: "u128" },
    { name: "returnAt", type: "u128" },
    { name: "noteId", type: "felt" },
  ],
};

const RETURN_TYPES: TypedData["types"] = {
  StarknetDomain: ACTION_TYPES.StarknetDomain!,
  TravelSafeReturn: [
    { name: "helper", type: "ContractAddress" },
    { name: "stateId", type: "felt" },
    { name: "nonce", type: "u128" },
    { name: "token", type: "ContractAddress" },
    { name: "remainingAmount", type: "u128" },
    { name: "returnAt", type: "u128" },
    { name: "noteId", type: "felt" },
  ],
};

/**
 * Moving ordinary funds into the pool as part of a larger action.
 *
 * A deposit is never sent on its own: it compiles to a TransferFrom and a
 * Deposit event, neither of which carries a nullifier or a random, so a bundle
 * containing nothing else is refused by the pool as NO_REPLAY_PROTECTION. It
 * rides along with the withdrawal that funds a Safe, which supplies both.
 */
export type TravelSafeV3DepositAction = {
  type: "deposit";
  token: string;
  amount: string;
};

export type TravelSafeV3TransferAction = {
  type: "transfer";
  token: string;
  amount: "OPEN";
  recipient: string;
};

export type TravelSafeV3WithdrawAction = {
  type: "withdraw";
  token: string;
  amount: string;
  recipient: string;
};

export type TravelSafeV3InvokeAction = {
  type: "invoke";
  contract: string;
  calldata: string[];
};

export type TravelSafeV3Action =
  | TravelSafeV3DepositAction
  | TravelSafeV3TransferAction
  | TravelSafeV3WithdrawAction
  | TravelSafeV3InvokeAction;

export type TravelSafeV3Signature = { r: string; s: string };

export type TravelSafeV3StateAuthorization = {
  chainId: string;
  helperAddress: string;
  stateId: string;
  nonce: string;
  tokenAddress: string;
  remainingAmount: string;
  firstReleaseAt: string;
  returnAt: string;
};

export type TravelSafeV3ActionAuthorization =
  TravelSafeV3StateAuthorization & {
    operation: "RELEASE" | "TOP_UP" | "EXTEND" | "CLAIM_EARLY";
    value: string;
    noteId: string;
  };

export type TravelSafeV3ReturnAuthorization =
  TravelSafeV3StateAuthorization & {
    recoveryAccount: string;
    noteId: string;
  };

function felt(value: string | bigint, label: string, allowZero = true): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not a felt`);
  }
  if (parsed < 0n || parsed >= constants.PRIME || (!allowZero && parsed === 0n)) {
    throw new Error(`${label} is outside the Stark field`);
  }
  return `0x${parsed.toString(16)}`;
}

function integer(
  value: string | bigint,
  maximum: bigint,
  label: string,
  allowZero = true,
): string {
  const parsed = felt(value, label, allowZero);
  if (BigInt(parsed) > maximum) throw new Error(`${label} is too large`);
  return parsed;
}

function nonZeroFelt(value: string | bigint, label: string): string {
  return felt(value, label, false);
}

function nonZeroAmount(value: string | bigint, label = "amount"): string {
  return integer(value, U128_MAX, label, false);
}

function openNote(value: string): string {
  return value === TRAVEL_SAFE_V3_OPEN_NOTE
    ? value
    : felt(value, "OPEN note ID");
}

function domain(chainId: string) {
  return {
    name: "WrenchlessSafe",
    version: "3",
    chainId: felt(chainId, "chain ID", false),
    revision: "1",
  };
}

export function computeTravelSafeV3ClaimCommitment(
  stateId: string,
  claimPublicKey: string,
): string {
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString("WR_CLAIM_KEY_V3"),
    nonZeroFelt(stateId, "state ID"),
    nonZeroFelt(claimPublicKey, "claim public key"),
  ]);
}

export function deriveTravelSafeV3PublicKey(privateKey: string): string {
  return ec.starkCurve.getStarkKey(nonZeroFelt(privateKey, "private key"));
}

/**
 * A fresh device key, in the canonical felt form every consumer stores and
 * validates.
 *
 * The zero-padded byte string this used to return was never canonical: a Stark
 * key is below 2^251, so its first byte never exceeds 0x07 and the text always
 * carried a leading zero nibble. The ticket store rejected every one of them,
 * which took out Safe creation entirely. Canonicalising here changes the text
 * and not the key — the same scalar derives the same public key and the same
 * signatures.
 */
export function generateTravelSafeV3PrivateKey(): string {
  const bytes = ec.starkCurve.utils.randomPrivateKey();
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return nonZeroFelt(`0x${hex}`, "device private key");
}

export function computeTravelSafeV3DeviceCommitment(
  stateId: string,
  devicePublicKey: string,
): string {
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString("WR_DEVICE_KEY_V3"),
    nonZeroFelt(stateId, "state ID"),
    nonZeroFelt(devicePublicKey, "device public key"),
  ]);
}

export function computeTravelSafeV3RecoveryCommitment(
  stateId: string,
  recoveryAccount: string,
  recoverySalt: string,
): string {
  return hash.computePoseidonHashOnElements([
    shortString.encodeShortString("WR_RECOVERY_V3"),
    nonZeroFelt(stateId, "state ID"),
    nonZeroFelt(recoveryAccount, "recovery account"),
    nonZeroFelt(recoverySalt, "recovery salt"),
  ]);
}

export function createTravelSafeV3ActionTypedData(
  authorization: TravelSafeV3ActionAuthorization,
): TypedData {
  return {
    types: ACTION_TYPES,
    primaryType: "TravelSafeAction",
    domain: domain(authorization.chainId),
    message: {
      operation: authorization.operation,
      stateId: nonZeroFelt(authorization.stateId, "state ID"),
      nonce: integer(authorization.nonce, U64_MAX, "nonce"),
      token: nonZeroFelt(authorization.tokenAddress, "token"),
      remainingAmount: nonZeroAmount(
        authorization.remainingAmount,
        "remaining amount",
      ),
      value: integer(authorization.value, U128_MAX, "value"),
      firstReleaseAt: integer(
        authorization.firstReleaseAt,
        U64_MAX,
        "first release",
      ),
      returnAt: integer(authorization.returnAt, U64_MAX, "return date"),
      noteId: felt(authorization.noteId, "OPEN note ID"),
    },
  };
}

export function computeTravelSafeV3ActionHash(
  authorization: TravelSafeV3ActionAuthorization,
): string {
  return typedData.getMessageHash(
    createTravelSafeV3ActionTypedData(authorization),
    nonZeroFelt(authorization.helperAddress, "helper address"),
  );
}

export function signTravelSafeV3Action(
  privateKey: string,
  authorization: TravelSafeV3ActionAuthorization,
): TravelSafeV3Signature {
  const signature = ec.starkCurve.sign(
    computeTravelSafeV3ActionHash(authorization),
    nonZeroFelt(privateKey, "private key"),
  );
  return {
    r: felt(signature.r, "signature r", false),
    s: felt(signature.s, "signature s", false),
  };
}

export function createTravelSafeV3ReturnTypedData(
  authorization: TravelSafeV3ReturnAuthorization,
): TypedData {
  return {
    types: RETURN_TYPES,
    primaryType: "TravelSafeReturn",
    domain: domain(authorization.chainId),
    message: {
      helper: nonZeroFelt(authorization.helperAddress, "helper address"),
      stateId: nonZeroFelt(authorization.stateId, "state ID"),
      nonce: integer(authorization.nonce, U64_MAX, "nonce"),
      token: nonZeroFelt(authorization.tokenAddress, "token"),
      remainingAmount: nonZeroAmount(
        authorization.remainingAmount,
        "remaining amount",
      ),
      returnAt: integer(authorization.returnAt, U64_MAX, "return date"),
      noteId: nonZeroFelt(authorization.noteId, "OPEN note ID"),
    },
  };
}

export function computeTravelSafeV3ReturnHash(
  authorization: TravelSafeV3ReturnAuthorization,
): string {
  return typedData.getMessageHash(
    createTravelSafeV3ReturnTypedData(authorization),
    nonZeroFelt(authorization.recoveryAccount, "recovery account"),
  );
}

export function buildTravelSafeV3FundActions(input: {
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
  /** Ordinary funds to move into the pool first. "0" or absent for none. */
  depositAmount?: string;
}): TravelSafeV3Action[] {
  const helper = nonZeroFelt(input.helperAddress, "helper address");
  const token = nonZeroFelt(input.tokenAddress, "token");
  const amount = nonZeroAmount(input.amount);
  const daily = integer(input.dailyAmount, U128_MAX, "daily amount");
  if (BigInt(daily) > BigInt(amount)) {
    throw new Error("daily amount cannot exceed the Safe amount");
  }
  const firstRelease = integer(
    input.firstReleaseAt,
    U64_MAX,
    "first release",
  );
  const returnAt = integer(input.returnAt, U64_MAX, "return date", false);
  if (BigInt(firstRelease) > BigInt(returnAt)) {
    throw new Error("first release cannot be after the return date");
  }
  if (BigInt(daily) === 0n && BigInt(firstRelease) !== BigInt(returnAt)) {
    throw new Error("single-return Safes release only on the return date");
  }

  const deposit = integer(input.depositAmount ?? "0", U128_MAX, "deposit amount");
  return [
    ...(BigInt(deposit) > 0n
      ? [{ type: "deposit" as const, token, amount: deposit }]
      : []),
    { type: "withdraw", token, amount, recipient: helper },
    {
      type: "invoke",
      contract: helper,
      calldata: [
        felt(OPERATION.fund, "FUND operation"),
        nonZeroFelt(input.stateId, "state ID"),
        nonZeroFelt(input.claimCommitment, "claim commitment"),
        nonZeroFelt(input.deviceCommitment, "device commitment"),
        nonZeroFelt(input.recoveryCommitment, "recovery commitment"),
        token,
        amount,
        daily,
        firstRelease,
        returnAt,
      ],
    },
  ];
}

export function buildTravelSafeV3ReleaseActions(input: {
  helperAddress: string;
  stateId: string;
  tokenAddress: string;
  recipient: string;
  noteId: string;
  nonce: string;
  devicePublicKey: string;
  signature: TravelSafeV3Signature;
}): TravelSafeV3Action[] {
  const token = nonZeroFelt(input.tokenAddress, "token");
  const helper = nonZeroFelt(input.helperAddress, "helper address");
  const note = openNote(input.noteId);
  return [
    {
      type: "transfer",
      token,
      amount: "OPEN",
      recipient: nonZeroFelt(input.recipient, "recipient"),
    },
    {
      type: "invoke",
      contract: helper,
      calldata: [
        felt(OPERATION.release, "release operation"),
        nonZeroFelt(input.stateId, "state ID"),
        note,
        integer(input.nonce, U64_MAX, "nonce"),
        nonZeroFelt(input.devicePublicKey, "device public key"),
        nonZeroFelt(input.signature.r, "signature r"),
        nonZeroFelt(input.signature.s, "signature s"),
      ],
    },
  ];
}

export function buildTravelSafeV3TopUpActions(input: {
  helperAddress: string;
  stateId: string;
  tokenAddress: string;
  amount: string;
  nonce: string;
  devicePublicKey: string;
  signature: TravelSafeV3Signature;
  /** Ordinary funds to move into the pool first. "0" or absent for none. */
  depositAmount?: string;
}): TravelSafeV3Action[] {
  const token = nonZeroFelt(input.tokenAddress, "token");
  const helper = nonZeroFelt(input.helperAddress, "helper address");
  const amount = nonZeroAmount(input.amount);
  const deposit = integer(input.depositAmount ?? "0", U128_MAX, "deposit amount");
  return [
    ...(BigInt(deposit) > 0n
      ? [{ type: "deposit" as const, token, amount: deposit }]
      : []),
    { type: "withdraw", token, amount, recipient: helper },
    {
      type: "invoke",
      contract: helper,
      calldata: [
        felt(OPERATION.topUp, "top-up operation"),
        nonZeroFelt(input.stateId, "state ID"),
        token,
        amount,
        integer(input.nonce, U64_MAX, "nonce"),
        nonZeroFelt(input.devicePublicKey, "device public key"),
        nonZeroFelt(input.signature.r, "signature r"),
        nonZeroFelt(input.signature.s, "signature s"),
      ],
    },
  ];
}

export function buildTravelSafeV3ExtendActions(input: {
  helperAddress: string;
  stateId: string;
  newReturnAt: string;
  nonce: string;
  devicePublicKey: string;
  signature: TravelSafeV3Signature;
}): TravelSafeV3Action[] {
  return [
    {
      type: "invoke",
      contract: nonZeroFelt(input.helperAddress, "helper address"),
      calldata: [
        felt(OPERATION.extend, "extend operation"),
        nonZeroFelt(input.stateId, "state ID"),
        integer(input.newReturnAt, U64_MAX, "new return date", false),
        integer(input.nonce, U64_MAX, "nonce"),
        nonZeroFelt(input.devicePublicKey, "device public key"),
        nonZeroFelt(input.signature.r, "signature r"),
        nonZeroFelt(input.signature.s, "signature s"),
      ],
    },
  ];
}

export function buildTravelSafeV3ClaimEarlyActions(input: {
  helperAddress: string;
  stateId: string;
  tokenAddress: string;
  recipient: string;
  noteId: string;
  nonce: string;
  claimPublicKey: string;
  signature: TravelSafeV3Signature;
}): TravelSafeV3Action[] {
  const token = nonZeroFelt(input.tokenAddress, "token");
  return [
    {
      type: "transfer",
      token,
      amount: "OPEN",
      recipient: nonZeroFelt(input.recipient, "recipient"),
    },
    {
      type: "invoke",
      contract: nonZeroFelt(input.helperAddress, "helper address"),
      calldata: [
        felt(OPERATION.claimEarly, "early-claim operation"),
        nonZeroFelt(input.stateId, "state ID"),
        openNote(input.noteId),
        integer(input.nonce, U64_MAX, "nonce"),
        nonZeroFelt(input.claimPublicKey, "claim public key"),
        nonZeroFelt(input.signature.r, "signature r"),
        nonZeroFelt(input.signature.s, "signature s"),
      ],
    },
  ];
}

export function buildTravelSafeV3RefundActions(input: {
  helperAddress: string;
  stateId: string;
  tokenAddress: string;
  recipient: string;
  noteId: string;
  nonce: string;
  recoveryAccount: string;
  recoverySalt: string;
  signature: readonly string[];
}): TravelSafeV3Action[] {
  if (input.signature.length === 0) {
    throw new Error("return signature cannot be empty");
  }
  const token = nonZeroFelt(input.tokenAddress, "token");
  return [
    {
      type: "transfer",
      token,
      amount: "OPEN",
      recipient: nonZeroFelt(input.recipient, "recipient"),
    },
    {
      type: "invoke",
      contract: nonZeroFelt(input.helperAddress, "helper address"),
      calldata: [
        felt(OPERATION.refund, "refund operation"),
        nonZeroFelt(input.stateId, "state ID"),
        openNote(input.noteId),
        integer(input.nonce, U64_MAX, "nonce"),
        nonZeroFelt(input.recoveryAccount, "recovery account"),
        nonZeroFelt(input.recoverySalt, "recovery salt"),
        felt(BigInt(input.signature.length), "signature length"),
        ...input.signature.map((value) => nonZeroFelt(value, "signature felt")),
      ],
    },
  ];
}
