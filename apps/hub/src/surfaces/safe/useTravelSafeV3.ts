import {
  computeTravelSafeV3ClaimCommitment,
  computeTravelSafeV3DeviceCommitment,
  computeTravelSafeV3RecoveryCommitment,
  deriveTravelSafeSecrets,
  deriveTravelSafeV3PublicKey,
  formatTokenAmount,
  generateTravelSafePhrase,
  generateTravelSafeV3PrivateKey,
  jsonValueSchema,
  parseTokenAmount,
  type TravelSafeTicketV3,
  type TravelSafeToken,
} from "@wrenchless/canary-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { devicePasskeysAvailable } from "../../adapters/device-passkey";
import { reasonFrom } from "../../adapters/amount";
import {
  assertSelectedWalletAccount,
  requestWalletAccount,
  type BrowserWallet,
} from "../../adapters/wallet";
import { readSettings } from "../../adapters/settings";
import { WRENCHLESS_MAINNET, WRENCHLESS_SERVICES } from "../../lib/product-config";
import {
  assertReadyPrivateContext,
  readPublicBalances,
  readReadyPoolFee,
  readReadyShieldedBalances,
} from "../../lib/ready-cover";
import {
  submitAllowanceRelease,
  submitShieldDeposits,
  submitTravelSafeClaimEarly,
  submitTravelSafeExtend,
  submitTravelSafeV3Refund,
  type ReadyTravelSafeV3Wallet,
} from "../../lib/ready-travel-safe-v3";
import {
  TravelSafeV3SponsorError,
} from "../../lib/relayed-travel-safe-v3";
import {
  readTransactionReceiptStatus,
} from "../../lib/refill-state";
import {
  clearTravelSafeTicket,
  readActiveAnyTravelSafeTicket,
  storeNewTravelSafeTicketV3,
  transitionStoredTravelSafeTicketV3,
} from "../../lib/refill-ticket";
import {
  assertPrivateReturnFeeReserve,
  confirmedTravelSafeAction,
  reconcileTravelSafeAction,
  retainPreparedForAccount,
  travelSafeTargetCompleted,
  type TravelSafeActionTarget,
} from "../../lib/travel-safe-action-state";
import {
  planShieldDeposits,
  shieldLeftTheWallet,
  shieldShortfalls,
  type ShieldableBalance,
  type ShieldDeposit,
} from "../../lib/travel-safe-shield";
import {
  prepareTravelSafeV3FundRelay,
  prepareTravelSafeV3TopUpRelay,
  submitPreparedTravelSafeV3Relay,
  type PreparedTravelSafeV3Relay,
} from "../../lib/travel-safe-v3-operations";
import { readReadyPoolRegistration } from "../../lib/ready-private-setup";
import { inspectTravelSafeV3Sponsor } from "../../lib/travel-safe-v3-readiness";
import {
  readTravelSafeV3Snapshot,
  type TravelSafeV3ChainState,
  type TravelSafeV3Snapshot,
} from "../../lib/travel-safe-state-v3";
import { TRAVEL_SAFE_TOKENS } from "../../lib/travel-safe-tokens";
import {
  createOrVerifyTravelSafePasskey,
  travelSafePasskey,
  unlockTravelSafeWithPasskey,
} from "./travel-safe-device";
import type {
  SafeAssetView,
  SafePlanDraft,
  SafeReadinessCheck,
  SafeShieldStep,
  TravelSafeV3Controller,
} from "./travel-safe-model";

const MAINNET_CHAIN_ID = "0x534e5f4d41494e";
const AMBIGUOUS_ACTION_WINDOW_MILLISECONDS = 5 * 60 * 1_000;
const MAXIMUM_SAFE_DURATION_SECONDS = 180n * 86_400n;
const SHIELD_POLL_MILLISECONDS = 4_000;
const SHIELD_RECEIPT_TIMEOUT_MILLISECONDS = 10 * 60_000;
const SHIELD_NOTE_TIMEOUT_MILLISECONDS = 5 * 60_000;
/** How long to keep watching the chain for a wallet that never replies. */
const SHIELD_WALLET_TIMEOUT_MILLISECONDS = 15 * 60_000;
const EMPTY_PLAN: SafePlanDraft = {
  tokenAddress: TRAVEL_SAFE_TOKENS[0].address,
  parkAmount: "",
  keepAmount: "",
  dailyAmount: "",
  firstReleaseLocal: "",
  returnDateLocal: "",
  mode: "single",
};

type SetupSecrets = {
  claimCommitment: string;
  deviceCommitment: string;
  recoveryCommitment: string;
};

type PendingAction = {
  transactionHash: string;
  target: TravelSafeActionTarget;
};

type ActiveTravelSafeV3State = {
  ticket: TravelSafeTicketV3;
  state: TravelSafeV3ChainState;
};

type FreshBalances = {
  balances: readonly ShieldableBalance[];
  poolFeeFri: string;
  /** Why the wallet's private balances could not be read, when they could not. */
  shieldedError: string | null;
};

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function readable(available: boolean, baseUnits: string): bigint {
  return available ? BigInt(baseUnits) : 0n;
}

function shieldStep(input: {
  purpose: SafeShieldStep["purpose"];
  tokenAddress: string;
  amountBaseUnits: string;
  topUpAmount: string | null;
  deposits: readonly ShieldDeposit[];
}): SafeShieldStep {
  return {
    purpose: input.purpose,
    tokenAddress: input.tokenAddress,
    amountBaseUnits: input.amountBaseUnits,
    topUpAmount: input.topUpAmount,
    transactionHash: null,
    sent: false,
    deposits: input.deposits.map((deposit) => ({
      symbol: deposit.token.symbol,
      tokenAddress: deposit.token.address,
      decimals: deposit.token.decimals,
      amount: formatTokenAmount(BigInt(deposit.amountBaseUnits), deposit.token.decimals),
      amountBaseUnits: deposit.amountBaseUnits,
    })),
  };
}

function canonicalFelt(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function readyWallet(wallet: BrowserWallet): ReadyTravelSafeV3Wallet {
  return {
    async request(request) {
      return jsonValueSchema.parse(
        await wallet.request({ type: request.type, params: request.params }),
      );
    },
  };
}

function tokenFor(address: string): TravelSafeToken {
  const token = TRAVEL_SAFE_TOKENS.find(
    (candidate) => BigInt(candidate.address) === BigInt(address),
  );
  if (token === undefined) throw new Error("Choose a supported private token");
  return token;
}

function localSeconds(value: string, label: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error(`Choose ${label}`);
  return Math.floor(milliseconds / 1_000).toString();
}

function actionWindowExpired(updatedAt: string): boolean {
  return Date.now() - Date.parse(updatedAt) >= AMBIGUOUS_ACTION_WINDOW_MILLISECONDS;
}

function nextReleaseTime(
  snapshot: TravelSafeV3Controller["model"]["snapshot"],
): string | null {
  if (snapshot === null || snapshot.state === null) {
    return null;
  }
  const state = snapshot.state;
  if (BigInt(state.dailyAmount) === 0n) {
    return null;
  }
  const chainTime = BigInt(snapshot.chainTimeSeconds);
  const firstRelease = BigInt(state.firstReleaseAt);
  const returnAt = BigInt(state.returnAt);
  if (chainTime > returnAt) return null;
  if (chainTime < firstRelease) return firstRelease.toString();
  const next = firstRelease + (1n + (chainTime - firstRelease) / 86_400n) * 86_400n;
  return next <= returnAt ? next.toString() : null;
}

function stateAuthorization(ticket: TravelSafeTicketV3, state: TravelSafeV3ChainState) {
  return {
    chainId: MAINNET_CHAIN_ID,
    helperAddress: ticket.helperAddress,
    stateId: state.stateId,
    nonce: state.nonce,
    tokenAddress: state.tokenAddress,
    remainingAmount: state.remainingAmount,
    firstReleaseAt: state.firstReleaseAt,
    returnAt: state.returnAt,
  };
}

function assertTicketMatchesState(
  ticket: TravelSafeTicketV3,
  state: TravelSafeV3ChainState,
): void {
  const deviceCommitment = computeTravelSafeV3DeviceCommitment(
    ticket.stateId,
    deriveTravelSafeV3PublicKey(ticket.devicePrivateKey),
  );
  const recoveryCommitment = computeTravelSafeV3RecoveryCommitment(
    ticket.stateId,
    ticket.recoveryAccount,
    ticket.recoverySalt,
  );
  if (
    BigInt(ticket.tokenAddress) !== BigInt(state.tokenAddress) ||
    BigInt(deviceCommitment) !== BigInt(state.deviceCommitment) ||
    BigInt(recoveryCommitment) !== BigInt(state.recoveryCommitment)
  ) {
    throw new Error("This device ticket does not match the onchain Safe");
  }
}

function calendarFile(ticket: TravelSafeTicketV3): void {
  const date = new Date(Number(ticket.returnDateSeconds) * 1_000);
  const stamp = date.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}Z$/u, "Z");
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wrenchless//Travel Safe//EN",
    "BEGIN:VEVENT",
    `UID:${ticket.stateId.slice(2)}@wrenchless`,
    `DTSTART:${stamp}`,
    `DTEND:${stamp}`,
    "SUMMARY:Travel Safe return opens",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const href = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = "travel-safe-return.ics";
  link.click();
  URL.revokeObjectURL(href);
}

