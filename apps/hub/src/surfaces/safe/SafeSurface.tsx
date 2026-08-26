import type { TravelSafeTicket } from "@wrenchless/canary-core";
import type { JSX } from "react";

import {
  EXPLORER_BASE,
  formatStrk,
  formatStrkFigure,
  formatUnixSeconds,
  shortHex,
} from "../../adapters/amount";
import { ReadyWalletMark } from "../../components/ReadyWalletMark";
import {
  ArrowDownLeftIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  FingerprintIcon,
  HourglassIcon,
  KeyIcon,
  LockKeyOpenIcon,
  LockSimpleIcon,
  SuitcaseRollingIcon,
  WarningCircleIcon,
} from "../../components/icons";
import type { TravelSafeFundProgress } from "../../lib/travel-safe-progress";
import { navigate } from "../../routes";
import {
  Actions,
  Amount,
  Balance,
  Button,
  Countdown,
  Emblem,
  Fact,
  Facts,
  Live,
  Note,
  Phrase,
  ProductFrame,
  Screen,
  StatusLine,
  TransactionRef,
  Waiting,
  WalletField,
} from "../shared/product";
import type {
  CreateStep,
  SafeHomeState,
  TravelSafeActions,
  TravelSafeViewModel,
} from "./useTravelSafe";
import { useTravelSafe } from "./useTravelSafe";

/**
 * The Travel Safe, on the one device that holds it.
 *
 * The surface has exactly one subject at a time — a reserve that is parked, or
 * a reserve that can come home, or the absence of either — and the screen is
 * built around that one thing rather than around a list of things a wallet can
 * do. There are no tabs, no ledger and no second balance: what is on screen is
 * whatever the helper contract last said, read at a named block.
 *
 * Nothing here computes. Amounts, fees, the return date and the release
 * decision all arrive from the controller as they were read; this file chooses
 * words, order and motion for them and nothing else.
 */

/** The create flow, as the corner counter says it out loud. */
const CREATE_STEPS: readonly CreateStep[] = [
  "connect",
  "details",
  "review",
  "quote",
  "parking",
];

function explorer(hash: string): string {
  return `${EXPLORER_BASE}${hash}`;
}

function localReturnDate(value: string): string | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function addFri(left: string, right: string): string {
  return (BigInt(left) + BigInt(right)).toString();
}

/**
 * A failure, in the words the controller already wrote for a person.
 *
 * It is never parsed or rephrased here: an operation that fails says what to
 * do next, and a screen that re-words it goes stale the day that operation
 * says it better.
 */
function Failure(props: { message: string }): JSX.Element {
  return (
    <div role="alert">
      <StatusLine icon={<WarningCircleIcon />} tone="alert">
        {props.message}
      </StatusLine>
    </div>
  );
}

function SafeEvidence(props: { ticket: TravelSafeTicket }): JSX.Element | null {
  const { fundTransactionHash, returnTransactionHash } = props.ticket;
  if (fundTransactionHash === null && returnTransactionHash === null) return null;
  return (
    <div className="txrefs">
      {fundTransactionHash === null ? null : (
        <TransactionRef
          hash={shortHex(fundTransactionHash)}
          href={explorer(fundTransactionHash)}
          label={props.ticket.status === "FUND_SUBMITTING" ? "Submitted" : "Parked"}
        />
      )}
      {returnTransactionHash === null ? null : (
        <TransactionRef
          hash={shortHex(returnTransactionHash)}
          href={explorer(returnTransactionHash)}
          label={props.ticket.status === "RETURN_SUBMITTING" ? "Submitted" : "Returned"}
        />
      )}
    </div>
  );
}

/** What the safe holds, said once and large, above the facts that qualify it. */
function SafeFigure(props: {
  ticket: TravelSafeTicket;
  caption: string;
}): JSX.Element {
  return (
    <Balance
      caption={props.caption}
      value={formatStrkFigure(props.ticket.amountFri)}
    />
  );
}

