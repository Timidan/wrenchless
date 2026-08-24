import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";

import type { RefillFundArtifact } from "@wrenchless/canary-core";
import {
  requiredPrivateRefillFri,
  totalVaultRefillDebitFri,
} from "../../lib/cover-exposure";
import { WRENCHLESS_MAINNET } from "../../lib/product-config";
import {
  inspectReadyCoverAccount,
  readCoverTransactionState,
  type ReadyCoverAccountStatus,
} from "../../lib/ready-cover";
import {
  inspectReadyPrivateReadiness,
  minimumReadyPrivateDepositFri,
  submitReadyPrivateDeposit,
  type ReadyPrivateReadiness,
} from "../../lib/ready-private-setup";
import { prepareReadyRefillFundArtifact } from "../../lib/ready-refill";
import {
  importCarriedRestoreRequests,
  parseCarriedReceipt,
} from "../../lib/refill-pairing";
import { refundStoredVaultRefill } from "../../lib/refill-operations";
import {
  readRefillChainState,
  type RefillChainState,
} from "../../lib/refill-state";
import {
  readVaultRefillIntent,
  type VaultRefillIntent,
} from "../../lib/refill-ticket";
import { submitRelayedRefillFund } from "../../lib/relayed-refill";
import { assertNewRestoreAllowed } from "../../lib/restore-guard";
import { navigate } from "../../routes";
import {
  readVaultControlKey,
  resolveRestorePause,
  retrieveRestorePauseCommands,
  type RestorePauseState,
} from "../../lib/vault-control";
import {
  amountChoices,
  EXPLORER_BASE,
  formatStrk,
  formatStrkExact,
  formatStrkFigure,
  formatUnixSeconds,
  parseStrkAmount,
  reasonFrom,
  shortHex,
  unixSecondsFromNow,
} from "../../adapters/amount";
import {
  devicePasskeysAvailable,
  verifyDevicePasskey,
} from "../../adapters/device-passkey";
import {
  recordSubmission,
  useActivity,
  type ActivityRecord,
} from "../../adapters/records";
import {
  coverEnrollment,
  rememberRefillStateId,
  useSettings,
  writeSettings,
} from "../../adapters/settings";
import {
  alreadyAuthorized,
  assertSelectedWalletAccount,
  requestWalletAccount,
  type BrowserWallet,
} from "../../adapters/wallet";
import { ReadyWalletMark } from "../../components/ReadyWalletMark";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  GearSixIcon,
  KeyIcon,
  PaperPlaneTiltIcon,
  PauseIcon,
  VaultIcon,
  WarningCircleIcon,
} from "../../components/icons";
import {
  Actions,
  Amount,
  Balance,
  Button,
  Emblem,
  Empty,
  Fact,
  Facts,
  Live,
  Note,
  ProductFrame,
  Screen,
  Section,
  StatusLine,
  TechnicalDetail,
  WalletField,
  Waiting,
} from "../shared/product";

/**
 * The home vault.
 *
 * One number, and it is the one that matters: what is being kept back. Under it
 * are the facts a person opens this device to check, and then the only two
 * things they can change from here.
 *
 * This surface is deliberate rather than everyday. It is allowed to name the
 * private balance and quote its fee before anything is signed, because it is
 * used somewhere safe, by the person who chose to hold the reserve.
 *
 * It never reads the carried wallet. It does not know that account's address
 * and is not meant to: a link between the two accounts is precisely what the
 * product spends its complexity avoiding. So the carried figure is absent here
 * rather than guessed at, and the screen shows the limit it did set instead.
 *
 * Sending a restore no longer starts with a code somebody typed. The carried
 * phone handed over three one-time requests when it paired, and this screen
 * picks the next unused one. A pasted code survives only as a way out of a
 * pairing that went wrong.
 */

const AMOUNTS = ["5", "10", "25", "50"] as const;
/** Round figures above the live floor; the floor itself is always offered. */
const DEPOSIT_SUGGESTIONS = ["25", "50", "100"] as const;
const WINDOWS = [
  { label: "1 hour", hours: 1 },
  { label: "6 hours", hours: 6 },
  { label: "24 hours", hours: 24 },
] as const;
const ONE_STRK = 10n ** 18n;

type RestoreAmountChoice = { label: string; fri: string };

/** Fixed suggestions that fit, plus the exact ceiling when it is not one. */
function restoreAmountChoices(capFri: string): readonly RestoreAmountChoice[] {
  const cap = BigInt(capFri);
  const choices: RestoreAmountChoice[] = AMOUNTS.map((label) => ({
    label,
    fri: (BigInt(label) * ONE_STRK).toString(),
  })).filter((choice) => BigInt(choice.fri) <= cap);
  const exactCap = cap.toString();
  if (cap > 0n && !choices.some((choice) => choice.fri === exactCap)) {
    choices.push({ label: formatStrkExact(exactCap), fri: exactCap });
  }
  return choices;
}

/** Keep the familiar 10 STRK default when it fits; otherwise use the ceiling. */
function initialRestoreAmountFri(capFri: string): string {
  const cap = BigInt(capFri);
  const ten = 10n * ONE_STRK;
  return (cap >= ten ? ten : cap).toString();
}

function sameFelt(left: string, right: string): boolean {
  try {
    return BigInt(left) === BigInt(right);
  } catch {
    return false;
  }
}

type View = "home" | "limit" | "restore" | "deposit";

type Wallet =
  | { name: "idle" }
  | { name: "connecting" }
  | { name: "checking" }
  | { name: "ready"; status: ReadyCoverAccountStatus }
  | { name: "blocked"; reason: string };

