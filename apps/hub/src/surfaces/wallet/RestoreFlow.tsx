import type { JSX } from "react";
import { useEffect, useState } from "react";

import { WRENCHLESS_MAINNET } from "../../lib/product-config";
import {
  readCoverTransactionState,
  type ReadyCoverWallet,
} from "../../lib/ready-cover";
import {
  inspectReadyPrivateReadiness,
  minimumReadyPrivateDepositFri,
  submitReadyPrivateDeposit,
  type ReadyPrivateReadiness,
} from "../../lib/ready-private-setup";
import type { ReadyRefillWallet } from "../../lib/ready-refill";
import { readRefillChainState } from "../../lib/refill-state";
import { markCoverRefillClaimed } from "../../lib/refill-ticket";
import {
  amountChoices,
  EXPLORER_BASE,
  formatStrk,
  formatStrkExact,
  formatStrkFigure,
  parseStrkAmount,
  shortHex,
} from "../../adapters/amount";
import {
  collectTopUp,
  moveAllowance,
  priceAllowanceMove,
  walletSafeReason,
  type AllowanceQuoteView,
} from "../../adapters/cover-operations";
import { recordSubmission } from "../../adapters/records";
import type { HubSettings } from "../../adapters/settings";
import { assertSelectedWalletAccount } from "../../adapters/wallet";
import { ReadyWalletMark } from "../../components/ReadyWalletMark";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from "../../components/icons";
import {
  Actions,
  Amount,
  Button,
  Emblem,
  Fact,
  Facts,
  Live,
  Note,
  Screen,
  StatusLine,
  WalletField,
  Waiting,
} from "../shared/product";

/**
 * Restore.
 *
 * One button, one review, one approval, and a balance back at its limit. What
 * happens underneath is not one step and this screen does not pretend it is:
 * anything already waiting for this wallet is brought in first, quietly and
 * without a fee, and only the movement a person has to approve is put in front
 * of them.
 *
 * The amount is not a choice. Restoring means going back to the limit that was
 * set once, on another device, by the person who set it — so the figure is
 * computed, shown exactly, and the only decision left is whether to approve it.
 *
 * There is one thing a wallet has to do before any of this works, and it can
 * only be done here: the account has to be set up to receive at all. That is a
 * one-time step, it is named as one, and it says nothing about how it works.
 *
 * Nothing on this screen names the machinery. There is no code to share, no
 * state to check, nothing to expire, and no second party. If the money is not
 * there, the screen says the money is not there.
 */

/** Round figures above the live floor; the floor itself is always offered. */
const SETUP_SUGGESTIONS = ["10", "15"] as const;

type Stage =
  | { name: "reading" }
  | { name: "setup"; readiness: ReadyPrivateReadiness }
  | { name: "approving" }
  /**
   * `baselineShieldedFri` is what was set aside before this one. A wallet that
   * already had something put by would otherwise look finished the instant the
   * transaction confirmed, and land back on a screen that still cannot restore.
   */
  | { name: "settling"; transactionHash: string; baselineShieldedFri: string }
  | { name: "review"; quote: AllowanceQuoteView; resultingFri: string }
  | { name: "approvingMove"; quote: AllowanceQuoteView; resultingFri: string }
  | { name: "done"; transactionHash: string; balanceFri: string }
  | { name: "full" }
  | { name: "empty" }
  | { name: "failed"; reason: string };

/**
 * Brings in anything already waiting for this wallet.
 *
 * Best effort by design. It costs the person nothing, needs no approval, and
 * every way it can fail is a way that leaves the balance exactly as it was — so
 * a failure here is not an error to report, it is simply nothing arriving.
 */
async function collectWhateverIsWaiting(input: {
  wallet: ReadyRefillWallet;
  settings: HubSettings;
  account: string;
}): Promise<boolean> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  for (const stateId of input.settings.refillStateIds) {
    try {
      const state = await readRefillChainState({
        helperAddress: WRENCHLESS_MAINNET.helperAddress,
        stateId,
      });
      if (state === null) continue;
      if (state.status !== "funded" || BigInt(state.expiry) < now) {
        if (state.status === "claimed") await markCoverRefillClaimed(stateId);
        continue;
      }
      await collectTopUp({
        wallet: input.wallet,
        settings: input.settings,
        account: input.account,
        stateId,
      });
      await markCoverRefillClaimed(stateId);
      return true;
    } catch {
      // Nothing arrived from this one. The next screen still tells the truth
      // about what is available, so there is nothing to report here.
    }
  }
  return false;
}

