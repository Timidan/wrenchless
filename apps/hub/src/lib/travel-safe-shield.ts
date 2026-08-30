import type { TravelSafeToken } from "@wrenchless/canary-core";

/**
 * What a Trip Allowance can draw on for one token: the private note the
 * wallet reports, and the ordinary balance still sitting in the account.
 * Either read can be missing; a missing read counts as nothing, never as
 * something.
 */
export type ShieldableBalance = {
  token: TravelSafeToken;
  shieldedBalanceBaseUnits: string;
  shieldedAvailable: boolean;
  publicBalanceBaseUnits: string;
  publicAvailable: boolean;
};

/**
 * One STRK20 deposit the wallet must sign before the private action.
 *
 * The split is carried because the total on its own is unexplainable. Somebody
 * holding exactly the ten STRK they mean to park is still asked for six more,
 * and without the breakdown that reads as the app losing track of a deposit
 * they already made. It is the action fee, and it is a different thing from
 * the money being parked.
 */
export type ShieldAmount = {
  token: TravelSafeToken;
  amountBaseUnits: string;
};

/**
 * A deposit with its reason attached. Sending one needs only `ShieldAmount`;
 * explaining one to a person needs the split.
 */
export type ShieldDeposit = ShieldAmount & {
  /** The part that is the amount being parked or added. */
  towardAmountBaseUnits: string;
  /** The part that is the action fee, which stays private afterwards. */
  towardReserveBaseUnits: string;
};

export type ShieldRequirement = {
  /** The token being parked or added. */
  tokenAddress: string;
  amountBaseUnits: string;
  /** The private STRK that must stay behind for one return action. */
  poolFeeFri: string;
  balances: readonly ShieldableBalance[];
};

function sameToken(left: string, right: string): boolean {
  return BigInt(left) === BigInt(right);
}

function readable(available: boolean, baseUnits: string): bigint {
  return available ? BigInt(baseUnits) : 0n;
}

/**
 * How much of each token still has to move into the private balance before
 * the requested action can be proven: the parked amount for its own token,
 * plus the return-fee reserve in STRK. Empty when the private balance already
 * covers everything.
 */
export function shieldShortfalls(input: ShieldRequirement): readonly ShieldDeposit[] {
  const amount = BigInt(input.amountBaseUnits);
  const reserve = BigInt(input.poolFeeFri);
  if (amount < 0n || reserve < 0n) throw new Error("Amounts cannot be negative");
  const shortfalls: ShieldDeposit[] = [];
  for (const balance of input.balances) {
    const towardAmount = sameToken(balance.token.address, input.tokenAddress)
      ? amount
      : 0n;
    const towardReserve = balance.token.symbol === "STRK" ? reserve : 0n;
    const shielded = readable(balance.shieldedAvailable, balance.shieldedBalanceBaseUnits);
    const needed = towardAmount + towardReserve;
    if (needed <= shielded) continue;
    /**
     * What is already private is counted against the parked amount first, so
     * the shortfall that remains is named as the fee rather than as a vague
     * remainder. It is also the true reading: the parked amount is what the
     * person chose, and the fee is what the pool adds on top of it.
     */
    const amountShort = towardAmount > shielded ? towardAmount - shielded : 0n;
    const spare = shielded > towardAmount ? shielded - towardAmount : 0n;
    const reserveShort = towardReserve > spare ? towardReserve - spare : 0n;
    shortfalls.push({
      token: balance.token,
      amountBaseUnits: (amountShort + reserveShort).toString(),
      towardAmountBaseUnits: amountShort.toString(),
      towardReserveBaseUnits: reserveShort.toString(),
    });
  }
  return shortfalls;
}

/**
 * The deposits a wallet must sign first, or an empty list when none are
 * needed. Throws when the account cannot cover a shortfall even with its
 * ordinary balance, so the caller never proposes a shield that would fail.
 */
export function planShieldDeposits(input: ShieldRequirement): readonly ShieldDeposit[] {
  const known = input.balances.find((balance) =>
    sameToken(balance.token.address, input.tokenAddress),
  );
  if (known === undefined) throw new Error("Choose a supported private token");
  const shortfalls = shieldShortfalls(input);
  for (const shortfall of shortfalls) {
    const balance = input.balances.find((candidate) =>
      sameToken(candidate.token.address, shortfall.token.address),
    );
    const publicBalance =
      balance === undefined ? 0n : readable(balance.publicAvailable, balance.publicBalanceBaseUnits);
    if (BigInt(shortfall.amountBaseUnits) > publicBalance) {
      throw new Error(`${shortfall.token.symbol} balance is too low`);
    }
  }
  return shortfalls;
}

/** The STRK20 actions for one wallet-signed shield of these deposits. */
export function buildShieldActions(
  deposits: readonly ShieldAmount[],
): { type: "deposit"; token: string; amount: string }[] {
  if (deposits.length === 0) throw new Error("Nothing needs shielding");
  return deposits.map((deposit) => {
    const amount = BigInt(deposit.amountBaseUnits);
    if (amount <= 0n) throw new Error("Shield amounts must be positive");
    return {
      type: "deposit",
      token: `0x${BigInt(deposit.token.address).toString(16)}`,
      amount: `0x${amount.toString(16)}`,
    };
  });
}

/**
 * Whether the deposits have already left the account, judged from mainnet
 * rather than from the wallet.
 *
 * A wallet's reply to `wallet_strk20InvokeTransaction` can go missing — the
 * proof takes a long time, the popup is dismissed, the mobile app returns
 * without answering — and a flow that waits only for that reply waits forever
 * for a transaction that already landed. The account's ordinary balance is an
 * independent witness: one shield moves every deposit in a single transaction,
 * so when each token has fallen by at least what was deposited, it happened.
 *
 * Every token must agree. A single token falling on its own is somebody
 * spending, not this shield.
 */
export function shieldLeftTheWallet(input: {
  deposits: readonly ShieldAmount[];
  baseline: readonly ShieldableBalance[];
  current: readonly ShieldableBalance[];
}): boolean {
  if (input.deposits.length === 0) return false;
  return input.deposits.every((deposit) => {
    const before = input.baseline.find((entry) =>
      sameToken(entry.token.address, deposit.token.address),
    );
    const after = input.current.find((entry) =>
      sameToken(entry.token.address, deposit.token.address),
    );
    // An unreadable balance is not evidence in either direction.
    if (before === undefined || after === undefined) return false;
    if (!before.publicAvailable || !after.publicAvailable) return false;
    const spent =
      BigInt(before.publicBalanceBaseUnits) - BigInt(after.publicBalanceBaseUnits);
    return spent >= BigInt(deposit.amountBaseUnits);
  });
}