type PasskeyGate =
  | { name: "locked" }
  | { name: "checking" }
  | { name: "open" }
  | { name: "failed"; reason: string };

/**
 * The private rail, as the four things a person can be looking at.
 *
 * A fresh account cannot receive a private restore: it has to be known to the
 * rail first, and a deposit has to settle before anything can be sent from it.
 * Each state below is read from the chain, never assumed, and `settling` exists
 * because a confirmed deposit and a usable balance are not the same moment.
 */
type Rail =
  | { name: "unknown" }
  | { name: "reading" }
  | { name: "ready"; readiness: ReadyPrivateReadiness }
  | { name: "unregistered"; readiness: ReadyPrivateReadiness }
  | { name: "approving" }
  /**
   * `baselineShieldedFri` is what the private balance held before this deposit
   * was sent. Without it an account that already had something in it would
   * look settled the moment the transaction confirmed, and the person would be
   * sent on to a screen that cannot yet do anything.
   */
  | { name: "settling"; transactionHash: string; baselineShieldedFri: string }
  | { name: "failed"; reason: string };

type Slot =
  | { name: "finding" }
  | { name: "ready"; intent: VaultRefillIntent }
  | { name: "waiting"; stateId: string; state: RefillChainState }
  | { name: "none" }
  | { name: "failed"; reason: string };

/**
 * `spendingFri` is the figure the person picked; the artifact carries that plus
 * one live fee, because the carried wallet has to pay a fee of its own before
 * any of it becomes spending money. The two are kept apart so the review can
 * lead with the number they chose and account for the rest underneath it.
 */
type Fund =
  | { name: "idle" }
  | { name: "proving" }
  | { name: "review"; artifact: RefillFundArtifact; spendingFri: string; feeFri: string }
  | { name: "sending"; artifact: RefillFundArtifact; spendingFri: string; feeFri: string }
  | { name: "sent"; transactionHash: string; final: boolean }
  | { name: "failed"; reason: string };

function describe(state: RefillChainState): string {
  if (state.status === "claimed") return "Collected";
  if (state.status === "refunded") return "Returned here";
  return BigInt(state.expiry) < BigInt(Math.floor(Date.now() / 1000))
    ? "Expired, uncollected"
    : "Waiting to be collected";
}

