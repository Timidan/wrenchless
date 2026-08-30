import { formatTokenAmount } from "@wrenchless/canary-core";
import type { JSX } from "react";
import { useState } from "react";

import {
  EXPLORER_BASE,
  formatStrk,
  formatUnixSeconds,
  reasonFrom,
  shortHex,
} from "../../../adapters/amount";
import { StrkTokenMark } from "../../../components/StrkTokenMark";
import { UsdcTokenMark } from "../../../components/UsdcTokenMark";
import {
  ArrowDownLeftIcon,
  ArrowsClockwiseIcon,
  CalendarPlusIcon,
  CheckCircleIcon,
  ClockClockwiseIcon,
  FingerprintIcon,
  HourglassIcon,
  KeyIcon,
  LockKeyOpenIcon,
  LockSimpleIcon,
  PlusCircleIcon,
  ShieldCheckIcon,
  SuitcaseRollingIcon,
  WalletIcon,
  WarningCircleIcon,
} from "../../../components/icons";
import {
  Actions,
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
  WalletField,
} from "../../shared/product";
import type {
  SafeActionState,
  SafeAssetView,
  SafeReadinessCheck,
  SafeApprovalStep,
  SafeV3Phase,
  TravelSafeV3Actions,
  TravelSafeV3Model,
} from "../travel-safe-model";
import { useTravelSafeV3 } from "../useTravelSafeV3";
import { SafeAmount, SafeBalance, type SafeAssetSymbol } from "./SafeAsset";
import { safeActionBusy, SafeActionProgress } from "./SafeActionProgress";

/**
 * The Trip Allowance, on the one device that holds it.
 *
 * New Safes and every v3 ticket live here, on `useTravelSafeV3`. Like
 * `SafeSurfaceV2`, the surface has exactly one subject at a time and nothing
 * here computes: amounts, fees, the schedule and the release decision all
 * arrive from the controller as they were read, and this file only chooses
 * words, order and motion for them.
 */

const CREATE_STEPS: readonly SafeV3Phase[] = [
  "connect",
  "readiness",
  "plan",
  "recovery",
  "review",
  "quote",
];

const LOCK_PRESETS = [25, 50, 75, 100] as const;

/** A failure, in the words the controller already wrote for a person. */
function Failure(props: { message: string }): JSX.Element {
  return (
    <div role="alert">
      <StatusLine icon={<WarningCircleIcon />} tone="alert">
        {props.message}
      </StatusLine>
    </div>
  );
}

/**
 * One error, never two. An in-flight or settled action already has its own
 * truthful line in `SafeActionProgress`; a screen only falls back to the
 * controller's general `error` field when nothing else is reporting on it —
 * a stale read failure on the active screen, for instance.
 */
function SafeStatus(props: {
  action: SafeActionState;
  error: string | null;
}): JSX.Element | null {
  if (props.action.name !== "idle") {
    return <SafeActionProgress action={props.action} />;
  }
  if (props.error !== null) return <Failure message={props.error} />;
  return null;
}

function assetMarkFor(symbol: SafeAssetSymbol): JSX.Element {
  return symbol === "USDC" ? (
    <UsdcTokenMark />
  ) : (
    <StrkTokenMark />
  );
}

export function SafeSurfaceV3(): JSX.Element {
  const { model, actions } = useTravelSafeV3();
  const stepIndex = CREATE_STEPS.indexOf(model.phase);
  const creating = stepIndex >= 0;
  const canRefresh = model.phase === "active" || model.phase === "terminal";

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
      detail={
        model.walletAccount === null
          ? "Starknet mainnet"
          : shortHex(model.walletAccount)
      }
      label={creating ? "New Trip Allowance" : "Trip Allowance"}
      role="safe"
      step={
        creating
          ? {
              display: `${String(stepIndex + 1)}/${String(CREATE_STEPS.length)}`,
              label: `Step ${String(stepIndex + 1)} of ${String(CREATE_STEPS.length)}`,
            }
          : undefined
      }
    >
      <Phase actions={actions} model={model} />
    </ProductFrame>
  );
}