export function RestoreFlow(props: {
  wallet: ReadyCoverWallet & ReadyRefillWallet;
  account: string;
  settings: HubSettings;
  publicBalanceFri: string;
  onDone: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [stage, setStage] = useState<Stage>({ name: "reading" });
  const [elapsed, setElapsed] = useState(0);
  const [setupAmount, setSetupAmount] = useState<string>("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);

  // Preparing takes as long as it takes. An elapsed count is honest where a
  // progress bar would be a guess.
  useEffect(() => {
    if (stage.name !== "reading") return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [stage.name]);

  const prepare = async (): Promise<void> => {
    setStage({ name: "reading" });
    setLive("Checking what is available");
    const capFri = BigInt(props.settings.exposureCapFri);
    const publicFri = BigInt(props.publicBalanceFri);
    if (publicFri >= capFri) {
      setStage({ name: "full" });
      setLive(null);
      return;
    }

    try {
      assertSelectedWalletAccount(props.wallet, props.account);
      let readiness = await inspectReadyPrivateReadiness({
        wallet: props.wallet,
        poolAddress: WRENCHLESS_MAINNET.poolAddress,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
      });

      // The one thing that has to be true before anything else can be, and the
      // only screen a person can fix it from.
      if (!readiness.registered) {
        // Opened at the smallest figure that can actually go through, read
        // live. A default nobody can use is a screen that wastes a trip to
        // Ready Wallet before it says so.
        setSetupAmount((current) =>
          current.length > 0
            ? current
            : formatStrkExact(minimumReadyPrivateDepositFri(readiness.poolFeeFri)),
        );
        setStage({ name: "setup", readiness });
        setLive(null);
        return;
      }

      const collected = await collectWhateverIsWaiting({
        wallet: props.wallet,
        settings: props.settings,
        account: props.account,
      });
      if (collected) {
        readiness = await inspectReadyPrivateReadiness({
          wallet: props.wallet,
          poolAddress: WRENCHLESS_MAINNET.poolAddress,
          tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
        });
      }

      if (BigInt(readiness.shieldedBalanceFri) === 0n) {
        setStage({ name: "empty" });
        setLive(null);
        return;
      }

      const wanted = capFri - publicFri;
      let quote = await priceAllowanceMove({
        wallet: props.wallet,
        amountFri: wanted.toString(),
      });
      // Short of the limit: restore everything that is there rather than
      // refusing. A smaller true figure beats an exact impossible one.
      if (!quote.canSubmit && BigInt(quote.maximumAmountFri) > 0n) {
        quote = await priceAllowanceMove({
          wallet: props.wallet,
          amountFri: quote.maximumAmountFri,
        });
      }
      if (!quote.canSubmit) {
        setStage({ name: "empty" });
        setLive(null);
        return;
      }
      setStage({
        name: "review",
        quote,
        resultingFri: (publicFri + BigInt(quote.amountFri)).toString(),
      });
      setLive(null);
    } catch (caught) {
      setStage({ name: "failed", reason: walletSafeReason(caught) });
      setLive("Not available");
    }
  };

  useEffect(() => {
    void prepare();
    // Once per visit. Every call in here asks Ready Wallet or the network for
    // something, and one of them costs the person a permission prompt, so this
    // must not re-run because a parent re-rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Waits out the one-time setup.
   *
   * The transaction confirming and the wallet being able to receive are not the
   * same moment, so both are read from the network rather than assumed, and
   * nothing here invents a percentage for the gap between them.
   */
  useEffect(() => {
    if (stage.name !== "settling") return;
    let active = true;
    const hash = stage.transactionHash;
    const baseline = stage.baselineShieldedFri;
    const tick = async (): Promise<void> => {
      try {
        const state = await readCoverTransactionState({ transactionHash: hash });
        if (!active) return;
        if (state.state === "reverted") {
          setStage({
            name: "failed",
            reason: "That did not go through. Your balance is unchanged.",
          });
          return;
        }
        if (state.state !== "confirmed") return;
        const readiness = await inspectReadyPrivateReadiness({
          wallet: props.wallet,
          poolAddress: WRENCHLESS_MAINNET.poolAddress,
          tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
        });
        // Registered is not enough, and neither is a balance that was already
        // there. This is finished when the live figure has risen above what the
        // wallet held before the setup was sent.
        if (
          !active ||
          !readiness.registered ||
          BigInt(readiness.shieldedBalanceFri) <= BigInt(baseline)
        ) {
          return;
        }
        props.onChanged();
        void prepare();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const runSetup = async (
    feeFri: string,
    baselineShieldedFri: string,
  ): Promise<void> => {
    const parsed = parseStrkAmount(setupAmount);
    if (!parsed.ok) {
      setSetupError(parsed.message);
      return;
    }
    if (BigInt(parsed.fri) > BigInt(props.publicBalanceFri)) {
      setSetupError("More than your balance.");
      return;
    }
    // Checked before the handoff, not after it. Opening Ready Wallet only to
    // be told the figure was never going to work is a wasted trip.
    const minimum = minimumReadyPrivateDepositFri(feeFri);
    if (BigInt(parsed.fri) < BigInt(minimum)) {
      setSetupError(`Use at least ${formatStrk(minimum)} STRK.`);
      return;
    }
    setSetupError(null);
    setStage({ name: "approving" });
    setLive("Waiting for Ready Wallet");
    try {
      assertSelectedWalletAccount(props.wallet, props.account);
      const submitted = await submitReadyPrivateDeposit({
        wallet: props.wallet,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
        amountFri: parsed.fri,
        poolFeeFri: feeFri,
      });
      setStage({
        name: "settling",
        transactionHash: submitted.transactionHash,
        baselineShieldedFri,
      });
      setLive("Setting up");
    } catch (caught) {
      setStage({ name: "failed", reason: walletSafeReason(caught) });
      setLive("Not set up");
    }
  };

  const confirm = async (
    quote: AllowanceQuoteView,
    resultingFri: string,
  ): Promise<void> => {
    setStage({ name: "approvingMove", quote, resultingFri });
    setLive("Waiting for Ready Wallet");
    try {
      assertSelectedWalletAccount(props.wallet, props.account);
      const submitted = await moveAllowance({ wallet: props.wallet, quote });
      recordSubmission("wallet", {
        transactionHash: submitted.transactionHash,
        kind: "allowance",
        amountFri: submitted.amountFri,
        recipient: null,
        submittedAt: new Date().toISOString(),
      });
      setStage({
        name: "done",
        transactionHash: submitted.transactionHash,
        balanceFri: resultingFri,
      });
      setLive("Balance restored");
      props.onChanged();
    } catch (caught) {
      setStage({ name: "failed", reason: walletSafeReason(caught) });
      setLive("Not restored");
    }
  };

  if (stage.name === "reading") {
    return (
      <Screen center onBack={props.onDone} title="Restore balance">
        <Waiting seconds={elapsed} />
        <Note>This can take a moment. Leave the screen open.</Note>
        <Live message={live} />
      </Screen>
    );
  }

  /* ---------- the one-time setup ---------- */

  if (stage.name === "setup") {
    const parsed = parseStrkAmount(setupAmount);
    const tooMuch =
      parsed.ok && BigInt(parsed.fri) > BigInt(props.publicBalanceFri);
    const minimum = minimumReadyPrivateDepositFri(stage.readiness.poolFeeFri);
    const short = BigInt(props.publicBalanceFri) < BigInt(minimum);
    return (
      <Screen
        lede="This wallet needs one setup step before it can restore. It only happens once."
        onBack={props.onDone}
        title="One-time setup"
      >
        {short ? (
          <StatusLine icon={<WarningCircleIcon />}>
            You need at least {formatStrk(minimum)} STRK in this wallet to set it
            up. Receive a little first.
          </StatusLine>
        ) : null}

        <p className="eyebrow">Amount</p>
        <ul className="wchips" role="group">
          {amountChoices(minimum, SETUP_SUGGESTIONS).map((value) => (
            <li key={value}>
              <button
                aria-pressed={setupAmount === value}
                className="wchip"
                onClick={() => {
                  setSetupAmount(value);
                  setSetupError(null);
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
            void runSetup(
              stage.readiness.poolFeeFri,
              stage.readiness.shieldedBalanceFri,
            );
          }}
        >
          <WalletField
            error={setupError ?? (tooMuch && !short ? "More than your balance." : null)}
            hint={`At least ${formatStrk(minimum)} STRK, set aside from your spending balance.`}
            label="Amount in STRK"
          >
            {({ inputId, describedBy }) => (
              <input
                aria-describedby={describedBy}
                className="winput winput--mono"
                id={inputId}
                inputMode="decimal"
                onChange={(event) => setSetupAmount(event.target.value)}
                type="text"
                value={setupAmount}
              />
            )}
          </WalletField>
          <Facts>
            <Fact
              label="Your balance"
              value={<Amount value={formatStrkFigure(props.publicBalanceFri)} />}
            />
            <Fact label="Network fee" value="Shown by Ready Wallet" />
          </Facts>
          <Actions>
            <Button
              disabled={tooMuch || short}
              icon={<ReadyWalletMark className="ready-wallet-mark" />}
              label="Set up"
              type="submit"
            />
          </Actions>
        </form>
        <Live message={live} />
      </Screen>
    );
  }

  if (stage.name === "approving") {
    return (
      <Screen
        center
        lede="Ready Wallet asks you to approve it, then to move it."
        title="Approve in Ready Wallet"
      >
        <Emblem>
          <ReadyWalletMark className="ready-wallet-mark" />
        </Emblem>
        <Waiting seconds={null} />
        <Live message={live} />
      </Screen>
    );
  }

  if (stage.name === "settling") {
    return (
      <Screen
        center
        lede="Nothing else to do. This finishes on its own."
        title="Setting up"
      >
        <Waiting seconds={null} />
        <p className="wlive">
          <a
            className="wref"
            href={`${EXPLORER_BASE}${stage.transactionHash}`}
            rel="noreferrer"
            target="_blank"
          >
            {shortHex(stage.transactionHash)}
          </a>
        </p>
        <Actions>
          <Button label="Come back later" onClick={props.onDone} tone="quiet" />
        </Actions>
        <Live message={live} />
      </Screen>
    );
  }

  /* ---------- the ordinary endings ---------- */

  if (stage.name === "full") {
    return (
      <Screen onBack={props.onDone} title="Restore balance">
        <StatusLine icon={<CheckCircleIcon />}>
          Your balance is already at your limit.
        </StatusLine>
        <Actions>
          <Button label="Done" onClick={props.onDone} />
        </Actions>
        <Live message={live} />
      </Screen>
    );
  }

  if (stage.name === "empty") {
    return (
      <Screen onBack={props.onDone} title="Restore balance">
        <StatusLine icon={<WarningCircleIcon />}>
          There is nothing to restore right now.
        </StatusLine>
        <Note>Try again later.</Note>
        <Actions>
          <Button label="Done" onClick={props.onDone} />
        </Actions>
        <Live message={live} />
      </Screen>
    );
  }

  if (stage.name === "failed") {
    return (
      <Screen onBack={props.onDone} title="Not restored">
        <StatusLine icon={<WarningCircleIcon />} tone="alert">
          {stage.reason}
        </StatusLine>
        <Note>Your balance is unchanged.</Note>
        <Actions>
          <Button label="Try again" onClick={() => void prepare()} />
          <Button label="Done" onClick={props.onDone} tone="quiet" />
        </Actions>
        <Live message={live} />
      </Screen>
    );
  }

  if (stage.name === "done") {
    return (
      <Screen title="Balance restored">
        <p className="balance__figure">
          <Amount size="lead" value={formatStrkFigure(stage.balanceFri)} />
        </p>
        <StatusLine icon={<CheckCircleIcon />}>
          Confirming on Starknet. Your balance updates when it lands.
        </StatusLine>
        <p className="wlive">
          <a
            className="wref"
            href={`${EXPLORER_BASE}${stage.transactionHash}`}
            rel="noreferrer"
            target="_blank"
          >
            {shortHex(stage.transactionHash)}
          </a>
        </p>
        <Actions>
          <Button label="Done" onClick={props.onDone} />
        </Actions>
        <Live message={live} />
      </Screen>
    );
  }

  const approving = stage.name === "approvingMove";
  return (
    <Screen
      onBack={approving ? undefined : props.onDone}
      title="Restore balance"
    >
      <p className="balance__figure">
        <Amount
          sign="+"
          size="lead"
          value={formatStrkFigure(stage.quote.amountFri)}
        />
      </p>
      <Facts>
        <Fact
          label="New balance"
          strong
          value={<Amount value={formatStrkFigure(stage.resultingFri)} />}
        />
        <Fact
          label="Fee"
          value={<Amount value={formatStrk(stage.quote.poolFeeFri)} />}
        />
        <Fact label="Network fee" value="Shown by Ready Wallet" />
      </Facts>
      <Actions>
        <Button
          disabled={approving}
          icon={
            approving ? (
              <ReadyWalletMark className="ready-wallet-mark" />
            ) : (
              <ArrowsClockwiseIcon />
            )
          }
          label={approving ? "Approve in Ready Wallet" : "Continue"}
          onClick={() => void confirm(stage.quote, stage.resultingFri)}
        />
      </Actions>
      {approving ? <Waiting seconds={null} /> : null}
      <Live message={live} />
    </Screen>
  );
}
