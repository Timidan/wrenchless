import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";

/**
 * Four digits on four rules.
 *
 * The real input sits transparent over the rules, so the caret, selection,
 * paste and the software keyboard all behave the way the platform means them
 * to while the rules do the drawing. A label rather than a click handler, so
 * the whole area is a hit target and the semantics come for free.
 *
 * Three things here are safety behaviour rather than styling, and each is the
 * kind that quietly stops being true when a component is tidied later:
 *
 *  - **Nothing reacts to an individual digit.** A field that answers each
 *    keystroke gives a confident entry a different rhythm from a hesitant one.
 *    Only a complete code changes anything.
 *  - **The active rule breathes on a fixed clock**, not on typing speed. It
 *    marks where the next digit lands without timing the person entering it.
 *  - **Both codes use this component, unchanged.** No second variant, no extra
 *    hint, no different placeholder. Anything that tells them apart on screen
 *    tells them apart to someone watching.
 */

export const CODE_LENGTH = 4;

const digitsOnly = (value: string): string =>
  value.replace(/\D/g, "").slice(0, CODE_LENGTH);

export function CodeEntry(props: {
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  /** Names the field for assistive technology; never says which code it is. */
  label: string;
}): JSX.Element {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const active = Math.min(props.value.length, CODE_LENGTH - 1);

  /* Each step of the flow remounts this field. Without taking focus back, a
     reader has to tap again for every one of the four codes they enter. */
  useEffect(() => {
    if (!props.disabled) ref.current?.focus();
  }, [props.disabled]);

  return (
    <label className="code">
      <span className="code__sr">{props.label}</span>
      <input
        autoComplete="off"
        className="code__input"
        disabled={props.disabled}
        inputMode="numeric"
        maxLength={CODE_LENGTH}
        onBlur={() => setFocused(false)}
        onChange={(event) => props.onChange(digitsOnly(event.target.value))}
        onFocus={() => setFocused(true)}
        ref={ref}
        type="password"
        value={props.value}
      />
      <span aria-hidden="true" className="code__row">
        {Array.from({ length: CODE_LENGTH }, (_, index) => (
          <span
            className="code__slot"
            data-active={
              focused && !props.disabled && index === active ? true : undefined
            }
            data-on={props.value[index] ? true : undefined}
            key={index}
          >
            <span className="code__mark">
              {props.value[index] ? "•" : ""}
            </span>
          </span>
        ))}
      </span>
    </label>
  );
}

/** Rejects a second code that is a trivial variation of the first. */
export function tooSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === [...b].reverse().join("")) return true;
  let differing = 0;
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    if (a[index] !== b[index]) differing += 1;
  }
  return differing < 2;
}

/** Rejects the codes a shoulder-surfer guesses first. */
export function isWeak(code: string): boolean {
  if (new Set(code).size === 1) return true;
  const digits = [...code].map(Number);
  const ascending = digits.every(
    (digit, index) => index === 0 || digit === digits[index - 1]! + 1,
  );
  const descending = digits.every(
    (digit, index) => index === 0 || digit === digits[index - 1]! - 1,
  );
  return ascending || descending;
}