function Phase(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
}): JSX.Element {
  const { actions, model } = props;

  switch (model.phase) {
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

    case "unavailable":
      return (
        <Screen
          center
          lede="This network isn't ready for it yet. Check back soon."
          title="Trip Allowance opens soon"
        >
          <Emblem>
            <HourglassIcon />
          </Emblem>
        </Screen>
      );

    case "device-locked":
      return (
        <Screen
          center
          lede="Verify with your passkey to see it."
          title="This device holds a Trip Allowance"
        >
          <Emblem>
            <FingerprintIcon />
          </Emblem>
          <SafeStatus action={model.action} error={model.error} />
          <Actions>
            <Button
              icon={<KeyIcon />}
              label="Unlock"
              onClick={() => {
                void actions.unlock();
              }}
            />
          </Actions>
        </Screen>
      );

    case "empty":
      return (
        <Screen
          center
          lede="Park most of a private balance and keep a daily allowance."
          title="No Trip Allowance yet"
        >
          <Emblem>
            <SuitcaseRollingIcon />
          </Emblem>
          <SafeStatus action={model.action} error={model.error} />
          <Actions>
            <Button
              icon={<SuitcaseRollingIcon />}
              label="Start a Trip Allowance"
              onClick={actions.startCreate}
            />
          </Actions>
        </Screen>
      );

    case "connect":
      return (
        <Screen
          center
          lede="Choose the account that funds it and can bring it home."
          onBack={actions.closeCreate}
          title="Connect wallet"
        >
          <Emblem>
            <WalletIcon />
          </Emblem>
          <Actions>
            <Button
              disabled={safeActionBusy(model.action)}
              icon={<WalletIcon />}
              iconMotion={model.action.name === "wallet" ? "spin" : undefined}
              label="Connect wallet"
              onClick={() => {
                void actions.connect();
              }}
            />
          </Actions>
          <SafeStatus action={model.action} error={model.error} />
        </Screen>
      );

    case "readiness":
      return <ReadinessScreen actions={actions} model={model} />;

    case "plan":
      return <PlanScreen actions={actions} model={model} />;

    case "recovery":
      return <RecoveryScreen actions={actions} model={model} />;

    case "review":
      return <ReviewScreen actions={actions} model={model} />;

    case "quote":
      return <QuoteScreen actions={actions} model={model} />;

    case "active":
      return <ActiveHome actions={actions} model={model} />;

    case "terminal":
      return <TerminalScreen actions={actions} model={model} />;
  }
}

const READINESS_ICONS = {
  checking: ArrowsClockwiseIcon,
  ready: CheckCircleIcon,
  blocked: WarningCircleIcon,
} satisfies Record<SafeReadinessCheck["status"], typeof ArrowsClockwiseIcon>;

const READINESS_WORDS = {
  checking: "Checking",
  ready: "Ready",
  blocked: "Not ready",
} satisfies Record<SafeReadinessCheck["status"], string>;

function ReadinessRow(props: { check: SafeReadinessCheck }): JSX.Element {
  const { check } = props;
  const spinning = check.status === "checking";
  const Icon = READINESS_ICONS[check.status];
  return (
    <li className="wcheck" data-status={check.status}>
      <span
        aria-hidden="true"
        className="wcheck__icon"
        data-icon-motion={spinning ? "spin" : undefined}
      >
        <Icon />
      </span>
      <span className="wcheck__body">
        <span className="wcheck__label">{check.label}</span>
        <span className="visually-hidden">{READINESS_WORDS[check.status]}</span>
        <span className="wcheck__detail">{check.detail}</span>
      </span>
    </li>
  );
}

function ReadinessScreen(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
}): JSX.Element {
  const { actions, model } = props;
  const readiness = model.readiness;
  const busy = safeActionBusy(model.action);

  return (
    <Screen
      lede="A few checks before the plan, so nothing stops halfway."
      onBack={actions.closeCreate}
      title="Trip readiness"
    >
      {readiness === null ? (
        <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
          Checking this trip
        </StatusLine>
      ) : (
        <ul aria-busy={readiness.status === "checking" ? "true" : undefined} className="wchecks">
          {readiness.checks.map((check) => (
            <ReadinessRow check={check} key={check.id} />
          ))}
        </ul>
      )}
      {readiness?.status === "ready" ? (
        <Actions>
          <Button
            disabled={busy}
            icon={<ShieldCheckIcon />}
            label="Continue"
            onClick={actions.continueFromReadiness}
          />
        </Actions>
      ) : null}
      {readiness?.status === "blocked" ? (
        <Actions>
          <Button
            disabled={busy}
            icon={<ArrowsClockwiseIcon />}
            iconMotion={busy ? "spin" : undefined}
            label="Check again"
            onClick={() => {
              void actions.checkReadiness();
            }}
          />
        </Actions>
      ) : null}
      <Note>The exact cost comes after the plan.</Note>
    </Screen>
  );
}

/**
 * A labelled group of buttons — a segmented choice or a row of chips —
 * dressed exactly like `WalletField` without the dangling `<label for>` a
 * text input needs and a button group does not: the group speaks for itself
 * through `role="group"` and its own `aria-label`, and the visible label here
 * is prose beside it rather than a control pointed at nothing.
 */
function FieldGroup(props: {
  label: string;
  hint?: string | undefined;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="wfield">
      <span className="wfield__label">{props.label}</span>
      {props.children}
      {props.hint === undefined ? null : <p className="wfield__hint">{props.hint}</p>}
    </div>
  );
}

function AssetPicker(props: {
  assets: readonly SafeAssetView[];
  selected: string;
  onSelect: (tokenAddress: string) => void;
}): JSX.Element {
  return (
    <div aria-label="Asset" className="wsegment" role="group">
      {props.assets.map((asset) => (
        <button
          aria-pressed={BigInt(asset.tokenAddress) === BigInt(props.selected)}
          className="wsegment__option"
          disabled={!asset.available}
          key={asset.tokenAddress}
          onClick={() => props.onSelect(asset.tokenAddress)}
          type="button"
        >
          <span aria-hidden="true" className="wsegment__icon">
            {assetMarkFor(asset.symbol)}
          </span>
          <span>{asset.symbol}</span>
        </button>
      ))}
    </div>
  );
}

