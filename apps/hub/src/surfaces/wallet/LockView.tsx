import type { JSX } from "react";
import { useState } from "react";

import type {
  CoverSessionController,
  NeutralCoverSessionState,
} from "../../lib/cover-session";
import { walletSafeReason } from "../../adapters/cover-operations";
import {
  createDevicePasskey,
  devicePasskeysAvailable,
  verifyDevicePasskey,
} from "../../adapters/device-passkey";
import { writeSettings, type HubSettings } from "../../adapters/settings";
import { KeyIcon, WarningCircleIcon } from "../../components/icons";
import {
  Actions,
  Button,
  Emblem,
  Live,
  Note,
  Screen,
  StatusLine,
} from "../shared/product";
import { CodeEntry } from "./CodeEntry";

/**
 * Opening the wallet, in the two steps the product promised.
 *
 * The passkey is the device saying this is its owner; the access code is the
 * person saying which of their two codes this is. They are separate because
 * they answer different questions, and because only the second one has a second
 * meaning.
 *
 * Everything past the passkey is identical whichever code is entered. There is
 * no branch in this file that could make it otherwise: the session module takes
 * the digits, returns one neutral state, and never says which code opened it.
 */

type PasskeyStage =
  | { name: "idle" }
  | { name: "working" }
  | { name: "failed"; reason: string };

export function LockView(props: {
  session: CoverSessionController;
  settings: HubSettings;
  passkeyDone: boolean;
  onPasskey: () => void;
  onOpen: (state: NeutralCoverSessionState) => void;
}): JSX.Element {
  const [stage, setStage] = useState<PasskeyStage>({ name: "idle" });
  const [live, setLive] = useState<string | null>(null);

  const enrolled =
    props.settings.devicePasskeyId !== null &&
    props.settings.devicePasskeyPublicKey !== null;
  const available = devicePasskeysAvailable();

  const run = async (): Promise<void> => {
    setStage({ name: "working" });
    setLive("Waiting for this device");
    try {
      if (enrolled) {
        await verifyDevicePasskey({
          credentialId: props.settings.devicePasskeyId ?? "",
          publicKey: props.settings.devicePasskeyPublicKey ?? "",
        });
      } else {
        const created = await createDevicePasskey("Wrenchless wallet");
        writeSettings({
          devicePasskeyId: created.credentialId,
          devicePasskeyPublicKey: created.publicKey,
        });
      }
      setLive(null);
      props.onPasskey();
    } catch (caught) {
      setStage({ name: "failed", reason: walletSafeReason(caught) });
      setLive("Not accepted");
    }
  };

  // A browser that cannot hold a passkey cannot open this wallet. The code
  // alone is one factor, and the product promised two, so this stops here and
  // says the one thing that changes it. There is no way past it.
  if (!available) {
    return (
      <Screen
        center
        lede="This wallet opens with a passkey and a code."
        title="Open Wrenchless"
      >
        <Emblem>
          <KeyIcon />
        </Emblem>
        <StatusLine icon={<WarningCircleIcon />} tone="alert">
          Open this page on localhost or over HTTPS. A passkey cannot be used on
          an IP address.
        </StatusLine>
        <Live message={live} />
      </Screen>
    );
  }

  if (!props.passkeyDone) {
    return (
      <Screen
        center
        lede={
          enrolled
            ? "Use the passkey saved on this phone."
            : "Save a passkey on this phone to open your wallet."
        }
        title="Open Wrenchless"
      >
        <Emblem>
          <KeyIcon />
        </Emblem>
        {stage.name === "failed" ? (
          <Note tone="caution">{stage.reason}</Note>
        ) : null}
        <Actions>
          <Button
            disabled={stage.name === "working"}
            icon={<KeyIcon />}
            label={
              stage.name === "working"
                ? "Waiting"
                : enrolled
                  ? "Use passkey"
                  : "Save passkey"
            }
            onClick={() => void run()}
          />
        </Actions>
        <Live message={live} />
      </Screen>
    );
  }

  return (
    <CodeEntry
      note="Your wallet closes itself after a few minutes."
      onOpen={props.onOpen}
      session={props.session}
      title="Enter your access code"
    />
  );
}
