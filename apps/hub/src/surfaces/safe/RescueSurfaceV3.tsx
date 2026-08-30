import type { JSX } from "react";

import {
  EXPLORER_BASE,
  formatUnixSeconds,
  shortHex,
} from "../../adapters/amount";
import {
  ArrowDownLeftIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  HourglassIcon,
  KeyIcon,
  WalletIcon,
  WarningCircleIcon,
} from "../../components/icons";
import { navigate } from "../../routes";
import {
  Actions,
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
import { SafeAmount } from "./components/SafeAsset";
import {
  useTravelSafeRescueV3,
  type TravelSafeRescueController,
} from "./useTravelSafeRescueV3";

export function RescueSurfaceV3(): JSX.Element {
  const { model, actions } = useTravelSafeRescueV3();

  return (
    <ProductFrame
      detail={
        model.account === null ? "Starknet mainnet" : shortHex(model.account)
      }
      label="Rescue a Safe"
      role="recover"
    >
      <RescuePhase actions={actions} model={model} />
    </ProductFrame>
  );
}

function RescuePhase(props: TravelSafeRescueController): JSX.Element {
  const { actions, model } = props;

  switch (model.phase) {
    case "entry":
      return (
        <Screen
          lede="Saved recovery words can return a still-locked reserve to a wallet account on this device."
          onBack={() => navigate("/safe")}
          title="Rescue a Safe"
        >
          <WalletField label="Recovery words">
            {({ inputId, describedBy }) => (
              <textarea
                aria-describedby={describedBy}
                autoCapitalize="none"
                autoCorrect="off"
                className="winput winput--paste"
                id={inputId}
                onChange={(event) => actions.setWords(event.target.value)}
                rows={5}
                spellCheck={false}
                value={model.words}
              />
            )}
          </WalletField>
          <Actions>
            <Button
              disabled={model.words.trim() === ""}
              icon={<KeyIcon />}
              label="Check words"
              onClick={() => {
                void actions.inspect();
              }}
            />
          </Actions>
          <Note>The words stay on this device. They are not a wallet seed.</Note>
        </Screen>
      );

    case "checking":
      return (
        <Screen center title="Checking the words">
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Reading Starknet
          </StatusLine>
        </Screen>
      );

    case "review":
      return <ReviewScreen actions={actions} model={model} />;

    case "connecting":
      return (
        <Screen center title="Connect wallet">
          <Emblem>
            <WalletIcon />
          </Emblem>
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Waiting for your wallet
          </StatusLine>
        </Screen>
      );

    case "ready":
      return <ReadyScreen actions={actions} model={model} />;

    case "submitting":
      return (
        <Screen center title="Returning the reserve">
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Preparing the private return
          </StatusLine>
        </Screen>
      );

    case "confirming":
      return (
        <Screen title="Returning the reserve">
          <StatusLine announce icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            {model.live ?? "Confirming on Starknet"}
          </StatusLine>
          {model.transactionHash === null ? null : (
            <TransactionRef
              hash={shortHex(model.transactionHash)}
              href={`${EXPLORER_BASE}${model.transactionHash}`}
              label="Submitted"
            />
          )}
          <Actions>
            <Button
              disabled={model.live !== null}
              icon={<ArrowsClockwiseIcon />}
              iconMotion={model.live === null ? undefined : "spin"}
              label="Check again"
              onClick={() => {
                void actions.check();
              }}
              tone="quiet"
            />
          </Actions>
        </Screen>
      );

    case "complete":
      return <CompleteScreen actions={actions} model={model} />;

    case "return_open":
      return <ReturnOpenScreen actions={actions} model={model} />;

    case "failed":
      return (
        <Screen title="Rescue stopped" tone="alert">
          <Emblem>
            <WarningCircleIcon />
          </Emblem>
          <div role="alert">
            <StatusLine announce icon={<WarningCircleIcon />} tone="alert">
              {model.error ?? "The rescue could not be completed"}
            </StatusLine>
          </div>
          <Actions>
            <Button
              icon={<ArrowsClockwiseIcon />}
              label="Try again"
              onClick={actions.reset}
            />
          </Actions>
        </Screen>
      );
  }
}

function ReserveFacts(props: {
  summary: NonNullable<TravelSafeRescueController["model"]["summary"]>;
}): JSX.Element {
  const { summary } = props;
  return (
    <Facts>
      <Fact label="Asset" value={summary.tokenSymbol} />
      <Fact
        label="Remaining"
        strong
        value={<SafeAmount symbol={summary.tokenSymbol} value={summary.amount} />}
      />
      <Fact label="Return date" value={formatUnixSeconds(summary.returnAt)} />
      <Fact
        full={summary.stateId}
        label="Safe ID"
        mono
        value={shortHex(summary.stateId)}
      />
    </Facts>
  );
}

function ReviewScreen(props: TravelSafeRescueController): JSX.Element {
  const { actions, model } = props;
  const summary = model.summary;

  return (
    <Screen
      lede="This is what the words open. Connect the wallet it should return to."
      title="Review"
    >
      {summary === null ? null : <ReserveFacts summary={summary} />}
      {model.error === null ? null : (
        <div role="alert">
          <StatusLine icon={<WarningCircleIcon />} tone="alert">
            {model.error}
          </StatusLine>
        </div>
      )}
      <Actions>
        <Button
          icon={<WalletIcon />}
          label="Connect wallet"
          onClick={() => {
            void actions.connect();
          }}
        />
      </Actions>
      <Note>Nothing broadcasts until you confirm the return.</Note>
    </Screen>
  );
}

function ReadyScreen(props: TravelSafeRescueController): JSX.Element {
  const { actions, model } = props;
  const summary = model.summary;

  return (
    <Screen
      lede="The whole remaining reserve goes to the account below."
      title="Return the reserve"
    >
      {summary === null ? null : <ReserveFacts summary={summary} />}
      <Facts>
        <Fact
          full={model.account ?? undefined}
          label="Receiving account"
          mono
          value={model.account === null ? "" : shortHex(model.account)}
        />
      </Facts>
      <Actions>
        <Button
          icon={<ArrowDownLeftIcon />}
          label="Return to this wallet"
          onClick={() => {
            void actions.submit();
          }}
        />
      </Actions>
      <Note>This account pays the private action fee.</Note>
    </Screen>
  );
}

function CompleteScreen(props: TravelSafeRescueController): JSX.Element {
  const { actions, model } = props;
  const summary = model.summary;
  const returnedHere = model.transactionHash !== null;

  return (
    <Screen
      lede={
        returnedHere
          ? "The reserve is back in the connected account."
          : "The words match, but this reserve had already been returned."
      }
      title={returnedHere ? "Returned" : "Already returned"}
    >
      <Emblem>
        <CheckCircleIcon />
      </Emblem>
      <Facts>
        {summary === null ? null : (
          <Fact label="Asset" value={summary.tokenSymbol} />
        )}
        {summary === null ? null : (
          <Fact
            full={summary.stateId}
            label="Safe ID"
            mono
            value={shortHex(summary.stateId)}
          />
        )}
        {summary === null ? null : (
          <Fact label="Read at block" mono value={summary.blockNumber} />
        )}
        {returnedHere && model.account !== null ? (
          <Fact
            full={model.account}
            label="Returned to"
            mono
            value={shortHex(model.account)}
          />
        ) : null}
      </Facts>
      {model.transactionHash === null ? null : (
        <TransactionRef
          hash={shortHex(model.transactionHash)}
          href={`${EXPLORER_BASE}${model.transactionHash}`}
          label="Returned"
        />
      )}
      <Actions>
        <Button
          icon={<KeyIcon />}
          label="Check other words"
          onClick={actions.reset}
          tone="quiet"
        />
      </Actions>
    </Screen>
  );
}

function ReturnOpenScreen(props: TravelSafeRescueController): JSX.Element {
  const { actions, model } = props;
  const summary = model.summary;

  return (
    <Screen
      lede="Recovery words only authorise an early return."
      title="The return date has passed"
    >
      <Emblem>
        <HourglassIcon />
      </Emblem>
      {summary === null ? null : <ReserveFacts summary={summary} />}
      <Note>
        Open Trip Allowance on the original recovery account to bring this
        reserve home.
      </Note>
      <Actions>
        <Button label="Open Trip Allowance" onClick={() => navigate("/safe")} />
        <Button
          icon={<KeyIcon />}
          label="Check other words"
          onClick={actions.reset}
          tone="quiet"
        />
      </Actions>
    </Screen>
  );
}