function PlanScreen(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
}): JSX.Element {
  const { actions, model } = props;
  const [localError, setLocalError] = useState<string | null>(null);
  const asset =
    model.assets.find(
      (item) => BigInt(item.tokenAddress) === BigInt(model.plan.tokenAddress),
    ) ?? null;

  async function handleContinue(): Promise<void> {
    setLocalError(null);
    try {
      await actions.showRecoveryWords();
    } catch (cause) {
      setLocalError(reasonFrom(cause));
    }
  }

  return (
    <Screen
      lede="Choose the asset, what stays parked, and the schedule."
      onBack={actions.closeCreate}
      title="Set up the allowance"
    >
      <FieldGroup label="Asset">
        <AssetPicker
          assets={model.assets}
          onSelect={(tokenAddress) => actions.selectAsset(tokenAddress)}
          selected={model.plan.tokenAddress}
        />
      </FieldGroup>
      {asset === null ? null : (
        <Note>
          {!asset.available
            ? `${asset.symbol} is temporarily unavailable from your wallet.`
            : asset.hasPublicBalance
              ? `${asset.shieldedBalance} ${asset.symbol} private and ${asset.publicBalance} ${asset.symbol} still in your wallet, plus ${asset.returnFeeStrk} STRK reserved for the return. Anything parked from the wallet moves into your private balance inside the funding transaction, after one approval.`
              : `${asset.shieldedBalance} ${asset.symbol} private now, plus ${asset.returnFeeStrk} STRK reserved for the return.`}
        </Note>
      )}
      <div className="wform">
        <FieldGroup hint="Fills in the amount to park from what's left." label="Lock Most">
          <div aria-label="Lock Most" className="wchips" role="group">
            {LOCK_PRESETS.map((percent) => (
              <button
                className="wchip"
                disabled={asset === null || !asset.available}
                key={percent}
                onClick={() => actions.applyLockPreset(percent)}
                type="button"
              >
                {percent}%
              </button>
            ))}
          </div>
        </FieldGroup>
        <WalletField label="Keep out">
          {({ inputId, describedBy }) => (
            <input
              aria-describedby={describedBy}
              className="winput winput--mono"
              id={inputId}
              inputMode="decimal"
              onChange={(event) =>
                actions.setPlanField("keepAmount", event.target.value)
              }
              placeholder="0.0"
              value={model.plan.keepAmount}
            />
          )}
        </WalletField>
        <WalletField label="Park">
          {({ inputId, describedBy }) => (
            <input
              aria-describedby={describedBy}
              className="winput winput--mono"
              id={inputId}
              inputMode="decimal"
              onChange={(event) =>
                actions.setPlanField("parkAmount", event.target.value)
              }
              placeholder="0.0"
              value={model.plan.parkAmount}
            />
          )}
        </WalletField>
        <FieldGroup label="Schedule">
          <div aria-label="Schedule" className="wsegment" role="group">
            <button
              aria-pressed={model.plan.mode === "single"}
              className="wsegment__option"
              onClick={() => actions.setPlanField("mode", "single")}
              type="button"
            >
              One return date
            </button>
            <button
              aria-pressed={model.plan.mode === "daily"}
              className="wsegment__option"
              onClick={() => actions.setPlanField("mode", "daily")}
              type="button"
            >
              Daily allowance
            </button>
          </div>
        </FieldGroup>
        {model.plan.mode === "daily" ? (
          <>
            <WalletField
              hint="Released once each day, from the first release."
              label={`Daily allowance${asset === null ? "" : ` (${asset.symbol})`}`}
            >
              {({ inputId, describedBy }) => (
                <input
                  aria-describedby={describedBy}
                  className="winput winput--mono"
                  id={inputId}
                  inputMode="decimal"
                  onChange={(event) =>
                    actions.setPlanField("dailyAmount", event.target.value)
                  }
                  placeholder="0.0"
                  value={model.plan.dailyAmount}
                />
              )}
            </WalletField>
            <WalletField label="First release">
              {({ inputId, describedBy }) => (
                <input
                  aria-describedby={describedBy}
                  className="winput winput--mono"
                  id={inputId}
                  onChange={(event) =>
                    actions.setPlanField("firstReleaseLocal", event.target.value)
                  }
                  type="datetime-local"
                  value={model.plan.firstReleaseLocal}
                />
              )}
            </WalletField>
          </>
        ) : null}
        <WalletField hint="Within 180 days." label="Return date">
          {({ inputId, describedBy }) => (
            <input
              aria-describedby={describedBy}
              className="winput winput--mono"
              id={inputId}
              onChange={(event) =>
                actions.setPlanField("returnDateLocal", event.target.value)
              }
              type="datetime-local"
              value={model.plan.returnDateLocal}
            />
          )}
        </WalletField>
      </div>
      {localError === null ? null : <Failure message={localError} />}
      <Actions>
        <Button
          label="Continue"
          onClick={() => {
            void handleContinue();
          }}
        />
      </Actions>
    </Screen>
  );
}

