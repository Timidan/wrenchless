import type { JSX } from "react";
import { useEffect, useState } from "react";

import {
  accessCodeIssue,
  accessCodesAreTooSimilar,
  createCoverSessionController,
  type CoverSessionController,
} from "../../lib/cover-session";
import { createCarriedReceipt } from "../../lib/refill-pairing";
import { getOrCreateCarriedAuthKey } from "../../lib/carried-auth-key";
import { bindMailboxSender } from "../../lib/mailbox-client";
import { walletSafeReason } from "../../adapters/cover-operations";
import {
  type CarriedInvitation,
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
import { CODE_LENGTH, CodeEntry } from "../onboarding/CodeEntry";

type CodePhase =
  | { name: "enter"; index: 1 | 2 }
  | { name: "confirm"; index: 1 | 2; first: string };

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
  const [invitation, setInvitation] = useState<CarriedInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [session] = useState<CoverSessionController>(() =>
    createCoverSessionController(),
  );
  const [codePhase, setCodePhase] = useState<CodePhase>({
    name: "enter",
    index: 1,
  });
  const [codeValue, setCodeValue] = useState("");
  const [firstCode, setFirstCode] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeShake, setCodeShake] = useState(0);

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
  const accept = (value: string): void => {
    const parsed = fromCarriedInvitation(value);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    setText("");
    setInvitation(parsed.invitation);
  };

  const finishPairing = async (
    pending: CarriedInvitation,
    everydayCode: string,
    otherCode: string,
  ): Promise<void> => {
    setBusy(true);
    try {
      const enrollment = parseCoverEnrollmentBundle(
        pending.enrollmentText,
      );
      await session.setup(everydayCode, otherCode);
      const code = props.settings.deviceCode ?? createConfirmationCode();
      const sender = await getOrCreateCarriedAuthKey();
      await bindMailboxSender({
        mailboxUrl: enrollment.mailboxUrl,
        mailboxId: enrollment.mailboxId,
        bindCapability: pending.mailboxBindCapability,
        senderSigningPublicKey: sender.signingPublicKey,
        senderEncryptionPublicKey: sender.publicKey,
      });
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
        exposureCapFri: pending.exposureCapFri,
        deviceCode: code,
        deviceReceiptToken: token,
        deviceReceiptDoneAt: null,
        pairingResponseMailboxId:
          pending.schemaVersion === "wrenchless.carried-invitation.v3"
            ? pending.responseMailboxId
            : null,
        pairingResponseBindCapability:
          pending.schemaVersion === "wrenchless.carried-invitation.v3"
            ? pending.responseMailboxBindCapability
            : null,
        pairingResponsePublicKey:
          pending.schemaVersion === "wrenchless.carried-invitation.v3"
            ? pending.responsePublicKey
            : null,
        carriedPairedAt: new Date().toISOString(),
        carriedAccount: null,
      });
      setError(null);
      props.onPaired(token);
    } catch (caught) {
      setCodeError(walletSafeReason(caught));
    } finally {
      setBusy(false);
    }
  };

  const onCode = (next: string): void => {
    setCodeValue(next);
    if (next.length !== CODE_LENGTH || busy || invitation === null) return;
    window.setTimeout(() => {
      setCodeValue("");
      if (codePhase.name === "enter") {
        const issue = accessCodeIssue(next);
        if (issue !== null) {
          setCodeError(issue);
          setCodeShake((value) => value + 1);
          return;
        }
        if (
          codePhase.index === 2 &&
          firstCode !== null &&
          accessCodesAreTooSimilar(firstCode, next)
        ) {
          setCodeError("Too close to your first code. Pick another.");
          setCodeShake((value) => value + 1);
          return;
        }
        setCodeError(null);
        setCodePhase({ name: "confirm", index: codePhase.index, first: next });
        return;
      }
      if (next !== codePhase.first) {
        setCodeError("That did not match. Start this code again.");
        setCodeShake((value) => value + 1);
        setCodePhase({ name: "enter", index: codePhase.index });
        return;
      }
      setCodeError(null);
      if (codePhase.index === 1) {
        setFirstCode(codePhase.first);
        setCodePhase({ name: "enter", index: 2 });
      } else if (firstCode !== null) {
        void finishPairing(invitation, firstCode, codePhase.first);
      }
    }, 240);
  };

  if (invitation !== null) {
    const second = codePhase.index === 2;
    const confirming = codePhase.name === "confirm";
    return (
      <Screen
        lede={
          confirming
            ? "Enter the same four digits again."
            : second
              ? "Choose a different four-digit code."
              : "Choose the four digits you will use every day."
        }
        onBack={
          busy
            ? undefined
            : () => {
                setInvitation(null);
                setCodePhase({ name: "enter", index: 1 });
                setFirstCode(null);
                setCodeValue("");
                setCodeError(null);
              }
        }
        title={
          confirming
            ? "Enter it again"
            : second
              ? "Choose your second code"
              : "Choose your everyday code"
        }
      >
        <div
          className="codestep"
          key={`${String(codePhase.index)}-${codePhase.name}-${String(codeShake)}`}
        >
          <CodeEntry
            disabled={busy}
            label="Access code"
            onChange={onCode}
            value={codeValue}
          />
        </div>
        <p aria-live="polite" className="codestep__msg">
          {codeError ?? "\u00a0"}
        </p>
        <Note>Remember which is which. The wallet never labels them again.</Note>
        <Live message={live} />
      </Screen>
    );
  }

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
          accept(text);
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
              placeholder="wrc2_…"
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
