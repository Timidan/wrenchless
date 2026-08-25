import {
  chooseTravelSafeRelease,
  computeRefillRecoveryCommitment,
  deriveTravelSafeSecrets,
  generateTravelSafePhrase,
  type TravelSafeTicket,
} from "@wrenchless/canary-core";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createDevicePasskey,
  devicePasskeysAvailable,
  PasskeyPrfUnavailableError,
  verifyDevicePasskey,
} from "../../adapters/device-passkey";
import {
  formatStrkExact,
  parseStrkAmount,
  reasonFrom,
} from "../../adapters/amount";
import { requestWalletAccount, type BrowserWallet } from "../../adapters/wallet";
import { readSettings, useSettings, writeSettings } from "../../adapters/settings";
import { WRENCHLESS_MAINNET } from "../../lib/product-config";
import {
  fundTravelSafe,
  recoverTravelSafe,
  returnRecoveredTravelSafe,
  returnTravelSafe,
  type TravelSafeRecoveryResult,
} from "../../lib/refill-operations";
import {
  inspectTravelSafeReadiness,
  type TravelSafeReadiness,
} from "../../lib/ready-private-setup";
import { requestReadyRecoveryLocator } from "../../lib/ready-recovery";
import {
  readRefillChainSnapshot,
  readTransactionReceiptStatus,
  type RefillChainSnapshot,
  type RefillChainState,
} from "../../lib/refill-state";
import {
  clearTravelSafeTicket,
  createTravelSafeTicket,
  readActiveTravelSafeTicket,
  readTravelSafeTicket,
  transitionStoredTravelSafeTicket,
  unlockTravelSafeTicketStorage,
} from "../../lib/refill-ticket";
import {
  inspectRefillSponsor,
  RelayedRefillFundError,
} from "../../lib/relayed-refill";
import {
  sameFelt,
  validateTravelSafeAmount,
  validateTravelSafeReturnDate,
} from "../../lib/travel-safe";

const RETURN_RECEIPT_WINDOW_BLOCKS = 120n;

export type SafeHomeState =
  | { name: "loading" }
  | { name: "no-local-safe" }
  | { name: "device-locked"; reason: string | null }
  | { name: "setup-incomplete"; ticket: TravelSafeTicket }
  | { name: "parking"; ticket: TravelSafeTicket }
  | { name: "locked"; ticket: TravelSafeTicket; snapshot: RefillChainSnapshot }
  | { name: "return-ready"; ticket: TravelSafeTicket; snapshot: RefillChainSnapshot }
  | { name: "returning"; ticket: TravelSafeTicket }
  | { name: "returned"; ticket: TravelSafeTicket; snapshot: RefillChainSnapshot }
  | { name: "released-early"; ticket: TravelSafeTicket; snapshot: RefillChainSnapshot }
  | {
      name: "ready-recovery-submitted";
      transactionHash: string;
      amountFri: string;
    }
  | { name: "local-unavailable"; reason: string }
  | { name: "chain-unavailable"; reason: string };

export type CreateStep =
  | "closed"
  | "connect"
  | "details"
  | "review"
  | "parking";

export type TravelSafeViewModel = {
  home: SafeHomeState;
  createStep: CreateStep;
  walletAccount: string | null;
  readiness: TravelSafeReadiness | null;
  amount: string;
  returnDateLocal: string;
  earlyRecoveryBackup: string | null;
  error: string | null;
  live: string | null;
  elapsedSeconds: number;
};

export type TravelSafeActions = {
  startCreate(): void;
  closeCreate(): void;
  connect(): Promise<void>;
  setAmount(value: string): void;
  setReturnDateLocal(value: string): void;
  continueFromDetails(): Promise<void>;
  back(): void;
  park(): Promise<void>;
  unlock(): Promise<void>;
  refresh(): Promise<void>;
  bringBack(): Promise<void>;
  bringBackEarly(): Promise<void>;
  createEarlyRecoveryBackup(): Promise<void>;
  dismissEarlyRecoveryBackup(): void;
  clearTerminal(): Promise<void>;
  forgetLocal(): Promise<void>;
};