/**
 * The one moment the twelve words exist on screen.
 *
 * They arrive concealed and copyable, and nothing here asks for them back.
 * The type-back that used to gate this screen proved only that the words were
 * still on the screen being read from — a person who copied them into a
 * password manager had to retype all twelve to get past it, and a person who
 * saved nothing could pass it by looking up. The honest guard is the phrase
 * itself: it is shown once, said plainly, and Wrenchless cannot show it again.
 */
function RecoveryScreen(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
}): JSX.Element {
  const { actions, model } = props;
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Nobody gets past their only copy of the phrase without having put it in
   * front of themselves once. Revealing or copying both count; typing is
   * still not asked for.
   */
  const [seen, setSeen] = useState(false);

  async function handleConfirm(): Promise<void> {
    setLocalError(null);
    setBusy(true);
    try {
      await actions.confirmRecoveryWords();
    } catch (cause) {
      setLocalError(reasonFrom(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      lede="They bring the whole reserve back before the return date — on this device too."
      onBack={actions.closeCreate}
      title="Save these words once"
    >
      <Phrase
        conceal
        onSeen={() => setSeen(true)}
        words={(model.recoveryWords ?? "").split(" ")}
      />
      <Note tone="caution">
        {seen
          ? "Save them now. Wrenchless never shows them again, and nobody can reissue them."
          : "Reveal or copy the words first. Wrenchless never shows them again, and nobody can reissue them."}
      </Note>
      {localError === null ? null : <Failure message={localError} />}
      <Actions>
        <Button
          disabled={busy || !seen}
          icon={<KeyIcon />}
          iconMotion={busy ? "spin" : undefined}
          label="I saved them"
          onClick={() => {
            void handleConfirm();
          }}
        />
      </Actions>
    </Screen>
  );
}

/**
 * The one ordinary, public transaction the product asks for.
 *
 * Shielding used to be its own transaction, and it could never have worked: a
 * bundle holding nothing but a deposit carries no nullifier and no random, and
 * the pool refuses it as NO_REPLAY_PROTECTION. The deposit now rides inside
 * the funding transaction, where the withdrawal supplies both — which leaves
 * only the permission to take the money, and only the account can give that.
 *
 * The amount is exact. An allowance that outlives the transaction it was for
 * is a standing permission nobody asked to keep.
 */
function ApprovalStep(props: {
  approval: SafeApprovalStep;
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
}): JSX.Element {
  const { actions, approval, model } = props;
  const busy = safeActionBusy(model.action);
  const sent = approval.sent;
  return (
    <>
      <Facts>
        <Fact
          label="Allow the pool to take"
          strong
          value={<SafeAmount symbol={approval.symbol} value={approval.amount} />}
        />
        {/* A total on its own is unexplainable: somebody holding exactly the
            ten STRK they mean to park is still asked for six more, and without
            this the six reads as a deposit the app has lost track of. */}
        {approval.towardAmount === "0" || approval.towardReserve === "0" ? null : (
          <Fact
            label="Of which"
            value={`${approval.towardAmount} to park, ${approval.towardReserve} action fee`}
          />
        )}
      </Facts>
      {approval.towardAmount !== "0" ? null : (
        <Note>
          You already hold what you are parking. The {approval.amount}{" "}
          {approval.symbol} is the pool&apos;s action fee, which has to be
          private and has to still be there afterwards — it is what pays to
          release the money or bring it home.
        </Note>
      )}
      <Note>
        {sent
          ? "The approval is on its way. The exact fee follows once it is onchain."
          : `This is an ordinary Starknet transaction and the only one you send yourself: it lets the privacy pool take exactly ${approval.amount} ${approval.symbol}, and nothing more. The money moves into your private balance inside the funding transaction itself, so there is no separate shield and nothing to wait for afterwards.`}
      </Note>
      <SafeStatus action={model.action} error={model.error} />
      {approval.transactionHash === null ? null : (
        <TransactionRef
          hash={shortHex(approval.transactionHash)}
          href={`${EXPLORER_BASE}${approval.transactionHash}`}
          label="Approval"
        />
      )}
      <Actions>
        <Button
          disabled={busy}
          icon={<ShieldCheckIcon />}
          iconMotion={busy ? "guard" : undefined}
          label={sent ? "Check the approval" : "Approve in wallet"}
          onClick={() => {
            void actions.approveNow();
          }}
        />
        {/* Never disabled. A wallet that goes quiet must not be able to trap
            somebody on this screen with both controls greyed out. */}
        <Button
          label={busy ? "Stop waiting" : "Not now"}
          onClick={actions.dismissApproval}
          tone="quiet"
        />
      </Actions>
    </>
  );
}

function ReviewScreen(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
}): JSX.Element {
  const { actions, model } = props;
  const ticket = model.ticket;
  const [recoveryInput, setRecoveryInput] = useState("");
  if (ticket === null) {
    return (
      <Screen center title="Preparing">
        <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
          Preparing
        </StatusLine>
      </Screen>
    );
  }
  const daily = BigInt(ticket.dailyAmountBaseUnits) > 0n;
  const busy = safeActionBusy(model.action);
  const needsRecoveryWords = model.recoveryWords === null;
  /**
   * A ticket outlives the browser session that made it, so this screen can be
   * reached with no wallet attached — after a reload, say. Asking for the fee
   * needs the funding account, so the connect step is offered here in its
   * place rather than behind a button that could only fail.
   */
  const connected = model.walletAccount !== null;
  const approval = model.approval?.purpose === "fund" ? model.approval : null;
  const missingWords = needsRecoveryWords && recoveryInput.trim() === "";
  return (
    <Screen lede="Check the plan before the exact fee." title="Review">
      <Facts>
        <Fact label="Asset" value={ticket.tokenSymbol} />
        <Fact
          label="Parking"
          strong
          value={
            <SafeAmount
              symbol={ticket.tokenSymbol}
              value={formatTokenAmount(
                BigInt(ticket.amountBaseUnits),
                ticket.tokenDecimals,
              )}
            />
          }
        />
        {daily ? (
          <Fact
            label="Daily allowance"
            value={
              <SafeAmount
                symbol={ticket.tokenSymbol}
                value={formatTokenAmount(
                  BigInt(ticket.dailyAmountBaseUnits),
                  ticket.tokenDecimals,
                )}
              />
            }
          />
        ) : null}
        {daily ? (
          <Fact
            label="First release"
            value={formatUnixSeconds(ticket.firstReleaseSeconds)}
          />
        ) : null}
        <Fact
          label="Return date"
          strong
          value={formatUnixSeconds(ticket.returnDateSeconds)}
        />
      </Facts>
      {needsRecoveryWords ? (
        <WalletField
          hint="Funding proves this Safe can be brought back early, and only these words can prove that. They were never stored, so they are asked for once per session — not sent anywhere, and used on this device only."
          label="Recovery words"
        >
          {({ inputId, describedBy }) => (
            <textarea
              aria-describedby={describedBy}
              className="winput winput--paste"
              id={inputId}
              onChange={(event) => {
                setRecoveryInput(event.target.value);
                actions.setRecoveryWords(event.target.value);
              }}
              rows={3}
              value={recoveryInput}
            />
          )}
        </WalletField>
      ) : null}
      {connected ? null : (
        <Note>Connect the wallet that funds this allowance to price it.</Note>
      )}
      {approval !== null && connected ? (
        <ApprovalStep actions={actions} approval={approval} model={model} />
      ) : (
        <>
          <SafeStatus action={model.action} error={model.error} />
          {busy ? (
            <Note>
              Your wallet builds the private proof itself, which can take a
              minute or two and asks for your approval first. Nothing is sent
              until you have seen the fee.
            </Note>
          ) : null}
          <Actions>
            {connected ? (
              <Button
                disabled={busy || missingWords}
                icon={<LockSimpleIcon />}
                iconMotion={busy ? "spin" : undefined}
                label="Get exact fee"
                onClick={() => {
                  void actions.prepareFund();
                }}
              />
            ) : (
              <Button
                disabled={busy}
                icon={<WalletIcon />}
                iconMotion={model.action.name === "wallet" ? "spin" : undefined}
                label="Connect wallet"
                onClick={() => {
                  void actions.connect();
                }}
              />
            )}
            {busy ? (
              <Button
                label="Stop waiting"
                onClick={actions.cancelPreparation}
                tone="quiet"
              />
            ) : null}
          </Actions>
          {/* A disabled control that does not say what it wants is the whole
              reason somebody stares at this screen. */}
          {missingWords ? (
            <Note>Type the twelve words above to price this Safe.</Note>
          ) : null}
        </>
      )}
      <Note>
        {approval === null
          ? "Nothing broadcasts until you confirm the fee, unless part of the amount is still in your wallet — then one approval goes first."
          : "Only the approval broadcasts now, and only after you send it from your wallet."}
      </Note>
      {/* This Safe exists on this device and nowhere else until it is funded,
          so abandoning it costs nothing and strands nothing. Without it a
          half-finished setup can only be escaped by clearing site data. */}
      <Actions>
        <Button
          disabled={busy}
          label="Start over"
          onClick={() => {
            void actions.discardUnfundedSafe();
          }}
          tone="quiet"
        />
      </Actions>
    </Screen>
  );
}

function QuoteScreen(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
}): JSX.Element {
  const { actions, model } = props;
  const { quote, ticket } = model;
  if (ticket === null) {
    return (
      <Screen center title="Preparing">
        <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
          Preparing
        </StatusLine>
      </Screen>
    );
  }
  if (quote === null) {
    return (
      <Screen center title="Preparing the cost">
        <SafeStatus action={model.action} error={model.error} />
        <Live message={model.live} />
      </Screen>
    );
  }
  const total = (
    BigInt(quote.poolFeeFri) + BigInt(quote.estimatedTransactionFeeFri)
  ).toString();
  const locked = safeActionBusy(model.action) || model.action.name === "confirmed";
  return (
    <Screen title="Confirm the cost">
      <Facts>
        <Fact
          label="Funds"
          strong
          value={
            <SafeAmount
              symbol={ticket.tokenSymbol}
              value={formatTokenAmount(
                BigInt(ticket.amountBaseUnits),
                ticket.tokenDecimals,
              )}
            />
          }
        />
        <Fact label="Privacy fee" value={<SafeAmount symbol="STRK" value={formatStrk(quote.poolFeeFri)} />} />
        <Fact
          label="Network fee estimate"
          value={<SafeAmount symbol="STRK" value={formatStrk(quote.estimatedTransactionFeeFri)} />}
        />
        <Fact
          label="Estimated total"
          strong
          value={<SafeAmount symbol="STRK" value={formatStrk(total)} />}
        />
        <Fact label="Spend limit" value={<SafeAmount symbol="STRK" value={formatStrk(quote.maxSpendFri)} />} />
      </Facts>
      <SafeStatus action={model.action} error={model.error} />
      <Actions>
        <Button
          disabled={locked}
          icon={<LockSimpleIcon />}
          iconMotion={safeActionBusy(model.action) ? "spin" : undefined}
          label="Confirm and fund"
          onClick={() => {
            void actions.submitFund();
          }}
        />
      </Actions>
      <Note>Cost changes stop before broadcast.</Note>
    </Screen>
  );
}

type ActiveSubview = "none" | "topup" | "extend" | "early" | "drill";

function ActiveHome(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
}): JSX.Element {
  const { actions, model } = props;
  const [subview, setSubview] = useState<ActiveSubview>("none");
  const ticket = model.ticket;
  const state = model.snapshot?.state ?? null;

  if (ticket === null || state === null) {
    return (
      <Screen center title="Reading the Trip Allowance">
        <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
          Checking Starknet
        </StatusLine>
        {model.error === null ? null : <Failure message={model.error} />}
      </Screen>
    );
  }

  if (subview === "topup") {
    return (
      <TopUpSubview
        actions={actions}
        model={model}
        onBack={() => setSubview("none")}
        ticket={ticket}
      />
    );
  }
  if (subview === "extend") {
    return (
      <ExtendSubview
        actions={actions}
        model={model}
        onBack={() => setSubview("none")}
        state={state}
      />
    );
  }
  if (subview === "early") {
    return (
      <EarlySubview
        actions={actions}
        model={model}
        onBack={() => setSubview("none")}
      />
    );
  }
  if (subview === "drill") {
    return (
      <DrillSubview
        actions={actions}
        model={model}
        onBack={() => {
          actions.resetRecoveryDrill();
          setSubview("none");
        }}
      />
    );
  }

  const busy = safeActionBusy(model.action);
  const canReturnNow =
    model.snapshot !== null &&
    BigInt(model.snapshot.chainTimeSeconds) > BigInt(state.returnAt);
  const canExtend = BigInt(state.returnAt) < BigInt(state.maxReturnAt);
  const daily = BigInt(state.dailyAmount) > 0n;

  return (
    <Screen title={`${ticket.tokenSymbol} Trip Allowance`}>
      <SafeBalance
        caption="Available now"
        symbol={ticket.tokenSymbol}
        value={formatTokenAmount(BigInt(state.claimableAmount), ticket.tokenDecimals)}
      />
      <Facts>
        <Fact
          label="Remaining reserve"
          value={
            <SafeAmount
              symbol={ticket.tokenSymbol}
              value={formatTokenAmount(BigInt(state.remainingAmount), ticket.tokenDecimals)}
            />
          }
        />
        {daily ? (
          <Fact
            label="Daily allowance"
            value={
              <SafeAmount
                symbol={ticket.tokenSymbol}
                value={formatTokenAmount(BigInt(state.dailyAmount), ticket.tokenDecimals)}
              />
            }
          />
        ) : null}
        {daily ? (
          <Fact label="First release" value={formatUnixSeconds(state.firstReleaseAt)} />
        ) : null}
        <Fact label="Return date" strong value={formatUnixSeconds(state.returnAt)} />
        {model.nextReleaseAt === null ? null : (
          <Fact label="Next release" value={formatUnixSeconds(model.nextReleaseAt)} />
        )}
      </Facts>
      {model.snapshot === null ? null : (
        <Countdown
          chainTimeSeconds={model.snapshot.chainTimeSeconds}
          returnDateSeconds={state.returnAt}
        />
      )}
      <SafeStatus action={model.action} error={model.error} />
      <Actions>
        <Button
          disabled={busy || BigInt(state.claimableAmount) <= 0n}
          icon={<ArrowDownLeftIcon />}
          iconMotion={busy ? "spin" : undefined}
          label="Release available"
          onClick={() => {
            void actions.releaseAvailable();
          }}
        />
      </Actions>

      <div className="wshelf">
        <Actions>
          <Button
            disabled={busy}
            icon={<PlusCircleIcon />}
            label="Top up"
            onClick={() => setSubview("topup")}
            tone="quiet"
          />
          <Button
            disabled={busy || !canExtend}
            icon={<ClockClockwiseIcon />}
            label="Extend return date"
            onClick={() => setSubview("extend")}
            tone="quiet"
          />
          <Button
            icon={<CalendarPlusIcon />}
            label="Add to calendar"
            onClick={actions.downloadReturnCalendarEvent}
            tone="quiet"
          />
        </Actions>
        <Actions>
          <Button
            disabled={busy}
            icon={<KeyIcon />}
            label="Bring it all back early"
            onClick={() => setSubview("early")}
            tone="quiet"
          />
          <Button
            disabled={busy}
            icon={<ShieldCheckIcon />}
            label="Check recovery words"
            onClick={() => setSubview("drill")}
            tone="quiet"
          />
          {canReturnNow ? (
            <Button
              disabled={busy}
              icon={<ArrowDownLeftIcon />}
              label="Return the remainder"
              onClick={() => {
                void actions.returnNow();
              }}
              tone="quiet"
            />
          ) : null}
        </Actions>
      </div>
    </Screen>
  );
}

