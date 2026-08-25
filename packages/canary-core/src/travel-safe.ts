import {
  generateMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { ec } from "starknet";

import { computeRefillClaimCommitment } from "./refill-claim.js";

const DOMAIN = "WRENCHLESS_TRAVEL_SAFE_V1";
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const MAX_DERIVATION_ATTEMPTS = 1_024;

export type TravelSafeSecrets = {
  stateId: string;
  claimPrivateKey: string;
  claimPublicKey: string;
  claimCommitment: string;
  recoverySalt: string;
};

function canonicalPhrase(phrase: string): string {
  const normalized = phrase.trim().toLowerCase().split(/\s+/u).join(" ");
  if (
    normalized.split(" ").length !== 12 ||
    !validateMnemonic(normalized, wordlist)
  ) {
    throw new Error("Enter a valid twelve-word recovery phrase");
  }
  return normalized;
}

function bytesToBigInt(bytes: ArrayBuffer): bigint {
  const hex = Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return BigInt(`0x${hex}`);
}

function canonicalHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

async function deriveNonZeroScalar(input: {
  material: CryptoKey;
  purpose: "state-id" | "claim-private-key" | "recovery-salt";
  upperBound: bigint;
}): Promise<string> {
  const encoder = new TextEncoder();
  const salt = encoder.encode(DOMAIN);
  for (let counter = 0; counter < MAX_DERIVATION_ATTEMPTS; counter += 1) {
    const candidate = bytesToBigInt(
      await crypto.subtle.deriveBits(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt,
          info: encoder.encode(`${DOMAIN}:${input.purpose}:${counter}`),
        },
        input.material,
        256,
      ),
    );
    if (candidate > 0n && candidate < input.upperBound) {
      return canonicalHex(candidate);
    }
  }
  throw new Error("Could not derive Travel Safe recovery authority");
}

export function generateTravelSafePhrase(): string {
  return generateMnemonic(wordlist, 128);
}

export async function deriveTravelSafeSecrets(
  phrase: string,
): Promise<TravelSafeSecrets> {
  const entropy = mnemonicToEntropy(canonicalPhrase(phrase), wordlist);
  const entropyBytes = new Uint8Array(entropy.length);
  entropyBytes.set(entropy);
  const material = await crypto.subtle.importKey(
    "raw",
    entropyBytes.buffer,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const [stateId, claimPrivateKey, recoverySalt] = await Promise.all([
    deriveNonZeroScalar({
      material,
      purpose: "state-id",
      upperBound: STARK_FIELD_PRIME,
    }),
    deriveNonZeroScalar({
      material,
      purpose: "claim-private-key",
      upperBound: ec.starkCurve.CURVE.n,
    }),
    deriveNonZeroScalar({
      material,
      purpose: "recovery-salt",
      upperBound: STARK_FIELD_PRIME,
    }),
  ]);
  const claimPublicKey = ec.starkCurve.getStarkKey(claimPrivateKey);
  return {
    stateId,
    claimPrivateKey,
    claimPublicKey,
    claimCommitment: computeRefillClaimCommitment(stateId, claimPublicKey),
    recoverySalt,
  };
}

export function chooseTravelSafeRelease(
  returnDateSeconds: string | bigint,
  chainTimeSeconds: string | bigint,
): "claim" | "refund" {
  let returnDate: bigint;
  let chainTime: bigint;
  try {
    returnDate = BigInt(returnDateSeconds);
    chainTime = BigInt(chainTimeSeconds);
  } catch {
    throw new Error("Travel Safe time is invalid");
  }
  if (returnDate <= 0n || chainTime <= 0n) {
    throw new Error("Travel Safe time must be positive");
  }
  return chainTime <= returnDate ? "claim" : "refund";
}
