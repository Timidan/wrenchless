export type TravelSafeToken = {
  symbol: "STRK" | "USDC";
  decimals: 18 | 6;
  address: string;
};

export type AllowanceSchedule = {
  initialAmount: bigint;
  remainingAmount: bigint;
  releasedAmount: bigint;
  dailyAmount: bigint;
  firstReleaseAt: bigint;
  returnAt: bigint;
};

const DAY_SECONDS = 86_400n;

function assertNonNegative(value: bigint, label: string): void {
  if (value < 0n) {
    throw new Error(`${label} must be non-negative`);
  }
}

function tokenScale(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("Token decimals must be an integer from 0 to 255");
  }
  return 10n ** BigInt(decimals);
}

export function computeClaimableAllowance(
  schedule: AllowanceSchedule,
  chainTime: bigint,
): bigint {
  assertNonNegative(schedule.initialAmount, "initial amount");
  assertNonNegative(schedule.remainingAmount, "remaining amount");
  assertNonNegative(schedule.releasedAmount, "released amount");
  assertNonNegative(schedule.dailyAmount, "daily amount");
  assertNonNegative(schedule.firstReleaseAt, "first release time");
  assertNonNegative(schedule.returnAt, "return time");
  assertNonNegative(chainTime, "chain time");

  if (schedule.firstReleaseAt > schedule.returnAt) {
    throw new Error("first release time must not exceed return time");
  }
  if (schedule.releasedAmount > schedule.initialAmount) {
    throw new Error("released allowance exceeds initial entitlement");
  }

  const elapsedDays =
    chainTime < schedule.firstReleaseAt
      ? 0n
      : 1n + (chainTime - schedule.firstReleaseAt) / DAY_SECONDS;
  const accrued = elapsedDays * schedule.dailyAmount;
  const entitlement =
    accrued < schedule.initialAmount ? accrued : schedule.initialAmount;

  if (schedule.releasedAmount > entitlement) {
    throw new Error("released allowance exceeds entitlement");
  }
  if (chainTime > schedule.returnAt) {
    return 0n;
  }

  const unreleasedEntitlement = entitlement - schedule.releasedAmount;
  return schedule.remainingAmount < unreleasedEntitlement
    ? schedule.remainingAmount
    : unreleasedEntitlement;
}

export function parseTokenAmount(value: string, decimals: number): bigint {
  const scale = tokenScale(decimals);
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/u.exec(normalized);
  if (match === null) {
    throw new Error("Token amount must be a non-negative decimal");
  }

  const whole = match[1];
  const fraction = match[2] ?? "";
  if (whole === undefined) {
    throw new Error("Token amount must be a non-negative decimal");
  }
  if (fraction.length > decimals) {
    throw new Error(`Token amount must use at most ${decimals} decimal places`);
  }

  return BigInt(whole) * scale + BigInt(fraction.padEnd(decimals, "0") || "0");
}

export function formatTokenAmount(value: bigint, decimals: number): string {
  assertNonNegative(value, "token amount");
  const scale = tokenScale(decimals);
  const whole = value / scale;
  if (decimals === 0) return whole.toString();

  const fraction = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/u, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}