function FundProgress(props: { progress: TravelSafeFundProgress }): JSX.Element {
  return (
    <section aria-label="Parking progress" className="fund-progress">
      <ol className="fund-progress__steps">
        {props.progress.steps.map((step) => (
          <li
            aria-current={step.state === "current" ? "step" : undefined}
            data-state={step.state}
            key={step.id}
          >
            <span aria-hidden="true" className="fund-progress__marker">
              {step.state === "complete" ? <CheckCircleIcon /> : null}
            </span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <StatusLine
        announce
        icon={
          props.progress.working ? (
            <ArrowsClockwiseIcon />
          ) : (
            <CheckCircleIcon />
          )
        }
        iconMotion={props.progress.working ? "spin" : undefined}
      >
        {props.progress.message}
      </StatusLine>
      <p className="fund-progress__money" data-state={props.progress.money}>
        {props.progress.moneyLabel}
      </p>
    </section>
  );
}

export function SafeSurface(): JSX.Element {
  const { model, actions } = useTravelSafe();
  const { home, createStep } = model;
  const creating = createStep !== "closed";
  const earlyRecoveryBackup = model.earlyRecoveryBackup ?? null;
  const backingUp = earlyRecoveryBackup !== null;
  const stepIndex = CREATE_STEPS.indexOf(createStep);

  const detail =
    model.walletAccount === null
      ? "Starknet mainnet"
      : shortHex(model.walletAccount);

  const canRefresh =
    !creating &&
    !backingUp &&
    home.name !== "loading" &&
    home.name !== "no-local-safe" &&
    home.name !== "device-locked";

  return (
    <ProductFrame
      action={
        canRefresh ? (
          <button
            aria-busy={model.live === "Checking Starknet" ? "true" : undefined}
            aria-label="Check the chain again"
            className="iconbtn"
            onClick={() => {
              void actions.refresh();
            }}
            type="button"
          >
            <span
              aria-hidden="true"
              data-icon-motion={
                model.live === "Checking Starknet" ? "spin" : undefined
              }
            >
              <ArrowsClockwiseIcon />
            </span>
          </button>
        ) : undefined
      }
      detail={detail}
      label={
        creating
          ? "New Travel Safe"
          : backingUp
            ? "Early recovery backup"
            : "Travel Safe"
      }
      role="safe"
      step={
        creating && stepIndex >= 0
          ? {
              display: `${String(stepIndex + 1)}/${String(CREATE_STEPS.length)}`,
              label: `Step ${String(stepIndex + 1)} of ${String(CREATE_STEPS.length)}`,
            }
          : undefined
      }
    >
      {backingUp ? (
        <EarlyRecoveryBackup
          onDone={actions.dismissEarlyRecoveryBackup}
          words={earlyRecoveryBackup}
        />
      ) : creating ? (
        <CreateFlow actions={actions} model={model} />
      ) : (
        <Home
          actions={actions}
          error={model.error}
          fundProgress={model.fundProgress}
          home={home}
          live={model.live}
        />
      )}
    </ProductFrame>
  );
}

function EarlyRecoveryBackup(props: {
  words: string;
  onDone: () => void;
}): JSX.Element {
  return (
    <Screen
      lede="Use this only to return early from another device."
      title="Save your early-recovery backup"
    >
      <Phrase words={props.words.split(" ")} />
      <Note tone="caution">
        Anyone with these words can return the reserve before your return date.
      </Note>
      <Note>
        This is not a wallet seed. It stays encrypted on this device and is
        never sent to the sponsor.
      </Note>
      <Actions>
        <Button label="I saved it" onClick={props.onDone} />
      </Actions>
    </Screen>
  );
}

function Home(props: {
  home: SafeHomeState;
  error: string | null;
  fundProgress: TravelSafeFundProgress | null;
  live: string | null;
  actions: TravelSafeActions;
}): JSX.Element {
  const { actions, home } = props;

  switch (home.name) {
    case "loading":
      return (
        <Screen center>
          <Emblem>
            <ArrowsClockwiseIcon />
          </Emblem>
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Reading the chain
          </StatusLine>
        </Screen>
      );

    case "no-local-safe":
      return (
        <Screen
          center
          lede="Return after the date, or use an optional backup sooner."
          title="No safe in this browser"
        >
          <Emblem>
            <ReadyWalletMark className="emblem__ready" />
          </Emblem>
          {props.error === null ? null : <Failure message={props.error} />}
          <Actions stack>
            <Button
              icon={<ReadyWalletMark className="wbtn__ready" />}
              label="Recover reserve"
              onClick={() => {
                void actions.bringBack();
              }}
            />
            <Button
              icon={<KeyIcon />}
              label="Use recovery backup"
              onClick={() => navigate("/recover")}
              tone="quiet"
            />
            <Button
              icon={<SuitcaseRollingIcon />}
              label="Create a new safe"
              onClick={() => {
                void actions.startCreate();
              }}
              tone="quiet"
            />
          </Actions>
        </Screen>
      );

    case "device-locked":
      return (
        <Screen
          center
          lede="Verify with your passkey to see it."
          title="This device holds a safe"
        >
          <Emblem>
            <FingerprintIcon />
          </Emblem>
          {home.reason === null ? null : <Failure message={home.reason} />}
          <Actions stack>
            <Button
              icon={<KeyIcon />}
              label="Unlock"
              onClick={() => {
                void actions.unlock();
              }}
            />
            <Button
              icon={<ReadyWalletMark className="wbtn__ready" />}
              label="Recover reserve"
              onClick={() => {
                void actions.bringBack();
              }}
              tone="quiet"
            />
            <Button
              icon={<KeyIcon />}
              label="Use recovery backup"
              onClick={() => navigate("/recover")}
              tone="quiet"
            />
            <Button
              label="Forget this browser"
              onClick={() => {
                void actions.forgetLocal();
              }}
              tone="quiet"
            />
          </Actions>
        </Screen>
      );

    case "setup-incomplete":
      return (
        <Screen
          lede="The reserve has not been parked yet."
          title="Setup incomplete"
        >
          <SafeFigure caption="Chosen to park" ticket={home.ticket} />
          <Facts>
            <Fact
              label="Return date"
              value={formatUnixSeconds(home.ticket.returnDateSeconds)}
            />
          </Facts>
          <Actions>
            <Button
              icon={<LockSimpleIcon />}
              label="Finish parking"
              onClick={() => {
                void actions.park();
              }}
            />
          </Actions>
          <Live message={props.live} />
        </Screen>
      );

    case "parking":
      return (
        <Screen
          title={
            home.ticket.fundTransactionHash === null
              ? "Checking submission"
              : "Transaction submitted"
          }
        >
          <SafeFigure caption="On its way to the safe" ticket={home.ticket} />
          {props.fundProgress === null ? null : (
            <FundProgress progress={props.fundProgress} />
          )}
          {props.error === null ? null : <Failure message={props.error} />}
          <SafeEvidence ticket={home.ticket} />
          <Actions>
            <Button
              icon={<ArrowsClockwiseIcon />}
              label="Check now"
              onClick={() => {
                void actions.refresh();
              }}
            />
          </Actions>
          <Note>You can close this screen. Checking resumes when you return.</Note>
        </Screen>
      );

    case "locked":
      return (
        <Screen title={`Locked until ${formatUnixSeconds(home.ticket.returnDateSeconds)}`}>
          <SafeFigure caption="Parked until your return" ticket={home.ticket} />
          <Countdown
            chainTimeSeconds={home.snapshot.chainTimeSeconds}
            returnDateSeconds={home.ticket.returnDateSeconds}
          />
          <StatusLine icon={<CheckCircleIcon />}>Confirmed on Starknet</StatusLine>
          <StatusLine icon={<HourglassIcon />}>
            Return opens after that date.
          </StatusLine>
          <Facts>
            <Fact
              label="Read at block"
              mono
              value={home.snapshot.blockNumber}
            />
          </Facts>
          <SafeEvidence ticket={home.ticket} />
          <Actions>
            <Button
              icon={<FingerprintIcon />}
              label="Bring it back early"
              onClick={() => {
                void actions.bringBackEarly();
              }}
            />
          </Actions>
          <Actions>
            <Button
              icon={<KeyIcon />}
              label="Create recovery backup"
              onClick={() => {
                void actions.createEarlyRecoveryBackup();
              }}
              tone="quiet"
            />
          </Actions>
          <Note>The backup is optional and only works before the return date.</Note>
        </Screen>
      );

    case "return-ready":
      return (
        <Screen lede="The return date has passed." title="Return available">
          <SafeFigure caption="Waiting for you" ticket={home.ticket} />
          <Facts>
            <Fact
              label="Return date"
              value={formatUnixSeconds(home.ticket.returnDateSeconds)}
            />
            <Fact label="Read at block" mono value={home.snapshot.blockNumber} />
          </Facts>
          <Actions>
            <Button
              icon={<ArrowDownLeftIcon />}
              label="Bring it back"
              onClick={() => {
                void actions.bringBack();
              }}
            />
          </Actions>
          <Live message={props.live} />
          <Note>
            It returns as a private note.
          </Note>
        </Screen>
      );

    case "returning":
      return (
        <Screen lede="Starknet is confirming it." title="Return submitted">
          <SafeFigure caption="On its way back" ticket={home.ticket} />
          <StatusLine icon={<CheckCircleIcon />}>Transaction submitted</StatusLine>
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            {props.live ?? "Checking Starknet"}
          </StatusLine>
          <SafeEvidence ticket={home.ticket} />
          <Actions>
            <Button
              icon={<ArrowsClockwiseIcon />}
              label="Check now"
              onClick={() => {
                void actions.refresh();
              }}
            />
          </Actions>
          <Note>You can close this screen. Checking resumes when you return.</Note>
        </Screen>
      );

    case "returned":
      return (
        <Screen title="Returned to Shielded Starknet">
          <Emblem>
            <CheckCircleIcon />
          </Emblem>
          <SafeFigure caption="Back in your private balance" ticket={home.ticket} />
          <Note>Open your wallet to spend or unshield it.</Note>
          <Facts>
            <Fact label="Read at block" mono value={home.snapshot.blockNumber} />
          </Facts>
          <SafeEvidence ticket={home.ticket} />
          <Actions>
            <Button
              label="Clear this safe"
              onClick={() => {
                void actions.clearTerminal();
              }}
              tone="quiet"
            />
          </Actions>
        </Screen>
      );

    case "released-early":
      return (
        <Screen
          lede="The reserve returned before the chosen date."
          title="Returned early"
          tone="alert"
        >
          <Emblem>
            <LockKeyOpenIcon />
          </Emblem>
          <SafeFigure caption="No longer held by the safe" ticket={home.ticket} />
          <Facts>
            <Fact label="Read at block" mono value={home.snapshot.blockNumber} />
          </Facts>
          <SafeEvidence ticket={home.ticket} />
          <Actions>
            <Button
              label="Clear this safe"
              onClick={() => {
                void actions.clearTerminal();
              }}
              tone="quiet"
            />
          </Actions>
        </Screen>
      );

    case "ready-recovery-submitted":
      return (
        <Screen
          center
          lede={
            home.status === "checking"
              ? "Starknet is confirming it."
              : home.status === "confirmed"
                ? "The reserve is back in your private balance."
                : "The transaction did not complete."
          }
          title={
            home.status === "checking"
              ? "Return submitted"
              : home.status === "confirmed"
                ? "Return confirmed"
                : "Return failed"
          }
          tone={home.status === "reverted" ? "alert" : undefined}
        >
          <Emblem>
            {home.status === "confirmed" ? (
              <CheckCircleIcon />
            ) : home.status === "reverted" ? (
              <WarningCircleIcon />
            ) : (
              <ArrowDownLeftIcon />
            )}
          </Emblem>
          <Balance
            caption="Returning"
            value={formatStrkFigure(home.amountFri)}
          />
          {home.status === "checking" ? (
            <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
              {props.live ?? "Checking Starknet"}
            </StatusLine>
          ) : (
            <StatusLine
              icon={
                home.status === "confirmed" ? (
                  <CheckCircleIcon />
                ) : (
                  <WarningCircleIcon />
                )
              }
              tone={home.status === "reverted" ? "alert" : undefined}
            >
              {home.status === "confirmed"
                ? "Confirmed on Starknet"
                : "Reverted on Starknet"}
            </StatusLine>
          )}
          <TransactionRef
            hash={shortHex(home.transactionHash)}
            href={explorer(home.transactionHash)}
            label="Check on Starkscan"
          />
          {home.status === "reverted" ? (
            <Actions>
              <Button
                label="Try again"
                onClick={() => {
                  void actions.bringBack();
                }}
              />
            </Actions>
          ) : null}
        </Screen>
      );

    case "local-unavailable":
      return (
        <Screen
          lede="Return after the date, or use an optional backup sooner."
          title="This browser lost its safe"
          tone="alert"
        >
          <Failure message={home.reason} />
          <Actions stack>
            <Button
              icon={<ReadyWalletMark className="wbtn__ready" />}
              label="Recover reserve"
              onClick={() => {
                void actions.bringBack();
              }}
            />
            <Button
              icon={<KeyIcon />}
              label="Use recovery backup"
              onClick={() => navigate("/recover")}
              tone="quiet"
            />
            <Button
              label="Forget this browser's safe"
              onClick={() => {
                void actions.forgetLocal();
              }}
              tone="quiet"
            />
          </Actions>
          <Note>Forgetting this browser does not move any STRK.</Note>
        </Screen>
      );

    case "chain-unavailable":
      return (
        <Screen
          lede="The status of your safe is unknown right now."
          title="Cannot read the chain"
          tone="alert"
        >
          <Failure message={home.reason} />
          <Actions>
            <Button
              icon={<ArrowsClockwiseIcon />}
              label="Try again"
              onClick={() => {
                void actions.refresh();
              }}
            />
          </Actions>
        </Screen>
      );
  }
}

function CreateFlow(props: {
  model: TravelSafeViewModel;
  actions: TravelSafeActions;
}): JSX.Element {
  const { actions, model } = props;

  switch (model.createStep) {
    case "connect":
      if (model.walletResolution?.kind === "install_extension") {
        return (
          <Screen
            center
            lede="Install the extension, then return here."
            onBack={actions.closeCreate}
            title="Get Ready Wallet"
          >
            <Emblem>
              <ReadyWalletMark className="emblem__ready" />
            </Emblem>
            <Actions>
              <a
                className="wbtn"
                href={model.walletResolution.href}
                rel="noreferrer noopener"
                target="_blank"
              >
                <span aria-hidden="true" className="wbtn__icon">
                  <ReadyWalletMark className="wbtn__ready" />
                </span>
                <span>{model.walletResolution.label}</span>
              </a>
              <Button
                icon={<ArrowsClockwiseIcon />}
                label="Try again"
                onClick={() => {
                  void actions.connect();
                }}
                tone="quiet"
              />
            </Actions>
          </Screen>
        );
      }
      return (
        <Screen
          center
          lede="Choose where the reserve returns."
          onBack={actions.closeCreate}
          title="Connect wallet"
        >
          <Emblem>
            <ReadyWalletMark className="emblem__ready" />
          </Emblem>
          {model.error === null ? null : <Failure message={model.error} />}
          <Actions>
            <Button
              disabled={model.preflight === "checking"}
              icon={<ReadyWalletMark className="wbtn__ready" />}
              iconMotion={model.live === null ? undefined : "spin"}
              label="Connect wallet"
              onClick={() => {
                void actions.connect();
              }}
            />
          </Actions>
          <Live message={model.live} />
          <Note>Your passkey protects early return.</Note>
        </Screen>
      );

    case "details":
      return (
        <Screen
          lede="The rest stays available."
          onBack={actions.back}
          title="What stays home"
        >
          <div className="wform">
            <WalletField
              hint={
                model.readiness === null
                  ? "1 STRK minimum"
                  : `1 STRK minimum · ${formatStrk(model.readiness.maxParkableFri)} available`
              }
              label="Amount to park"
            >
              {({ inputId, describedBy }) => (
                <input
                  aria-describedby={describedBy}
                  className="winput winput--mono"
                  id={inputId}
                  inputMode="decimal"
                  onChange={(event) => actions.setAmount(event.target.value)}
                  placeholder="0.0"
                  value={model.amount}
                />
              )}
            </WalletField>
            <WalletField
              hint="Two hours to ninety days from now, in your local time."
              label="Return date"
            >
              {({ inputId, describedBy }) => (
                <input
                  aria-describedby={describedBy}
                  className="winput winput--mono"
                  id={inputId}
                  onChange={(event) =>
                    actions.setReturnDateLocal(event.target.value)
                  }
                  type="datetime-local"
                  value={model.returnDateLocal}
                />
              )}
            </WalletField>
          </div>
          {model.error === null ? null : <Failure message={model.error} />}
          <Actions>
            <Button
              label="Continue"
              onClick={() => {
                void actions.continueFromDetails();
              }}
            />
          </Actions>
        </Screen>
      );

    case "review": {
      const returnDate = localReturnDate(model.returnDateLocal);
      return (
        <Screen
          lede="Check the amount and return date."
          onBack={actions.back}
          title="Review"
        >
          <Facts>
            <Fact
              label="Parking"
              strong
              value={<Amount value={model.amount} />}
            />
            {returnDate === null ? null : (
              <Fact label="Returns on" strong value={returnDate} />
            )}
            {model.walletAccount === null ? null : (
              <Fact
                full={model.walletAccount}
                label="Return account"
                mono
                value={shortHex(model.walletAccount)}
              />
            )}
            {model.readiness === null ? null : (
              <Fact
                label="Return fee held back"
                value={<Amount value={formatStrk(model.readiness.returnReserveFri)} />}
              />
            )}
            {model.readiness === null ? null : (
              <Fact
                label="Private balance now"
                value={
                  <Amount value={formatStrk(model.readiness.shieldedBalanceFri)} />
                }
              />
            )}
          </Facts>
          {model.error === null ? null : <Failure message={model.error} />}
          <Actions>
            <Button
              icon={<LockSimpleIcon />}
              label="Prepare cost"
              onClick={() => {
                void actions.prepare();
              }}
            />
          </Actions>
          <Note>No recovery phrase needed.</Note>
        </Screen>
      );
    }

    case "quote": {
      const quote = model.fundQuote;
      if (quote === null) {
        return (
          <Screen center title="Preparing the cost">
            {model.fundProgress === null ? null : (
              <FundProgress progress={model.fundProgress} />
            )}
            <Live message={model.live} />
          </Screen>
        );
      }
      const estimatedTotalFri = addFri(
        quote.poolFeeFri,
        quote.estimatedTransactionFeeFri,
      );
      return (
        <Screen
          onBack={actions.back}
          title="Confirm the cost"
        >
          {model.fundProgress === null ? null : (
            <FundProgress progress={model.fundProgress} />
          )}
          <Facts>
            <Fact
              label="Safe receives"
              strong
              value={<Amount value={model.amount} />}
            />
            <Fact
              label="Privacy fee"
              value={<Amount value={formatStrk(quote.poolFeeFri)} />}
            />
            <Fact
              label="Network fee estimate"
              value={
                <Amount value={formatStrk(quote.estimatedTransactionFeeFri)} />
              }
            />
            <Fact
              label="Estimated total"
              strong
              value={<Amount value={formatStrk(estimatedTotalFri)} />}
            />
            <Fact
              label="Spend limit"
              value={<Amount value={formatStrk(quote.maxSpendFri)} />}
            />
          </Facts>
          <Actions>
            <Button
              icon={<LockSimpleIcon />}
              label="Confirm and park"
              onClick={() => {
                void actions.park();
              }}
            />
          </Actions>
          <Note>Cost changes stop before broadcast.</Note>
        </Screen>
      );
    }

    case "parking":
      return (
        <Screen center title="Sending transaction">
          {model.fundProgress === null ? null : (
            <FundProgress progress={model.fundProgress} />
          )}
          <Live message={model.live} />
          <Waiting seconds={model.elapsedSeconds} />
          <Note>Close after a transaction reference appears.</Note>
        </Screen>
      );

    case "closed":
      return <Screen>{null}</Screen>;
  }
}