/** "23h 59m left", from a moment in the future. Never a bare timestamp. */
function remaining(until: string): string {
  const milliseconds = Date.parse(until) - Date.now();
  if (milliseconds <= 0) return "ending now";
  const minutes = Math.floor(milliseconds / 60_000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
}

const ACTIVITY_LABEL = {
  funding: "Restore sent",
  refund: "Returned here",
  payment: "Sent",
  allowance: "Moved",
  refill: "Collected",
} satisfies Record<ActivityRecord["kind"], string>;

export function ReserveSurface(): JSX.Element {
  const settings = useSettings();
  const records = useActivity("reserve");

  const [passkeyGate, setPasskeyGate] = useState<PasskeyGate>({ name: "locked" });
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [walletState, setWalletState] = useState<Wallet>({ name: "idle" });
  const [rail, setRail] = useState<Rail>({ name: "unknown" });
  const [pause, setPause] = useState<RestorePauseState>({
    active: false,
    blockedUntil: null,
  });
  const [view, setView] = useState<View>("home");
  const [live, setLive] = useState<string | null>(null);

  const [limit, setLimit] = useState(() => formatStrkExact(settings.exposureCapFri));
  const [limitError, setLimitError] = useState<string | null>(null);

  const [deposit, setDeposit] = useState<string>("25");
  const [depositError, setDepositError] = useState<string | null>(null);

  const [slot, setSlot] = useState<Slot>({ name: "finding" });
  const [amountFri, setAmountFri] = useState<string>(() =>
    initialRestoreAmountFri(settings.exposureCapFri),
  );
  const [hours, setHours] = useState<number>(6);
  const [fund, setFund] = useState<Fund>({ name: "idle" });
  const [elapsed, setElapsed] = useState(0);

  const [codeText, setCodeText] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);

  const restoreAmounts = restoreAmountChoices(settings.exposureCapFri);
  /** The live fee, when a reading exists. Nothing here guesses one. */
  const railFeeFri = (): string | null =>
    rail.name === "ready" || rail.name === "unregistered"
      ? rail.readiness.poolFeeFri
      : null;

  /** What the private balance holds right now, as the baseline for a deposit. */
  const railShieldedFri = (): string | null =>
    rail.name === "ready" || rail.name === "unregistered"
      ? rail.readiness.shieldedBalanceFri
      : null;
  const guardianPaired = coverEnrollment(settings) !== null;
  const carriedPaired = settings.carriedDeviceCode !== null;
  const passkeyEnrolled =
    settings.devicePasskeyId !== null &&
    settings.devicePasskeyPublicKey !== null;
  const setupComplete = settings.onboardedAt !== null && passkeyEnrolled;
  const passkeyAvailable = devicePasskeysAvailable();
  const reserveUnlocked =
    setupComplete && passkeyAvailable && passkeyGate.name === "open";

  // A partial or missing enrolment is not a weaker way into the vault. Setup is
  // the only place that can create the device credential, so send the person
  // back there before this surface connects a wallet or reads anything.
  useEffect(() => {
    if (setupComplete) return;
    navigate("/start");
  }, [setupComplete]);

  // A lower ceiling can arrive from the limit screen or another open tab. Do
  // not leave an invisible, now-impossible amount selected after that change.
  useEffect(() => {
    if (
      restoreAmountChoices(settings.exposureCapFri).some(
        (choice) => choice.fri === amountFri,
      )
    ) {
      return;
    }
    setAmountFri(initialRestoreAmountFri(settings.exposureCapFri));
  }, [amountFri, settings.exposureCapFri]);

  useEffect(() => {
    if (!reserveUnlocked) return;
    const existing = alreadyAuthorized();
    if (existing === null) return;
    setWallet(existing);
    void inspect(existing);
    // `inspect` is a hoisted declaration and never changes identity.
  }, [reserveUnlocked]);

  // Proving takes as long as it takes. An elapsed count is honest where a
  // progress bar would be a guess.
  useEffect(() => {
    if (fund.name !== "proving") return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [fund.name]);

  /**
   * Reads the control inbox and resolves what it means.
   *
   * A pause is not a flag stored here — it is whatever the newest command from
   * the guardian says, minus anything this device has already dismissed. That
   * keeps it correct across a reload, a lift, and a second command sent after
   * the first was lifted.
   */
  const readPause = useCallback(async (): Promise<void> => {
    if (
      settings.controlInboxId === null ||
      settings.controlInboxReceiveCapability === null
    ) {
      return;
    }
    try {
      const key = await readVaultControlKey();
      if (key === null) return;
      const enrollment = coverEnrollment(settings);
      if (enrollment === null) return;
      const commands = await retrieveRestorePauseCommands({
        mailboxUrl: settings.mailboxUrl,
        mailboxId: settings.controlInboxId,
        receiveCapability: settings.controlInboxReceiveCapability,
        controlPrivateKey: key.privateKey,
        guardianPublicKey: enrollment.guardianPublicKey,
      });
      setPause(resolveRestorePause(commands, settings.pauseLiftedAt));
    } catch {
      // An unreachable inbox is not evidence that nothing was sent, so the
      // gate is left exactly as it was rather than quietly opening.
    }
  }, [
    settings.coverEnrollmentText,
    settings.controlInboxId,
    settings.controlInboxReceiveCapability,
    settings.mailboxUrl,
    settings.pauseLiftedAt,
  ]);

  useEffect(() => {
    if (!reserveUnlocked) return;
    void readPause();
    const timer = window.setInterval(() => void readPause(), 60_000);
    return () => window.clearInterval(timer);
  }, [readPause, reserveUnlocked]);

  async function inspect(connected: BrowserWallet): Promise<void> {
    setWalletState((current) =>
      current.name === "ready" ? current : { name: "checking" },
    );
    try {
      const status = await inspectReadyCoverAccount({
        wallet: connected,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
      });
      if (
        settings.reserveAccount !== null &&
        !sameFelt(settings.reserveAccount, status.account)
      ) {
        setWalletState({
          name: "blocked",
          reason:
            "This is not the account chosen for your home vault. Switch Ready Wallet back to that account and try again.",
        });
        return;
      }
      setWalletState({ name: "ready", status });
      if (settings.reserveAccount === null) {
        writeSettings({ reserveAccount: status.account });
      }
      void readRail(connected);
    } catch (caught) {
      const reason = reasonFrom(caught);
      setWalletState((current) =>
        current.name === "ready" ? current : { name: "blocked", reason },
      );
    }
  }

  /** One read for the whole rail: known or not, both balances, the live fee. */
  async function readRail(connected: BrowserWallet): Promise<void> {
    setRail((current) =>
      current.name === "ready" || current.name === "unregistered"
        ? current
        : { name: "reading" },
    );
    try {
      const readiness = await inspectReadyPrivateReadiness({
        wallet: connected,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
      });
      if (settings.reserveAccount === null) {
        throw new Error("Reconnect the Ready Wallet account chosen for your home vault.");
      }
      assertSelectedWalletAccount(connected, settings.reserveAccount);
      setRail(
        readiness.registered
          ? { name: "ready", readiness }
          : { name: "unregistered", readiness },
      );
    } catch (caught) {
      setRail({ name: "failed", reason: reasonFrom(caught) });
    }
  }

  /**
   * Waits out a deposit without inventing a percentage.
   *
   * Two things have to happen and they are not the same moment: the deposit
   * confirms, and the balance behind it becomes usable. So this watches the
   * transaction first and then keeps re-reading the rail until it says yes.
   */
  useEffect(() => {
    if (!reserveUnlocked || rail.name !== "settling" || wallet === null) return;
    let active = true;
    const hash = rail.transactionHash;
    const baseline = rail.baselineShieldedFri;
    const tick = async (): Promise<void> => {
      try {
        const state = await readCoverTransactionState({ transactionHash: hash });
        if (!active) return;
        if (state.state === "reverted") {
          setRail({
            name: "failed",
            reason: "The deposit did not go through. Try again.",
          });
          return;
        }
        if (state.state !== "confirmed") return;
        const readiness = await inspectReadyPrivateReadiness({
          wallet,
          poolAddress: WRENCHLESS_MAINNET.poolAddress,
          tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
        });
        if (!active) return;
        // Registered is not enough, and neither is a balance that was already
        // there. The deposit is usable when the live figure has actually risen
        // above what this account held before it was sent.
        if (
          readiness.registered &&
          BigInt(readiness.shieldedBalanceFri) > BigInt(baseline)
        ) {
          setRail({ name: "ready", readiness });
          setLive("Private balance ready");
          setView("home");
        }
      } catch {
        // Left settling: an unreachable node is not evidence of failure.
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 8_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [rail, reserveUnlocked, wallet]);

  const unlockReserve = async (): Promise<void> => {
    if (
      !passkeyAvailable ||
      settings.devicePasskeyId === null ||
      settings.devicePasskeyPublicKey === null
    ) {
      return;
    }
    setPasskeyGate({ name: "checking" });
    setLive("Waiting for this device");
    try {
      await verifyDevicePasskey({
        credentialId: settings.devicePasskeyId,
        publicKey: settings.devicePasskeyPublicKey,
      });
      setPasskeyGate({ name: "open" });
      setLive(null);
    } catch (caught) {
      setPasskeyGate({ name: "failed", reason: reasonFrom(caught) });
      setLive("Not accepted");
    }
  };

  const connect = async (): Promise<void> => {
    setWalletState({ name: "connecting" });
    setLive("Waiting for Ready Wallet");
    try {
      const connected = await requestWalletAccount();
      setWallet(connected.wallet);
      setLive(null);
      await inspect(connected.wallet);
    } catch (caught) {
      setWalletState({ name: "blocked", reason: reasonFrom(caught) });
      setLive(null);
    }
  };

  const saveLimit = (): void => {
    const parsed = parseStrkAmount(limit);
    if (!parsed.ok) {
      setLimitError(parsed.message);
      return;
    }
    setLimitError(null);
    writeSettings({ exposureCapFri: parsed.fri });
    setLive("Limit saved");
    setView("home");
  };

  const liftPause = (): void => {
    writeSettings({ pauseLiftedAt: new Date().toISOString() });
    setPause({ active: false, blockedUntil: pause.blockedUntil });
    setLive("Pause lifted");
  };

  const startDeposit = async (): Promise<void> => {
    if (wallet === null) return;
    const fee = railFeeFri();
    const baseline = railShieldedFri();
    if (fee === null || baseline === null) {
      setDepositError("Read your reserve first.");
      return;
    }
    const parsed = parseStrkAmount(deposit);
    if (!parsed.ok) {
      setDepositError(parsed.message);
      return;
    }
    // Checked here rather than left to the handoff: a person should not open
    // Ready Wallet only to be told the figure was never going to work.
    if (BigInt(parsed.fri) < BigInt(minimumReadyPrivateDepositFri(fee))) {
      setDepositError(
        `Move at least ${formatStrk(minimumReadyPrivateDepositFri(fee))} STRK.`,
      );
      return;
    }
    setDepositError(null);
    setRail({ name: "approving" });
    setLive("Ready Wallet asks for approval, then the deposit");
    try {
      if (settings.reserveAccount === null) {
        throw new Error("Reconnect the Ready Wallet account chosen for your home vault.");
      }
      assertSelectedWalletAccount(wallet, settings.reserveAccount);
      const submitted = await submitReadyPrivateDeposit({
        wallet,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
        amountFri: parsed.fri,
        poolFeeFri: fee,
      });
      setRail({
        name: "settling",
        transactionHash: submitted.transactionHash,
        baselineShieldedFri: baseline,
      });
      setLive("Private balance is settling");
    } catch (caught) {
      setRail({ name: "failed", reason: reasonFrom(caught) });
      setLive(null);
    }
  };

  /**
   * Picks the next request to use, from what the carried phone left here.
   *
   * One at a time, deliberately. Funding all three would put three restores in
   * flight against one wallet's limit, and the phone can only collect them one
   * by one anyway. If one is already funded and uncollected, that is the answer
   * — there is nothing to send until it lands or expires.
   */
  const findSlot = useCallback(async (): Promise<void> => {
    setSlot({ name: "finding" });
    const stored = settings.refillStateIds;
    if (stored.length === 0) {
      setSlot({ name: "none" });
      return;
    }
    try {
      let nextReady: VaultRefillIntent | null = null;
      for (const stateId of stored) {
        const state = await readRefillChainState({
          helperAddress: WRENCHLESS_MAINNET.helperAddress,
          stateId,
        });
        if (state === null) {
          nextReady ??= await readVaultRefillIntent(stateId);
          continue;
        }
        if (state.status === "funded") {
          setSlot({ name: "waiting", stateId, state });
          return;
        }
      }
      setSlot(
        nextReady === null ? { name: "none" } : { name: "ready", intent: nextReady },
      );
    } catch (caught) {
      setSlot({ name: "failed", reason: reasonFrom(caught) });
    }
  }, [settings.refillStateIds]);

  useEffect(() => {
    if (!reserveUnlocked || view !== "restore") return;
    void findSlot();
  }, [findSlot, reserveUnlocked, view]);

  /** The way back from a pairing that went wrong. Not the everyday path. */
  const importCode = async (): Promise<void> => {
    const parsed = parseCarriedReceipt(codeText);
    if (!parsed.ok) {
      setCodeError(parsed.message);
      return;
    }
    setCodeError(null);
    try {
      const intents = await importCarriedRestoreRequests(
        parsed.receipt.restoreRequests,
      );
      for (const intent of intents) rememberRefillStateId(intent.stateId);
      writeSettings({ carriedDeviceCode: parsed.receipt.confirmationCode });
      setCodeText("");
      setLive("Code read");
      await findSlot();
    } catch (caught) {
      setCodeError(reasonFrom(caught));
    }
  };

  /**
   * Prepares the proof for what has to arrive, not for what was chosen.
   *
   * The figure on the chips is spending money on the other phone. Getting it
   * there costs that phone a fee of its own, so what this sends has to be the
   * chosen amount plus one live fee — otherwise the restore lands a fee short
   * and the person is left with money they cannot move.
   */
  const prepare = async (bound: VaultRefillIntent): Promise<void> => {
    if (wallet === null) return;
    const fee = railFeeFri();
    if (fee === null) {
      setFund({
        name: "failed",
        reason: "The live fee has not been read yet. Show your reserve first.",
      });
      return;
    }
    setFund({ name: "proving" });
    setLive("Preparing in Ready Wallet");
    try {
      if (settings.reserveAccount === null) {
        throw new Error("Reconnect the Ready Wallet account chosen for your home vault.");
      }
      assertSelectedWalletAccount(wallet, settings.reserveAccount);
      // Checked here and again before it is sent. A pause that arrives while a
      // proof is being built must not be the one this screen missed.
      setPause(await assertNewRestoreAllowed({ settings }));
      const artifact = await prepareReadyRefillFundArtifact({
        wallet,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        helperAddress: WRENCHLESS_MAINNET.helperAddress,
        stateId: bound.stateId,
        claimCommitment: bound.claimCommitment,
        refundPublicKey: bound.refundPublicKey,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
        amountFri: requiredPrivateRefillFri(amountFri, fee),
        expiry: unixSecondsFromNow(hours),
      });
      setFund({ name: "review", artifact, spendingFri: amountFri, feeFri: fee });
      setLive(null);
    } catch (caught) {
      setFund({ name: "failed", reason: reasonFrom(caught) });
      setLive(null);
      void readPause();
    }
  };

  /**
   * Sends it, and says so honestly.
   *
   * The wallet handoff finished when the proof was prepared. What happens now
   * is one HTTP call to a service that broadcasts from an account unrelated to
   * this one, so the screen must not keep saying it is waiting for Ready
   * Wallet — nobody is going to be asked for anything.
   */
  const send = async (
    artifact: RefillFundArtifact,
    spendingFri: string,
    feeFri: string,
  ): Promise<void> => {
    setFund({ name: "sending", artifact, spendingFri, feeFri });
    setLive("Sending privately");
    try {
      setPause(await assertNewRestoreAllowed({ settings }));
      const result = await submitRelayedRefillFund({
        sponsorUrl: settings.sponsorUrl,
        artifact,
      });
      recordSubmission("reserve", {
        transactionHash: result.transactionHash,
        kind: "funding",
        amountFri: artifact.amountFri,
        recipient: null,
        submittedAt: new Date().toISOString(),
      });
      setFund({
        name: "sent",
        transactionHash: result.transactionHash,
        final: result.status === "finalized",
      });
      setLive("Restore sent");
      if (wallet !== null) void readRail(wallet);
    } catch (caught) {
      setFund({ name: "failed", reason: reasonFrom(caught) });
      setLive(null);
      void readPause();
    }
  };

  const takeBack = async (stateId: string): Promise<void> => {
    if (wallet === null || walletState.name !== "ready") return;
    setLive("Waiting for Ready Wallet");
    try {
      if (settings.reserveAccount === null) {
        throw new Error("Reconnect the Ready Wallet account chosen for your home vault.");
      }
      assertSelectedWalletAccount(wallet, settings.reserveAccount);
      const result = await refundStoredVaultRefill({
        wallet,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        helperAddress: WRENCHLESS_MAINNET.helperAddress,
        recipient: walletState.status.account,
        stateId,
      });
      recordSubmission("reserve", {
        transactionHash: result.transactionHash,
        kind: "refund",
        amountFri: slot.name === "waiting" ? slot.state.amountFri : "0",
        recipient: null,
        submittedAt: new Date().toISOString(),
      });
      setLive("Returned");
      await findSlot();
    } catch (caught) {
      setSlot({ name: "failed", reason: reasonFrom(caught) });
      setLive(null);
    }
  };

  const shell = (body: JSX.Element): JSX.Element => (
    <ProductFrame
      detail={
        walletState.name === "ready"
          ? shortHex(walletState.status.account)
          : "Not connected"
      }
      label="Home vault"
      role="vault"
    >
      {body}
    </ProductFrame>
  );

  /* ---------- passkey ---------- */

  if (!setupComplete) {
    return shell(
      <Screen center title="Opening setup">
        <Emblem>
          <KeyIcon />
        </Emblem>
      </Screen>,
    );
  }

  if (!passkeyAvailable) {
    return shell(
      <Screen
        center
        lede="This vault opens with the passkey saved on this device."
        title="Open your home vault"
      >
        <Emblem>
          <KeyIcon />
        </Emblem>
        <StatusLine icon={<WarningCircleIcon />} tone="alert">
          Open this page on localhost or over HTTPS. A passkey cannot be used on
          an IP address.
        </StatusLine>
      </Screen>,
    );
  }

  if (!reserveUnlocked) {
    return shell(
      <Screen
        center
        lede="Use the passkey saved on this device."
        title="Open your home vault"
      >
        <Emblem>
          <KeyIcon />
        </Emblem>
        {passkeyGate.name === "failed" ? (
          <Note tone="caution">{passkeyGate.reason}</Note>
        ) : null}
        <Actions>
          <Button
            disabled={passkeyGate.name === "checking"}
            icon={<KeyIcon />}
            label={passkeyGate.name === "checking" ? "Waiting" : "Use passkey"}
            onClick={() => void unlockReserve()}
          />
        </Actions>
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- connect ---------- */

  if (walletState.name !== "ready" || wallet === null) {
    return shell(
      <Screen
        center
        lede="Use the account that stays at home, not the one you carry."
        title="Connect your reserve"
      >
        <Emblem>
          <VaultIcon />
        </Emblem>
        {walletState.name === "blocked" ? (
          <Note tone="caution">{walletState.reason}</Note>
        ) : null}
        <Actions>
          <Button
            disabled={
              walletState.name === "connecting" || walletState.name === "checking"
            }
            icon={<ReadyWalletMark className="ready-wallet-mark" />}
            label={
              walletState.name === "connecting"
                ? "Waiting for Ready Wallet"
                : walletState.name === "checking"
                  ? "Checking"
                  : walletState.name === "blocked"
                    ? "Try again"
                    : "Connect Ready Wallet"
            }
            onClick={() => void connect()}
          />
        </Actions>
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- setting up the private balance ---------- */

  if (view === "deposit") {
    if (rail.name === "approving" || rail.name === "settling") {
      return shell(
        <Screen
          center
          lede={
            rail.name === "approving"
              ? "Ready Wallet asks you to approve it, then to deposit."
              : "Nothing else to do. This finishes on its own."
          }
          title={
            rail.name === "approving"
              ? "Approve in Ready Wallet"
              : "Private balance is settling"
          }
        >
          <Emblem>
            <ReadyWalletMark className="ready-wallet-mark" />
          </Emblem>
          <Waiting seconds={null} />
          {rail.name === "settling" ? (
            <p className="wlive">
              <a
                className="wref"
                href={`${EXPLORER_BASE}${rail.transactionHash}`}
                rel="noreferrer"
                target="_blank"
              >
                {shortHex(rail.transactionHash)}
              </a>
            </p>
          ) : null}
          <Live message={live} />
        </Screen>,
      );
    }

    const publicFri = BigInt(walletState.status.publicBalanceFri);
    const parsedDeposit = parseStrkAmount(deposit);
    const tooMuch = parsedDeposit.ok && BigInt(parsedDeposit.fri) > publicFri;
    const fee = railFeeFri();
    const minimumDeposit = fee === null ? null : minimumReadyPrivateDepositFri(fee);
    const short = minimumDeposit !== null && publicFri < BigInt(minimumDeposit);

    return shell(
      <Screen
        lede="Moved from this account into the balance restores are sent from."
        onBack={() => setView("home")}
        title="Set up private balance"
      >
        {rail.name === "failed" ? (
          <>
            <StatusLine icon={<WarningCircleIcon />} tone="alert">
              Nothing was moved. Try again.
            </StatusLine>
            <TechnicalDetail>{rail.reason}</TechnicalDetail>
          </>
        ) : null}

        {short && minimumDeposit !== null ? (
          <StatusLine icon={<WarningCircleIcon />}>
            This account holds less than the {formatStrk(minimumDeposit)} STRK
            needed. Add STRK to it first.
          </StatusLine>
        ) : null}

        <p className="eyebrow">Amount</p>
        <ul className="wchips" role="group">
          {(minimumDeposit === null
            ? DEPOSIT_SUGGESTIONS
            : amountChoices(minimumDeposit, DEPOSIT_SUGGESTIONS)
          ).map((value) => (
            <li key={value}>
              <button
                aria-pressed={deposit === value}
                className="wchip"
                onClick={() => {
                  setDeposit(value);
                  setDepositError(null);
                }}
                type="button"
              >
                {value}
              </button>
            </li>
          ))}
        </ul>

        <form
          className="wform"
          onSubmit={(event) => {
            event.preventDefault();
            void startDeposit();
          }}
        >
          <WalletField
            error={depositError ?? (tooMuch ? "More than this account holds." : null)}
            {...(minimumDeposit === null
              ? {}
              : { hint: `At least ${formatStrk(minimumDeposit)} STRK.` })}
            label="Amount in STRK"
          >
            {({ inputId, describedBy }) => (
              <input
                aria-describedby={describedBy}
                className="winput winput--mono"
                id={inputId}
                inputMode="decimal"
                onChange={(event) => setDeposit(event.target.value)}
                type="text"
                value={deposit}
              />
            )}
          </WalletField>
          <Facts>
            <Fact
              label="In this account"
              value={
                <Amount
                  value={formatStrkFigure(walletState.status.publicBalanceFri)}
                />
              }
            />
            <Fact label="Network fee" value="Shown by Ready Wallet" />
          </Facts>
          <Actions>
            <Button
              disabled={tooMuch || short}
              icon={<ReadyWalletMark className="ready-wallet-mark" />}
              label="Continue"
              type="submit"
            />
          </Actions>
        </form>
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- the limit ---------- */

  if (view === "limit") {
    return shell(
      <Screen
        lede="The carried wallet will never hold more than this."
        onBack={() => setView("home")}
        title="Carried limit"
      >
        <form
          className="wform"
          onSubmit={(event) => {
            event.preventDefault();
            saveLimit();
          }}
        >
          <WalletField
            error={limitError}
            hint={`Now ${formatStrk(settings.exposureCapFri)} STRK.`}
            label="Carried limit in STRK"
          >
            {({ inputId, describedBy }) => (
              <input
                aria-describedby={describedBy}
                className="winput winput--mono"
                id={inputId}
                inputMode="decimal"
                onChange={(event) => setLimit(event.target.value)}
                type="text"
                value={limit}
              />
            )}
          </WalletField>
          <Actions>
            <Button label="Save limit" type="submit" />
          </Actions>
        </form>
        <Note>
          The carried phone reads the new limit the next time it is paired.
        </Note>
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- sending a restore ---------- */

  if (view === "restore") {
    if (fund.name === "sent") {
      return shell(
        <Screen title="Restore sent">
          <Emblem>
            <CheckCircleIcon />
          </Emblem>
          <StatusLine icon={<CheckCircleIcon />}>
            {fund.final
              ? "It is on the chain. They can collect it now."
              : "It is not there until this confirms."}
          </StatusLine>
          <p className="wlive">
            <a
              className="wref"
              href={`${EXPLORER_BASE}${fund.transactionHash}`}
              rel="noreferrer"
              target="_blank"
            >
              {shortHex(fund.transactionHash)}
            </a>
          </p>
          <Actions>
            <Button
              label="Done"
              onClick={() => {
                setFund({ name: "idle" });
                setView("home");
              }}
            />
          </Actions>
          <Live message={live} />
        </Screen>,
      );
    }

    if (fund.name === "review" || fund.name === "sending") {
      const sending = fund.name === "sending";
      return shell(
        <Screen
          onBack={sending ? undefined : () => setFund({ name: "idle" })}
          title="Review"
        >
          {/* The dominant figure is what they asked for and what the other
              phone will be able to spend. The debit underneath is what leaves
              here: the same amount plus the two live fees it has to clear on
              the way — one to send it, one for the wallet to move it. */}
          <p className="balance__figure">
            <Amount size="lead" value={formatStrkFigure(fund.spendingFri)} />
          </p>
          <Facts>
            <Fact
              label="Collect before"
              value={formatUnixSeconds(fund.artifact.expiry)}
            />
            <Fact
              label="Taken from your reserve"
              strong
              value={
                <Amount
                  value={formatStrkFigure(
                    totalVaultRefillDebitFri(fund.spendingFri, fund.feeFri),
                  )}
                />
              }
            />
            <Fact label="Network fee" value="Paid by the restore service" />
          </Facts>
          <Note>Includes private transfer fees.</Note>
          <Actions>
            <Button
              disabled={sending}
              icon={<PaperPlaneTiltIcon />}
              label={sending ? "Sending privately" : "Send it"}
              onClick={() =>
                void send(fund.artifact, fund.spendingFri, fund.feeFri)
              }
            />
          </Actions>
          {sending ? <Waiting seconds={null} /> : null}
          <Live message={live} />
        </Screen>,
      );
    }

    return shell(
      <Screen
        lede="Their phone left one-time requests here when it paired."
        onBack={() => setView("home")}
        title="Send a restore"
      >
        {pause.active && pause.blockedUntil !== null ? (
          <StatusLine icon={<PauseIcon />} tone="alert">
            New restores are paused · {remaining(pause.blockedUntil)}
          </StatusLine>
        ) : null}

        {slot.name === "finding" ? <Waiting seconds={null} /> : null}

        {slot.name === "none" ? (
          <Empty
            body="Pair the carried phone again so it can leave one here."
            title="Nothing to send against"
          />
        ) : null}

        {slot.name === "failed" ? (
          <>
            <StatusLine icon={<WarningCircleIcon />} tone="alert">
              This could not be prepared just now.
            </StatusLine>
            <TechnicalDetail>{slot.reason}</TechnicalDetail>
            <Actions>
              <Button label="Try again" onClick={() => void findSlot()} tone="quiet" />
            </Actions>
          </>
        ) : null}

        {slot.name === "waiting" ? (
          <>
            <StatusLine icon={<CheckCircleIcon />}>
              A restore is already waiting for them to collect.
            </StatusLine>
            <Facts>
              <Fact label="State" value={describe(slot.state)} />
              <Fact
                label="Amount"
                value={<Amount value={formatStrkFigure(slot.state.amountFri)} />}
              />
              <Fact
                label="Collect before"
                value={formatUnixSeconds(slot.state.expiry)}
              />
            </Facts>
            {BigInt(slot.state.expiry) < BigInt(Math.floor(Date.now() / 1000)) ? (
              <Actions>
                <Button
                  icon={<ArrowsClockwiseIcon />}
                  label="Take it back"
                  onClick={() => void takeBack(slot.stateId)}
                />
              </Actions>
            ) : (
              <Note>
                Send another once this one is collected, or take it back after
                its deadline.
              </Note>
            )}
            <Actions>
              <Button label="Check again" onClick={() => void findSlot()} tone="quiet" />
            </Actions>
          </>
        ) : null}

        {slot.name === "ready" ? (
          <>
            <p className="eyebrow">Amount</p>
            <ul className="wchips" role="group">
              {restoreAmounts.map((choice) => (
                <li key={choice.fri}>
                  <button
                    aria-pressed={amountFri === choice.fri}
                    className="wchip"
                    onClick={() => {
                      setAmountFri(choice.fri);
                      setFund({ name: "idle" });
                    }}
                    type="button"
                  >
                    {choice.label}
                  </button>
                </li>
              ))}
            </ul>

            <p className="eyebrow">Collect within</p>
            <ul className="wchips" role="group">
              {WINDOWS.map((option) => (
                <li key={option.hours}>
                  <button
                    aria-pressed={hours === option.hours}
                    className="wchip"
                    onClick={() => setHours(option.hours)}
                    type="button"
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>

            {rail.name === "ready" ? (
              <Facts>
                <Fact
                  label="Fee, read live"
                  value={<Amount value={formatStrk(rail.readiness.poolFeeFri)} />}
                />
                <Fact
                  label="Your reserve"
                  value={
                    <Amount
                      value={formatStrkFigure(rail.readiness.shieldedBalanceFri)}
                    />
                  }
                />
              </Facts>
            ) : null}

            {fund.name === "failed" ? (
              <>
                <StatusLine icon={<WarningCircleIcon />} tone="alert">
                  Nothing was sent.
                </StatusLine>
                <TechnicalDetail>{fund.reason}</TechnicalDetail>
              </>
            ) : null}

            <Actions>
              <Button
                disabled={fund.name === "proving" || pause.active}
                icon={<ArrowsClockwiseIcon />}
                label={
                  pause.active
                    ? "Paused"
                    : fund.name === "proving"
                      ? `Preparing in Ready Wallet · ${elapsed}s`
                      : "Prepare"
                }
                onClick={() => void prepare(slot.intent)}
              />
            </Actions>
            {fund.name === "proving" ? (
              <>
                <Waiting seconds={elapsed} />
                <Note>This can take a while and is normal. Leave it open.</Note>
              </>
            ) : null}
          </>
        ) : null}

        {/* Recovery, not the everyday path: a pairing that half-finished can be
            completed from the code the phone still shows. */}
        <details className="detail">
          <summary>Their phone still shows a code</summary>
          <form
            className="wform"
            onSubmit={(event) => {
              event.preventDefault();
              void importCode();
            }}
          >
            <WalletField error={codeError} label="Code from the carried phone">
              {({ inputId, describedBy }) => (
                <textarea
                  aria-describedby={describedBy}
                  className="winput winput--paste"
                  id={inputId}
                  onChange={(event) => setCodeText(event.target.value)}
                  placeholder="wrr2_…"
                  rows={3}
                  spellCheck={false}
                  value={codeText}
                />
              )}
            </WalletField>
            <Actions>
              <Button
                disabled={codeText.trim().length === 0}
                label="Read code"
                tone="quiet"
                type="submit"
              />
            </Actions>
          </form>
        </details>

        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- home ---------- */

  const railReady = rail.name === "ready";

  return shell(
    <Screen>
      {pause.active && pause.blockedUntil !== null ? (
        <StatusLine icon={<PauseIcon />} tone="alert">
          New restores paused · {remaining(pause.blockedUntil)}
        </StatusLine>
      ) : null}

      <Balance
        caption="Reserve balance"
        value={
          rail.name === "ready" || rail.name === "unregistered"
            ? formatStrkFigure(rail.readiness.shieldedBalanceFri)
            : null
        }
      />

      {rail.name === "unregistered" ? (
        <>
          <StatusLine icon={<WarningCircleIcon />}>
            This account cannot send a private restore yet.
          </StatusLine>
          <Actions>
            <Button
              icon={<ReadyWalletMark className="ready-wallet-mark" />}
              label="Set up private balance"
              onClick={() => setView("deposit")}
            />
          </Actions>
        </>
      ) : null}

      {rail.name === "settling" ? (
        <StatusLine icon={<ArrowsClockwiseIcon />}>
          Private balance is settling.
        </StatusLine>
      ) : null}

      {rail.name === "unknown" || rail.name === "reading" ? (
        <Actions>
          <Button
            disabled={rail.name === "reading"}
            label={rail.name === "reading" ? "Reading" : "Show reserve"}
            onClick={() => void readRail(wallet)}
            tone="quiet"
          />
        </Actions>
      ) : null}

      {rail.name === "failed" ? (
        <>
          <Note tone="caution">
            Your reserve could not be read. Allow it in Ready Wallet, then try
            again.
          </Note>
          <TechnicalDetail>{rail.reason}</TechnicalDetail>
          <Actions>
            <Button label="Try again" onClick={() => void readRail(wallet)} tone="quiet" />
          </Actions>
        </>
      ) : null}

      <Facts>
        <Fact
          label="Carried limit"
          value={<Amount value={formatStrkFigure(settings.exposureCapFri)} />}
        />
        <Fact
          label="Carried phone"
          value={carriedPaired ? "Paired" : "Not paired"}
        />
        <Fact label="Guardian" value={guardianPaired ? "Paired" : "Not paired"} />
        <Fact
          label="In this account"
          value={
            <Amount value={formatStrkFigure(walletState.status.publicBalanceFri)} />
          }
        />
      </Facts>

      <Actions>
        <Button
          icon={<GearSixIcon />}
          label="Edit limit"
          onClick={() => setView("limit")}
        />
        <Button
          disabled={!railReady || !carriedPaired}
          icon={<PaperPlaneTiltIcon />}
          label="Send a restore"
          onClick={() => setView("restore")}
        />
        {pause.active ? (
          <Button
            icon={<ArrowsClockwiseIcon />}
            label="Lift pause"
            onClick={liftPause}
          />
        ) : null}
      </Actions>

      {railReady && !carriedPaired ? (
        <Note>Pair the carried phone before sending a restore.</Note>
      ) : null}

      <Section title="Recent" />
      {records.length === 0 ? (
        <Empty
          body="Restores sent from this reserve appear here."
          title="Nothing yet"
        />
      ) : (
        <ul className="wlist">
          {records.slice(0, 6).map((row) => (
            <li className="wlist__row" key={row.transactionHash}>
              <div className="wlist__main">
                <p className="wlist__kind">{ACTIVITY_LABEL[row.kind]}</p>
                <p className="wlist__meta">
                  <a
                    className="wref"
                    href={`${EXPLORER_BASE}${row.transactionHash}`}
                    rel="noreferrer"
                    target="_blank"
                    title={row.transactionHash}
                  >
                    {shortHex(row.transactionHash)}
                  </a>
                </p>
              </div>
              <div className="wlist__side">
                <p className="wlist__amount">
                  <Amount
                    sign={row.kind === "refund" ? "+" : "−"}
                    value={formatStrkFigure(row.amountFri)}
                  />
                </p>
                <p className="wlist__status" data-status={row.status}>
                  {row.status === "confirmed"
                    ? "Complete"
                    : row.status === "reverted"
                      ? "Failed"
                      : "Confirming"}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Live message={live} />
    </Screen>,
  );
}