function TopUpSubview(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
  ticket: NonNullable<TravelSafeV3Model["ticket"]>;
  onBack: () => void;
}): JSX.Element {
  const { actions, model, ticket } = props;
  const [amount, setAmount] = useState("");
  const [attempted, setAttempted] = useState(false);
  const busy = safeActionBusy(model.action);
  const showQuote = attempted && model.quote !== null;
  const locked = busy || model.action.name === "confirmed";
  const approval = model.approval?.purpose === "top-up" ? model.approval : null;

  return (
    <Screen lede="Add more without changing the schedule." onBack={props.onBack} title="Top up">
      {approval !== null ? (
        <ApprovalStep actions={actions} approval={approval} model={model} />
      ) : !showQuote ? (
        <>
          <div className="wform">
            <WalletField label={`Amount (${ticket.tokenSymbol})`}>
              {({ inputId, describedBy }) => (
                <input
                  aria-describedby={describedBy}
                  className="winput winput--mono"
                  id={inputId}
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.0"
                  value={amount}
                />
              )}
            </WalletField>
          </div>
          <SafeStatus action={model.action} error={model.error} />
          <Actions>
            <Button
              disabled={busy || amount.trim() === ""}
              icon={<LockSimpleIcon />}
              iconMotion={busy ? "spin" : undefined}
              label="Get exact fee"
              onClick={() => {
                setAttempted(true);
                void actions.prepareTopUp(amount);
              }}
            />
          </Actions>
        </>
      ) : model.quote === null ? null : (
        <>
          <Facts>
            <Fact label="Adding" strong value={<SafeAmount symbol={ticket.tokenSymbol} value={amount} />} />
            <Fact label="Privacy fee" value={<SafeAmount symbol="STRK" value={formatStrk(model.quote.poolFeeFri)} />} />
            <Fact
              label="Network fee estimate"
              value={<SafeAmount symbol="STRK" value={formatStrk(model.quote.estimatedTransactionFeeFri)} />}
            />
          </Facts>
          <SafeStatus action={model.action} error={model.error} />
          <Actions>
            <Button
              disabled={locked}
              icon={<LockSimpleIcon />}
              iconMotion={busy ? "spin" : undefined}
              label="Confirm top-up"
              onClick={() => {
                void actions.submitTopUp();
              }}
            />
          </Actions>
        </>
      )}
    </Screen>
  );
}

