import type { JSX } from "react";
import { useEffect, useState } from "react";

import {
  formatStrkFigure,
  formatTimestamp,
  shortHex,
} from "../../adapters/amount";
import {
  refreshActivity,
  useActivity,
  type ActivityRecord,
} from "../../adapters/records";
import { ArrowsClockwiseIcon } from "../../components/icons";
import {
  Actions,
  Amount,
  Button,
  Empty,
  Screen,
} from "../shared/product";

/**
 * The ledger, and the reason it can be short.
 *
 * Every row began as a transaction reference handed back by an operation. There
 * is no index and no backfill, so an account with years of public history still
 * starts empty here — and the empty state says that rather than implying the
 * account is new.
 *
 * Statuses are re-read from the chain while anything is open, then the polling
 * stops. A screen that keeps asking forever is wrong about something.
 */

const LABEL = {
  payment: "Sent",
  allowance: "Balance restored",
  refill: "Balance restored",
  funding: "Reserve funded",
  refund: "Returned",
} satisfies Record<ActivityRecord["kind"], string>;

function statusText(record: ActivityRecord): string {
  if (record.status === "confirmed") return "Confirmed";
  if (record.status === "reverted") return "Failed";
  return "Confirming";
}

export function ActivityList(props: {
  limit?: number | undefined;
}): JSX.Element {
  const rows = useActivity("wallet");
  const pending = rows.some((row) => row.status === "pending");
  const shown = props.limit === undefined ? rows : rows.slice(0, props.limit);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    const tick = (): void => {
      void refreshActivity("wallet");
    };
    tick();
    const timer = window.setInterval(() => {
      if (live) tick();
    }, 15_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [pending]);

  if (shown.length === 0) {
    return (
      <Empty
        body="Payments made from this wallet appear here."
        title="Nothing yet"
      />
    );
  }

  return (
    <ul className="wlist">
      {shown.map((row) => (
        <li className="wlist__row" key={row.transactionHash}>
          <div className="wlist__main">
            <p className="wlist__kind">{LABEL[row.kind]}</p>
            <p className="wlist__meta">
              {formatTimestamp(row.submittedAt)}
              {row.recipient === null ? "" : ` · ${shortHex(row.recipient)}`}
            </p>
          </div>
          <div className="wlist__side">
            <p className="wlist__amount">
              <Amount
                sign={row.kind === "payment" ? "−" : "+"}
                value={formatStrkFigure(row.amountFri)}
              />
            </p>
            <p className="wlist__status" data-status={row.status}>
              {statusText(row)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ActivityView(): JSX.Element {
  const rows = useActivity("wallet");
  const [checking, setChecking] = useState(false);

  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      await refreshActivity("wallet");
    } finally {
      setChecking(false);
    }
  };

  return (
    <Screen title="Activity">
      <ActivityList />
      {/* One control, and no list of references under it. A transaction
          reference belongs on the screen that has just produced one, not
          collected into a column of hashes on an everyday wallet. */}
      {rows.length === 0 ? null : (
        <Actions>
          <Button
            disabled={checking}
            icon={<ArrowsClockwiseIcon />}
            label={checking ? "Checking" : "Check statuses"}
            onClick={() => void check()}
          />
        </Actions>
      )}
    </Screen>
  );
}
