import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";

import {
  createCoverSessionController,
  type CoverSessionController,
  type NeutralCoverSessionState,
} from "../../lib/cover-session";
import { WRENCHLESS_MAINNET, WRENCHLESS_PRODUCT } from "../../lib/product-config";
import {
  inspectReadyCoverAccount,
  type ReadyCoverAccountStatus,
} from "../../lib/ready-cover";
import { formatStrkFigure, shortHex } from "../../adapters/amount";
import {
  walletSafeReason,
} from "../../adapters/cover-operations";
import {
  readSettings,
  useSettings,
  walletIsReady,
  writeSettings,
} from "../../adapters/settings";
import {
  alreadyAuthorized,
  requestWalletAccount,
  type BrowserWallet,
} from "../../adapters/wallet";
import { ReadyWalletMark } from "../../components/ReadyWalletMark";
import {
  ArrowDownLeftIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  LockSimpleIcon,
  PaperPlaneTiltIcon,
  WalletIcon,
} from "../../components/icons";
import { QrInvitation } from "../shared/QrInvitation";
import {
  Actions,
  Balance,
  Button,
  Emblem,
  IconButton,
  Live,
  Note,
  ProductFrame,
  Screen,
  Section,
  StatusLine,
} from "../shared/product";
import { ActivityList, ActivityView } from "./ActivityView";
import { LockView } from "./LockView";
import { PairView } from "./PairView";
import { ReceiveView } from "./ReceiveView";
import { RestoreFlow } from "./RestoreFlow";
import { SendFlow } from "./SendFlow";
import { SettingsView } from "./SettingsView";

/**
 * The carried wallet.
 *
 * One address, and no way from here to anything else this product does. It is
 * an ordinary spending app: a balance, two buttons, a list, and settings that
 * hold nothing a wallet would not hold.
 *
 * Send, Receive and Restore are screens rather than tabs because they are
 * errands — you enter one, finish, and come back — and because collapsing them
 * out of the way is what keeps the first screen a balance and two buttons.
 *
 * Nothing here changes with which valid code opened the wallet. The session
 * module holds that and never returns it, so there is no branch in this file to
 * keep identical, and no message crossing into it that could name the other
 * half of the product.
 */

type View = "home" | "activity" | "settings" | "send" | "receive" | "restore";

type Account =
  | { name: "idle" }
  | { name: "connecting" }
  | { name: "checking" }
  | { name: "ready"; status: ReadyCoverAccountStatus }
  | { name: "blocked"; reason: string };

const TABS = [
  { id: "home", label: "Home", Icon: WalletIcon },
  { id: "activity", label: "Activity", Icon: ClockCounterClockwiseIcon },
  { id: "settings", label: "Settings", Icon: GearSixIcon },
] as const;

