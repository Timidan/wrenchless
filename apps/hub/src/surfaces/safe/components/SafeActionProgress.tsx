import type { JSX } from "react";

import { EXPLORER_BASE, shortHex } from "../../../adapters/amount";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from "../../../components/icons";
import { StatusLine, TransactionRef } from "../../shared/product";
import type { SafeActionState } from "../travel-safe-model";

/**
 * One truthful line of state for whatever a Trip Allowance action is doing,
 * from the first proof to a confirmed or failed receipt.
 *
 * This is the single progress view the product boundary asks for: proof
 * preparation, cost review, submission and confirmation are all the same
 * `SafeActionState` union, so a screen never has to re-derive "are we done
 * yet" from a transaction hash and a timer of its own. `idle` renders
 * nothing — there is nothing true to say yet — and every other state renders
 * exactly one status line, plus the evidence once there is a hash worth
 * showing.
 */
export function SafeActionProgress(props: {
  action: SafeActionState;
}): JSX.Element | null {
  const { action } = props;

  switch (action.name) {
    case "idle":
      return null;

    case "preparing":
    case "wallet":
      return (
        <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
          {action.label}
        </StatusLine>
      );

    case "submitted":
      return (
        <>
          <StatusLine icon={<CheckCircleIcon />}>
            Transaction submitted
          </StatusLine>
          <TransactionRef
            hash={shortHex(action.transactionHash)}
            href={`${EXPLORER_BASE}${action.transactionHash}`}
            label="Submitted"
          />
        </>
      );

    case "confirming":
      return (
        <>
          <StatusLine announce icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Confirming on Starknet
          </StatusLine>
          <TransactionRef
            hash={shortHex(action.transactionHash)}
            href={`${EXPLORER_BASE}${action.transactionHash}`}
            label="Submitted"
          />
        </>
      );

    case "confirmed":
      return (
        <>
          <StatusLine announce icon={<CheckCircleIcon />}>
            {action.label ?? "Confirmed on Starknet"}
          </StatusLine>
          {action.transactionHash === null ? null : (
            <TransactionRef
              hash={shortHex(action.transactionHash)}
              href={`${EXPLORER_BASE}${action.transactionHash}`}
              label="Confirmed"
            />
          )}
        </>
      );

    case "failed":
      return (
        <div role="alert">
          <StatusLine announce icon={<WarningCircleIcon />} tone="alert">
            {action.message}
          </StatusLine>
        </div>
      );
  }
}

/** Whether a screen's own controls should give way to `SafeActionProgress`. */
export function safeActionBusy(action: SafeActionState): boolean {
  return (
    action.name === "preparing" ||
    action.name === "wallet" ||
    action.name === "submitted" ||
    action.name === "confirming"
  );
}