export type TravelSafeController = {
  model: TravelSafeViewModel;
  actions: TravelSafeActions;
};

function passkeyFromSettings(): { credentialId: string; publicKey: string } | null {
  const settings = readSettings();
  if (
    settings.devicePasskeyId === null ||
    settings.devicePasskeyPublicKey === null
  ) {
    return null;
  }
  return {
    credentialId: settings.devicePasskeyId,
    publicKey: settings.devicePasskeyPublicKey,
  };
}

async function createOrVerifyPasskey(account: string): Promise<void> {
  const existing = passkeyFromSettings();
  if (existing !== null) {
    try {
      await unlockTravelSafeTicketStorage(await verifyDevicePasskey(existing));
      return;
    } catch (error) {
      if (!(error instanceof PasskeyPrfUnavailableError)) throw error;
      if (readSettings().activeSafeStateId !== null) {
        throw new Error(
          "This saved passkey predates secure Travel Safe storage. Recover or clear the existing Safe before creating another.",
        );
      }
      writeSettings({ devicePasskeyId: null, devicePasskeyPublicKey: null });
    }
  }
  const created = await createDevicePasskey(`Travel Safe ${account.slice(0, 8)}`);
  const passkeySecret = await verifyDevicePasskey(created);
  writeSettings({
    devicePasskeyId: created.credentialId,
    devicePasskeyPublicKey: created.publicKey,
  });
  await unlockTravelSafeTicketStorage(passkeySecret);
}

async function readSafeSnapshot(stateId: string): Promise<RefillChainSnapshot> {
  return readRefillChainSnapshot({
    helperAddress: WRENCHLESS_MAINNET.helperAddress,
    stateId,
    rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
  });
}

async function assertTicketMatchesChainState(
  ticket: TravelSafeTicket,
  state: RefillChainState,
): Promise<void> {
  const secrets = await deriveTravelSafeSecrets(ticket.recoveryPhrase);
  if (
    !sameFelt(ticket.stateId, state.stateId) ||
    !sameFelt(secrets.claimCommitment, state.claimCommitment) ||
    !sameFelt(
      computeRefillRecoveryCommitment(
        ticket.stateId,
        ticket.recoveryAccount,
        secrets.recoverySalt,
      ),
      state.recoveryCommitment,
    ) ||
    !sameFelt(ticket.tokenAddress, state.tokenAddress) ||
    BigInt(ticket.amountFri) !== BigInt(state.amountFri) ||
    BigInt(ticket.returnDateSeconds) !== BigInt(state.returnDateSeconds)
  ) {
    throw new Error("The onchain Travel Safe does not match this device");
  }
}

async function resetFundSubmission(
  ticket: TravelSafeTicket,
): Promise<TravelSafeTicket> {
  return transitionStoredTravelSafeTicket(ticket.stateId, "READY", {
    fundProofExpiresAtBlock: null,
    fundTransactionHash: null,
  });
}

const LEGACY_HASHLESS_FUND_RETRY_DELAY_MS = 24 * 60 * 60 * 1_000;

function legacyHashlessFundCanRetry(ticket: TravelSafeTicket): boolean {
  const submittedAt = Date.parse(ticket.updatedAt);
  return (
    Number.isFinite(submittedAt) &&
    Date.now() - submittedAt >= LEGACY_HASHLESS_FUND_RETRY_DELAY_MS
  );
}

