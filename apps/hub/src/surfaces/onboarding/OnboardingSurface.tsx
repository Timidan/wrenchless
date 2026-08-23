import type { JSX } from "react";
import { useEffect, useState } from "react";

import {
  createCoverSessionController,
  exportCoverAccessConfig,
  type CoverSessionController,
} from "../../lib/cover-session";
import {
  CODE_LENGTH,
  CodeEntry,
  isWeak,
  tooSimilar,
} from "./CodeEntry";
import { enrollGuardianMailbox } from "../../lib/guardian-mailbox";
import { WRENCHLESS_MAINNET } from "../../lib/product-config";
import {
  inspectReadyCoverAccount,
  type ReadyCoverAccountStatus,
} from "../../lib/ready-cover";
import {
  createCoverEnrollmentBundle,
  type GuardianEnrollmentBundle,
} from "../../lib/role-handoff";
import {
  importCarriedRestoreRequests,
  parseCarriedReceipt,
} from "../../lib/refill-pairing";
import { getOrCreateVaultControlKey } from "../../lib/vault-control";
import {
  formatStrk,
  formatStrkExact,
  formatStrkFigure,
  parseStrkAmount,
  reasonFrom,
  shortHex,
} from "../../adapters/amount";
import {
  createDevicePasskey,
  devicePasskeysAvailable,
  verifyDevicePasskey,
} from "../../adapters/device-passkey";
import {
  invitationLink,
  toCarriedInvitation,
  toGuardianInvitation,
} from "../../adapters/invitations";
import { fromPairingCode } from "../../adapters/pairing-code";
import {
  coverEnrollment,
  markOnboarded,
  readSettings,
  rememberRefillStateId,
  storeCoverEnrollment,
  useSettings,
  writeSettings,
} from "../../adapters/settings";
import {
  alreadyAuthorized,
  requestWalletAccount,
  type BrowserWallet,
} from "../../adapters/wallet";
import { navigate } from "../../routes";
import { ReadyWalletMark } from "../../components/ReadyWalletMark";
import {
  CaretRightIcon,
  CheckCircleIcon,
  KeyIcon,
  QrCodeIcon,
  ScanIcon,
  UserCircleIcon,
  VaultIcon,
  WalletIcon,
  WarningCircleIcon,
} from "../../components/icons";
import { QrInvitation } from "../shared/QrInvitation";
import {
  Actions,
  Amount,
  Button,
  Emblem,
  Live,
  Note,
  ProductFrame,
  Screen,
  StatusLine,
  TechnicalDetail,
  WalletField,
  Waiting,
} from "../shared/product";

/**
 * First run, and it happens here.
 *
 * Setup belongs on the device that holds the money. It is the one place a
 * person can be sitting somewhere safe, taking their time, with both other
 * phones in front of them — and it is the only place the second access code can
 * ever be explained, because the wallet it opens must never admit it exists.
 *
 * Seven things have to be true before any of this works, and a person meets
 * them one at a time, in the order that makes each one make sense. So this is a
 * single flow with one decision per screen, not a console with seven panels
 * open at once.
 *
 * The guardian is paired before the carried phone, which is the reverse of how
 * the two are usually listed. It is not a preference: the invitation the
 * carried phone receives has to contain the guardian's key and inbox, and those
 * do not exist until the guardian has answered. Pairing the phone first would
 * mean handing it half a wallet and a second code to scan later.
 *
 * Neither pairing step has a way past it. A device is paired when it has sent
 * back something this screen could not have produced on its own — the
 * guardian's own key material, the phone's own receipt — and until then the
 * step waits.
 */

type Step =
  | "passkey"
  | "connect"
  | "limit"
  | "codes"
  | "guardian"
  | "carried"
  | "done";

/** Where the reader is inside the two-code sequence. */
type CodePhase =
  | { name: "enter"; index: 1 | 2 }
  | { name: "confirm"; index: 1 | 2; first: string };

const ORDER: readonly Step[] = [
  "passkey",
  "connect",
  "limit",
  "codes",
  "guardian",
  "carried",
  "done",
];

const LIMITS = ["5", "10", "25", "50"] as const;
const ONE_STRK = 10n ** 18n;

