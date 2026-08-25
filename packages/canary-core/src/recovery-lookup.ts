import { constants, typedData, type TypedData } from "starknet";

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

const RECOVERY_LOOKUP_TYPES: TypedData["types"] = {
  StarknetDomain: [
    { name: "name", type: "shortstring" },
    { name: "version", type: "shortstring" },
    { name: "chainId", type: "shortstring" },
    { name: "revision", type: "shortstring" },
  ],
  RecoveryLookup: [
    { name: "challenge", type: "felt" },
    { name: "expiresAt", type: "u128" },
  ],
};

const RECOVERY_REGISTRATION_TYPES: TypedData["types"] = {
  StarknetDomain: RECOVERY_LOOKUP_TYPES.StarknetDomain!,
  RecoveryRegistration: [
    { name: "helper", type: "ContractAddress" },
    { name: "stateId", type: "felt" },
    { name: "claimCommitment", type: "felt" },
    { name: "recoveryCommitment", type: "felt" },
    { name: "token", type: "ContractAddress" },
    { name: "amount", type: "u128" },
    { name: "expiry", type: "u128" },
  ],
};

export type RecoveryLookupAuthorization = {
  chainId: string;
  recoveryAccount: string;
  challenge: string;
  expiresAt: string | bigint;
};

export type RecoveryRegistrationAuthorization = {
  chainId: string;
  recoveryAccount: string;
  helperAddress: string;
  stateId: string;
  claimCommitment: string;
  recoveryCommitment: string;
  tokenAddress: string;
  amountFri: string | bigint;
  expiry: string | bigint;
};

function felt(value: string, label: string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not a felt`);
  }
  if (parsed <= 0n || parsed >= constants.PRIME) {
    throw new Error(`${label} is outside the non-zero Stark field`);
  }
  return `0x${parsed.toString(16)}`;
}

function u64(value: string | bigint, label: string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not an integer`);
  }
  if (parsed <= 0n || parsed > U64_MAX) {
    throw new Error(`${label} is outside u64`);
  }
  return parsed.toString();
}

function u128(value: string | bigint, label: string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new Error(`${label} is not an integer`);
  }
  if (parsed <= 0n || parsed > U128_MAX) {
    throw new Error(`${label} is outside u128`);
  }
  return parsed.toString();
}

export function createRecoveryLookupTypedData(
  authorization: RecoveryLookupAuthorization,
): TypedData {
  return {
    types: RECOVERY_LOOKUP_TYPES,
    primaryType: "RecoveryLookup",
    domain: {
      name: "WrenchlessRecovery",
      version: "1",
      chainId: authorization.chainId,
      revision: "1",
    },
    message: {
      challenge: felt(authorization.challenge, "recovery challenge"),
      expiresAt: u64(authorization.expiresAt, "recovery challenge expiry"),
    },
  };
}

export function computeRecoveryLookupHash(
  authorization: RecoveryLookupAuthorization,
): string {
  return typedData.getMessageHash(
    createRecoveryLookupTypedData(authorization),
    felt(authorization.recoveryAccount, "recovery account"),
  );
}

export function createRecoveryRegistrationTypedData(
  authorization: RecoveryRegistrationAuthorization,
): TypedData {
  return {
    types: RECOVERY_REGISTRATION_TYPES,
    primaryType: "RecoveryRegistration",
    domain: {
      name: "WrenchlessRecovery",
      version: "1",
      chainId: authorization.chainId,
      revision: "1",
    },
    message: {
      helper: felt(authorization.helperAddress, "helper address"),
      stateId: felt(authorization.stateId, "state id"),
      claimCommitment: felt(
        authorization.claimCommitment,
        "claim commitment",
      ),
      recoveryCommitment: felt(
        authorization.recoveryCommitment,
        "recovery commitment",
      ),
      token: felt(authorization.tokenAddress, "token address"),
      amount: u128(authorization.amountFri, "recovery amount"),
      expiry: u64(authorization.expiry, "recovery expiry"),
    },
  };
}

export function computeRecoveryRegistrationHash(
  authorization: RecoveryRegistrationAuthorization,
): string {
  return typedData.getMessageHash(
    createRecoveryRegistrationTypedData(authorization),
    felt(authorization.recoveryAccount, "recovery account"),
  );
}
