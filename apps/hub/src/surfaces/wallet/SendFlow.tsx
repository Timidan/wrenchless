import type { JSX } from "react";
import { useState } from "react";

import type { CoverSessionController } from "../../lib/cover-session";
import { WRENCHLESS_MAINNET } from "../../lib/product-config";
import type { ReadyCoverWallet } from "../../lib/ready-cover";
import {
  EXPLORER_BASE,
  formatStrk,
  formatStrkFigure,
  parseStrkAmount,
  shortHex,
} from "../../adapters/amount";
import { payFromWallet, walletSafeReason } from "../../adapters/cover-operations";
import { recordSubmission } from "../../adapters/records";
import type { HubSettings } from "../../adapters/settings";
import { assertSelectedWalletAccount } from "../../adapters/wallet";
import { ReadyWalletMark } from "../../components/ReadyWalletMark";
import {
  CheckCircleIcon,
  PaperPlaneTiltIcon,
  WarningCircleIcon,
} from "../../components/icons";
import {
  Actions,
  Amount,
  Button,
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
 * Send.
 *
 * Compose, then one review screen, then Ready Wallet. The review is the only
 * place this flow spends words, because it is the last moment anything can be
 * changed — and it shows the three things that are actually true: the exact
 * amount, where it comes from, and that the network fee is Ready Wallet's
 * figure rather than a guess made here.
 *
 * The four endings are distinct because a person has to act differently in
 * each: it went, you declined it, nothing came back, or it did not go. Nothing
 * on any of them changes with which code opened the wallet — the same call runs
 * in the same order, and the message that leaves for someone else is sealed
 * inside the session module where no screen can see it.
 */

type Stage =
  | { name: "compose" }
  | { name: "review" }
  | { name: "approving" }
  | { name: "sent"; transactionHash: string }
  | { name: "declined" }
  | { name: "unknown"; reason: string };

export function SendFlow(props: {
  session: CoverSessionController;
  wallet: ReadyCoverWallet;
  settings: HubSettings;
  account: string;
  balanceFri: string;
  onDone: () => void;
  onSubmitted: () => void;
}): JSX.Element {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [toError, setToError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ name: "compose" });
  const [live, setLive] = useState<string | null>(null);

  const parsed = parseStrkAmount(amount);
  const amountFri = parsed.ok ? parsed.fri : null;

  const check = (): boolean => {
    const address = to.trim();
    const badAddress = !/^0x[0-9a-fA-F]{1,64}$/.test(address);
    setToError(badAddress ? "Enter a Starknet address starting with 0x." : null);
    setAmountError(parsed.ok ? null : parsed.message);
    if (badAddress || !parsed.ok) return false;
    if (BigInt(parsed.fri) > BigInt(props.balanceFri)) {
      setAmountError("More than your balance.");
      return false;
    }
    return true;
  };

  const send = async (): Promise<void> => {
    if (amountFri === null) return;
    setStage({ name: "approving" });
    setLive("Waiting for Ready Wallet");
    try {
      assertSelectedWalletAccount(props.wallet, props.account);
      const report = await payFromWallet({
        session: props.session,
        wallet: props.wallet,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
        recipient: to.trim(),
        amountFri,
        settings: props.settings,
      });

      if (report.transactionHash !== null) {
        recordSubmission("wallet", {
          transactionHash: report.transactionHash,
          kind: "payment",
          amountFri,
          recipient: to.trim(),
          submittedAt: new Date().toISOString(),
        });
        setStage({ name: "sent", transactionHash: report.transactionHash });
        setLive("Sent");
        props.onSubmitted();
        return;
      }
      if (report.outcome === "rejected") {
        setStage({ name: "declined" });
        setLive("Declined");
        return;
      }
      setStage({
        name: "unknown",
        reason: "No transaction reference came back.",
      });
      setLive("No reference");
    } catch (caught) {
      setStage({ name: "unknown", reason: walletSafeReason(caught) });
      setLive("Not sent");
    }
  };

  if (stage.name === "sent") {
    return (
      <Screen title="Sent">
        <p className="balance__figure">
          <Amount size="lead" value={formatStrkFigure(amountFri ?? "0")} />
        </p>
        <Facts>
          <Fact full={to.trim()} label="To" mono value={shortHex(to.trim())} />
          <Fact label="Status" value="Confirming" />
        </Facts>
        <StatusLine icon={<CheckCircleIcon />}>
          Confirming on Starknet. Activity follows it from here.
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

  if (stage.name === "declined" || stage.name === "unknown") {
    return (
      <Screen onBack={props.onDone} title="Not sent">
        <StatusLine icon={<WarningCircleIcon />} tone="alert">
          {stage.name === "declined"
            ? "You declined this in Ready Wallet. Nothing was sent."
            : stage.reason}
        </StatusLine>
        <Note>
          {stage.name === "declined"
            ? "Your balance is unchanged."
            : "Check Ready Wallet and Activity before trying again."}
        </Note>
        <Actions>
          <Button label="Try again" onClick={() => setStage({ name: "review" })} />
          <Button label="Cancel" onClick={props.onDone} tone="quiet" />
        </Actions>
        <Live message={live} />
      </Screen>
    );
  }

  if (stage.name === "review" || stage.name === "approving") {
    const approving = stage.name === "approving";
    return (
      <Screen
        onBack={approving ? undefined : () => setStage({ name: "compose" })}
        title="Review"
      >
        <p className="balance__figure">
          <Amount size="lead" value={formatStrkFigure(amountFri ?? "0")} />
        </p>
        <Facts>
          <Fact full={to.trim()} label="To" mono value={shortHex(to.trim())} />
          <Fact label="From" value="Spending balance" />
          <Fact label="Network fee" value="Shown by Ready Wallet" />
        </Facts>
        <Actions>
          <Button
            disabled={approving}
            icon={
              approving ? (
                <ReadyWalletMark className="ready-wallet-mark" />
              ) : (
                <PaperPlaneTiltIcon />
              )
            }
            label={approving ? "Approve in Ready Wallet" : "Confirm and send"}
            onClick={() => void send()}
          />
        </Actions>
        {approving ? <Waiting seconds={null} /> : null}
        <Live message={live} />
      </Screen>
    );
  }

  return (
    <Screen onBack={props.onDone} title="Send">
      <form
        className="wform"
        onSubmit={(event) => {
          event.preventDefault();
          if (check()) setStage({ name: "review" });
        }}
      >
        <WalletField error={toError} label="To">
          {({ inputId, describedBy }) => (
            <input
              aria-describedby={describedBy}
              autoComplete="off"
              className="winput winput--mono"
              id={inputId}
              onChange={(event) => setTo(event.target.value)}
              placeholder="0x…"
              spellCheck={false}
              type="text"
              value={to}
            />
          )}
        </WalletField>
        <WalletField
          error={amountError}
          hint={`Balance ${formatStrk(props.balanceFri)} STRK`}
          label="Amount"
        >
          {({ inputId, describedBy }) => (
            <input
              aria-describedby={describedBy}
              autoComplete="off"
              className="winput winput--mono"
              id={inputId}
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.0"
              spellCheck={false}
              type="text"
              value={amount}
            />
          )}
        </WalletField>
        <Actions>
          <Button label="Review" type="submit" />
        </Actions>
      </form>
      <Live message={live} />
    </Screen>
  );
}
