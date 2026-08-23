import type { JSX } from "react";
import { useId, useState } from "react";

import { CheckIcon, CopyIcon } from "../../components/icons";

/**
 * A value someone has to move somewhere else, shown as a value rather than as
 * a document.
 *
 * Codes here are long because of what is inside them, not because anyone needs
 * to read them. So the affordance is Copy, the text is selectable, and the box
 * is sized to be recognisably "a code" rather than to invite proofreading.
 *
 * Every screen that shows a QR shows one of these underneath it. A camera is
 * the fast path, not the only one: a cracked lens, a locked-down phone or a
 * screen reader all end up here instead.
 */
export function CopyValue(props: {
  label: string;
  value: string;
  note?: string | undefined;
  secret?: boolean | undefined;
}): JSX.Element {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(props.secret !== true);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission: reveal it so it can be selected by hand.
      setShown(true);
    }
  };

  return (
    <div className="copyvalue">
      <div className="copyvalue__head">
        <label className="copyvalue__label" htmlFor={id}>
          {props.label}
        </label>
        <div className="copyvalue__tools">
          {props.secret === true ? (
            <button
              className="copyvalue__tool"
              onClick={() => setShown((value) => !value)}
              type="button"
            >
              {shown ? "Hide" : "Show"}
            </button>
          ) : null}
          <button className="copyvalue__tool" onClick={() => void copy()} type="button">
            {copied ? (
              <CheckIcon aria-hidden="true" />
            ) : (
              <CopyIcon aria-hidden="true" />
            )}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
      </div>
      <output className="copyvalue__value" id={id}>
        {shown ? props.value : "•".repeat(48)}
      </output>
      {props.note === undefined ? null : (
        <p className="copyvalue__note">{props.note}</p>
      )}
    </div>
  );
}