function ExtendSubview(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
  state: NonNullable<NonNullable<TravelSafeV3Model["snapshot"]>["state"]>;
  onBack: () => void;
}): JSX.Element {
  const { actions, model, state } = props;
  const [date, setDate] = useState("");
  const busy = safeActionBusy(model.action);

  return (
    <Screen
      lede="Choose a later date within this allowance's limit."
      onBack={props.onBack}
      title="Extend the return date"
    >
      <div className="wform">
        <WalletField hint={`Up to ${formatUnixSeconds(state.maxReturnAt)}.`} label="New return date">
          {({ inputId, describedBy }) => (
            <input
              aria-describedby={describedBy}
              className="winput winput--mono"
              id={inputId}
              onChange={(event) => setDate(event.target.value)}
              type="datetime-local"
              value={date}
            />
          )}
        </WalletField>
      </div>
      <SafeStatus action={model.action} error={model.error} />
      <Actions>
        <Button
          disabled={busy || date === ""}
          icon={<ClockClockwiseIcon />}
          iconMotion={busy ? "spin" : undefined}
          label="Extend"
          onClick={() => {
            void actions.extendReturnDate(date);
          }}
        />
      </Actions>
    </Screen>
  );
}

function EarlySubview(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
  onBack: () => void;
}): JSX.Element {
  const { actions, model } = props;
  const [words, setWords] = useState("");
  const busy = safeActionBusy(model.action);

  return (
    <Screen
      lede="Only the recovery words you saved at setup can do this."
      onBack={props.onBack}
      title="Bring it all back early"
    >
      <div className="wform">
        <WalletField label="Recovery words">
          {({ inputId, describedBy }) => (
            <textarea
              aria-describedby={describedBy}
              className="winput winput--paste"
              id={inputId}
              onChange={(event) => setWords(event.target.value)}
              rows={3}
              value={words}
            />
          )}
        </WalletField>
      </div>
      <SafeStatus action={model.action} error={model.error} />
      <Actions>
        <Button
          disabled={busy || words.trim() === ""}
          icon={<KeyIcon />}
          iconMotion={busy ? "spin" : undefined}
          label="Bring it back"
          onClick={() => {
            void actions.bringBackEarly(words);
          }}
        />
      </Actions>
      <Note tone="caution">
        This returns the whole remaining reserve, not just today's allowance.
      </Note>
    </Screen>
  );
}

