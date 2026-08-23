const U256_MAX = (1n << 256n) - 1n;

export type CoverExposure = {
  publicBalanceFri: string;
  shieldedBalanceFri: string;
  immediatelyClaimableFri: string;
  poolFeeFri: string;
  privateSpendableFri: string;
  totalFri: string;
  capFri: string;
  remainingCapacityFri: string;
  withinCap: boolean;
};

function amount(value: string, label: string): bigint {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a non-negative decimal integer`);
  }
  const parsed = BigInt(value);
  if (parsed > U256_MAX) throw new Error(`${label} is too large`);
  return parsed;
}

export function requiredPrivateRefillFri(
  spendingAmountFri: string,
  poolFeeFri: string,
): string {
  const total =
    amount(spendingAmountFri, "spending amount") +
    amount(poolFeeFri, "pool fee");
  if (total > U256_MAX) throw new Error("private refill amount is too large");
  return total.toString();
}

export function totalVaultRefillDebitFri(
  spendingAmountFri: string,
  poolFeeFri: string,
): string {
  const total =
    amount(spendingAmountFri, "spending amount") +
    2n * amount(poolFeeFri, "pool fee");
  if (total > U256_MAX) throw new Error("vault refill debit is too large");
  return total.toString();
}

export function computeCoverExposure(input: {
  publicBalanceFri: string;
  shieldedBalanceFri: string;
  immediatelyClaimableAmountsFri: readonly string[];
  poolFeeFri: string;
  capFri: string;
}): CoverExposure {
  if (input.immediatelyClaimableAmountsFri.length > 24) {
    throw new Error("Too many refill tickets are being counted");
  }
  const publicBalance = amount(input.publicBalanceFri, "public balance");
  const shieldedBalance = amount(input.shieldedBalanceFri, "shielded balance");
  const immediatelyClaimable = input.immediatelyClaimableAmountsFri.reduce(
    (total, value) => {
      const next = total + amount(value, "claimable refill");
      if (next > U256_MAX) {
        throw new Error("claimable refill exposure is too large");
      }
      return next;
    },
    0n,
  );
  const poolFee = amount(input.poolFeeFri, "pool fee");
  const cap = amount(input.capFri, "exposure cap");
  // A claim joins the carried wallet's existing private holdings. A later
  // withdrawal may select both balances while paying one pool fee, so treating
  // them as permanently separate would understate what the wallet can spend.
  const combinedPrivate = shieldedBalance + immediatelyClaimable;
  if (combinedPrivate > U256_MAX) {
    throw new Error("combined private exposure is too large");
  }
  const privateSpendable =
    combinedPrivate > poolFee ? combinedPrivate - poolFee : 0n;
  const total = publicBalance + privateSpendable;
  const withinCap = total <= cap;
  return {
    publicBalanceFri: publicBalance.toString(),
    shieldedBalanceFri: shieldedBalance.toString(),
    immediatelyClaimableFri: immediatelyClaimable.toString(),
    poolFeeFri: poolFee.toString(),
    privateSpendableFri: privateSpendable.toString(),
    totalFri: total.toString(),
    capFri: cap.toString(),
    remainingCapacityFri: withinCap ? (cap - total).toString() : "0",
    withinCap,
  };
}
