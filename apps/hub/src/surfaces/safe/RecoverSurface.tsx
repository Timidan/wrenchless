import type { JSX } from "react";

import {
  EXPLORER_BASE,
  formatStrkFigure,
  formatUnixSeconds,
  shortHex,
} from "../../adapters/amount";
import { ReadyWalletMark } from "../../components/ReadyWalletMark";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  KeyIcon,
  LockKeyOpenIcon,
  WarningCircleIcon,
} from "../../components/icons";
import { navigate } from "../../routes";
import {
  Actions,
  Balance,
  Button,
  Emblem,
  Fact,
  Facts,
  Note,
  ProductFrame,
  Screen,
  StatusLine,
  TransactionRef,
  WalletField,
} from "../shared/product";
import { useTravelSafeRecovery } from "./useTravelSafe";

export function RecoverSurface(): JSX.Element {
  const recovery = useTravelSafeRecovery();
  const { state } = recovery;

  return (
    <ProductFrame detail="Twelve words" label="Recovery" role="recover">
      {state.name === "entry" ? (
        <Screen
          lede="Enter the words in order. They never leave this page."
          onBack={() => navigate("/safe")}
          title="Recover a safe"
        >
          <WalletField label="Recovery words">
            {({ inputId, describedBy }) => (
              <textarea
                aria-describedby={describedBy}
                autoCapitalize="none"
                autoCorrect="off"
                className="winput winput--paste"
                id={inputId}
                onChange={(event) => recovery.setWords(event.target.value)}
                rows={5}
                spellCheck={false}
                value={recovery.words}
              />
            )}
          </WalletField>
          <Actions>
            <Button
              disabled={recovery.words.trim().length === 0}
              icon={<KeyIcon />}
              label="Check the words"
              onClick={() => void recovery.inspect()}
            />
          </Actions>
        </Screen>
      ) : null}

      {state.name === "checking" ? (
        <Screen center title="Checking the safe">
          <Emblem>
            <KeyIcon />
          </Emblem>
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Reading Starknet
          </StatusLine>
        </Screen>
      ) : null}

      {state.name === "review" ? (
        <Screen
          lede={
            state.release === "claim"
              ? "The return date has not passed. These words can release it early."
              : "The return date has passed. These words can bring it back."
          }
          onBack={recovery.reset}
          title={state.release === "claim" ? "Release early" : "Bring it back"}
        >
          <Balance
            caption="Found in the Travel Safe"
            value={formatStrkFigure(state.amountFri)}
          />
          <Facts>
            <Fact
              label="Return date"
              value={formatUnixSeconds(state.returnDateSeconds)}
            />
            <Fact
              label="Action"
              strong
              value={state.release === "claim" ? "Early release" : "Return"}
            />
          </Facts>
          <Actions>
            <Button
              icon={<ReadyWalletMark className="wbtn__ready" />}
              label="Continue in Ready"
              onClick={() => void recovery.submit()}
            />
          </Actions>
          <Note>Ready receives the STRK as a private note.</Note>
        </Screen>
      ) : null}

      {state.name === "submitting" ? (
        <Screen
          center
          lede="Approve the private note in Ready."
          title={state.release === "claim" ? "Releasing early" : "Returning"}
        >
          <Emblem>
            <LockKeyOpenIcon />
          </Emblem>
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Waiting for Ready
          </StatusLine>
        </Screen>
      ) : null}

      {state.name === "submitted" ? (
        <Screen
          center
          lede="Recovery is complete only after Starknet confirms the safe moved."
          title="Transaction submitted"
        >
          <Emblem>
            <ArrowsClockwiseIcon />
          </Emblem>
          <StatusLine
            icon={<ArrowsClockwiseIcon />}
            iconMotion={state.checking ? "spin" : undefined}
          >
            {state.checking ? "Reading Starknet" : "Waiting for confirmation"}
          </StatusLine>
          <TransactionRef
            hash={shortHex(state.result.transactionHash)}
            href={`${EXPLORER_BASE}${state.result.transactionHash}`}
            label="Transaction"
          />
          <Actions>
            <Button
              disabled={state.checking}
              icon={<ArrowsClockwiseIcon />}
              label="Check Starknet"
              onClick={() => void recovery.check()}
            />
          </Actions>
          <Actions>
            <Button
              label="Enter the words again"
              onClick={recovery.reset}
              tone="quiet"
            />
          </Actions>
        </Screen>
      ) : null}

      {state.name === "complete" ? (
        <Screen center title="Recovery complete">
          <Emblem>
            <CheckCircleIcon />
          </Emblem>
          <Note>
            {state.result.kind === "claimed"
              ? "Released early to Shielded Starknet."
              : state.result.kind === "refunded"
                ? "Returned to Shielded Starknet."
                : state.result.kind === "already-claimed"
                  ? "This safe was already released early."
                  : "This safe was already returned."}
          </Note>
          {"transactionHash" in state.result ? (
            <TransactionRef
              hash={shortHex(state.result.transactionHash)}
              href={`${EXPLORER_BASE}${state.result.transactionHash}`}
              label="Transaction"
            />
          ) : null}
          <Actions>
            <Button label="Done" onClick={() => navigate("/safe")} />
          </Actions>
        </Screen>
      ) : null}

      {state.name === "failed" ? (
        <Screen
          center
          lede="The safe was not released."
          onBack={recovery.reset}
          title="Recovery did not finish"
          tone="alert"
        >
          <StatusLine icon={<WarningCircleIcon />} tone="alert">
            {state.reason}
          </StatusLine>
          <Actions>
            <Button label="Try again" onClick={recovery.reset} />
          </Actions>
        </Screen>
      ) : null}
    </ProductFrame>
  );
}
