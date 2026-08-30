import type { JSX } from "react";

import {
  EXPLORER_BASE,
  formatStrkFigure,
  formatUnixSeconds,
  shortHex,
} from "../../adapters/amount";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  KeyIcon,
  LockKeyOpenIcon,
  WalletIcon,
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
    <ProductFrame
      detail="Optional backup"
      label="Early recovery"
      role="recover"
    >
      {state.name === "entry" ? (
        <Screen
          lede="Use this only to return early from another device."
          onBack={() => navigate("/safe")}
          title="Use early-recovery backup"
        >
          <WalletField label="Backup words">
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
              label="Check backup"
              onClick={() => void recovery.inspect()}
            />
          </Actions>
          <Note>
            This is not a wallet seed. No backup is needed after the return
            date.
          </Note>
        </Screen>
      ) : null}

      {state.name === "checking" ? (
        <Screen center title="Finding the Travel Safe">
          <Emblem>
            <KeyIcon />
          </Emblem>
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Reading Starknet
          </StatusLine>
        </Screen>
      ) : null}

      {state.name === "review" && state.release === "claim" ? (
        <Screen
          lede="The return date has not passed. This backup can release it now."
          onBack={recovery.reset}
          title="Bring it back early"
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
              value="Early return"
            />
          </Facts>
          <Actions>
            <Button
              icon={<WalletIcon />}
              label="Continue in wallet"
              onClick={() => void recovery.submit()}
            />
          </Actions>
          <Note>STRK returns as a private note.</Note>
        </Screen>
      ) : null}

      {state.name === "review" && state.release === "refund" ? (
        <Screen
          center
          lede="Reconnect the same account. The backup is no longer needed."
          onBack={recovery.reset}
          title="The return date has passed"
        >
          <Emblem>
            <WalletIcon />
          </Emblem>
          <Actions>
            <Button label="Open Travel Safe" onClick={() => navigate("/safe")} />
          </Actions>
        </Screen>
      ) : null}

      {state.name === "submitting" ? (
        <Screen
          center
          lede="Approve the private note."
          title="Returning early"
        >
          <Emblem>
            <LockKeyOpenIcon />
          </Emblem>
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Waiting for wallet
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
            iconMotion="spin"
          >
            {state.checking
              ? "Checking Starknet"
              : (state.message ?? "Waiting for confirmation")}
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
        <Screen center title="Early recovery complete">
          <Emblem>
            <CheckCircleIcon />
          </Emblem>
          <Note>
            {state.result.kind === "claimed"
              ? "Returned early to Shielded Starknet."
              : state.result.kind === "refunded"
                ? "Returned to Shielded Starknet."
                : state.result.kind === "already-claimed"
                  ? "This safe was already returned early."
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
          lede="The reserve was not returned."
          onBack={recovery.reset}
          title="Early recovery did not finish"
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
