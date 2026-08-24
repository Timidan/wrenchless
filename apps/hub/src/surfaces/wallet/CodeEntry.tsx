import type { JSX } from "react";
import { useState } from "react";

import type {
  CoverSessionController,
  NeutralCoverSessionState,
} from "../../lib/cover-session";
import { COVER_ACCESS_CODE_LENGTH } from "../../lib/cover-session";
import { walletSafeReason } from "../../adapters/cover-operations";
import { CaretLeftIcon } from "../../components/icons";
import { Live, Note, Screen } from "../shared/product";

/**
 * Four digits, and nothing that could tell them apart.
 *
 * Both codes open this wallet. One of them also asks someone to check on the
 * person entering it, and that difference must be invisible here: the same
 * dots, the same pause, the same word, the same next screen. So this file does
 * not learn which code was entered — it hands the digits to the session module
 * and gets back one neutral state — and there is no branch in it that could
 * render differently if it did.
 *
 * A keypad rather than a text field. A field brings a keyboard, an autofill
 * prompt, a paste menu and a visible character count, and each of those is a
 * place where the screen could behave differently on a second attempt.
 */

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;
const LENGTH = COVER_ACCESS_CODE_LENGTH;

export function CodeEntry(props: {
  session: CoverSessionController;
  title: string;
  note?: string | undefined;
  onOpen: (state: NeutralCoverSessionState) => void;
}): JSX.Element {
  const [digits, setDigits] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<string | null>(null);

  const submit = async (code: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setLive("Checking");
    try {
      const next = await props.session.unlock(code);
      setDigits("");
      setLive(null);
      props.onOpen(next);
    } catch (caught) {
      setError(walletSafeReason(caught));
      setDigits("");
      setLive("Not accepted");
    } finally {
      setBusy(false);
    }
  };

  const press = (key: string): void => {
    if (busy) return;
    if (key === "back") {
      setDigits((current) => current.slice(0, -1));
      return;
    }
    const next = `${digits}${key}`.slice(0, LENGTH);
    setDigits(next);
    if (next.length === LENGTH) void submit(next);
  };

  return (
    <Screen title={props.title}>
      <div
        aria-label={`${digits.length} of ${LENGTH} digits entered`}
        className="codedots"
        role="img"
      >
        {Array.from({ length: LENGTH }, (_unused, index) => (
          <span
            className="codedots__dot"
            data-filled={index < digits.length ? "" : undefined}
            key={index}
          />
        ))}
      </div>

      <div className="keypad">
        {KEYS.map((key, index) =>
          key === "" ? (
            <span className="keypad__key keypad__gap" key={`gap-${index}`} />
          ) : (
            <button
              aria-label={key === "back" ? "Delete a digit" : key}
              className="keypad__key"
              disabled={busy}
              key={key}
              onClick={() => press(key)}
              type="button"
            >
              {key === "back" ? <CaretLeftIcon aria-hidden="true" /> : key}
            </button>
          ),
        )}
      </div>

      {error === null ? null : <Note tone="caution">{error}</Note>}
      {props.note === undefined ? null : <Note>{props.note}</Note>}
      <Live message={live} />
    </Screen>
  );
}