export function useTravelSafeV3(): TravelSafeV3Controller {
  const [phase, setPhase] = useState<TravelSafeV3Controller["model"]["phase"]>(
    "loading",
  );
  const [account, setAccount] = useState<string | null>(null);
  const [assets, setAssets] = useState<readonly SafeAssetView[]>([]);
  const [plan, setPlan] = useState<SafePlanDraft>(EMPTY_PLAN);
  const [ticket, setTicket] = useState<TravelSafeTicketV3 | null>(null);
  const [snapshot, setSnapshot] = useState<TravelSafeV3Controller["model"]["snapshot"]>(null);
  const [readiness, setReadiness] = useState<TravelSafeV3Controller["model"]["readiness"]>(null);
  const [shield, setShield] = useState<SafeShieldStep | null>(null);
  const [recoveryDrill, setRecoveryDrill] = useState<TravelSafeV3Controller["model"]["recoveryDrill"]>({ status: "idle" });
  const [action, setAction] = useState<TravelSafeV3Controller["model"]["action"]>({ name: "idle" });
  const [recoveryWords, updateRecoveryWords] = useState<string | null>(null);
  const [quote, setQuote] = useState<TravelSafeV3Controller["model"]["quote"]>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const wallet = useRef<BrowserWallet | null>(null);
  const setup = useRef<SetupSecrets | null>(null);
  const prepared = useRef<PreparedTravelSafeV3Relay | null>(null);
  const pending = useRef<PendingAction | null>(null);
  const passkeyVerified = useRef(false);
  /** Bumped per shield attempt; a stale attempt stops writing state. */
  const shieldRun = useRef(0);
  /** The same, for proof preparation, which can outlive a person's patience. */
  const prepareRun = useRef(0);

  const selectedToken = useMemo(() => tokenFor(plan.tokenAddress), [plan.tokenAddress]);
  const nextReleaseAt = useMemo(() => nextReleaseTime(snapshot), [snapshot]);

  /**
   * Both sides of what a plan can draw on. The private read comes from the
   * wallet and the ordinary read from mainnet; either may fail on its own. A
   * failed private read is carried as a reason rather than thrown, because an
   * account that has never shielded still has ordinary STRK to start from.
   */
  const refreshBalances = useCallback(async (currentWallet: BrowserWallet): Promise<FreshBalances> => {
    const [shieldedResult, publicBalances, fee] = await Promise.all([
      readReadyShieldedBalances({
        wallet: currentWallet,
        tokens: TRAVEL_SAFE_TOKENS,
        checkContext: false,
      }).then(
        (value) => ({ value, reason: null }),
        (cause: unknown) => ({ value: null, reason: reasonFrom(cause) }),
      ),
      readPublicBalances({
        account: currentWallet.selectedAddress,
        tokens: TRAVEL_SAFE_TOKENS,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      }),
      readReadyPoolFee({
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      }),
    ]);
    if (shieldedResult.value === null && publicBalances.every((entry) => !entry.available)) {
      throw new Error(shieldedResult.reason ?? "Could not read any balance");
    }
    const balances = TRAVEL_SAFE_TOKENS.map((token): ShieldableBalance => {
      const shielded = shieldedResult.value?.find(
        (entry) => BigInt(entry.token.address) === BigInt(token.address),
      );
      const ordinary = publicBalances.find(
        (entry) => BigInt(entry.token.address) === BigInt(token.address),
      );
      return {
        token,
        shieldedBalanceBaseUnits: shielded?.shieldedBalanceBaseUnits ?? "0",
        shieldedAvailable: shielded?.available ?? false,
        publicBalanceBaseUnits: ordinary?.publicBalanceBaseUnits ?? "0",
        publicAvailable: ordinary?.available ?? false,
      };
    });
    const views = balances.map((balance): SafeAssetView => {
      const shielded = readable(balance.shieldedAvailable, balance.shieldedBalanceBaseUnits);
      const ordinary = readable(balance.publicAvailable, balance.publicBalanceBaseUnits);
      return {
        symbol: balance.token.symbol,
        tokenAddress: balance.token.address,
        decimals: balance.token.decimals,
        shieldedBalance: balance.shieldedAvailable
          ? formatTokenAmount(shielded, balance.token.decimals)
          : "—",
        publicBalance: balance.publicAvailable
          ? formatTokenAmount(ordinary, balance.token.decimals)
          : "—",
        totalBalance: formatTokenAmount(shielded + ordinary, balance.token.decimals),
        hasPublicBalance: ordinary > 0n,
        returnFeeStrk: formatTokenAmount(
          BigInt(fee.poolFeeFri),
          TRAVEL_SAFE_TOKENS[0].decimals,
        ),
        available: balance.shieldedAvailable || balance.publicAvailable,
        shieldedAvailable: balance.shieldedAvailable,
        publicAvailable: balance.publicAvailable,
      };
    });
    setAssets(views);
    return { balances, poolFeeFri: fee.poolFeeFri, shieldedError: shieldedResult.reason };
  }, []);

  const runReadiness = useCallback(async (
    currentWallet: BrowserWallet,
    expectedAccount: string,
  ): Promise<void> => {
    const checking: SafeReadinessCheck[] = [
      { id: "wallet", label: "Private wallet", status: "ready", detail: "Mainnet account connected" },
      { id: "passkey", label: "Passkey", status: "checking", detail: "Checking this device" },
      { id: "setup", label: "Private setup", status: "checking", detail: "Reading your pool account" },
      { id: "relay", label: "Private relay", status: "checking", detail: "Checking availability" },
      { id: "fee", label: "Action reserve", status: "checking", detail: "Reading the live fee" },
      { id: "balance", label: "Balance", status: "checking", detail: "Reading STRK and USDC" },
    ];
    setPhase("readiness");
    setError(null);
    setAction({ name: "preparing", label: "Checking trip readiness" });
    setReadiness({ status: "checking", checks: checking });
    try {
      assertSelectedWalletAccount(currentWallet, expectedAccount);
    } catch (cause) {
      const detail = reasonFrom(cause);
      setReadiness({
        status: "blocked",
        checks: checking.map((check) =>
          check.id === "wallet"
            ? { ...check, status: "blocked", detail }
            : { ...check, status: "blocked", detail: "Reconnect the wallet first" },
        ),
      });
      setError(detail);
      setAction({ name: "idle" });
      return;
    }

    let passkeyError: string | null = null;
    try {
      if (!passkeyVerified.current) {
        await createOrVerifyTravelSafePasskey(expectedAccount);
        passkeyVerified.current = true;
      }
    } catch (cause) {
      passkeyError = reasonFrom(cause);
    }

    const [setupResult, relayResult, balanceResult] = await Promise.allSettled([
      readReadyPoolRegistration({
        account: expectedAccount,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      }),
      WRENCHLESS_MAINNET.tripAllowanceHelperAddress === null
        ? Promise.reject(new Error("Trip Allowance is not available yet"))
        : inspectTravelSafeV3Sponsor({
            sponsorUrl: WRENCHLESS_SERVICES.sponsorUrl,
          }),
      refreshBalances(currentWallet),
    ]);
    /**
     * An account that has never registered with the pool cannot hold, read or
     * receive a private balance, so it fails every later step — but only at
     * the wallet prompt, which is after the twelve recovery words have been
     * written down. It is asked here instead, where the answer still saves
     * somebody the whole setup.
     */
    const registered =
      setupResult.status === "fulfilled" ? setupResult.value.registered : null;
    const setupError =
      setupResult.status === "rejected" ? reasonFrom(setupResult.reason) : null;
    const checks: SafeReadinessCheck[] = [
      checking[0]!,
      passkeyError === null
        ? { id: "passkey", label: "Passkey", status: "ready", detail: "Protected on this device" }
        : { id: "passkey", label: "Passkey", status: "blocked", detail: passkeyError },
      registered === true
        ? { id: "setup", label: "Private setup", status: "ready", detail: "Private balances are on for this account" }
        : registered === false
          ? {
              id: "setup",
              label: "Private setup",
              status: "blocked",
              detail: "Turn on private balances in your wallet, then check again",
            }
          : {
              id: "setup",
              label: "Private setup",
              status: "blocked",
              detail: setupError ?? "Could not read your pool account",
            },
      relayResult.status === "fulfilled"
        ? { id: "relay", label: "Private relay", status: "ready", detail: "Available" }
        : { id: "relay", label: "Private relay", status: "blocked", detail: reasonFrom(relayResult.reason) },
    ];
    if (balanceResult.status === "rejected") {
      const detail = reasonFrom(balanceResult.reason);
      checks.push(
        { id: "fee", label: "Action reserve", status: "blocked", detail },
        { id: "balance", label: "Balance", status: "blocked", detail },
      );
    } else {
      const { balances, poolFeeFri, shieldedError } = balanceResult.value;
      const reserve = BigInt(poolFeeFri);
      const reserveText = `${formatTokenAmount(reserve, 18)} STRK`;
      const strk = balances.find((balance) => balance.token.symbol === "STRK");
      const shieldedStrk =
        strk === undefined ? 0n : readable(strk.shieldedAvailable, strk.shieldedBalanceBaseUnits);
      const ordinaryStrk =
        strk === undefined ? 0n : readable(strk.publicAvailable, strk.publicBalanceBaseUnits);
      checks.push(
        shieldedStrk >= reserve
          ? {
              id: "fee",
              label: "Action reserve",
              status: "ready",
              detail: `${reserveText} kept private for actions`,
            }
          : shieldedStrk + ordinaryStrk >= reserve
            ? {
                id: "fee",
                label: "Action reserve",
                status: "ready",
                detail: `${reserveText} moves from your wallet into the private balance first`,
              }
            : {
                id: "fee",
                label: "Action reserve",
                status: "blocked",
                detail: `Add at least ${reserveText} to your wallet for one action fee`,
              },
      );
      const funded = balances.filter((balance) => {
        const total =
          readable(balance.shieldedAvailable, balance.shieldedBalanceBaseUnits) +
          readable(balance.publicAvailable, balance.publicBalanceBaseUnits);
        return balance.token.symbol === "STRK" ? total > reserve : total > 0n;
      });
      const shieldsFirst = funded.some(
        (balance) => readable(balance.publicAvailable, balance.publicBalanceBaseUnits) > 0n,
      );
      const fundedText = funded.map((balance) => balance.token.symbol).join(" and ");
      checks.push(
        funded.length === 0
          ? {
              id: "balance",
              label: "Balance",
              status: "blocked",
              detail: shieldedError ?? "Add STRK or USDC to your wallet to park",
            }
          : shieldedError !== null
            ? {
                id: "balance",
                label: "Balance",
                status: "ready",
                detail:
                  registered === false
                    ? `${fundedText} in your wallet, none of it private yet`
                    : `${fundedText} in your wallet. Private balance unread: ${shieldedError}`,
              }
            : {
                id: "balance",
                label: "Balance",
                status: "ready",
                detail: shieldsFirst
                  ? `${fundedText} available; wallet funds are shielded first`
                  : `${fundedText} available privately`,
              },
      );
    }
    const ready = checks.every((check) => check.status === "ready");
    const blocked = checks.find((check) => check.status === "blocked");
    setReadiness({ status: ready ? "ready" : "blocked", checks });
    setError(blocked?.detail ?? null);
    setAction({ name: "idle" });
  }, [refreshBalances]);

  /**
   * Fresh balances for parking or adding `amountBaseUnits` of one token.
   * Returns the deposits the wallet must shield first when the private
   * balance falls short and the ordinary balance can cover it; otherwise
   * holds the existing private-only guarantees — the return-fee reserve and
   * the parked amount both sit in the private balance — before any proof.
   */
  const readFundingBalances = useCallback(async (
    tokenAddress: string,
    amountBaseUnits: string,
  ): Promise<{ fresh: FreshBalances; deposits: readonly ShieldDeposit[] }> => {
    if (wallet.current === null || account === null) throw new Error("Connect your wallet");
    assertSelectedWalletAccount(wallet.current, account);
    const fresh = await refreshBalances(wallet.current);
    const deposits = planShieldDeposits({
      tokenAddress,
      amountBaseUnits,
      poolFeeFri: fresh.poolFeeFri,
      balances: fresh.balances,
    });
    if (deposits.length > 0) return { fresh, deposits };
    const token = tokenFor(tokenAddress);
    const strk = fresh.balances.find((item) => item.token.symbol === "STRK");
    if (strk === undefined) throw new Error("Private STRK balance is unavailable");
    assertPrivateReturnFeeReserve({
      strkAvailable: strk.shieldedAvailable,
      shieldedStrkBaseUnits: strk.shieldedBalanceBaseUnits,
      requiredBaseUnits: fresh.poolFeeFri,
      additionalStrkSpendBaseUnits: token.symbol === "STRK" ? amountBaseUnits : "0",
    });
    const selected = fresh.balances.find(
      (item) => BigInt(item.token.address) === BigInt(tokenAddress),
    );
    if (
      selected === undefined ||
      !selected.shieldedAvailable ||
      BigInt(selected.shieldedBalanceBaseUnits) < BigInt(amountBaseUnits)
    ) {
      throw new Error(`${token.symbol} private balance is too low`);
    }
    return { fresh, deposits };
  }, [account, refreshBalances]);

  const refresh = useCallback(async (): Promise<void> => {
    setLive("Checking Starknet");
    try {
      const active = await readActiveAnyTravelSafeTicket();
      if (active === null) {
        setTicket(null);
        setSnapshot(null);
        setPhase(WRENCHLESS_MAINNET.tripAllowanceHelperAddress === null ? "unavailable" : "empty");
        return;
      }
      if (active.schemaVersion !== "wrenchless.travel-safe-ticket.v3") {
        setPhase("unavailable");
        return;
      }
      /**
       * A failed chain read is not the absence of a Safe. Letting it fall to
       * the outer catch left the ticket unset while the device settings still
       * pointed at it, so the surface offered to create a Safe and the store
       * then refused — "this device already owns a Safe" with nothing on
       * screen that owned anything. The Safe is shown from what this device
       * already knows, and the read failure is reported as itself.
       */
      let current: TravelSafeV3Snapshot;
      try {
        current = await readTravelSafeV3Snapshot({
          helperAddress: active.helperAddress,
          stateId: active.stateId,
          rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
        });
      } catch (cause) {
        setTicket(active);
        setSnapshot(null);
        setPhase(
          active.status === "READY"
            ? "review"
            : active.status === "TERMINAL"
              ? "terminal"
              : "active",
        );
        setError(reasonFrom(cause));
        return;
      }
      if (current.state !== null) assertTicketMatchesState(active, current.state);
      const inMemoryPending = pending.current;
      const target =
        inMemoryPending?.target ??
        active.pendingAction ??
        (active.status === "FUND_SUBMITTING" ? { operation: "FUND" as const } : null);
      const transactionHash =
        inMemoryPending?.transactionHash ??
        active.actionTransactionHash ??
        active.fundTransactionHash;
      let currentTicket = active;
      let nextAction: TravelSafeV3Controller["model"]["action"] | null = null;

      if (target !== null && travelSafeTargetCompleted(current.state, target)) {
        nextAction = confirmedTravelSafeAction(transactionHash);
      } else if (transactionHash !== null) {
        const receipt = await readTransactionReceiptStatus({
          transactionHash,
          rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
        });
        if (target !== null) {
          nextAction = reconcileTravelSafeAction({
            transactionHash,
            receipt,
            state: current.state,
            target,
          });
          if (
            receipt.name === "not-found" &&
            nextAction.name === "confirming" &&
            actionWindowExpired(active.updatedAt)
          ) {
            nextAction = {
              name: "failed",
              message: "No onchain change was found. Prepare again.",
              retryable: true,
            };
          }
        } else if (receipt.name === "pending" || receipt.name === "not-found") {
          nextAction = { name: "confirming", transactionHash };
        } else if (receipt.name === "reverted") {
          nextAction = { name: "failed", message: receipt.reason, retryable: true };
        } else {
          nextAction = { name: "confirmed", transactionHash };
        }
      } else if (target !== null) {
        nextAction = actionWindowExpired(active.updatedAt)
          ? {
              name: "failed",
              message: "No onchain change was found. Prepare again.",
              retryable: true,
            }
          : { name: "preparing", label: "Checking Starknet" };
      }

      if (nextAction?.name === "confirmed") {
        pending.current = null;
        if (active.status === "FUND_SUBMITTING") {
          currentTicket = await transitionStoredTravelSafeTicketV3(
            active.stateId,
            "FUNDED",
            { pendingAction: null },
          );
        } else if (active.status === "ACTION_SUBMITTING") {
          currentTicket = await transitionStoredTravelSafeTicketV3(
            active.stateId,
            current.state?.status === "funded" ? "FUNDED" : "TERMINAL",
            { pendingAction: null },
          );
        }
      } else if (nextAction?.name === "failed") {
        pending.current = null;
        if (active.status === "FUND_SUBMITTING") {
          currentTicket = await transitionStoredTravelSafeTicketV3(
            active.stateId,
            "READY",
            { fundTransactionHash: null, pendingAction: null },
          );
        } else if (active.status === "ACTION_SUBMITTING") {
          currentTicket = await transitionStoredTravelSafeTicketV3(
            active.stateId,
            "FUNDED",
            { actionTransactionHash: null, pendingAction: null },
          );
        }
      } else if (
        current.state !== null &&
        current.state.status !== "funded" &&
        active.status !== "TERMINAL"
      ) {
        currentTicket = await transitionStoredTravelSafeTicketV3(
          active.stateId,
          "TERMINAL",
          { pendingAction: null },
        );
      }

      setTicket(currentTicket);
      setSnapshot(current);
      setPhase(
        current.state?.status === "claimed" || current.state?.status === "refunded"
          ? "terminal"
          : currentTicket.status === "READY"
            ? "review"
            : "active",
      );
      if (nextAction !== null) setAction(nextAction);
      setError(null);
    } catch (cause) {
      setError(reasonFrom(cause));
    } finally {
      setLive(null);
    }
  }, []);

  const connect = useCallback(async (): Promise<void> => {
    setError(null);
    setAction({ name: "wallet", label: "Connecting" });
    try {
      const connected = await requestWalletAccount();
      const context = await assertReadyPrivateContext(connected.wallet);
      wallet.current = connected.wallet;
      setAccount(context.account);
      const retained = retainPreparedForAccount(prepared.current, context.account);
      prepared.current = retained;
      if (retained === null) setQuote(null);
      if (ticket === null) {
        await runReadiness(connected.wallet, context.account);
      } else {
        await createOrVerifyTravelSafePasskey(context.account);
        passkeyVerified.current = true;
        await refreshBalances(connected.wallet);
        setAction({ name: "idle" });
        setPhase(
          ticket.status === "READY"
            ? "review"
            : ticket.status === "TERMINAL"
              ? "terminal"
              : "active",
        );
      }
    } catch (cause) {
      setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
      setError(reasonFrom(cause));
    }
  }, [refreshBalances, runReadiness, ticket]);

  const unlock = useCallback(async (): Promise<void> => {
    setError(null);
    setAction({ name: "wallet", label: "Verify passkey" });
    try {
      const passkey = travelSafePasskey();
      if (passkey === null) throw new Error("This device has no Travel Safe passkey");
      await unlockTravelSafeWithPasskey(passkey);
      setAction({ name: "idle" });
      await refresh();
    } catch (cause) {
      setError(reasonFrom(cause));
      setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
    }
  }, [refresh]);

  useEffect(() => {
    if (!devicePasskeysAvailable()) {
      setPhase("unavailable");
      return;
    }
    const active = readSettings().activeSafeStateId;
    if (active === null) {
      setPhase(WRENCHLESS_MAINNET.tripAllowanceHelperAddress === null ? "unavailable" : "empty");
      return;
    }
    setPhase("device-locked");
  }, []);

  useEffect(() => {
    const hasPendingTicket = ticket?.pendingAction !== null && ticket?.pendingAction !== undefined;
    if (
      action.name !== "submitted" &&
      action.name !== "confirming" &&
      !hasPendingTicket
    ) return;
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [action.name, refresh, ticket?.pendingAction]);

  const showRecoveryWords = useCallback(async (): Promise<void> => {
    if (account === null) throw new Error("Connect your wallet");
    const amount = parseTokenAmount(plan.parkAmount, selectedToken.decimals);
    if (amount <= 0n) throw new Error("Enter an amount to park");
    const returnAt = localSeconds(plan.returnDateLocal, "a return date");
    const now = BigInt(Math.floor(Date.now() / 1_000));
    if (BigInt(returnAt) <= now) {
      throw new Error("Choose a future return date");
    }
    if (BigInt(returnAt) > now + MAXIMUM_SAFE_DURATION_SECONDS) {
      throw new Error("Choose a return date within 180 days");
    }
    if (plan.mode === "daily") {
      const daily = parseTokenAmount(plan.dailyAmount, selectedToken.decimals);
      if (daily <= 0n || daily > amount) {
        throw new Error("Choose a valid daily amount");
      }
      const firstReleaseAt = localSeconds(plan.firstReleaseLocal, "a first release date");
      if (BigInt(firstReleaseAt) < now || BigInt(firstReleaseAt) > BigInt(returnAt)) {
        throw new Error("Choose a first release before the return date");
      }
    }
    const phrase = generateTravelSafePhrase();
    updateRecoveryWords(phrase);
    setPhase("recovery");
  }, [account, plan, selectedToken]);

  const confirmRecoveryWords = useCallback(async (): Promise<void> => {
    if (recoveryWords === null || account === null) {
      throw new Error("Confirm your recovery words first");
    }
    const helperAddress = WRENCHLESS_MAINNET.tripAllowanceHelperAddress;
    if (helperAddress === null) throw new Error("Travel Safe is not available yet");
    const recovery = await deriveTravelSafeSecrets(recoveryWords);
    const devicePrivateKey = generateTravelSafeV3PrivateKey();
    const devicePublicKey = deriveTravelSafeV3PublicKey(devicePrivateKey);
    const token = selectedToken;
    const returnDateSeconds = localSeconds(plan.returnDateLocal, "a return date");
    const firstReleaseSeconds =
      plan.mode === "daily"
        ? localSeconds(plan.firstReleaseLocal, "a first release date")
        : returnDateSeconds;
    const now = new Date().toISOString();
    const nextTicket: TravelSafeTicketV3 = {
      schemaVersion: "wrenchless.travel-safe-ticket.v3",
      contractVersion: "v3",
      role: "safe",
      helperAddress,
      stateId: recovery.stateId,
      status: "READY",
      recoveryAccount: canonicalFelt(account),
      recoverySalt: recovery.recoverySalt,
      devicePrivateKey,
      tokenAddress: canonicalFelt(token.address),
      tokenSymbol: token.symbol,
      tokenDecimals: token.decimals,
      amountBaseUnits: parseTokenAmount(plan.parkAmount, token.decimals).toString(),
      dailyAmountBaseUnits:
        plan.mode === "daily"
          ? parseTokenAmount(plan.dailyAmount, token.decimals).toString()
          : "0",
      firstReleaseSeconds,
      returnDateSeconds,
      fundTransactionHash: null,
      actionTransactionHash: null,
      pendingAction: null,
      createdAt: now,
      updatedAt: now,
    };
    setup.current = {
      claimCommitment: computeTravelSafeV3ClaimCommitment(
        recovery.stateId,
        recovery.claimPublicKey,
      ),
      deviceCommitment: computeTravelSafeV3DeviceCommitment(
        recovery.stateId,
        devicePublicKey,
      ),
      recoveryCommitment: computeTravelSafeV3RecoveryCommitment(
        recovery.stateId,
        account,
        recovery.recoverySalt,
      ),
    };
    await storeNewTravelSafeTicketV3(nextTicket);
    setTicket(nextTicket);
    setPhase("review");
  }, [account, plan, recoveryWords, selectedToken]);

  /**
   * Turn a planned Safe into a priced, submittable FUND.
   *
   * Every step reports itself, because the expensive one is not ours: the
   * wallet generates a SNIP-36 proof, which the API documents as long-running
   * and which shows its own approval first. A single unchanging "preparing"
   * line through a minute of that reads as a page that has died.
   */
  const prepareFund = useCallback(async (): Promise<void> => {
    const run = prepareRun.current + 1;
    prepareRun.current = run;
    const current = () => prepareRun.current === run;
    setError(null);
    prepared.current = null;
    setQuote(null);
    setAction({ name: "preparing", label: "Checking the recovery words" });
    try {
      if (wallet.current === null || account === null || ticket === null) {
        throw new Error("Connect your wallet");
      }
      if (setup.current === null) {
        if (recoveryWords === null) {
          throw new Error("Enter the confirmed recovery words again");
        }
        const recovery = await deriveTravelSafeSecrets(recoveryWords);
        if (
          BigInt(recovery.stateId) !== BigInt(ticket.stateId) ||
          BigInt(recovery.recoverySalt) !== BigInt(ticket.recoverySalt)
        ) {
          throw new Error("Those recovery words do not match this Safe");
        }
        setup.current = {
          claimCommitment: computeTravelSafeV3ClaimCommitment(
            recovery.stateId,
            recovery.claimPublicKey,
          ),
          deviceCommitment: computeTravelSafeV3DeviceCommitment(
            recovery.stateId,
            deriveTravelSafeV3PublicKey(ticket.devicePrivateKey),
          ),
          recoveryCommitment: computeTravelSafeV3RecoveryCommitment(
            recovery.stateId,
            ticket.recoveryAccount,
            recovery.recoverySalt,
          ),
        };
      }
      if (!current()) return;
      setAction({ name: "preparing", label: "Reading your balances" });
      const funding = await readFundingBalances(ticket.tokenAddress, ticket.amountBaseUnits);
      if (!current()) return;
      if (funding.deposits.length > 0) {
        setShield(
          shieldStep({
            purpose: "fund",
            tokenAddress: ticket.tokenAddress,
            amountBaseUnits: ticket.amountBaseUnits,
            topUpAmount: null,
            deposits: funding.deposits,
          }),
        );
        setAction({ name: "idle" });
        return;
      }
      setShield(null);
      setAction({
        name: "wallet",
        label: "Your wallet is building the private proof",
      });
      const next = await prepareTravelSafeV3FundRelay({
        wallet: readyWallet(wallet.current),
        account,
        chainId: MAINNET_CHAIN_ID,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        ticket,
        claimCommitment: setup.current.claimCommitment,
        deviceCommitment: setup.current.deviceCommitment,
        recoveryCommitment: setup.current.recoveryCommitment,
        sponsorUrl: WRENCHLESS_SERVICES.sponsorUrl,
      });
      if (!current()) return;
      prepared.current = next;
      setQuote(next.estimate.summary);
      setAction({ name: "idle" });
      setPhase("quote");
    } catch (cause) {
      if (!current()) return;
      setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
      setError(reasonFrom(cause));
    }
  }, [account, readFundingBalances, recoveryWords, ticket]);

  /**
   * Give up on a preparation that is taking too long.
   *
   * Nothing has been broadcast at this point — a proof is built and priced
   * before anything is sent — so stopping costs only the work in flight. The
   * run token means a wallet that answers afterwards is ignored rather than
   * dropping a quote onto a screen the person has already left.
   */
  const cancelPreparation = useCallback((): void => {
    prepareRun.current += 1;
    prepared.current = null;
    setQuote(null);
    setError(null);
    setAction({ name: "idle" });
  }, []);

  const submitFund = useCallback(async (): Promise<void> => {
    let staged = false;
    let activeTicket: TravelSafeTicketV3 | null = null;
    try {
      if (wallet.current === null || account === null || ticket === null) {
        throw new Error("Connect your wallet");
      }
      activeTicket = ticket;
      const current = retainPreparedForAccount(prepared.current, account);
      if (current === null || current.artifact.operation !== "FUND") {
        throw new Error("Prepare this Safe again");
      }
      assertSelectedWalletAccount(wallet.current, account);
      setError(null);
      setAction({ name: "preparing", label: "Sending" });
      await transitionStoredTravelSafeTicketV3(activeTicket.stateId, "FUND_SUBMITTING", {
        pendingAction: { operation: "FUND" },
      });
      staged = true;
      const result = await submitPreparedTravelSafeV3Relay({
        prepared: current,
        sponsorUrl: WRENCHLESS_SERVICES.sponsorUrl,
      });
      const updated = await transitionStoredTravelSafeTicketV3(
        activeTicket.stateId,
        "FUND_SUBMITTING",
        { fundTransactionHash: result.transactionHash },
      );
      setTicket(updated);
      pending.current = { transactionHash: result.transactionHash, target: { operation: "FUND" } };
      setAction({ name: "submitted", transactionHash: result.transactionHash });
      prepared.current = null;
      setup.current = null;
      updateRecoveryWords(null);
      await refresh();
    } catch (cause) {
      setError(reasonFrom(cause));
      if (!staged || activeTicket === null) {
        setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
      } else if (cause instanceof TravelSafeV3SponsorError && !cause.ambiguous) {
        prepared.current = null;
        setQuote(null);
        setTicket(
          await transitionStoredTravelSafeTicketV3(activeTicket.stateId, "READY", {
            fundTransactionHash: null,
            pendingAction: null,
          }),
        );
        setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
        setPhase("review");
      } else {
        setAction({ name: "preparing", label: "Checking Starknet" });
      }
      await refresh();
    }
  }, [account, refresh, ticket]);

  /**
   * Everything this device holds about a Safe, forgotten.
   *
   * `stateId` is read from the ticket when there is one and from the device
   * settings when there is not, because the state worth escaping is exactly
   * the one where the settings still name a Safe the app can no longer show.
   */
  const forgetSafe = useCallback(async (stateId: string): Promise<void> => {
    await clearTravelSafeTicket(stateId);
    shieldRun.current += 1;
    wallet.current = null;
    setup.current = null;
    prepared.current = null;
    pending.current = null;
    passkeyVerified.current = false;
    setAccount(null);
    setAssets([]);
    setPlan(EMPTY_PLAN);
    setTicket(null);
    setSnapshot(null);
    setShield(null);
    setQuote(null);
    setLive(null);
    setReadiness(null);
    setRecoveryDrill({ status: "idle" });
    updateRecoveryWords(null);
    setAction({ name: "idle" });
    setPhase("empty");
  }, []);

  /**
   * Abandon a Safe that was planned but never funded.
   *
   * Nothing about it exists anywhere but this device: no FUND was broadcast,
   * so there is no onchain state to orphan and no money to strand. Without
   * this the only way out of a half-finished setup was to clear the browser's
   * storage by hand.
   */
  const discardUnfundedSafe = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const stateId = ticket?.stateId ?? readSettings().activeSafeStateId;
      if (stateId === null || stateId === undefined) {
        setPhase("empty");
        return;
      }
      if (ticket !== null && (ticket.status !== "READY" || ticket.fundTransactionHash !== null)) {
        throw new Error("This Safe has already been funded");
      }
      await forgetSafe(stateId);
    } catch (cause) {
      const reason = reasonFrom(cause);
      setError(reason);
      setAction({ name: "failed", message: reason, retryable: true });
    }
  }, [forgetSafe, ticket]);

  const clearTerminal = useCallback(async (): Promise<void> => {
    if (ticket === null || ticket.status !== "TERMINAL") return;
    setError(null);
    try {
      await clearTravelSafeTicket(ticket.stateId);
      wallet.current = null;
      setup.current = null;
      prepared.current = null;
      pending.current = null;
      setAccount(null);
      setAssets([]);
      setPlan(EMPTY_PLAN);
      setTicket(null);
      setSnapshot(null);
      setAction({ name: "idle" });
      updateRecoveryWords(null);
      setQuote(null);
      setLive(null);
      setReadiness(null);
      setShield(null);
      setRecoveryDrill({ status: "idle" });
      passkeyVerified.current = false;
      setPhase("empty");
    } catch (cause) {
      const reason = reasonFrom(cause);
      setError(reason);
      setAction({ name: "failed", message: reason, retryable: true });
    }
  }, [ticket]);

  const activeState = useCallback((): ActiveTravelSafeV3State => {
    if (ticket === null || snapshot?.state === null || snapshot === null) {
      throw new Error("This Travel Safe is not funded yet");
    }
    if (snapshot.state.status !== "funded") throw new Error("This Travel Safe is complete");
    return { ticket, state: snapshot.state };
  }, [snapshot, ticket]);

  /**
   * The common opening of every action this device sends itself.
   *
   * These pay the pool fee out of the private balance — unlike FUND and
   * TOP_UP, which the relay sponsors — so the fee has to already be private.
   * When it is not but the wallet can cover it, this offers the same shield
   * step the funding flow uses and returns `null`, and the caller stops
   * without reporting a failure: nothing has gone wrong, there is just a
   * deposit to approve first.
   */
  const beginDirectAction = useCallback(async (): Promise<{
    wallet: BrowserWallet;
    account: string;
    ticket: TravelSafeTicketV3;
    state: TravelSafeV3ChainState;
  } | null> => {
    const active = activeState();
    if (wallet.current === null || account === null) throw new Error("Connect your wallet");
    assertSelectedWalletAccount(wallet.current, account);
    setError(null);
    setAction({ name: "preparing", label: "Checking fee reserve" });
    const fresh = await refreshBalances(wallet.current);
    let deposits: readonly ShieldDeposit[];
    try {
      deposits = planShieldDeposits({
        tokenAddress: active.ticket.tokenAddress,
        amountBaseUnits: "0",
        poolFeeFri: fresh.poolFeeFri,
        balances: fresh.balances,
      });
    } catch {
      // The wallet cannot cover the fee either, so name the figure rather
      // than repeating that a balance is too low.
      throw new Error(
        `Add at least ${formatTokenAmount(BigInt(fresh.poolFeeFri), 18)} STRK to your wallet for this action's fee`,
      );
    }
    if (deposits.length > 0) {
      setShield(
        shieldStep({
          purpose: "action",
          tokenAddress: active.ticket.tokenAddress,
          amountBaseUnits: "0",
          topUpAmount: null,
          deposits,
        }),
      );
      setAction({ name: "idle" });
      return null;
    }
    setShield(null);
    setAction({ name: "wallet", label: "Approve private action" });
    return { wallet: wallet.current, account, ...active };
  }, [account, activeState, refreshBalances]);

  const recordDirectAction = useCallback(async (
    input: { transactionHash: string; target: TravelSafeActionTarget },
  ) => {
    if (ticket === null) return;
    pending.current = input;
    setAction({ name: "submitted", transactionHash: input.transactionHash });
    setTicket(
      await transitionStoredTravelSafeTicketV3(ticket.stateId, "ACTION_SUBMITTING", {
        actionTransactionHash: input.transactionHash,
        pendingAction: input.target,
      }),
    );
    await refresh();
  }, [refresh, ticket]);

  const resetUnsentAction = useCallback(async (force = false): Promise<void> => {
    if (ticket === null || pending.current !== null) return;
    try {
      const stored = await readActiveAnyTravelSafeTicket();
      if (
        stored === null ||
        stored.schemaVersion !== "wrenchless.travel-safe-ticket.v3" ||
        stored.status !== "ACTION_SUBMITTING" ||
        (stored.pendingAction !== null && !force)
      ) {
        return;
      }
      setTicket(
        await transitionStoredTravelSafeTicketV3(stored.stateId, "FUNDED", {
          actionTransactionHash: null,
          pendingAction: null,
        }),
      );
    } catch {
      // A concurrent chain refresh may already have advanced the ticket.
    }
  }, [ticket]);

  const releaseAvailable = useCallback(async (): Promise<void> => {
    try {
      const current = activeState();
      if (BigInt(current.state.claimableAmount) <= 0n) {
        throw new Error("No allowance is ready yet");
      }
      const active = await beginDirectAction();
      if (active === null) return;
      const target: TravelSafeActionTarget = {
        operation: "RELEASE",
        previousNonce: active.state.nonce,
        maximumRemaining: (
          BigInt(active.state.remainingAmount) - BigInt(active.state.claimableAmount)
        ).toString(),
      };
      await transitionStoredTravelSafeTicketV3(active.ticket.stateId, "ACTION_SUBMITTING", {
        pendingAction: target,
      });
      const devicePublicKey = deriveTravelSafeV3PublicKey(active.ticket.devicePrivateKey);
      const result = await submitAllowanceRelease({
        wallet: readyWallet(active.wallet),
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        state: { ...stateAuthorization(active.ticket, active.state), claimableAmount: active.state.claimableAmount },
        recipient: active.account,
        devicePrivateKey: active.ticket.devicePrivateKey,
        devicePublicKey,
      });
      await recordDirectAction({
        transactionHash: result.transactionHash,
        target,
      });
    } catch (cause) {
      setError(reasonFrom(cause));
      setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
      await resetUnsentAction();
      await refresh();
    }
  }, [activeState, beginDirectAction, recordDirectAction, refresh, resetUnsentAction]);

  const prepareTopUp = useCallback(async (amount: string): Promise<void> => {
    try {
      const active = activeState();
      if (wallet.current === null || account === null) throw new Error("Connect your wallet");
      assertSelectedWalletAccount(wallet.current, account);
      const amountBaseUnits = parseTokenAmount(
        amount,
        tokenFor(active.ticket.tokenAddress).decimals,
      ).toString();
      if (BigInt(amountBaseUnits) <= 0n) throw new Error("Enter an amount to add");
      setError(null);
      prepared.current = null;
      setQuote(null);
      setAction({ name: "preparing", label: "Checking top-up" });
      const funding = await readFundingBalances(active.ticket.tokenAddress, amountBaseUnits);
      if (funding.deposits.length > 0) {
        setShield(
          shieldStep({
            purpose: "top-up",
            tokenAddress: active.ticket.tokenAddress,
            amountBaseUnits,
            topUpAmount: amount,
            deposits: funding.deposits,
          }),
        );
        setAction({ name: "idle" });
        return;
      }
      setShield(null);
      setAction({ name: "preparing", label: "Preparing private proof" });
      const next = await prepareTravelSafeV3TopUpRelay({
        wallet: readyWallet(wallet.current),
        account,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        state: active.state,
        ticket: active.ticket,
        amountBaseUnits,
        devicePublicKey: deriveTravelSafeV3PublicKey(active.ticket.devicePrivateKey),
        sponsorUrl: WRENCHLESS_SERVICES.sponsorUrl,
      });
      prepared.current = next;
      setQuote(next.estimate.summary);
      setAction({ name: "idle" });
    } catch (cause) {
      setError(reasonFrom(cause));
      setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
    }
  }, [account, activeState, readFundingBalances]);

  /**
   * Send the pending shield, then wait for two things in order: the deposit
   * accepted on Starknet, and the wallet reporting a private balance that
   * covers the action. Only then does the original preparation resume, so a
   * proof is never built against a note that does not exist yet. A step that
   * already holds a hash resumes the wait instead of sending a second deposit.
   */
  const shieldNow = useCallback(async (): Promise<void> => {
    const step = shield;
    if (step === null) return;
    const run = shieldRun.current + 1;
    shieldRun.current = run;
    const current = () => shieldRun.current === run;
    setError(null);
    try {
      if (wallet.current === null || account === null) throw new Error("Connect your wallet");
      const activeWallet = wallet.current;
      assertSelectedWalletAccount(activeWallet, account);
      let transactionHash = step.transactionHash;
      let sent = step.sent;

      if (!sent) {
        setAction({ name: "wallet", label: "Approve the shield in your wallet" });
        const baseline = (await refreshBalances(activeWallet)).balances;
        const deposits = step.deposits.map((deposit) => ({
          token: tokenFor(deposit.tokenAddress),
          amountBaseUnits: deposit.amountBaseUnits,
        }));

        /**
         * Two witnesses, whichever speaks first. The wallet's reply carries a
         * hash and is the better answer; the account's own balance falling is
         * the answer that still arrives when the reply does not.
         */
        const stopped = { value: false };
        const reply = submitShieldDeposits({
          wallet: readyWallet(activeWallet),
          chainId: MAINNET_CHAIN_ID,
          deposits,
        }).then((result) => ({
          kind: "reply" as const,
          transactionHash: result.transactionHash,
        }));
        // A reply that fails after the chain already answered must not surface
        // as an unhandled rejection; the race below still sees it first if it
        // is first.
        reply.catch(() => undefined);
        const observed = (async () => {
          const startedAt = Date.now();
          while (!stopped.value) {
            await sleep(SHIELD_POLL_MILLISECONDS);
            if (stopped.value || !current()) break;
            const seen = await refreshBalances(activeWallet).catch(() => null);
            if (seen !== null && shieldLeftTheWallet({
              deposits,
              baseline,
              current: seen.balances,
            })) {
              return { kind: "observed" as const };
            }
            if (Date.now() - startedAt > SHIELD_WALLET_TIMEOUT_MILLISECONDS) {
              return { kind: "timeout" as const };
            }
          }
          return { kind: "stopped" as const };
        })();

        let outcome;
        try {
          outcome = await Promise.race([reply, observed]);
        } finally {
          stopped.value = true;
        }
        if (!current()) return;
        if (outcome.kind === "timeout") {
          throw new Error(
            "Your wallet has not answered and no deposit has appeared onchain. Try the shield again.",
          );
        }
        if (outcome.kind === "reply") transactionHash = outcome.transactionHash;
        sent = true;
        setShield({ ...step, transactionHash, sent });
      }

      if (transactionHash !== null) {
        setAction({ name: "preparing", label: "Confirming the shield on Starknet" });
        const submittedAt = Date.now();
        for (;;) {
          if (!current()) return;
          const receipt = await readTransactionReceiptStatus({
            transactionHash,
            rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
          });
          if (receipt.name === "accepted") break;
          if (receipt.name === "reverted") {
            setShield({ ...step, transactionHash: null, sent: false });
            throw new Error(`The shield was rejected on Starknet: ${receipt.reason}`);
          }
          if (Date.now() - submittedAt > SHIELD_RECEIPT_TIMEOUT_MILLISECONDS) {
            throw new Error("The shield is still confirming. Check it again in a moment.");
          }
          await sleep(SHIELD_POLL_MILLISECONDS);
        }
      }

      setAction({ name: "preparing", label: "Waiting for the private note" });
      const acceptedAt = Date.now();
      for (;;) {
        if (!current()) return;
        const fresh = await refreshBalances(activeWallet);
        const remaining = shieldShortfalls({
          tokenAddress: step.tokenAddress,
          amountBaseUnits: step.amountBaseUnits,
          poolFeeFri: fresh.poolFeeFri,
          balances: fresh.balances,
        });
        if (remaining.length === 0) break;
        if (Date.now() - acceptedAt > SHIELD_NOTE_TIMEOUT_MILLISECONDS) {
          throw new Error(
            fresh.shieldedError ??
              "The private note has not appeared in your wallet yet. Check it again in a moment.",
          );
        }
        await sleep(SHIELD_POLL_MILLISECONDS);
      }
      if (!current()) return;
      setShield(null);
      if (step.purpose === "fund") {
        await prepareFund();
        return;
      }
      if (step.purpose === "top-up") {
        await prepareTopUp(step.topUpAmount ?? "");
        return;
      }
      // A direct action carries no prepared work to resume — the fee is
      // simply private now, and the button that asked for it will go through.
      setAction({
        name: "confirmed",
        transactionHash,
        label: "The action fee is private now",
      });
    } catch (cause) {
      if (!current()) return;
      setError(reasonFrom(cause));
      setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
    }
  }, [account, prepareFund, prepareTopUp, refreshBalances, shield]);

  const dismissShield = useCallback((): void => {
    shieldRun.current += 1;
    setShield(null);
    setError(null);
    setAction({ name: "idle" });
  }, []);

  const submitTopUp = useCallback(async (): Promise<void> => {
    let staged = false;
    try {
      if (account === null || ticket === null) throw new Error("Connect your wallet");
      const current = retainPreparedForAccount(prepared.current, account);
      if (current === null || current.artifact.operation !== "TOP_UP") {
        throw new Error("Prepare the top-up again");
      }
      const state = activeState().state;
      const target: TravelSafeActionTarget = {
        operation: "TOP_UP",
        previousNonce: state.nonce,
        minimumRemaining: (
          BigInt(state.remainingAmount) + BigInt(current.artifact.amountBaseUnits)
        ).toString(),
      };
      setError(null);
      setAction({ name: "preparing", label: "Sending top-up" });
      await transitionStoredTravelSafeTicketV3(ticket.stateId, "ACTION_SUBMITTING", {
        pendingAction: target,
      });
      staged = true;
      const result = await submitPreparedTravelSafeV3Relay({
        prepared: current,
        sponsorUrl: WRENCHLESS_SERVICES.sponsorUrl,
      });
      prepared.current = null;
      await recordDirectAction({
        transactionHash: result.transactionHash,
        target,
      });
    } catch (cause) {
      setError(reasonFrom(cause));
      if (!staged) {
        setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
      } else if (cause instanceof TravelSafeV3SponsorError && !cause.ambiguous) {
        prepared.current = null;
        setQuote(null);
        await resetUnsentAction(true);
        setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
      } else {
        setAction({ name: "preparing", label: "Checking Starknet" });
      }
      await refresh();
    }
  }, [account, activeState, recordDirectAction, refresh, resetUnsentAction, ticket]);

  const extendReturnDate = useCallback(async (localDate: string): Promise<void> => {
    try {
      const current = activeState();
      const returnAt = localSeconds(localDate, "a new return date");
      if (BigInt(returnAt) <= BigInt(current.state.returnAt) || BigInt(returnAt) > BigInt(current.state.maxReturnAt)) {
        throw new Error("Choose a later date within this Safe's limit");
      }
      const active = await beginDirectAction();
      if (active === null) return;
      const target: TravelSafeActionTarget = {
        operation: "EXTEND",
        previousNonce: active.state.nonce,
        returnAt,
      };
      await transitionStoredTravelSafeTicketV3(active.ticket.stateId, "ACTION_SUBMITTING", {
        pendingAction: target,
      });
      const result = await submitTravelSafeExtend({
        wallet: readyWallet(active.wallet),
        state: stateAuthorization(active.ticket, active.state),
        newReturnAt: returnAt,
        devicePrivateKey: active.ticket.devicePrivateKey,
        devicePublicKey: deriveTravelSafeV3PublicKey(active.ticket.devicePrivateKey),
      });
      await recordDirectAction({
        transactionHash: result.transactionHash,
        target,
      });
    } catch (cause) {
      setError(reasonFrom(cause));
      setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
      await resetUnsentAction();
      await refresh();
    }
  }, [activeState, beginDirectAction, recordDirectAction, refresh, resetUnsentAction]);

  const bringBackEarly = useCallback(async (words: string): Promise<void> => {
    try {
      const current = activeState();
      const secrets = await deriveTravelSafeSecrets(words);
      if (BigInt(secrets.stateId) !== BigInt(current.ticket.stateId)) {
        throw new Error("Those recovery words do not match this Safe");
      }
      const active = await beginDirectAction();
      if (active === null) return;
      const target: TravelSafeActionTarget = {
        operation: "TERMINAL",
        previousNonce: active.state.nonce,
      };
      await transitionStoredTravelSafeTicketV3(active.ticket.stateId, "ACTION_SUBMITTING", {
        pendingAction: target,
      });
      const result = await submitTravelSafeClaimEarly({
        wallet: readyWallet(active.wallet),
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        state: stateAuthorization(active.ticket, active.state),
        recipient: active.account,
        claimPrivateKey: secrets.claimPrivateKey,
        claimPublicKey: secrets.claimPublicKey,
      });
      await recordDirectAction({
        transactionHash: result.transactionHash,
        target,
      });
    } catch (cause) {
      setError(reasonFrom(cause));
      setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
      await resetUnsentAction();
      await refresh();
    }
  }, [activeState, beginDirectAction, recordDirectAction, refresh, resetUnsentAction]);

  const drillRecoveryWords = useCallback(async (words: string): Promise<void> => {
    setRecoveryDrill({ status: "checking" });
    try {
      if (snapshot?.state === null || snapshot === null || ticket === null) {
        throw new Error("This Trip Allowance is not ready for a recovery check");
      }
      const secrets = await deriveTravelSafeSecrets(words);
      const commitment = computeTravelSafeV3ClaimCommitment(
        secrets.stateId,
        secrets.claimPublicKey,
      );
      if (
        BigInt(secrets.stateId) !== BigInt(ticket.stateId) ||
        BigInt(commitment) !== BigInt(snapshot.state.claimCommitment)
      ) {
        throw new Error("Those words do not match this Trip Allowance");
      }
      setRecoveryDrill({ status: "valid" });
    } catch {
      setRecoveryDrill({
        status: "invalid",
        message: "Those words do not match this Trip Allowance",
      });
    }
  }, [snapshot, ticket]);

  const returnNow = useCallback(async (): Promise<void> => {
    try {
      const current = activeState();
      if (BigInt(snapshot?.chainTimeSeconds ?? "0") <= BigInt(current.state.returnAt)) {
        throw new Error("Return is not open yet");
      }
      if (account === null || BigInt(current.ticket.recoveryAccount) !== BigInt(account)) {
        throw new Error("Use the recovery account chosen for this Safe");
      }
      const active = await beginDirectAction();
      if (active === null) return;
      const target: TravelSafeActionTarget = {
        operation: "TERMINAL",
        previousNonce: active.state.nonce,
      };
      await transitionStoredTravelSafeTicketV3(active.ticket.stateId, "ACTION_SUBMITTING", {
        pendingAction: target,
      });
      const result = await submitTravelSafeV3Refund({
        wallet: readyWallet(active.wallet),
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        state: stateAuthorization(active.ticket, active.state),
        recipient: active.account,
        recoveryAccount: active.ticket.recoveryAccount,
        recoverySalt: active.ticket.recoverySalt,
      });
      await recordDirectAction({
        transactionHash: result.transactionHash,
        target,
      });
    } catch (cause) {
      setError(reasonFrom(cause));
      setAction({ name: "failed", message: reasonFrom(cause), retryable: true });
      await resetUnsentAction();
      await refresh();
    }
  }, [account, activeState, beginDirectAction, recordDirectAction, refresh, resetUnsentAction, snapshot?.chainTimeSeconds]);

  return {
    model: {
      version: "v3",
      phase,
      walletAccount: account,
      assets,
      plan,
      ticket,
      snapshot,
      nextReleaseAt,
      readiness,
      shield,
      recoveryDrill,
      action,
      recoveryWords,
      quote,
      error,
      live,
    },
    actions: {
      startCreate() {
        setError(null);
        setReadiness(null);
        setPhase(WRENCHLESS_MAINNET.tripAllowanceHelperAddress === null ? "unavailable" : "connect");
      },
      closeCreate() {
        if (ticket === null && phase === "plan") {
          setPhase("readiness");
          return;
        }
        if (ticket === null && phase === "recovery") {
          setPhase("plan");
          return;
        }
        setPhase(
          ticket === null
            ? "empty"
            : ticket.status === "READY"
              ? "review"
              : ticket.status === "TERMINAL"
                ? "terminal"
                : "active",
        );
      },
      connect,
      async checkReadiness() {
        if (wallet.current === null || account === null) {
          await connect();
          return;
        }
        await runReadiness(wallet.current, account);
      },
      continueFromReadiness() {
        if (readiness?.status !== "ready") return;
        setError(null);
        setPhase("plan");
      },
      selectAsset(tokenAddress) {
        tokenFor(tokenAddress);
        setPlan((current) => ({ ...current, tokenAddress, parkAmount: "", keepAmount: "", dailyAmount: "" }));
      },
      applyLockPreset(percent) {
        const asset = assets.find(
          (candidate) => BigInt(candidate.tokenAddress) === BigInt(plan.tokenAddress),
        );
        if (asset === undefined || !asset.available) return;
        const token = tokenFor(asset.tokenAddress);
        const balance = parseTokenAmount(asset.totalBalance, token.decimals);
        const reserve =
          token.symbol === "STRK"
            ? parseTokenAmount(
                asset.returnFeeStrk,
                TRAVEL_SAFE_TOKENS[0].decimals,
              )
            : 0n;
        const usable = balance > reserve ? balance - reserve : 0n;
        const parked = (usable * BigInt(percent)) / 100n;
        setPlan((current) => ({
          ...current,
          parkAmount: formatTokenAmount(parked, token.decimals),
          keepAmount: formatTokenAmount(balance - parked, token.decimals),
        }));
      },
      setPlanField(field, value) {
        setPlan((current) => {
          if (field !== "parkAmount" && field !== "keepAmount") {
            return { ...current, [field]: value };
          }
          const asset = assets.find(
            (candidate) => BigInt(candidate.tokenAddress) === BigInt(current.tokenAddress),
          );
          if (asset === undefined || !asset.available) {
            return { ...current, [field]: value };
          }
          const token = tokenFor(asset.tokenAddress);
          try {
            const balance = parseTokenAmount(asset.totalBalance, token.decimals);
            const entered = parseTokenAmount(value, token.decimals);
            if (entered > balance) return { ...current, [field]: value };
            return field === "parkAmount"
              ? {
                  ...current,
                  parkAmount: value,
                  keepAmount: formatTokenAmount(balance - entered, token.decimals),
                }
              : {
                  ...current,
                  keepAmount: value,
                  parkAmount: formatTokenAmount(balance - entered, token.decimals),
                };
          } catch {
            return { ...current, [field]: value };
          }
        });
      },
      showRecoveryWords,
      setRecoveryWords(words) {
        updateRecoveryWords(words.trim().toLowerCase());
      },
      confirmRecoveryWords,
      prepareFund,
      shieldNow,
      dismissShield,
      cancelPreparation,
      discardUnfundedSafe,
      submitFund,
      releaseAvailable,
      prepareTopUp,
      submitTopUp,
      extendReturnDate,
      bringBackEarly,
      drillRecoveryWords,
      resetRecoveryDrill() {
        setRecoveryDrill({ status: "idle" });
      },
      returnNow,
      downloadReturnCalendarEvent() {
        if (ticket === null) return;
        calendarFile(ticket);
      },
      clearTerminal,
      unlock,
      refresh,
    },
  };
}
