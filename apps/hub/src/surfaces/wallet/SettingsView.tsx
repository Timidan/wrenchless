import type { JSX } from "react";
import { useState } from "react";

import { formatStrk } from "../../adapters/amount";
import {
  pendingSyncCount,
  syncPendingMessages,
} from "../../adapters/cover-operations";
import { useSettings } from "../../adapters/settings";
import { CopyValue } from "../shared/CopyValue";
import {
  ArrowsClockwiseIcon,
  LockSimpleIcon,
} from "../../components/icons";
import {
  Amount,
  Fact,
  Facts,
  Live,
  Note,
  Screen,
} from "../shared/product";

/**
 * Wallet settings: the account, the limit, the lock.
 *
 * Nothing here belongs to another device. There is no key material, no pairing
 * state, no route anywhere else, and no way to change the two access codes —
 * those were chosen once, somewhere safe, and a control to change them here
 * would say out loud that there are two of them.
 *
 * The limit is shown and not editable for the same reason. It is the ceiling
 * that makes this wallet worth carrying, and a person standing under pressure
 * must not be able to raise it from the phone in their hand.
 *
 * The sync line reports the same two things whatever the session is, and there
 * is no per-item retry: a retry control is a place where two paths could start
 * to differ.
 */

type Sync =
  | { name: "idle" }
  | { name: "running" }
  | { name: "clear" }
  | { name: "waiting"; count: number };

export function SettingsView(props: { account: string; onLock: () => void }): JSX.Element {
  const settings = useSettings();
  const [sync, setSync] = useState<Sync>({ name: "idle" });
  const [live, setLive] = useState<string | null>(null);

  const runSync = async (): Promise<void> => {
    setSync({ name: "running" });
    setLive("Syncing");
    try {
      const report = await syncPendingMessages(settings);
      setSync(
        report.remaining === 0
          ? { name: "clear" }
          : { name: "waiting", count: report.remaining },
      );
      setLive(null);
    } catch {
      setSync({ name: "waiting", count: pendingSyncCount() });
      setLive(null);
    }
  };

  return (
    <Screen title="Settings">
      <Facts>
        <Fact
          label="Spending limit"
          value={<Amount value={formatStrk(settings.exposureCapFri)} />}
        />
        <Fact label="Network" value="Starknet" />
        <Fact
          label="Sync"
          value={
            sync.name === "running"
              ? "Syncing"
              : sync.name === "clear"
                ? "Up to date"
                : sync.name === "waiting"
                  ? `${sync.count} waiting`
                  : "Not checked"
          }
        />
      </Facts>

      <CopyValue label="Your address" value={props.account} />

      <ul className="wmenu">
        <li>
          <button
            aria-busy={sync.name === "running" ? "true" : undefined}
            className="wmenu__item"
            disabled={sync.name === "running"}
            onClick={() => void runSync()}
            type="button"
          >
            <span
              className="wmenu__icon"
              data-icon-motion={sync.name === "running" ? "spin" : undefined}
            >
              <ArrowsClockwiseIcon aria-hidden="true" />
            </span>
            <span className="wmenu__copy">
              <span className="wmenu__label">
                {sync.name === "running" ? "Syncing" : "Sync now"}
              </span>
              <span className="wmenu__hint">Send anything still waiting</span>
            </span>
          </button>
        </li>
        <li>
          <button className="wmenu__item" onClick={props.onLock} type="button">
            <span className="wmenu__icon">
              <LockSimpleIcon aria-hidden="true" />
            </span>
            <span className="wmenu__copy">
              <span className="wmenu__label">Lock wallet</span>
              <span className="wmenu__hint">Ask for your code again</span>
            </span>
          </button>
        </li>
      </ul>

      <Note>
        Your signing key stays in Ready Wallet. This browser keeps your settings
        and some sealed material of its own —{" "}
        <a className="wref" href="/privacy.html">
          what is kept and sent
        </a>
        .
      </Note>
      <Live message={live} />
    </Screen>
  );
}