export function WalletSurface(): JSX.Element {
  const settings = useSettings();
  const [session] = useState<CoverSessionController>(() =>
    createCoverSessionController(),
  );
  const [sessionState, setSessionState] = useState<NeutralCoverSessionState>(() =>
    session.state(),
  );
  const [passkeyDone, setPasskeyDone] = useState(false);
  // Held in the record rather than in component state: a reload before the
  // other device has read the code must not be the thing that loses it.
  const showReceipt =
    settings.deviceReceiptToken !== null && settings.deviceReceiptDoneAt === null;
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [account, setAccount] = useState<Account>({ name: "idle" });
  const [view, setView] = useState<View>("home");
  const [live, setLive] = useState<string | null>(null);

  /**
   * Reads the account, without ever throwing away a reading it already has.
   *
   * Every operation refreshes the balance when it finishes. If that refresh
   * moved this screen back through "checking", the connect gate would render
   * for a moment and take the flow with it — a person would approve a payment
   * in Ready Wallet and come back to an empty Send form instead of the receipt.
   * So a re-read replaces the figure or leaves it alone, and only a first read
   * is allowed to show a gate.
   */
  const load = useCallback(async (connected: BrowserWallet): Promise<void> => {
    setAccount((current) =>
      current.name === "ready" ? current : { name: "checking" },
    );
    try {
      const status = await inspectReadyCoverAccount({
        wallet: connected,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
      });
      const boundAccount = readSettings().carriedAccount;
      if (
        boundAccount !== null &&
        BigInt(boundAccount) !== BigInt(status.account)
      ) {
        throw new Error(
          "Switch Ready Wallet to the account paired with this wallet, then try again.",
        );
      }
      if (boundAccount === null) writeSettings({ carriedAccount: status.account });
      setAccount({ name: "ready", status });
    } catch (caught) {
      const reason = walletSafeReason(caught);
      setAccount((current) =>
        current.name === "ready" ? current : { name: "blocked", reason },
      );
    }
  }, []);

  // A wallet already authorised for this origin is picked up without asking
  // again. Nothing is read from it until an operation module asks.
  useEffect(() => {
    const existing = alreadyAuthorized();
    if (existing === null) return;
    setWallet(existing);
    void load(existing);
  }, [load]);

  // The session closes itself. This keeps the screen honest about that instead
  // of leaving an open wallet drawn over a session that already ended.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = session.state();
      setSessionState((current) => {
        // The access-code screen is still a locked session. Clearing the
        // passkey there every time this poll runs sends a person back to the
        // first gate while they are typing. Only an open session expiring is a
        // new lock event; explicit locks already clear the flag themselves.
        if (current.state === "unlocked" && next.state !== "unlocked") {
          setPasskeyDone(false);
        }
        return next;
      });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [session]);

  const connect = async (): Promise<void> => {
    setAccount({ name: "connecting" });
    setLive("Waiting for Ready Wallet");
    try {
      const connected = await requestWalletAccount();
      setWallet(connected.wallet);
      setLive(null);
      await load(connected.wallet);
    } catch (caught) {
      setAccount({ name: "blocked", reason: walletSafeReason(caught) });
      setLive(null);
    }
  };

  const refresh = useCallback(async (): Promise<void> => {
    if (wallet === null) return;
    await load(wallet);
  }, [load, wallet]);

  const lock = (): void => {
    session.lock();
    setPasskeyDone(false);
    setView("home");
    setSessionState(session.state());
  };

  const unlocked = sessionState.state === "unlocked";

  const frame = (
    body: JSX.Element,
    options: { tabs?: boolean; lock?: boolean } = {},
  ): JSX.Element => (
    <ProductFrame
      action={
        options.lock === true ? (
          <IconButton
            icon={<LockSimpleIcon />}
            label="Lock wallet"
            onClick={lock}
          />
        ) : undefined
      }
      detail={
        account.name === "ready"
          ? shortHex(account.status.account)
          : "Not connected"
      }
      label="Carried wallet"
      role="wallet"
      tabs={
        options.tabs === true ? (
          <nav aria-label="Wallet" className="tabbar">
            {TABS.map((tab) => (
              <button
                aria-current={view === tab.id ? "page" : undefined}
                className="tabbar__tab"
                key={tab.id}
                onClick={() => setView(tab.id)}
                type="button"
              >
                <tab.Icon aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>
        ) : undefined
      }
    >
      {body}
    </ProductFrame>
  );

  /* ---------- pairing ---------- */

  if (!walletIsReady(settings, sessionState.state !== "setup_required")) {
    return frame(
      <PairView
        onPaired={() => setSessionState(session.state())}
        settings={settings}
      />,
    );
  }

  /**
   * The answer this phone sends back, and the only time it leaves the device.
   *
   * It is a code rather than a few characters because it carries the public
   * half of three one-time requests: without them the other device has no way
   * to send money here at all. The private halves stay in this browser, so the
   * code is safe to photograph and useless to anyone else.
   */
  if (showReceipt) {
    return frame(
      <Screen
        lede="Your other device is waiting for it."
        title="Read this code back"
      >
        <QrInvitation
          code={settings.deviceReceiptToken ?? ""}
          codeLabel="Code to read back"
          label="QR code confirming this phone"
          link={settings.deviceReceiptToken ?? ""}
          note="It confirms this phone. It holds no keys and no balance."
        />
        {settings.deviceCode === null ? null : (
          <p className="fingerprint">{settings.deviceCode}</p>
        )}
        <Actions>
          <Button
            icon={<CheckCircleIcon />}
            label="They have it"
            onClick={() =>
              writeSettings({ deviceReceiptDoneAt: new Date().toISOString() })
            }
          />
        </Actions>
      </Screen>,
    );
  }

  /* ---------- opening ---------- */

  if (sessionState.state === "setup_required") {
    return frame(
      <Screen center title="This wallet is not ready">
        <Note>
          Pair it again from your other device. Nothing is stored here yet.
        </Note>
      </Screen>,
    );
  }

  if (!unlocked) {
    return frame(
      <LockView
        onOpen={(next) => setSessionState(next)}
        onPasskey={() => setPasskeyDone(true)}
        passkeyDone={passkeyDone}
        session={session}
        settings={settings}
      />,
    );
  }

  /* ---------- connecting ---------- */

  if (account.name !== "ready" || wallet === null) {
    return frame(
      <Screen
        center
        lede="Your spending balance lives in Ready Wallet."
        title="Connect Ready Wallet"
      >
        <Emblem>
          <WalletIcon />
        </Emblem>
        {account.name === "blocked" ? (
          <Note tone="caution">{account.reason}</Note>
        ) : null}
        <Actions>
          <Button
            disabled={account.name === "connecting" || account.name === "checking"}
            icon={<ReadyWalletMark className="ready-wallet-mark" />}
            label={
              account.name === "connecting"
                ? "Waiting for Ready Wallet"
                : account.name === "checking"
                  ? "Checking"
                  : account.name === "blocked"
                    ? "Try again"
                    : "Connect Ready Wallet"
            }
            onClick={() => void connect()}
          />
        </Actions>
        <Live message={live} />
      </Screen>,
      { lock: true },
    );
  }

  /* ---------- open ---------- */

  if (view === "send") {
    return frame(
      <SendFlow
        account={account.status.account}
        balanceFri={account.status.publicBalanceFri}
        onDone={() => setView("home")}
        onSubmitted={() => void refresh()}
        session={session}
        settings={settings}
        wallet={wallet}
      />,
      { lock: true },
    );
  }

  if (view === "receive") {
    return frame(
      <ReceiveView
        account={account.status.account}
        onDone={() => setView("home")}
      />,
      { lock: true },
    );
  }

  if (view === "restore") {
    return frame(
      <RestoreFlow
        account={account.status.account}
        onChanged={() => void refresh()}
        onDone={() => setView("home")}
        publicBalanceFri={account.status.publicBalanceFri}
        settings={settings}
        wallet={wallet}
      />,
      { lock: true },
    );
  }

  if (view === "activity") {
    return frame(<ActivityView />, { tabs: true, lock: true });
  }

  if (view === "settings") {
    return frame(
      <SettingsView account={account.status.account} onLock={lock} />,
      { tabs: true, lock: true },
    );
  }

  const balanceFri = BigInt(account.status.publicBalanceFri);
  const capFri = BigInt(settings.exposureCapFri);
  const low =
    capFri > 0n &&
    balanceFri * 100n <
      capFri * BigInt(Math.round(WRENCHLESS_PRODUCT.lowBalanceRatio * 100));

  return frame(
    <Screen>
      <Balance
        caption="Spending balance"
        value={formatStrkFigure(account.status.publicBalanceFri)}
      />

      {low ? (
        <StatusLine icon={<ArrowsClockwiseIcon />}>
          Your balance is running low.
        </StatusLine>
      ) : null}

      <Actions>
        <Button
          icon={<PaperPlaneTiltIcon />}
          label="Send"
          onClick={() => setView("send")}
        />
        <Button
          icon={<ArrowDownLeftIcon />}
          label="Receive"
          onClick={() => setView("receive")}
        />
        {low ? (
          <Button
            icon={<ArrowsClockwiseIcon />}
            label="Restore balance"
            onClick={() => setView("restore")}
          />
        ) : null}
      </Actions>

      <Section
        action={
          <button
            className="wlink"
            onClick={() => setView("activity")}
            type="button"
          >
            View all
          </button>
        }
        title="Recent"
      />
      <ActivityList limit={3} />
      <Live message={live} />
    </Screen>,
    { tabs: true, lock: true },
  );
}
