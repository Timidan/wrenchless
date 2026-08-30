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

/** One STRK20 deposit the wallet must sign before the private action. */
export type ShieldDeposit = {
  token: TravelSafeToken;
  amountBaseUnits: string;
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
    let needed = 0n;
    if (sameToken(balance.token.address, input.tokenAddress)) needed += amount;
    if (balance.token.symbol === "STRK") needed += reserve;
    const shielded = readable(balance.shieldedAvailable, balance.shieldedBalanceBaseUnits);
    if (needed > shielded) {
      shortfalls.push({ token: balance.token, amountBaseUnits: (needed - shielded).toString() });
    }
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
  deposits: readonly ShieldDeposit[],
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
