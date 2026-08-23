import type { JSX } from "react";
import { useEffect, useState } from "react";

import { importCoverAccessConfig } from "../../lib/cover-session";
import { createCarriedReceipt } from "../../lib/refill-pairing";
import { walletSafeReason } from "../../adapters/cover-operations";
import {
  createConfirmationCode,
  fromCarriedInvitation,
  readInvitationFromLocation,
} from "../../adapters/invitations";
import { parseCoverEnrollmentBundle } from "../../lib/role-handoff";
import {
  rememberRefillStateId,
  storeCoverEnrollment,
  writeSettings,
  type HubSettings,
} from "../../adapters/settings";
import { ScanIcon } from "../../components/icons";
import {
  Actions,
  Button,
  Emblem,
  Live,
  Note,
  Screen,
  WalletField,
} from "../shared/product";

/**
 * Before pairing there is one thing to do, and the screen shows one thing.
 *
 * A wallet that has not been paired holds nothing and can do nothing, so every
 * other control would be a control that fails. What it does have is a camera:
 * the invitation on the other device is a link, so the phone's own camera opens
 * this page with the invitation already in the address, and this screen reads
 * it and never puts it back.
 *
 * The typed path is not a lesser one. It is what a cracked lens, a locked-down
 * camera and a screen reader all use, and it accepts exactly the same value.
 */
export function PairView(props: {
  settings: HubSettings;
  onPaired: (receiptToken: string) => void;
}): JSX.Element {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);

  // A camera scan arrives as a fragment on this page. It is read once and
  // stripped from the address, so a shared screenshot of the URL bar carries
  // nothing.
  useEffect(() => {
    const token = readInvitationFromLocation();
    if (token === null) return;
    setAsking(true);
    setText(token);
  }, []);

  /**
   * Accepting an invitation, and answering it in the same breath.
   *
   * Three one-time restore requests are minted here and their private halves
   * never leave this phone — only the public half of each goes into the code
   * that gets read back. That is what lets the other device send money here
   * later without either of them holding the other's keys, and it is why the
   * receipt is worth showing as a code rather than as twelve characters.
   */
  const accept = async (value: string): Promise<void> => {
    const parsed = fromCarriedInvitation(value);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setBusy(true);
    try {
      const enrollment = parseCoverEnrollmentBundle(
        parsed.invitation.enrollmentText,
      );
      importCoverAccessConfig(parsed.invitation.accessConfigText);
      const code = props.settings.deviceCode ?? createConfirmationCode();
      let token = props.settings.deviceReceiptToken;
      let stateIds: readonly string[] = [];
      if (token === null) {
        const minted = await createCarriedReceipt(code);
        stateIds = minted.receipt.restoreRequests.map(
          (request) => request.stateId,
        );
        token = minted.token;
      }
      // Do not mark this browser paired until its own restore requests exist.
      // If key creation fails, a retry must return to this invitation instead
      // of opening a wallet that the home vault can never restore.
      storeCoverEnrollment(enrollment);
      for (const stateId of stateIds) rememberRefillStateId(stateId);
      writeSettings({
        exposureCapFri: parsed.invitation.exposureCapFri,
        deviceCode: code,
        deviceReceiptToken: token,
        carriedPairedAt: new Date().toISOString(),
        carriedAccount: null,
      });
      setError(null);
      setText("");
      props.onPaired(token);
    } catch (caught) {
      setError(walletSafeReason(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!asking) {
    return (
      <Screen
        center
        lede="Open the invitation shown on your other device."
        title="Pair your wallet"
      >
        <Emblem>
          <ScanIcon />
        </Emblem>
        <Actions>
          <Button
            icon={<ScanIcon />}
            label="Scan invitation"
            onClick={() => setAsking(true)}
          />
        </Actions>
        <Live message={live} />
      </Screen>
    );
  }

  return (
    <Screen
      lede="Point your camera at the code, or paste it here."
      onBack={() => {
        setAsking(false);
        setError(null);
      }}
      title="Scan invitation"
    >
      <form
        className="wform"
        onSubmit={(event) => {
          event.preventDefault();
          setLive("Checking");
          void accept(text);
        }}
      >
        <WalletField error={error} label="Invitation code">
          {({ inputId, describedBy }) => (
            <textarea
              aria-describedby={describedBy}
              autoComplete="off"
              className="winput winput--paste"
              id={inputId}
              onChange={(event) => setText(event.target.value)}
              placeholder="wrc1_…"
              rows={3}
              spellCheck={false}
              value={text}
            />
          )}
        </WalletField>
        <Actions>
          <Button
            disabled={busy || text.trim().length === 0}
            label={busy ? "Setting up" : "Continue"}
            type="submit"
          />
        </Actions>
      </form>
      <Note>This wallet holds nothing until it is paired.</Note>
      <Live message={live} />
    </Screen>
  );
}
