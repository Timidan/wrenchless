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
  "words",
  "confirm-words",
  "review",
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
          label="Parked"
        />
      )}
      {returnTransactionHash === null ? null : (
        <TransactionRef
          hash={shortHex(returnTransactionHash)}
          href={explorer(returnTransactionHash)}
          label="Returned"
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

export function SafeSurface(): JSX.Element {
  const { model, actions } = useTravelSafe();
  const { home, createStep } = model;
  const creating = createStep !== "closed";
  const stepIndex = CREATE_STEPS.indexOf(createStep);

  const detail =
    model.walletAccount === null
      ? "Starknet mainnet"
      : shortHex(model.walletAccount);

  const canRefresh =
    !creating &&
    home.name !== "loading" &&
    home.name !== "no-local-safe" &&
    home.name !== "device-locked";

  return (
    <ProductFrame
      action={
        canRefresh ? (
          <button
            aria-label="Check the chain again"
            className="iconbtn"
            onClick={() => {
              void actions.refresh();
            }}
            type="button"
          >
            <span aria-hidden="true">
              <ArrowsClockwiseIcon />
            </span>
          </button>
        ) : undefined
      }
      detail={detail}
      label={creating ? "New Travel Safe" : "Travel Safe"}
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
      {creating ? (
        <CreateFlow actions={actions} model={model} />
      ) : (
        <Home
          actions={actions}
          error={model.error}
          home={home}
          live={model.live}
        />
      )}
    </ProductFrame>
  );
}

function Home(props: {
  home: SafeHomeState;
  error: string | null;
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
          lede="Park private STRK until the day you are home."
          title="No safe on this device"
        >
          <Emblem>
            <SuitcaseRollingIcon />
          </Emblem>
          <Note>Create one here, or recover one with its twelve words.</Note>
          <Actions>
            <Button
              icon={<LockSimpleIcon />}
              label="Create a safe"
              onClick={actions.startCreate}
            />
          </Actions>
          <Actions>
            <Button
              label="Recover with your words"
              onClick={() => navigate("/recover")}
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
          <Actions>
            <Button
              icon={<KeyIcon />}
              label="Unlock"
              onClick={() => {
                void actions.unlock();
              }}
            />
          </Actions>
          <Actions>
            <Button
              label="Recover with your words"
              onClick={() => navigate("/recover")}
              tone="quiet"
            />
          </Actions>
        </Screen>
      );

    case "setup-incomplete":
      return (
        <Screen
          lede="Your words are confirmed. The reserve has not been parked yet."
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
          lede="The helper has not reported it funded yet."
          title="Parking your reserve"
        >
          <SafeFigure caption="On its way to the safe" ticket={home.ticket} />
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Waiting for the transaction to land
          </StatusLine>
          {props.error === null ? null : <Failure message={props.error} />}
          <SafeEvidence ticket={home.ticket} />
          <Actions>
            <Button
              icon={<ArrowsClockwiseIcon />}
              label="Check again"
              onClick={() => {
                void actions.refresh();
              }}
            />
          </Actions>
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
          <StatusLine icon={<HourglassIcon />}>
            This device cannot bring it back before that date.
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
              label="Recover with your words"
              onClick={() => navigate("/recover")}
              tone="quiet"
            />
          </Actions>
          <Note>Only the twelve words can release it early.</Note>
        </Screen>
      );

    case "return-ready":
      return (
        <Screen lede="The return date has passed." title="Ready to return">
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
            Ready signs the return and receives it as a private note.
          </Note>
        </Screen>
      );

    case "returning":
      return (
        <Screen lede="Ready is building the private note." title="Returning">
          <SafeFigure caption="On its way back" ticket={home.ticket} />
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Waiting for the transaction to land
          </StatusLine>
          <SafeEvidence ticket={home.ticket} />
          <Actions>
            <Button
              icon={<ArrowsClockwiseIcon />}
              label="Check again"
              onClick={() => {
                void actions.refresh();
              }}
            />
          </Actions>
        </Screen>
      );

    case "returned":
      return (
        <Screen title="Returned to Shielded Starknet">
          <Emblem>
            <CheckCircleIcon />
          </Emblem>
          <SafeFigure caption="Back in your private balance" ticket={home.ticket} />
          <Note>Open Ready to spend or unshield it.</Note>
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
          lede="Someone used the twelve words before the return date."
          title="Released early"
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

    case "local-unavailable":
      return (
        <Screen
          lede="The saved key is missing or unreadable. Your twelve words still work."
          title="This browser lost its safe"
          tone="alert"
        >
          <Failure message={home.reason} />
          <Actions>
            <Button
              label="Forget this device's safe"
              onClick={() => {
                void actions.forgetLocal();
              }}
              tone="quiet"
            />
          </Actions>
          <Note>This clears only this browser. It does not move any STRK.</Note>
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
      return (
        <Screen
          center
          lede="Ready is the only wallet that signs, and the only place your reserve comes back to."
          onBack={actions.closeCreate}
          title="Connect Ready"
        >
          <Emblem>
            <ReadyWalletMark className="emblem__ready" />
          </Emblem>
          {model.error === null ? null : <Failure message={model.error} />}
          <Actions>
            <Button
              icon={<ReadyWalletMark className="wbtn__ready" />}
              iconMotion={model.live === null ? undefined : "spin"}
              label="Connect Ready"
              onClick={() => {
                void actions.connect();
              }}
            />
          </Actions>
          <Live message={model.live} />
          <Note>
            Wrenchless also asks for a passkey on this device, so only you can
            open the safe here.
          </Note>
        </Screen>
      );

    case "details":
      return (
        <Screen
          lede="Everything else stays in Ready and travels with you."
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

    case "words":
      return (
        <Screen
          lede="Write them down and leave them at home."
          onBack={actions.back}
          title="Your recovery words"
        >
          {model.recoveryPhrase === null ? null : (
            <Phrase words={model.recoveryPhrase.split(" ")} />
          )}
          <Note tone="caution">
            These words release the safe early. Anyone who has them can bring
            the reserve back before your return date.
          </Note>
          <Note>Wrenchless never stores them. They are shown once.</Note>
          <Actions>
            <Button
              label="I have written them down"
              onClick={actions.showPhraseConfirmation}
            />
          </Actions>
        </Screen>
      );

    case "confirm-words":
      return (
        <Screen
          lede="Type all twelve, in order, to prove the copy is good."
          onBack={actions.back}
          title="Confirm your words"
        >
          <WalletField error={model.error} label="Recovery words">
            {({ inputId, describedBy }) => (
              <textarea
                aria-describedby={describedBy}
                autoCapitalize="none"
                autoCorrect="off"
                className="winput winput--paste"
                id={inputId}
                onChange={(event) => actions.setConfirmation(event.target.value)}
                rows={4}
                spellCheck={false}
                value={model.confirmation}
              />
            )}
          </WalletField>
          <Actions>
            <Button
              disabled={model.confirmation.trim().length === 0}
              label="Confirm"
              onClick={() => {
                void actions.confirmPhrase();
              }}
            />
          </Actions>
        </Screen>
      );

    case "review": {
      const returnDate = localReturnDate(model.returnDateLocal);
      return (
        <Screen
          lede="Check it once. The return date cannot be changed afterwards."
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
                label="Ready account"
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
              label="Park it"
              onClick={() => {
                void actions.park();
              }}
            />
          </Actions>
          <Note>
            Ready prepares the proof and hands it straight to the sponsor.
          </Note>
        </Screen>
      );
    }

    case "parking":
      return (
        <Screen
          center
          lede="Ready is proving it privately. This takes as long as it takes."
          title="Parking your reserve"
        >
          <Emblem>
            <LockSimpleIcon />
          </Emblem>
          <Waiting seconds={model.elapsedSeconds} />
          <Live message={model.live} />
          <Note>Keep this screen open until it lands.</Note>
        </Screen>
      );

    case "closed":
      return <Screen>{null}</Screen>;
  }
}
