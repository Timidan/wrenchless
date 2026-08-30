import type { TravelSafeReadiness } from "./ready-private-setup.js";

const TWO_HOURS_SECONDS = 2n * 60n * 60n;
const NINETY_DAYS_SECONDS = 90n * 24n * 60n * 60n;
const MINIMUM_AMOUNT_FRI = 1_000_000_000_000_000_000n;
const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;

function decimal(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return BigInt(value);
}

export function validateTravelSafeAmount(
  amountFri: string,
  readiness: TravelSafeReadiness,
): void {
  const amount = decimal(amountFri, "Travel Safe amount");
  if (amount < MINIMUM_AMOUNT_FRI) throw new Error("Park at least 1 STRK");
  if (!readiness.registered) {
    throw new Error("Set up Shielded Starknet in your wallet before parking STRK");
  }
  if (amount > BigInt(readiness.maxParkableFri)) {
    throw new Error("Leave the private fee reserve in your wallet");
  }
}

export function validateTravelSafeReturnDate(
  returnDateSeconds: string,
  chainTimeSeconds: string,
): void {
  const returnDate = decimal(returnDateSeconds, "Return date");
  const chainTime = decimal(chainTimeSeconds, "Chain time");
  const duration = returnDate - chainTime;
  if (duration < TWO_HOURS_SECONDS) {
    throw new Error("Choose a return time at least two hours from now");
  }
  if (duration > NINETY_DAYS_SECONDS) {
    throw new Error("Choose a return time within ninety days");
  }
}

export function createTravelSafeReleaseNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = BigInt(
    `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  );
  return `0x${((value % (STARK_FIELD_PRIME - 1n)) + 1n).toString(16)}`;
}

export function sameFelt(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}
