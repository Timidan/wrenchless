import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";

import {
  sealGuardianEnrollmentResponse,
  type HeartbeatPlaintext,
} from "@wrenchless/canary-core";
import {
  getOrCreateGuardianHeartbeatKey,
  readGuardianHeartbeatKey,
  type StoredGuardianHeartbeatKey,
} from "../../lib/guardian-key-store";
import {
  enrollGuardianMailbox,
  retrieveGuardianHeartbeats,
} from "../../lib/guardian-mailbox";
import { createGuardianEnrollmentBundle } from "../../lib/role-handoff";
import { sendRestorePause } from "../../lib/vault-control";
import { bindMailboxSender, deliverHeartbeat } from "../../lib/mailbox-client";
import { formatTimestamp, reasonFrom } from "../../adapters/amount";
import {
  acknowledge,
  useAcknowledgements,
  useResponsePlan,
  writeResponsePlan,
} from "../../adapters/acknowledgements";
import {
  fromGuardianInvitation,
  readInvitationFromLocation,
} from "../../adapters/invitations";
import {
  createDevicePasskey,
  devicePasskeysAvailable,
  verifyDevicePasskey,
} from "../../adapters/device-passkey";
import { fromPairingCode, toPairingCode } from "../../adapters/pairing-code";
import { readSettings, useSettings, writeSettings } from "../../adapters/settings";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  PauseIcon,
  ScanIcon,
  ShieldCheckIcon,
  WarningCircleIcon,
} from "../../components/icons";
import { CopyValue } from "../shared/CopyValue";
import {
  Actions,
  Button,
  Emblem,
  Fact,
  Facts,
  Live,
  Note,
  ProductFrame,
  Screen,
  Section,
  StatusLine,
  TechnicalDetail,
  WalletField,
} from "../shared/product";

/**
 * The guardian's phone.
 *
 * Almost all of its life this screen says one thing: they are fine, and there
 * is nothing to do. That is the design, not a placeholder — a screen that
 * demanded attention every day would be a screen nobody reads on the one day it
 * matters.
 *
 * It is also the only surface allowed to be explicit, because it is not the
 * covert one. When a signal decrypts to a call for help it says so, by name,
 * with the time it arrived and the plan the two of them agreed on.
 *
 * What it cannot do is as deliberate as what it can. There is no balance here,
 * no payment, no amount, no address and no transaction reference — those never
 * leave the other phone. The one action is to stop new restores for a day, and
 * even that cannot move anybody's money.
 */

type KeyState =
  | { name: "loading" }
  | { name: "absent" }
  | { name: "creating" }
  | { name: "ready"; key: StoredGuardianHeartbeatKey }
  | { name: "failed"; reason: string };

type Inbox =
  | { name: "idle" }
  | { name: "loading" }
  | { name: "read"; events: readonly HeartbeatPlaintext[] }
  | { name: "failed"; reason: string };

type Pause =
  | { name: "idle" }
  | { name: "sending" }
  | { name: "sent"; blockedUntil: string }
  | { name: "failed"; reason: string };

type PairDelivery =
  | { name: "idle" }
  | { name: "sending" }
  | { name: "sent" }
  | { name: "failed"; reason: string };

type View = "home" | "pause";

function endsAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function SignalsSurface(): JSX.Element {
  const settings = useSettings();
  const acknowledgements = useAcknowledgements();
  const plan = useResponsePlan();

  const [keyState, setKeyState] = useState<KeyState>({ name: "loading" });
  const [inbox, setInbox] = useState<Inbox>({ name: "idle" });
  const [pairingCode, setPairingCode] = useState<string | null>(
    settings.guardianResponseToken,
  );
  const [pairDelivery, setPairDelivery] = useState<PairDelivery>({ name: "idle" });
  const [pairDeliveryAttempt, setPairDeliveryAttempt] = useState(0);
  const [pairError, setPairError] = useState<string | null>(null);
  const [invitationText, setInvitationText] = useState("");
  const [asking, setAsking] = useState(false);
  const [pause, setPause] = useState<Pause>({ name: "idle" });
  const [view, setView] = useState<View>("home");
  const [live, setLive] = useState<string | null>(null);
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);

  const paired =
    settings.controlTargetId !== null && settings.controlTargetPublicKey !== null;
  const alias = settings.signalAlias ?? "They";

  useEffect(() => {
    if (!accessGranted) return;
    let current = true;
    const read = async (): Promise<void> => {
      try {
        const key = await readGuardianHeartbeatKey();
        if (!current) return;
        setKeyState(key === null ? { name: "absent" } : { name: "ready", key });
      } catch (caught) {
        if (!current) return;
        setKeyState({ name: "failed", reason: reasonFrom(caught) });
      }
    };
    void read();
    return () => {
      current = false;
    };
  }, [accessGranted]);

  // A camera scan lands here with the invitation in the address. It is read
  // once and stripped, so a screenshot of the address bar carries nothing.
  useEffect(() => {
    const token = readInvitationFromLocation();
    if (token === null) return;
    setAsking(true);
    setInvitationText(token);
  }, []);

  const sendPairingResponse = useCallback(async (code: string): Promise<void> => {
    const parsed = fromPairingCode(code);
    if (!parsed.ok) throw new Error(parsed.message);
    const currentSettings = readSettings();
    if (
      currentSettings.controlTargetUrl === null ||
      currentSettings.controlTargetId === null ||
      currentSettings.controlTargetPublicKey === null
    ) {
      throw new Error("The original pairing request is no longer available.");
    }
    const key = await readGuardianHeartbeatKey();
    if (key === null) throw new Error("This guardian key is unavailable.");
    const response = await sealGuardianEnrollmentResponse(
      {
        mailboxId: parsed.bundle.mailboxId,
        mailboxBindCapability: parsed.bundle.mailboxBindCapability,
      },
      currentSettings.controlTargetPublicKey,
      key.privateKey,
    );
    await deliverHeartbeat(
      {
        mailboxUrl: currentSettings.controlTargetUrl,
        mailboxId: currentSettings.controlTargetId,
        senderSigningPrivateKey: key.signingPrivateKey,
      },
      response,
    );
  }, []);

  useEffect(() => {
    if (pairingCode === null) return;
    let current = true;
    setPairDelivery({ name: "sending" });
    setLive("Updating the other device");
    void sendPairingResponse(pairingCode)
      .then(() => {
        if (!current) return;
        setPairDelivery({ name: "sent" });
        setLive("The other device updated.");
      })
      .catch(() => {
        if (!current) return;
        setPairDelivery({
          name: "failed",
          reason: "The pairing mailbox did not accept the response.",
        });
        setLive("Automatic update did not reach them.");
      });
    return () => {
      current = false;
    };
  }, [pairDeliveryAttempt, pairingCode, sendPairingResponse]);

  /**
   * Accepts their invitation and answers it in one step.
   *
   * A key without an inbox cannot receive anything and an inbox without a key
   * cannot be read, so offering them separately only creates a state where
   * neither works. The signed response goes back through the control mailbox;
   * the visible code is only the recovery path if delivery fails.
   */
  const accept = async (): Promise<void> => {
    const parsed = fromGuardianInvitation(invitationText);
    if (!parsed.ok) {
      setPairError(parsed.message);
      return;
    }
    setPairError(null);
    setKeyState({ name: "creating" });
    setLive("Setting up");
    try {
      let passkeyId = settings.devicePasskeyId;
      let passkeyPublicKey = settings.devicePasskeyPublicKey;
      if (passkeyId === null || passkeyPublicKey === null) {
        const created = await createDevicePasskey("Wrenchless guardian");
        passkeyId = created.credentialId;
        passkeyPublicKey = created.publicKey;
      } else {
        await verifyDevicePasskey({
          credentialId: passkeyId,
          publicKey: passkeyPublicKey,
        });
      }
      const key = await getOrCreateGuardianHeartbeatKey();
      await bindMailboxSender({
        mailboxUrl: parsed.invitation.controlMailboxUrl,
        mailboxId: parsed.invitation.controlMailboxId,
        bindCapability: parsed.invitation.controlBindCapability,
        senderSigningPublicKey: key.signingPublicKey,
        senderEncryptionPublicKey: key.publicKey,
      });
      const inboxEnrollment = await enrollGuardianMailbox(
        parsed.invitation.controlMailboxUrl,
      );
      writeSettings({
        mailboxUrl: parsed.invitation.controlMailboxUrl,
        inboxId: inboxEnrollment.mailboxId,
        inboxReceiveCapability: inboxEnrollment.receiveCapability,
        controlTargetUrl: parsed.invitation.controlMailboxUrl,
        controlTargetId: parsed.invitation.controlMailboxId,
        controlTargetPublicKey: parsed.invitation.controlPublicKey,
        signalAlias: parsed.invitation.alias,
        signalInstruction: parsed.invitation.instruction,
        guardianPairedAt: new Date().toISOString(),
        devicePasskeyId: passkeyId,
        devicePasskeyPublicKey: passkeyPublicKey,
      });
      setAccessGranted(true);
      setKeyState({ name: "ready", key });
      const responseToken = toPairingCode(
        createGuardianEnrollmentBundle({
          guardianPublicKey: key.publicKey,
          guardianFingerprint: key.fingerprint,
          mailboxUrl: parsed.invitation.controlMailboxUrl,
          mailboxId: inboxEnrollment.mailboxId,
          mailboxBindCapability: inboxEnrollment.bindCapability,
        }),
      );
      writeSettings({ guardianResponseToken: responseToken });
      setPairDelivery({ name: "idle" });
      setPairingCode(responseToken);
      setInvitationText("");
      setAsking(false);
    } catch (caught) {
      setPairError(reasonFrom(caught));
      setLive("Setup did not finish");
      const existing = await readGuardianHeartbeatKey();
      setKeyState(existing === null ? { name: "absent" } : { name: "ready", key: existing });
    }
  };

  const unlockGuardian = async (): Promise<void> => {
    setAccessBusy(true);
    setAccessError(null);
    setLive("Waiting for this device");
    try {
      if (
        settings.devicePasskeyId === null ||
        settings.devicePasskeyPublicKey === null
      ) {
        const created = await createDevicePasskey("Wrenchless guardian");
        writeSettings({
          devicePasskeyId: created.credentialId,
          devicePasskeyPublicKey: created.publicKey,
        });
      } else {
        await verifyDevicePasskey({
          credentialId: settings.devicePasskeyId,
          publicKey: settings.devicePasskeyPublicKey,
        });
      }
      setAccessGranted(true);
      setLive(null);
    } catch (caught) {
      setAccessError(reasonFrom(caught));
      setLive("Not accepted");
    } finally {
      setAccessBusy(false);
    }
  };

  const refresh = useCallback(async (key: StoredGuardianHeartbeatKey): Promise<void> => {
    if (settings.inboxId === null || settings.inboxReceiveCapability === null) {
      return;
    }
    setInbox({ name: "loading" });
    setLive("Checking");
    try {
      const result = await retrieveGuardianHeartbeats({
        mailboxUrl: settings.mailboxUrl,
        mailboxId: settings.inboxId,
        receiveCapability: settings.inboxReceiveCapability,
        guardianPrivateKey: key.privateKey,
      });
      if (
        result.carriedSenderPublicKey !== null &&
        result.carriedSenderPublicKey !== settings.carriedSenderPublicKey
      ) {
        writeSettings({ carriedSenderPublicKey: result.carriedSenderPublicKey });
      }
      setInbox({ name: "read", events: result.events });
      setLive(null);
    } catch (caught) {
      setInbox({ name: "failed", reason: reasonFrom(caught) });
      setLive("Could not check");
    }
  }, [
    settings.carriedSenderPublicKey,
    settings.inboxId,
    settings.inboxReceiveCapability,
    settings.mailboxUrl,
  ]);

  // A guardian must never be reassured by an inbox that has not been read.
  // Check once as soon as both the local key and mailbox capability are ready.
  useEffect(() => {
    if (keyState.name !== "ready" || inbox.name !== "idle") return;
    if (settings.inboxId === null || settings.inboxReceiveCapability === null) return;
    void refresh(keyState.key);
  }, [inbox.name, keyState, refresh, settings.inboxId, settings.inboxReceiveCapability]);

  const confirmPause = async (): Promise<void> => {
    if (
      settings.controlTargetUrl === null ||
      settings.controlTargetId === null ||
      settings.controlTargetPublicKey === null ||
      keyState.name !== "ready"
    ) {
      return;
    }
    setPause({ name: "sending" });
    setLive("Sending");
    try {
      const result = await sendRestorePause({
        mailboxUrl: settings.controlTargetUrl,
        mailboxId: settings.controlTargetId,
        vaultControlPublicKey: settings.controlTargetPublicKey,
        guardianPrivateKey: keyState.key.privateKey,
        guardianSigningPrivateKey: keyState.key.signingPrivateKey,
      });
      setPause({ name: "sent", blockedUntil: result.blockedUntil });
      setLive("New restores paused");
    } catch (caught) {
      setPause({ name: "failed", reason: reasonFrom(caught) });
      setLive("Not sent");
    }
  };

  const shell = (body: JSX.Element): JSX.Element => (
    <ProductFrame
      detail={paired ? "Guardian access" : "Not paired"}
      label={paired ? alias : "Guardian phone"}
      role="guardian"
    >
      {body}
    </ProductFrame>
  );

  /* ---------- pairing ---------- */

  if (!paired) {
    if (!asking) {
      return shell(
        <Screen
          center
          lede="Open the code on their home vault."
          title="Scan their invitation"
        >
          <Emblem>
            <ScanIcon />
          </Emblem>
          {keyState.name === "failed" ? (
            <Note tone="caution">{keyState.reason}</Note>
          ) : null}
          <Actions>
            <Button
              icon={<ScanIcon />}
              label="Scan invitation"
              onClick={() => setAsking(true)}
            />
          </Actions>
          <Live message={live} />
        </Screen>,
      );
    }

    return shell(
      <Screen
        lede="Point your camera at their code, or paste it here."
        onBack={() => {
          setAsking(false);
          setPairError(null);
        }}
        title="Scan invitation"
      >
        <form
          className="wform"
          onSubmit={(event) => {
            event.preventDefault();
            void accept();
          }}
        >
          <WalletField error={pairError} label="Invitation code">
            {({ inputId, describedBy }) => (
              <textarea
                aria-describedby={describedBy}
                className="winput winput--paste"
                id={inputId}
                onChange={(event) => setInvitationText(event.target.value)}
                placeholder="wrg2_…"
                rows={3}
                spellCheck={false}
                value={invitationText}
              />
            )}
          </WalletField>
          <Actions>
            <Button
              disabled={
                keyState.name === "creating" || invitationText.trim().length === 0
              }
              label={keyState.name === "creating" ? "Setting up" : "Continue"}
              type="submit"
            />
          </Actions>
        </form>
        <Note>
          The key stays in this browser and cannot be recovered. Clearing site
          data or switching browser loses it.
        </Note>
        <Live message={live} />
      </Screen>,
    );
  }

  if (!accessGranted) {
    const available = devicePasskeysAvailable();
    return shell(
      <Screen
        center
        lede="Use the passkey saved on this phone."
        title="Open guardian access"
      >
        <Emblem>
          <ShieldCheckIcon />
        </Emblem>
        {accessError === null ? null : (
          <Note tone="caution">{accessError}</Note>
        )}
        {available ? (
          <Actions>
            <Button
              disabled={accessBusy}
              label={
                accessBusy
                  ? "Waiting"
                  : settings.devicePasskeyId === null
                    ? "Create passkey"
                    : "Use passkey"
              }
              onClick={() => void unlockGuardian()}
            />
          </Actions>
        ) : (
          <StatusLine icon={<WarningCircleIcon />} tone="alert">
            Open this page on localhost or over HTTPS to use a passkey.
          </StatusLine>
        )}
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- pairing confirmation ---------- */

  if (pairingCode !== null) {
    const deliveryFailed = pairDelivery.name === "failed";
    return shell(
      <Screen
        center
        lede={
          deliveryFailed
            ? "Use the backup code below."
            : "Return to the other device."
        }
        title={deliveryFailed ? "One more step" : "Guardian paired"}
      >
        <Emblem>
          <CheckCircleIcon />
        </Emblem>
        {keyState.name === "ready" ? (
          <p className="fingerprint">{keyState.key.fingerprint}</p>
        ) : null}
        {pairDelivery.name === "sent" ? (
          <StatusLine icon={<CheckCircleIcon />}>Other device updated.</StatusLine>
        ) : deliveryFailed ? (
          <StatusLine icon={<WarningCircleIcon />} tone="alert">
            Automatic update failed.
          </StatusLine>
        ) : (
          <StatusLine icon={<ArrowsClockwiseIcon />} iconMotion="spin">
            Updating the other device.
          </StatusLine>
        )}
        <details className="detail" open={deliveryFailed}>
          <summary>Having trouble?</summary>
          <CopyValue
            label="Backup code"
            note="Paste this into the other device."
            value={pairingCode}
          />
          {pairDelivery.name === "failed" ? <p>{pairDelivery.reason}</p> : null}
        </details>
        <Actions>
          {deliveryFailed ? (
            <Button
              label="Try again"
              onClick={() => setPairDeliveryAttempt((attempt) => attempt + 1)}
              tone="quiet"
            />
          ) : null}
          <Button
            disabled={
              pairDelivery.name === "idle" || pairDelivery.name === "sending"
            }
            label="Done"
            onClick={() => {
              writeSettings({ guardianResponseToken: null });
              setPairingCode(null);
            }}
          />
        </Actions>
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- the pause review ---------- */

  if (view === "pause") {
    if (pause.name === "sent") {
      return shell(
        <Screen center title="New restores paused">
          <Emblem>
            <PauseIcon />
          </Emblem>
          <Facts>
            <Fact label="Ends" value={endsAt(pause.blockedUntil)} />
            <Fact label="Their money" value="Untouched" />
          </Facts>
          <Note>
            They can lift it themselves. Otherwise it ends on its own.
          </Note>
          <Actions>
            <Button
              label="Done"
              onClick={() => {
                setView("home");
                setPause({ name: "idle" });
              }}
            />
          </Actions>
          <Live message={live} />
        </Screen>,
      );
    }

    const ends = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    return shell(
      <Screen
        lede="Their carried balance still works. This ends automatically in 24 hours."
        onBack={
          pause.name === "sending"
            ? undefined
            : () => {
                setView("home");
                setPause({ name: "idle" });
              }
        }
        title="Pause new restores?"
      >
        <Facts>
          <Fact label="Starts" value="Now" />
          <Fact label="Ends" value={endsAt(ends)} />
          <Fact label="Moves their money" value="No" />
        </Facts>
        {pause.name === "failed" ? (
          <>
            <StatusLine icon={<WarningCircleIcon />} tone="alert">
              Nothing was sent, and nothing is paused. Try again.
            </StatusLine>
            <TechnicalDetail>{pause.reason}</TechnicalDetail>
          </>
        ) : null}
        <Actions>
          <Button
            disabled={pause.name === "sending"}
            icon={<PauseIcon />}
            label={
              pause.name === "sending" ? "Sending" : "Pause for 24 hours"
            }
            onClick={() => void confirmPause()}
          />
        </Actions>
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- home ---------- */

  const events = inbox.name === "read" ? inbox.events : [];
  // The inbox returns what it holds, in whatever order it holds it. The one
  // that matters is the most recent call for help, so the sort happens here
  // rather than being assumed of the service.
  const newest = events
    .filter((event) => event.signal !== "OK")
    .sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )[0];
  const planLines = plan
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const instruction = settings.signalInstruction;
  const waitingForCarried =
    inbox.name === "read" && settings.carriedSenderPublicKey === null;
  const quietCheckComplete =
    inbox.name === "read" && newest === undefined && !waitingForCarried;
  const statusTitle =
    newest !== undefined
      ? `${alias} needs you`
      : waitingForCarried
        ? "Waiting for carried wallet"
      : quietCheckComplete
        ? "No alert received"
        : inbox.name === "failed" || keyState.name === "failed" || keyState.name === "absent"
          ? "Status unavailable"
          : `Checking on ${alias}`;
  const statusLede =
    newest !== undefined
      ? "Follow the plan you agreed on."
      : waitingForCarried
        ? "Finish pairing it from the home vault."
      : quietCheckComplete
        ? "The latest check found no alert."
        : inbox.name === "failed" || keyState.name === "failed" || keyState.name === "absent"
          ? "Try again before relying on this screen."
          : "Reading the private inbox.";

  return shell(
    <Screen
      lede={statusLede}
      title={statusTitle}
      {...(newest === undefined ? {} : { tone: "alert" as const })}
    >
      {quietCheckComplete ? (
        <Emblem>
          <ShieldCheckIcon />
        </Emblem>
      ) : newest === undefined ? (
        <Emblem>
          <ArrowsClockwiseIcon />
        </Emblem>
      ) : (
        <>
          <p aria-live="assertive" className="statusline" data-tone="alert" role="alert">
            <span aria-hidden="true" className="statusline__icon">
              <WarningCircleIcon />
            </span>
            <span>
              Private signal received {formatTimestamp(newest.createdAt)}.
            </span>
          </p>
          {acknowledgements[newest.messageId] === undefined ? null : (
            <Note>Seen on this device. Nothing was sent back.</Note>
          )}
        </>
      )}

      {inbox.name === "failed" ? (
        <>
          <StatusLine icon={<WarningCircleIcon />} tone="alert">
            Nothing could be read just now. Try again in a moment.
          </StatusLine>
          <TechnicalDetail>{inbox.reason}</TechnicalDetail>
        </>
      ) : null}

      {/* The key lives in this browser and nowhere else. If it has gone —
          cleared site data, a private window, a different browser — nothing
          here can be opened again, and the screen has to say that rather than
          leave a control greyed out with no reason. */}
      {keyState.name === "absent" || keyState.name === "failed" ? (
        <StatusLine icon={<WarningCircleIcon />} tone="alert">
          This browser no longer holds your key, so nothing can be opened here.
          Ask them to pair you again.
        </StatusLine>
      ) : null}

      {/* On a quiet day the first thing to reach for is another check. On a
          bad one it is the pause, so it leads. Nothing is added or removed
          between the two — only the order changes. */}
      <Actions>
        {newest === undefined ? null : (
          <Button
            icon={<PauseIcon />}
            label="Pause new restores"
            onClick={() => setView("pause")}
          />
        )}
        <Button
          disabled={keyState.name !== "ready" || inbox.name === "loading"}
          icon={<ArrowsClockwiseIcon />}
          iconMotion={inbox.name === "loading" ? "spin" : undefined}
          label={inbox.name === "loading" ? "Checking" : "Check again"}
          onClick={() => {
            if (keyState.name === "ready") void refresh(keyState.key);
          }}
        />
        {newest === undefined ? (
          <Button
            icon={<PauseIcon />}
            label="Pause new restores"
            onClick={() => setView("pause")}
          />
        ) : acknowledgements[newest.messageId] === undefined ? (
          <Button
            label="I have seen this"
            onClick={() => acknowledge(newest.messageId, "")}
            tone="quiet"
          />
        ) : null}
      </Actions>

      <Section title="What you will do" />
      {instruction === null && planLines.length === 0 ? (
        <Note>Write down what the two of you agreed. It is saved here only.</Note>
      ) : (
        <ol className="plan">
          {instruction === null ? null : <li>{instruction}</li>}
          {planLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      )}

      {/* The plan is written on a quiet day and read on a bad one. While a
          signal is open this is a list to follow, not a field to edit. */}
      {newest === undefined ? (
        <WalletField
          hint="One step per line. Saved on this device as you type."
          label="Your plan"
        >
          {({ inputId, describedBy }) => (
            <textarea
              aria-describedby={describedBy}
              className="winput"
              id={inputId}
              onChange={(event) => writeResponsePlan(event.target.value)}
              rows={4}
              value={plan}
            />
          )}
        </WalletField>
      ) : null}

      <Live message={live} />
    </Screen>,
  );
}