type Account =
  | { name: "idle" }
  | { name: "connecting" }
  | { name: "checking" }
  | { name: "ready"; status: ReadyCoverAccountStatus }
  | { name: "failed"; reason: string };

type Passkey =
  | { name: "idle" }
  | { name: "working" }
  | { name: "done" }
  | { name: "failed"; reason: string };

type GuardianStage =
  | { name: "naming" }
  | { name: "preparing" }
  | { name: "waiting"; code: string; link: string }
  | { name: "confirm"; bundle: GuardianEnrollmentBundle }
  | { name: "failed"; reason: string };

type CarriedStage =
  | { name: "building" }
  | { name: "waiting"; code: string; link: string }
  | { name: "failed"; reason: string };

export function OnboardingSurface(): JSX.Element {
  const settings = useSettings();
  const setupComplete =
    settings.onboardedAt !== null &&
    settings.devicePasskeyId !== null &&
    settings.devicePasskeyPublicKey !== null;
  const [session] = useState<CoverSessionController>(() =>
    createCoverSessionController(),
  );
  const [step, setStep] = useState<Step>("passkey");
  const [live, setLive] = useState<string | null>(null);

  const [passkey, setPasskey] = useState<Passkey>({ name: "idle" });
  // A stored credential records that this device once enrolled. It is not
  // evidence that the person in front of it now is the one who did, so it
  // decides which question to ask the device, not whether to ask one.
  const enrolled =
    settings.devicePasskeyId === null || settings.devicePasskeyPublicKey === null
      ? null
      : {
          credentialId: settings.devicePasskeyId,
          publicKey: settings.devicePasskeyPublicKey,
        };
  const [account, setAccount] = useState<Account>({ name: "idle" });

  const [limit, setLimit] = useState(() => formatStrkExact(settings.exposureCapFri));
  const [limitError, setLimitError] = useState<string | null>(null);

  /**
   * The code step, one thing at a time.
   *
   * Both codes used to be two fields on one screen with no confirmation, so a
   * mistyped code became a wallet nobody could open and there was nothing to
   * catch it. The flow is now enter, confirm, enter, confirm — and a mismatch
   * restarts only the code it belongs to, never the pair.
   */
  const [codePhase, setCodePhase] = useState<CodePhase>({
    name: "enter",
    index: 1,
  });
  const [codeValue, setCodeValue] = useState("");
  const [firstCode, setFirstCode] = useState<string | null>(null);
  const [codesError, setCodesError] = useState<string | null>(null);
  const [savingCodes, setSavingCodes] = useState(false);
  const [codeShake, setCodeShake] = useState(0);

  const [alias, setAlias] = useState("");
  const [instruction, setInstruction] = useState("");
  const [aliasError, setAliasError] = useState<string | null>(null);
  const [guardian, setGuardian] = useState<GuardianStage>({ name: "naming" });
  const [theirCode, setTheirCode] = useState("");
  const [theirCodeError, setTheirCodeError] = useState<string | null>(null);

  const [carried, setCarried] = useState<CarriedStage>({ name: "building" });
  const [receipt, setReceipt] = useState("");
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [savingReceipt, setSavingReceipt] = useState(false);

  const index = ORDER.indexOf(step);
  const capFri = parseStrkAmount(limit);

  useEffect(() => {
    if (setupComplete) navigate("/reserve");
  }, [setupComplete]);

  // An account already authorised for this origin is shown without asking
  // again, so coming back to an interrupted setup does not start over.
  useEffect(() => {
    if (setupComplete) return;
    if (passkey.name !== "done") return;
    const existing = alreadyAuthorized();
    if (existing === null) return;
    void inspect(existing);
    // `inspect` is a hoisted declaration and never changes identity.
  }, [setupComplete, passkey.name]);

  async function inspect(connected: BrowserWallet): Promise<void> {
    setAccount({ name: "checking" });
    try {
      const status = await inspectReadyCoverAccount({
        wallet: connected,
        tokenAddress: WRENCHLESS_MAINNET.strkTokenAddress,
      });
      const boundAccount = readSettings().reserveAccount;
      if (
        boundAccount !== null &&
        BigInt(boundAccount) !== BigInt(status.account)
      ) {
        throw new Error(
          "Switch Ready Wallet to the account chosen for your home vault, then try again.",
        );
      }
      setAccount({ name: "ready", status });
      if (boundAccount === null) writeSettings({ reserveAccount: status.account });
    } catch (caught) {
      setAccount({ name: "failed", reason: reasonFrom(caught) });
    }
  }

  const provePasskey = async (): Promise<void> => {
    setPasskey({ name: "working" });
    setLive("Waiting for this device");
    try {
      if (enrolled === null) {
        const created = await createDevicePasskey("Wrenchless home vault");
        writeSettings({
          devicePasskeyId: created.credentialId,
          devicePasskeyPublicKey: created.publicKey,
        });
      } else {
        await verifyDevicePasskey(enrolled);
      }
      setPasskey({ name: "done" });
      setLive(null);
      setStep("connect");
    } catch (caught) {
      setPasskey({ name: "failed", reason: reasonFrom(caught) });
      setLive(null);
    }
  };

  const connect = async (): Promise<void> => {
    setAccount({ name: "connecting" });
    setLive("Waiting for Ready Wallet");
    try {
      const connected = await requestWalletAccount();
      await inspect(connected.wallet);
      setLive(null);
    } catch (caught) {
      setAccount({ name: "failed", reason: reasonFrom(caught) });
      setLive(null);
    }
  };

  const saveLimit = (): void => {
    if (!capFri.ok) {
      setLimitError(capFri.message);
      return;
    }
    setLimitError(null);
    writeSettings({ exposureCapFri: capFri.fri });
    setStep("codes");
  };

  const saveCodes = async (everyday: string, other: string): Promise<void> => {
    setSavingCodes(true);
    setCodesError(null);
    try {
      await session.setup(everyday, other);
      setFirstCode(null);
      setCodeValue("");
      setCodePhase({ name: "enter", index: 1 });
      setStep("guardian");
    } catch (caught) {
      setCodesError(reasonFrom(caught));
    } finally {
      setSavingCodes(false);
    }
  };

  /**
   * Creates the guardian's invitation.
   *
   * Two things are made here and neither exists before this moment: the key a
   * pause will be sealed to, and the inbox it will arrive in. The guardian is
   * given the inbox's send capability and nothing else, so it can write there
   * and read nothing — not even its own commands back.
   */
  const prepareGuardian = async (): Promise<void> => {
    const name = alias.trim();
    if (name.length === 0) {
      setAliasError("Enter a name they will recognise.");
      return;
    }
    setAliasError(null);
    setGuardian({ name: "preparing" });
    setLive("Preparing the invitation");
    try {
      const control = await getOrCreateVaultControlKey();
      const inbox = await enrollGuardianMailbox(settings.mailboxUrl);
      writeSettings({
        controlInboxId: inbox.mailboxId,
        controlInboxReceiveCapability: inbox.receiveCapability,
      });
      const note = instruction.trim();
      const token = toGuardianInvitation({
        alias: name,
        instruction: note.length === 0 ? null : note,
        controlMailboxUrl: settings.mailboxUrl,
        controlMailboxId: inbox.mailboxId,
        controlSendCapability: inbox.sendCapability,
        controlPublicKey: control.publicKey,
      });
      setGuardian({
        name: "waiting",
        code: token,
        link: invitationLink("/signals", token),
      });
      setLive("Waiting for their phone");
    } catch (caught) {
      setGuardian({ name: "failed", reason: reasonFrom(caught) });
      setLive(null);
    }
  };

  const readTheirCode = (): void => {
    const parsed = fromPairingCode(theirCode);
    if (!parsed.ok) {
      setTheirCodeError(parsed.message);
      return;
    }
    setTheirCodeError(null);
    setTheirCode("");
    setGuardian({ name: "confirm", bundle: parsed.bundle });
    setLive("Check the code with them");
  };

  const confirmGuardian = (bundle: GuardianEnrollmentBundle): void => {
    const note = instruction.trim();
    try {
      storeCoverEnrollment(
        createCoverEnrollmentBundle({
          guardianPublicKey: bundle.guardianPublicKey,
          guardianFingerprint: bundle.guardianFingerprint,
          mailboxUrl: bundle.mailboxUrl,
          mailboxId: bundle.mailboxId,
          sendCapability: bundle.sendCapability,
          coverAlias: alias.trim(),
          responseInstruction: note.length === 0 ? null : note,
        }),
      );
      writeSettings({ guardianPairedAt: new Date().toISOString() });
      setLive(null);
      setStep("carried");
      setCarried({ name: "building" });
    } catch (caught) {
      setGuardian({ name: "failed", reason: reasonFrom(caught) });
    }
  };

  /**
   * Builds the carried phone's invitation.
   *
   * It carries three things and no more: who to signal, the two access-code
   * verifiers, and the limit. Not one of them is a code, an address or a key
   * this device would not hand over anyway — and without all three the phone is
   * a wallet that cannot open, cannot signal and has no ceiling.
   */
  const prepareCarried = (): void => {
    setLive("Preparing the invitation");
    try {
      const enrollment = coverEnrollment(settings);
      const accessConfigText = exportCoverAccessConfig();
      if (enrollment === null || accessConfigText === null) {
        setCarried({
          name: "failed",
          reason: "Finish the earlier steps before pairing the phone.",
        });
        setLive(null);
        return;
      }
      const token = toCarriedInvitation({
        // Compact, not the module's indented form. This is the one payload that
        // has to fit inside a QR a phone camera can resolve, and the indentation
        // alone is a couple of hundred modules. The receiving side parses it
        // with the same module either way.
        enrollmentText: JSON.stringify(enrollment),
        accessConfigText,
        exposureCapFri: settings.exposureCapFri,
      });
      setCarried({
        name: "waiting",
        code: token,
        link: invitationLink("/wallet", token),
      });
      setLive("Waiting for the carried phone");
    } catch (caught) {
      setCarried({ name: "failed", reason: reasonFrom(caught) });
      setLive(null);
    }
  };

  useEffect(() => {
    if (step !== "carried" || carried.name !== "building") return;
    prepareCarried();
    // `prepareCarried` reads settings that cannot change while this step is on
    // screen, and re-running it would issue a second, different invitation
    // while someone is scanning the first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, carried.name]);

  // The route changes without a reload. Render no first-run step while React
  // hands the completed setup to the home-vault surface.
  if (setupComplete) return <></>;

  /**
   * Reads the phone's answer, and keeps what it carries.
   *
   * The code is not a receipt with a number in it. It holds the public half of
   * three one-time restore requests the phone minted and sealed, and this is
   * the only moment they cross. Binding each one to this device — a refund key
   * that exists nowhere else — is what lets the reserve send money to that
   * phone later, and take an uncollected restore back if it never lands.
   */
  const confirmCarried = async (): Promise<void> => {
    const parsed = parseCarriedReceipt(receipt);
    if (!parsed.ok) {
      setReceiptError(parsed.message);
      return;
    }
    setReceiptError(null);
    setSavingReceipt(true);
    setLive("Reading the code");
    try {
      const intents = await importCarriedRestoreRequests(
        parsed.receipt.restoreRequests,
      );
      for (const intent of intents) rememberRefillStateId(intent.stateId);
      writeSettings({
        carriedDeviceCode: parsed.receipt.confirmationCode,
        carriedPairedAt: new Date().toISOString(),
      });
      setReceipt("");
      setLive(null);
      setStep("done");
    } catch (caught) {
      setReceiptError(reasonFrom(caught));
      setLive(null);
    } finally {
      setSavingReceipt(false);
    }
  };

  const finish = (): void => {
    markOnboarded();
    navigate("/reserve");
  };

  const goBack = (): void => {
    if (step === "guardian" && guardian.name !== "naming") {
      setGuardian({ name: "naming" });
      return;
    }
    const previous = ORDER[index - 1];
    if (previous !== undefined) setStep(previous);
  };

  const shell = (body: JSX.Element): JSX.Element => (
    <ProductFrame
      detail={
        account.name === "ready" ? shortHex(account.status.account) : "Setup"
      }
      label="Home vault"
      role="setup"
    >
      {body}
    </ProductFrame>
  );

  const count = (
    <p className="stepcount">
      {step === "done" ? "Ready" : `${index + 1} / ${ORDER.length - 1}`}
    </p>
  );

  /* ---------- 1 · the passkey ---------- */

  if (step === "passkey") {
    const available = devicePasskeysAvailable();
    return shell(
      <Screen
        center
        lede="This is where you keep the money you are not carrying."
        title="Set up your home vault"
      >
        {count}
        <Emblem>
          <KeyIcon />
        </Emblem>
        {passkey.name === "failed" ? (
          <Note tone="caution">{passkey.reason}</Note>
        ) : null}
        {/* The passkey is the gate, not a suggestion. A browser that cannot
            hold one cannot set this device up, so the screen says what to
            change and stops — there is nothing here to continue past. */}
        {available ? (
          <Actions>
            <Button
              disabled={passkey.name === "working"}
              icon={<KeyIcon />}
              label={
                passkey.name === "working"
                  ? "Waiting"
                  : passkey.name === "done"
                    ? "Continue"
                    : enrolled === null
                      ? "Create passkey"
                      : "Use passkey"
              }
              onClick={
                passkey.name === "done"
                  ? () => setStep("connect")
                  : () => void provePasskey()
              }
            />
          </Actions>
        ) : (
          <StatusLine icon={<WarningCircleIcon />} tone="alert">
            Open this page on localhost or over HTTPS. A passkey cannot be saved
            on an IP address.
          </StatusLine>
        )}
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- 2 · the reserve account ---------- */

  if (step === "connect") {
    return shell(
      <Screen
        center
        lede="Choose the Ready Wallet account that stays at home."
        onBack={goBack}
        title="Connect your reserve"
      >
        {count}
        {account.name === "ready" ? (
          <>
            <StatusLine icon={<CheckCircleIcon />}>
              Ready Wallet connected.
            </StatusLine>
            <p className="fingerprint">{shortHex(account.status.account)}</p>
            <p className="balance__caption">
              <Amount value={formatStrk(account.status.publicBalanceFri)} /> on
              Starknet
            </p>
            <Actions>
              <Button
                icon={<CaretRightIcon />}
                label="Use this account"
                onClick={() => setStep("limit")}
              />
              <Button
                label="Use another"
                onClick={() => void connect()}
                tone="quiet"
              />
            </Actions>
          </>
        ) : (
          <>
            <Emblem>
              <VaultIcon />
            </Emblem>
            {account.name === "failed" ? (
              <Note tone="caution">{account.reason}</Note>
            ) : null}
            <Actions>
              <Button
                disabled={
                  account.name === "connecting" || account.name === "checking"
                }
                icon={<ReadyWalletMark className="ready-wallet-mark" />}
                label={
                  account.name === "connecting"
                    ? "Waiting for Ready Wallet"
                    : account.name === "checking"
                      ? "Checking"
                      : account.name === "failed"
                        ? "Try again"
                        : "Connect Ready Wallet"
                }
                onClick={() => void connect()}
              />
            </Actions>
          </>
        )}
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- 3 · the carried limit ---------- */

  if (step === "limit") {
    return shell(
      <Screen
        lede="Your carried wallet will never hold more than this."
        onBack={goBack}
        title="Set a carried limit"
      >
        {count}
        <p className="balance__figure">
          <Amount size="lead" value={capFri.ok ? formatStrkFigure(capFri.fri) : null} />
        </p>
        <ul className="wchips" role="group">
          {LIMITS.map((value) => (
            <li key={value}>
              <button
                aria-pressed={
                  capFri.ok &&
                  capFri.fri === (BigInt(value) * ONE_STRK).toString()
                }
                className="wchip"
                onClick={() => {
                  setLimit(value);
                  setLimitError(null);
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
            saveLimit();
          }}
        >
          <WalletField error={limitError} label="Carried limit in STRK">
            {({ inputId, describedBy }) => (
              <input
                aria-describedby={describedBy}
                className="winput winput--mono"
                id={inputId}
                inputMode="decimal"
                onChange={(event) => setLimit(event.target.value)}
                type="text"
                value={limit}
              />
            )}
          </WalletField>
          <Actions>
            <Button icon={<CaretRightIcon />} label="Continue" type="submit" />
          </Actions>
        </form>
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- 4 · the two codes ---------- */

  if (step === "codes") {
    const second = codePhase.index === 2;
    const confirming = codePhase.name === "confirm";

    /* A complete code is the only thing that moves the flow. Nothing here
       answers an individual digit, so a confident entry and a hesitant one
       look the same from across a table. */
    const onCode = (next: string): void => {
      setCodeValue(next);
      if (next.length !== CODE_LENGTH || savingCodes) return;

      /* Fixed, not measured. The work behind this step differs between the
         two codes, and a pause that tracked it would time-stamp which one
         was entered. */
      window.setTimeout(() => {
        setCodeValue("");

        if (codePhase.name === "enter") {
          if (isWeak(next)) {
            setCodesError("Pick something less predictable than that.");
            setCodeShake((n) => n + 1);
            return;
          }
          if (second && firstCode !== null && tooSimilar(firstCode, next)) {
            setCodesError("Too close to your first code. Pick another.");
            setCodeShake((n) => n + 1);
            return;
          }
          setCodesError(null);
          setCodePhase({ name: "confirm", index: codePhase.index, first: next });
          return;
        }

        if (next !== codePhase.first) {
          setCodesError("That did not match. Start this code again.");
          setCodeShake((n) => n + 1);
          setCodePhase({ name: "enter", index: codePhase.index });
          return;
        }

        setCodesError(null);
        if (codePhase.index === 1) {
          setFirstCode(codePhase.first);
          setCodePhase({ name: "enter", index: 2 });
        } else if (firstCode !== null) {
          void saveCodes(firstCode, codePhase.first);
        }
      }, 240);
    };

    return shell(
      <Screen
        lede={
          confirming
            ? "Just to be sure it is the one you meant."
            : second
              ? "Four digits, and not a variation of the first."
              : "Four digits. You will use this one every day."
        }
        onBack={goBack}
        title={
          confirming
            ? "Enter it again"
            : second
              ? "Choose your second code"
              : "Choose your everyday code"
        }
      >
        {count}
        <div
          className="codestep"
          key={`${String(codePhase.index)}-${codePhase.name}-${String(codeShake)}`}
        >
          <CodeEntry
            disabled={savingCodes}
            label="Access code"
            onChange={onCode}
            value={codeValue}
          />
        </div>
        <p aria-live="polite" className="codestep__msg">
          {codesError ?? "\u00a0"}
        </p>
        <Note>Remember which is which. The wallet never labels them again.</Note>
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- 5 · the guardian ---------- */

  if (step === "guardian") {
    if (guardian.name === "naming") {
      return shell(
        <Screen
          lede="They see your signal. They never see your balance or payments."
          onBack={goBack}
          title="Add your guardian"
        >
          {count}
          <Emblem>
            <UserCircleIcon />
          </Emblem>
          <form
            className="wform"
            onSubmit={(event) => {
              event.preventDefault();
              void prepareGuardian();
            }}
          >
            <WalletField
              error={aliasError}
              hint="They see this instead of your address."
              label="What should they call you?"
            >
              {({ inputId, describedBy }) => (
                <input
                  aria-describedby={describedBy}
                  className="winput"
                  id={inputId}
                  maxLength={48}
                  onChange={(event) => setAlias(event.target.value)}
                  type="text"
                  value={alias}
                />
              )}
            </WalletField>
            <WalletField
              hint="Optional. Shown with every signal."
              label="Anything they should do"
            >
              {({ inputId, describedBy }) => (
                <input
                  aria-describedby={describedBy}
                  className="winput"
                  id={inputId}
                  maxLength={160}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder="Call me before anything else"
                  type="text"
                  value={instruction}
                />
              )}
            </WalletField>
            <Actions>
              <Button icon={<QrCodeIcon />} label="Make invitation" type="submit" />
            </Actions>
          </form>
          <Live message={live} />
        </Screen>,
      );
    }

    if (guardian.name === "preparing") {
      return shell(
        <Screen center onBack={goBack} title="Preparing the invitation">
          {count}
          <Waiting seconds={null} />
          <Live message={live} />
        </Screen>,
      );
    }

    if (guardian.name === "failed") {
      return shell(
        <Screen onBack={goBack} title="Invitation not ready">
          {count}
          <StatusLine icon={<WarningCircleIcon />} tone="alert">
            Nothing was set up. Check this device is online and try again.
          </StatusLine>
          <TechnicalDetail>{guardian.reason}</TechnicalDetail>
          <Actions>
            <Button label="Try again" onClick={() => void prepareGuardian()} />
          </Actions>
          <Live message={live} />
        </Screen>,
      );
    }

    if (guardian.name === "confirm") {
      return shell(
        <Screen
          lede="Read the code aloud. Continue only if it matches theirs."
          onBack={goBack}
          title="Check it is really them"
        >
          {count}
          <p className="fingerprint">{guardian.bundle.guardianFingerprint}</p>
          <Actions>
            <Button
              icon={<CheckCircleIcon />}
              label="It matches"
              onClick={() => confirmGuardian(guardian.bundle)}
            />
          </Actions>
          <Live message={live} />
        </Screen>,
      );
    }

    return shell(
      <Screen
        lede="Ask them to open the guardian view and scan this."
        onBack={goBack}
        title="Pair your guardian phone"
      >
        {count}
        <QrInvitation
          code={guardian.code}
          label="QR code for the guardian invitation"
          link={guardian.link}
          note="It lets their phone reach you, and nothing else."
        />
        <StatusLine icon={<ScanIcon />}>Waiting for their phone.</StatusLine>
        <form
          className="wform"
          onSubmit={(event) => {
            event.preventDefault();
            readTheirCode();
          }}
        >
          <WalletField
            error={theirCodeError}
            hint="Their phone shows this once it has read your invitation."
            label="Code from their phone"
          >
            {({ inputId, describedBy }) => (
              <textarea
                aria-describedby={describedBy}
                className="winput winput--paste"
                id={inputId}
                onChange={(event) => setTheirCode(event.target.value)}
                placeholder="wrl1_…"
                rows={3}
                spellCheck={false}
                value={theirCode}
              />
            )}
          </WalletField>
          <Actions>
            <Button
              disabled={theirCode.trim().length === 0}
              icon={<CaretRightIcon />}
              label="Continue"
              type="submit"
            />
          </Actions>
        </form>
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- 6 · the carried phone ---------- */

  if (step === "carried") {
    if (carried.name === "building") {
      return shell(
        <Screen center onBack={goBack} title="Preparing the invitation">
          {count}
          <Waiting seconds={null} />
          <Live message={live} />
        </Screen>,
      );
    }

    if (carried.name === "failed") {
      return shell(
        <Screen onBack={goBack} title="Invitation not ready">
          {count}
          <StatusLine icon={<WarningCircleIcon />} tone="alert">
            The invitation could not be built. Try again.
          </StatusLine>
          <TechnicalDetail>{carried.reason}</TechnicalDetail>
          <Actions>
            <Button label="Try again" onClick={prepareCarried} />
          </Actions>
          <Live message={live} />
        </Screen>,
      );
    }

    return shell(
      <Screen
        lede="Open the carried wallet on the other phone and scan this."
        onBack={goBack}
        title="Pair your carried phone"
      >
        {count}
        <QrInvitation
          code={carried.code}
          label="QR code for the carried wallet invitation"
          link={carried.link}
          note="It sets up that phone. Show it to nobody else."
        />
        <StatusLine icon={<ScanIcon />}>Waiting for the carried phone.</StatusLine>
        <form
          className="wform"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmCarried();
          }}
        >
          <WalletField
            error={receiptError}
            hint="Scan it from the phone, or paste it here."
            label="Code from the carried phone"
          >
            {({ inputId, describedBy }) => (
              <textarea
                aria-describedby={describedBy}
                className="winput winput--paste"
                id={inputId}
                onChange={(event) => setReceipt(event.target.value)}
                placeholder="wrr1_…"
                rows={3}
                spellCheck={false}
                value={receipt}
              />
            )}
          </WalletField>
          <Actions>
            <Button
              disabled={savingReceipt || receipt.trim().length === 0}
              icon={<CaretRightIcon />}
              label={savingReceipt ? "Reading" : "Continue"}
              type="submit"
            />
          </Actions>
        </form>
        <Live message={live} />
      </Screen>,
    );
  }

  /* ---------- 7 · done ---------- */

  return shell(
    <Screen center lede="Everything else stays here." title="Your wallet is ready">
      {count}
      <Emblem>
        <CheckCircleIcon />
      </Emblem>
      <p className="balance__figure">
        <Amount size="lead" value={formatStrkFigure(settings.exposureCapFri)} />
      </p>
      <p className="balance__caption">Carried limit</p>
      <Actions>
        <Button icon={<WalletIcon />} label="Open home vault" onClick={finish} />
      </Actions>
      <Live message={live} />
    </Screen>,
  );
}