function DrillSubview(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
  onBack: () => void;
}): JSX.Element {
  const { actions, model } = props;
  const [words, setWords] = useState("");
  const drill = model.recoveryDrill;
  const checking = drill.status === "checking";

  async function handleCheck(): Promise<void> {
    await actions.drillRecoveryWords(words);
    setWords("");
  }

  return (
    <Screen
      lede="Confirm the words you saved still match this allowance."
      onBack={props.onBack}
      title="Check recovery words"
    >
      <div className="wform">
        <WalletField label="Recovery words">
          {({ inputId, describedBy }) => (
            <textarea
              aria-describedby={describedBy}
              autoCapitalize="none"
              autoCorrect="off"
              className="winput winput--paste"
              id={inputId}
              onChange={(event) => {
                setWords(event.target.value);
                if (drill.status !== "idle") actions.resetRecoveryDrill();
              }}
              rows={3}
              spellCheck={false}
              value={words}
            />
          )}
        </WalletField>
      </div>
      {checking ? (
        <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
          Checking on this device
        </StatusLine>
      ) : null}
      {drill.status === "valid" ? (
        <StatusLine announce icon={<CheckCircleIcon />}>
          These words match this Trip Allowance
        </StatusLine>
      ) : null}
      {drill.status === "invalid" ? <Failure message={drill.message} /> : null}
      <Actions>
        <Button
          disabled={checking || words.trim() === ""}
          icon={<ShieldCheckIcon />}
          iconMotion={checking ? "spin" : undefined}
          label="Check words"
          onClick={() => {
            void handleCheck();
          }}
        />
      </Actions>
      <Note>The check stays on this device. Nothing is sent and nothing is signed.</Note>
    </Screen>
  );
}