function localDateTimeInput(seconds: string): string {
  const date = new Date(Number(seconds) * 1_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

async function reconcileTicket(
  ticket: TravelSafeTicket,
  snapshot: RefillChainSnapshot,
): Promise<{ ticket: TravelSafeTicket; home: SafeHomeState }> {
  const state = snapshot.state;
  if (state === null) {
    if (ticket.status === "FUND_SUBMITTING") {
      let canRetry = false;
      if (ticket.fundTransactionHash !== null) {
        const receipt = await readTransactionReceiptStatus({
          transactionHash: ticket.fundTransactionHash,
          rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
        });
        if (receipt.name === "reverted") {
          const reset = await resetFundSubmission(ticket);
          return { ticket: reset, home: { name: "setup-incomplete", ticket: reset } };
        }
        canRetry =
          receipt.name === "not-found" &&
          ticket.fundProofExpiresAtBlock !== null &&
          BigInt(snapshot.blockNumber) > BigInt(ticket.fundProofExpiresAtBlock);
      } else if (ticket.fundProofExpiresAtBlock !== null) {
        canRetry =
          BigInt(snapshot.blockNumber) > BigInt(ticket.fundProofExpiresAtBlock);
      } else {
        // Tickets created before proof-expiry persistence have neither a hash nor
        // a reliable chain deadline. Give any accepted relay a full day to land.
        canRetry = legacyHashlessFundCanRetry(ticket);
      }
      if (canRetry) {
        const reset = await resetFundSubmission(ticket);
        return { ticket: reset, home: { name: "setup-incomplete", ticket: reset } };
      }
    }
    return {
      ticket,
      home:
        ticket.status === "FUND_SUBMITTING"
          ? { name: "parking", ticket }
          : { name: "setup-incomplete", ticket },
    };
  }
  await assertTicketMatchesChainState(ticket, state);
  let current = ticket;
  if (
    current.status === "READY" ||
    current.status === "FUND_SUBMITTING"
  ) {
    if (current.status === "READY") {
      current = await transitionStoredTravelSafeTicket(
        current.stateId,
        "FUND_SUBMITTING",
      );
    }
    current = await transitionStoredTravelSafeTicket(current.stateId, "FUNDED");
  }
  if (state.status !== "funded") {
    if (current.status !== "TERMINAL") {
      if (current.status === "RETURN_SUBMITTING" || current.status === "FUNDED") {
        current = await transitionStoredTravelSafeTicket(current.stateId, "TERMINAL");
      }
    }
    return {
      ticket: current,
      home:
        state.status === "refunded"
          ? { name: "returned", ticket: current, snapshot }
          : { name: "released-early", ticket: current, snapshot },
    };
  }
  if (current.status === "RETURN_SUBMITTING") {
    if (current.returnTransactionHash !== null) {
      const receipt = await readTransactionReceiptStatus({
        transactionHash: current.returnTransactionHash,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      if (
        receipt.name === "not-found" &&
        current.returnSubmittedAtBlock === null
      ) {
        current = await transitionStoredTravelSafeTicket(
          current.stateId,
          "RETURN_SUBMITTING",
          { returnSubmittedAtBlock: snapshot.blockNumber },
        );
        return { ticket: current, home: { name: "returning", ticket: current } };
      }
      const missingReceiptWindowElapsed =
        receipt.name === "not-found" &&
        current.returnSubmittedAtBlock !== null &&
        BigInt(snapshot.blockNumber) >
          BigInt(current.returnSubmittedAtBlock) + RETURN_RECEIPT_WINDOW_BLOCKS;
      if (receipt.name === "reverted" || missingReceiptWindowElapsed) {
        current = await transitionStoredTravelSafeTicket(
          current.stateId,
          "FUNDED",
          {
            returnSubmittedAtBlock: null,
            returnTransactionHash: null,
          },
        );
      } else {
        return { ticket: current, home: { name: "returning", ticket: current } };
      }
    } else {
      current = await transitionStoredTravelSafeTicket(
        current.stateId,
        "FUNDED",
        { returnSubmittedAtBlock: null },
      );
    }
  }
  return {
    ticket: current,
    home:
      chooseTravelSafeRelease(state.returnDateSeconds, snapshot.chainTimeSeconds) ===
      "refund"
        ? { name: "return-ready", ticket: current, snapshot }
        : { name: "locked", ticket: current, snapshot },
  };
}

export function useTravelSafe(): TravelSafeController {
  const settings = useSettings();
  const [home, setHome] = useState<SafeHomeState>({ name: "loading" });
  const [createStep, setCreateStep] = useState<CreateStep>("closed");
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<TravelSafeReadiness | null>(null);
  const [amount, setAmount] = useState("");
  const [returnDateLocal, setReturnDateLocal] = useState("");
  const [earlyRecoveryBackup, setEarlyRecoveryBackup] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (createStep !== "parking") return;
    setElapsedSeconds(0);
    const timer = window.setInterval(
      () => setElapsedSeconds((seconds) => seconds + 1),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [createStep]);

  useEffect(() => {
    if (settings.activeSafeStateId === null) {
      setHome({ name: "no-local-safe" });
      return;
    }
    if (!devicePasskeysAvailable()) {
      setHome({
        name: "device-locked",
        reason: "Open Wrenchless over HTTPS on a device that supports passkeys",
      });
      return;
    }
    setHome({ name: "device-locked", reason: null });
  }, [settings.activeSafeStateId]);

  const loadHome = useCallback(async (): Promise<void> => {
    let ticket: TravelSafeTicket | null;
    try {
      ticket = await readActiveTravelSafeTicket();
    } catch {
      setHome({
        name: "local-unavailable",
        reason: "This browser can no longer open its saved Travel Safe",
      });
      return;
    }
    if (ticket === null) {
      setHome({ name: "no-local-safe" });
      return;
    }
    try {
      const current = await readSafeSnapshot(ticket.stateId);
      const reconciled = await reconcileTicket(ticket, current);
      setHome(reconciled.home);
    } catch (caught) {
      setHome({ name: "chain-unavailable", reason: reasonFrom(caught) });
    }
  }, []);

  const connect = useCallback(async (): Promise<void> => {
    setError(null);
    setLive("Waiting for Ready");
    try {
      const connected = await requestWalletAccount();
      const [ready] = await Promise.all([
        inspectTravelSafeReadiness({
          wallet: connected.wallet,
          poolAddress: WRENCHLESS_MAINNET.poolAddress,
          tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
          rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
        }),
        inspectRefillSponsor({ sponsorUrl: readSettings().sponsorUrl }),
      ]);
      if (!ready.registered) {
        throw new Error("Set up Shielded Starknet in Ready, then check again");
      }
      if (!ready.canPark) {
        throw new Error("Add private STRK in Ready before creating a Travel Safe");
      }
      await createOrVerifyPasskey(ready.account);
      setWallet(connected.wallet);
      setWalletAccount(ready.account);
      setReadiness(ready);
      const active = await readActiveTravelSafeTicket();
      if (active === null) {
        setCreateStep("details");
      } else {
        setAmount(formatStrkExact(active.amountFri));
        setReturnDateLocal(localDateTimeInput(active.returnDateSeconds));
        setCreateStep("review");
      }
      setLive(null);
    } catch (caught) {
      setError(reasonFrom(caught));
      setLive(null);
    }
  }, []);

  const continueFromDetails = useCallback(async (): Promise<void> => {
    if (readiness === null) return;
    setError(null);
    const parsed = parseStrkAmount(amount);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    const dateMilliseconds = Date.parse(returnDateLocal);
    if (!Number.isFinite(dateMilliseconds)) {
      setError("Choose your return date and time");
      return;
    }
    const returnDateSeconds = Math.floor(dateMilliseconds / 1_000).toString();
    try {
      validateTravelSafeAmount(parsed.fri, readiness);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const phrase = generateTravelSafePhrase();
        const secrets = await deriveTravelSafeSecrets(phrase);
        const current = await readSafeSnapshot(secrets.stateId);
        validateTravelSafeReturnDate(
          returnDateSeconds,
          current.chainTimeSeconds,
        );
        if (current.state !== null) continue;
        await createTravelSafeTicket({
          secrets,
          recoveryPhrase: phrase,
          recoveryAccount: readiness.account,
          tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
          amountFri: parsed.fri,
          returnDateSeconds,
        });
        setCreateStep("review");
        return;
      }
      throw new Error("Could not create a unique Travel Safe. Try again");
    } catch (caught) {
      setError(reasonFrom(caught));
    }
  }, [amount, readiness, returnDateLocal]);

  const park = useCallback(async (): Promise<void> => {
    if (wallet === null) {
      setCreateStep("connect");
      return;
    }
    setError(null);
    setCreateStep("parking");
    setLive("Preparing privately in Ready");
    try {
      const ticket = await readActiveTravelSafeTicket();
      if (ticket === null) throw new Error("Travel Safe setup was not saved");
      const currentReadiness = await inspectTravelSafeReadiness({
        wallet,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      await inspectRefillSponsor({ sponsorUrl: readSettings().sponsorUrl });
      await fundTravelSafe({
        wallet,
        readiness: currentReadiness,
        ticket,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        helperAddress: WRENCHLESS_MAINNET.helperAddress,
        sponsorUrl: readSettings().sponsorUrl,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      setCreateStep("closed");
      setLive("Travel Safe submitted");
      await loadHome();
    } catch (caught) {
      setError(reasonFrom(caught));
      if (caught instanceof RelayedRefillFundError && caught.ambiguous) {
        setCreateStep("closed");
        await loadHome();
      } else {
        setCreateStep("review");
      }
      setLive(null);
    }
  }, [loadHome, wallet]);

  const unlock = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const passkey = passkeyFromSettings();
      if (passkey === null) throw new Error("This device has no Wrenchless passkey");
      await unlockTravelSafeTicketStorage(await verifyDevicePasskey(passkey));
      await loadHome();
    } catch (caught) {
      setHome({ name: "device-locked", reason: reasonFrom(caught) });
    }
  }, [loadHome]);

  const bringBack = useCallback(async (): Promise<void> => {
    setError(null);
    setLive("Waiting for Ready");
    try {
      const connected = await requestWalletAccount();
      const ready = await inspectTravelSafeReadiness({
        wallet: connected.wallet,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      if (!ready.registered || BigInt(ready.shieldedBalanceFri) < BigInt(ready.returnReserveFri)) {
        throw new Error("This Ready account needs its live private fee reserve");
      }
      const stateId = readSettings().activeSafeStateId;
      if (
        stateId === null ||
        home.name === "local-unavailable" ||
        home.name === "device-locked"
      ) {
        const locator = await requestReadyRecoveryLocator({
          wallet: connected.wallet,
          account: ready.account,
          sponsorUrl: readSettings().sponsorUrl,
        });
        const result = await returnRecoveredTravelSafe({
          wallet: connected.wallet,
          recipient: ready.account,
          stateId: locator.stateId,
          recoverySalt: locator.recoverySalt,
          poolAddress: WRENCHLESS_MAINNET.poolAddress,
          helperAddress: WRENCHLESS_MAINNET.helperAddress,
          tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
          rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
        });
        setHome({
          name: "ready-recovery-submitted",
          transactionHash: result.transactionHash,
          amountFri: result.amountFri,
        });
        setLive(null);
        return;
      }
      const passkey = passkeyFromSettings();
      if (passkey === null) throw new Error("This device has no Wrenchless passkey");
      await unlockTravelSafeTicketStorage(await verifyDevicePasskey(passkey));
      const ticket = await readTravelSafeTicket(stateId);
      setHome({ name: "returning", ticket });
      await returnTravelSafe({
        wallet: connected.wallet,
        recipient: ready.account,
        ticket,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        helperAddress: WRENCHLESS_MAINNET.helperAddress,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      setLive("Return submitted");
      await loadHome();
    } catch (caught) {
      const reason = reasonFrom(caught);
      setError(reason);
      setLive(null);
      if (home.name === "device-locked") {
        setHome({ name: "device-locked", reason });
      } else {
        await loadHome();
      }
    }
  }, [home.name, loadHome]);

  const back = useCallback((): void => {
    setError(null);
    setCreateStep((current) => {
      if (current === "details") return "connect";
      if (current === "review") return "closed";
      return current;
    });
  }, []);

  return {
    model: {
      home,
      createStep,
      walletAccount,
      readiness,
      amount,
      returnDateLocal,
      earlyRecoveryBackup,
      error,
      live,
      elapsedSeconds,
    },
    actions: {
      startCreate() {
        setError(null);
        setCreateStep("connect");
      },
      closeCreate() {
        setEarlyRecoveryBackup(null);
        setCreateStep("closed");
        setError(null);
      },
      connect,
      setAmount,
      setReturnDateLocal,
      continueFromDetails,
      back,
      park,
      unlock,
      refresh: loadHome,
      bringBack,
      bringBackEarly: bringBack,
      async createEarlyRecoveryBackup() {
        setError(null);
        try {
          const passkey = passkeyFromSettings();
          if (passkey === null) {
            throw new Error("This device has no Wrenchless passkey");
          }
          await unlockTravelSafeTicketStorage(await verifyDevicePasskey(passkey));
          const ticket = await readActiveTravelSafeTicket();
          if (ticket === null) throw new Error("No Travel Safe is active here");
          setEarlyRecoveryBackup(ticket.recoveryPhrase);
        } catch (caught) {
          setError(reasonFrom(caught));
        }
      },
      dismissEarlyRecoveryBackup() {
        setEarlyRecoveryBackup(null);
      },
      async clearTerminal() {
        const stateId = readSettings().activeSafeStateId;
        if (stateId === null) return;
        await clearTravelSafeTicket(stateId);
        setHome({ name: "no-local-safe" });
      },
      async forgetLocal() {
        const stateId = readSettings().activeSafeStateId;
        if (stateId === null) return;
        try {
          await clearTravelSafeTicket(stateId);
          setHome({ name: "no-local-safe" });
        } catch (caught) {
          const reason = reasonFrom(caught);
          setError(reason);
          if (home.name === "device-locked") {
            setHome({ name: "device-locked", reason });
          }
        }
      },
    },
  };
}

export type RecoveryViewState =
  | { name: "entry" }
  | { name: "checking" }
  | {
      name: "review";
      amountFri: string;
      returnDateSeconds: string;
      release: "claim" | "refund";
    }
  | { name: "submitting"; release: "claim" | "refund" }
  | {
      name: "submitted";
      checking: boolean;
      result: Extract<TravelSafeRecoveryResult, { kind: "submitted" }>;
    }
  | {
      name: "complete";
      result: Exclude<TravelSafeRecoveryResult, { kind: "submitted" }>;
    }
  | { name: "failed"; reason: string };

export type TravelSafeRecoveryController = {
  state: RecoveryViewState;
  words: string;
  setWords(value: string): void;
  inspect(): Promise<void>;
  submit(): Promise<void>;
  check(): Promise<void>;
  reset(): void;
};

function assertRecoveryStateMatches(
  expected: RefillChainState,
  actual: RefillChainState,
): void {
  if (
    !sameFelt(expected.stateId, actual.stateId) ||
    !sameFelt(expected.claimCommitment, actual.claimCommitment) ||
    !sameFelt(expected.recoveryCommitment, actual.recoveryCommitment) ||
    !sameFelt(expected.tokenAddress, actual.tokenAddress) ||
    BigInt(expected.amountFri) !== BigInt(actual.amountFri) ||
    BigInt(expected.returnDateSeconds) !== BigInt(actual.returnDateSeconds)
  ) {
    throw new Error("The onchain Travel Safe changed unexpectedly");
  }
}

export function useTravelSafeRecovery(): TravelSafeRecoveryController {
  const [state, setState] = useState<RecoveryViewState>({ name: "entry" });
  const [words, setWords] = useState("");
  const phrase = useRef<string | null>(null);

  const inspect = useCallback(async (): Promise<void> => {
    setState({ name: "checking" });
    try {
      const secrets = await deriveTravelSafeSecrets(words);
      const current = await readSafeSnapshot(secrets.stateId);
      const safe = current.state;
      if (
        safe === null ||
        !sameFelt(safe.claimCommitment, secrets.claimCommitment) ||
        !sameFelt(safe.tokenAddress, WRENCHLESS_MAINNET.strkTokenAddress)
      ) {
        throw new Error("No funded Travel Safe matches those words");
      }
      if (safe.status !== "funded") {
        setState({
          name: "complete",
          result: {
            kind: safe.status === "claimed" ? "already-claimed" : "already-refunded",
            snapshot: current,
          },
        });
        phrase.current = null;
        setWords("");
        return;
      }
      const release = chooseTravelSafeRelease(
        safe.returnDateSeconds,
        current.chainTimeSeconds,
      );
      phrase.current = words;
      setState({
        name: "review",
        amountFri: safe.amountFri,
        returnDateSeconds: safe.returnDateSeconds,
        release,
      });
    } catch (caught) {
      setState({ name: "failed", reason: reasonFrom(caught) });
    }
  }, [words]);

  const submit = useCallback(async (): Promise<void> => {
    const saved = phrase.current;
    if (saved === null || state.name !== "review") return;
    setState({ name: "submitting", release: state.release });
    try {
      const connected = await requestWalletAccount();
      const ready = await inspectTravelSafeReadiness({
        wallet: connected.wallet,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      if (!ready.registered || BigInt(ready.shieldedBalanceFri) < BigInt(ready.returnReserveFri)) {
        throw new Error("This Ready account needs its live private fee reserve");
      }
      const result = await recoverTravelSafe({
        phrase: saved,
        wallet: connected.wallet,
        recipient: ready.account,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        helperAddress: WRENCHLESS_MAINNET.helperAddress,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      phrase.current = null;
      setWords("");
      setState(
        result.kind === "submitted"
          ? { name: "submitted", checking: false, result }
          : { name: "complete", result },
      );
    } catch (caught) {
      setState({ name: "failed", reason: reasonFrom(caught) });
    }
  }, [state]);

  const check = useCallback(async (): Promise<void> => {
    if (state.name !== "submitted") return;
    const submission = state.result;
    const expected = submission.snapshot.state;
    if (expected === null) {
      setState({ name: "failed", reason: "The submitted safe has no chain state" });
      return;
    }
    setState({ name: "submitted", checking: true, result: submission });
    try {
      const current = await readSafeSnapshot(expected.stateId);
      if (current.state === null) {
        throw new Error("The Travel Safe is not visible on Starknet");
      }
      assertRecoveryStateMatches(expected, current.state);
      const receipt = await readTransactionReceiptStatus({
        transactionHash: submission.transactionHash,
        rpcUrl: WRENCHLESS_MAINNET.rpcUrl,
      });
      if (current.state.status === "funded") {
        if (receipt.name === "reverted") {
          throw new Error("The Ready transaction reverted. Enter the words and try again");
        }
        setState({ name: "submitted", checking: false, result: submission });
        return;
      }
      const submittedStatus =
        submission.release === "claim" ? "claimed" : "refunded";
      if (
        receipt.name !== "accepted" ||
        current.state.status !== submittedStatus
      ) {
        setState({
          name: "complete",
          result: {
            kind:
              current.state.status === "claimed"
                ? "already-claimed"
                : "already-refunded",
            snapshot: current,
          },
        });
        return;
      }
      setState({
        name: "complete",
        result: {
          kind: current.state.status === "claimed" ? "claimed" : "refunded",
          snapshot: current,
          transactionHash: submission.transactionHash,
          noteId: submission.noteId,
        },
      });
    } catch (caught) {
      setState({ name: "failed", reason: reasonFrom(caught) });
    }
  }, [state]);

  return {
    state,
    words,
    setWords,
    inspect,
    submit,
    check,
    reset() {
      phrase.current = null;
      setWords("");
      setState({ name: "entry" });
    },
  };
}