function TerminalScreen(props: {
  model: TravelSafeV3Model;
  actions: TravelSafeV3Actions;
}): JSX.Element {
  const { actions, model } = props;
  const ticket = model.ticket;
  const state = model.snapshot?.state ?? null;
  const claimed = state?.status === "claimed";
  /**
   * `clearTerminal` reports its own failure through the controller's `error`
   * rather than by throwing, so the only thing this screen has to say for
   * itself is that the clearing is in flight. On success the phase becomes
   * `empty` and this screen is gone before the flag is read again.
   */
  const [clearing, setClearing] = useState(false);

  async function handleClear(): Promise<void> {
    setClearing(true);
    try {
      await actions.clearTerminal();
    } finally {
      setClearing(false);
    }
  }

  return (
    <Screen
      title={claimed ? "Returned early" : "Returned to wallet"}
      tone={claimed ? "alert" : undefined}
    >
      <Emblem>{claimed ? <LockKeyOpenIcon /> : <CheckCircleIcon />}</Emblem>
      {model.snapshot === null ? null : (
        <Facts>
          <Fact label="Read at block" mono value={model.snapshot.blockNumber} />
        </Facts>
      )}
      {ticket?.actionTransactionHash === null || ticket?.actionTransactionHash === undefined ? null : (
        <TransactionRef
          hash={shortHex(ticket.actionTransactionHash)}
          href={`${EXPLORER_BASE}${ticket.actionTransactionHash}`}
          label={claimed ? "Returned early" : "Returned"}
        />
      )}
      <SafeStatus action={model.action} error={model.error} />
      <Actions>
        <Button
          disabled={clearing}
          icon={<SuitcaseRollingIcon />}
          iconMotion={clearing ? "spin" : undefined}
          label="Start another Trip Allowance"
          onClick={() => {
            void handleClear();
          }}
          tone="quiet"
        />
      </Actions>
    </Screen>
  );
}
