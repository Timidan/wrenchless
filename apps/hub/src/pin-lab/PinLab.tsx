import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * A bench for the access-code entry, not a screen that ships.
 *
 * Four ways of taking four digits, and one procedural flow driving whichever
 * is selected, so the interaction can be judged before any of it is wired into
 * onboarding. Nothing here talks to the wallet, stores a code, or leaves the
 * page: the codes live in component state for the length of the visit.
 *
 * Two rules are held by every variant rather than by the flow around them,
 * because they are the ones that quietly stop being true when a component is
 * edited later:
 *
 *  - **No per-digit validation.** A field that reacts as each digit lands
 *    gives a confident entry a different rhythm from a hesitant one, and both
 *    codes must look the same to someone watching over a shoulder.
 *  - **Both codes are the same component.** There is no second variant, no
 *    extra hint, and no different placeholder for the second code. Anything
 *    that distinguishes them on screen distinguishes them to a reader.
 */

const LENGTH = 4;

/* ---------- the four candidates ---------- */

type VariantId = "keypad" | "boxes" | "underline" | "single";

interface Variant {
  id: VariantId;
  name: string;
  note: string;
  /** Why it might be the right one, and what it costs. */
  tradeoff: string;
}

const VARIANTS: readonly Variant[] = [
  {
    id: "keypad",
    name: "Dots and keypad",
    note: "Four dots fill as you type. The keypad is drawn by the page.",
    tradeoff:
      "The phone-lock pattern, so it needs no explaining. Large fixed targets, and no system keyboard means the layout never jumps and entry takes the same shape on every device. Costs vertical space.",
  },
  {
    id: "boxes",
    name: "Four boxes",
    note: "One box per digit, advancing as you go.",
    tradeoff:
      "The one-time-code pattern people know from every login. Progress is obvious. Uses the system keyboard, which on iOS resizes the viewport and can shift the frame mid-entry.",
  },
  {
    id: "underline",
    name: "Four rules",
    note: "Digits sit on baseline rules, masked once entered.",
    tradeoff:
      "Quietest of the four and closest to the rest of the page's type-led language. Less obviously an input, which is a real cost on a screen someone meets once.",
  },
  {
    id: "single",
    name: "One field",
    note: "A single spaced field holding four digits.",
    tradeoff:
      "Least machinery and least to go wrong; native selection and paste behave normally. Reads as an ordinary form field rather than as a code, and gives the weakest sense of progress.",
  },
];

/* ---------- the procedural flow ---------- */

type Phase =
  | { name: "enter"; code: 1 | 2 }
  | { name: "confirm"; code: 1 | 2; first: string }
  | { name: "done" };

/** Rejects a second code that is a trivial variation of the first. */
function tooSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a === [...b].reverse().join("")) return true;
  let differing = 0;
  for (let i = 0; i < LENGTH; i += 1) if (a[i] !== b[i]) differing += 1;
  return differing < 2;
}

function isWeak(code: string): boolean {
  if (new Set(code).size === 1) return true;
  const digits = [...code].map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1]! + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1]! - 1);
  return ascending || descending;
}

export function PinLab(): JSX.Element {
  const [variant, setVariant] = useState<VariantId>("keypad");
  const [phase, setPhase] = useState<Phase>({ name: "enter", code: 1 });
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [firstCode, setFirstCode] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  const reset = useCallback(() => {
    setPhase({ name: "enter", code: 1 });
    setValue("");
    setError(null);
    setFirstCode(null);
    setBusy(false);
  }, []);

  /* A complete code advances the flow. The pause is fixed rather than
     measured: the real thing derives a verifier here, and a step that took
     as long as the work it did would time-stamp which path was taken. */
  const submit = useCallback(
    (entered: string) => {
      if (busy) return;
      setBusy(true);
      window.setTimeout(() => {
        setBusy(false);
        setValue("");

        if (phase.name === "enter") {
          if (isWeak(entered)) {
            setError("Pick something less predictable than that.");
            setShake((n) => n + 1);
            return;
          }
          if (phase.code === 2 && firstCode && tooSimilar(firstCode, entered)) {
            setError("Too close to your first code. Pick something else.");
            setShake((n) => n + 1);
            return;
          }
          setError(null);
          setPhase({ name: "confirm", code: phase.code, first: entered });
          return;
        }

        if (phase.name === "confirm") {
          if (entered !== phase.first) {
            setError("That did not match. Start this code again.");
            setShake((n) => n + 1);
            setPhase({ name: "enter", code: phase.code });
            return;
          }
          setError(null);
          if (phase.code === 1) {
            setFirstCode(phase.first);
            setPhase({ name: "enter", code: 2 });
          } else {
            setPhase({ name: "done" });
          }
        }
      }, 260);
    },
    [busy, phase, firstCode],
  );

  useEffect(() => {
    if (value.length === LENGTH) submit(value);
  }, [value, submit]);

  const copy = useMemo(() => {
    if (phase.name === "done") return null;
    const second = phase.code === 2;
    const title =
      phase.name === "enter"
        ? second
          ? "Choose your second code"
          : "Choose your everyday code"
        : "Enter it again";
    const lede =
      phase.name === "enter"
        ? second
          ? "Four digits, and not a variation of the first."
          : "Four digits. You will use this one every day."
        : "Just to be sure it is the one you meant.";
    return { title, lede };
  }, [phase]);

  const stepIndex =
    phase.name === "done"
      ? 4
      : (phase.code - 1) * 2 + (phase.name === "confirm" ? 1 : 0);

  return (
    <main className="lab">
      <header className="lab__head">
        <h1>Access code entry</h1>
        <p className="lab__lede">
          Four candidates for the same job. Pick one with the switch, then walk
          the whole flow — everyday code, confirm, second code, confirm.
          Nothing is stored and nothing leaves the page.
        </p>
      </header>

      <div className="lab__switch" role="tablist" aria-label="Input style">
        {VARIANTS.map((v) => (
          <button
            aria-selected={v.id === variant}
            className="lab__tab"
            key={v.id}
            onClick={() => {
              setVariant(v.id);
              reset();
            }}
            role="tab"
            type="button"
          >
            {v.name}
          </button>
        ))}
      </div>

      <section className="lab__stage">
        <div className="phone">
          <div className="phone__inner">
            {phase.name === "done" ? (
              <Done onAgain={reset} />
            ) : (
              <>
                <Progress index={stepIndex} />
                <h2 className="pin__title">{copy?.title}</h2>
                <p className="pin__lede">{copy?.lede}</p>

                <div
                  className="pin__field"
                  data-shake={shake || undefined}
                  key={`${variant}-${phase.name}-${phase.code}-${shake}`}
                >
                  <Field
                    busy={busy}
                    onChange={setValue}
                    value={value}
                    variant={variant}
                  />
                </div>

                <p aria-live="polite" className="pin__msg">
                  {error ?? " "}
                </p>
              </>
            )}
          </div>
        </div>

        <aside className="lab__notes">
          <h3>{VARIANTS.find((v) => v.id === variant)?.name}</h3>
          <p className="lab__note">
            {VARIANTS.find((v) => v.id === variant)?.note}
          </p>
          <p className="lab__trade">
            {VARIANTS.find((v) => v.id === variant)?.tradeoff}
          </p>
          <h3>Held by every variant</h3>
          <ul className="lab__rules">
            <li>No reaction to individual digits — only to a complete code.</li>
            <li>
              The pause before advancing is fixed, not proportional to the work
              behind it.
            </li>
            <li>
              Both codes use one component, one wording pattern, one rhythm.
            </li>
            <li>A mismatch restarts that code only, and says so plainly.</li>
            <li>Targets are at least 44px; motion respects reduced-motion.</li>
          </ul>
        </aside>
      </section>
    </main>
  );
}

/* ---------- shared chrome ---------- */

function Progress({ index }: { index: number }): JSX.Element {
  const labels = ["Code", "Confirm", "Code", "Confirm"];
  return (
    <ol className="steps" aria-label="Progress">
      {labels.map((l, i) => (
        <li
          className="steps__item"
          data-state={i < index ? "done" : i === index ? "now" : "next"}
          key={`${l}-${String(i)}`}
        >
          <span className="steps__dot" aria-hidden="true" />
          <span className="steps__label">{l}</span>
        </li>
      ))}
    </ol>
  );
}

function Done({ onAgain }: { onAgain: () => void }): JSX.Element {
  return (
    <div className="done">
      <h2 className="pin__title">Both codes set</h2>
      <p className="pin__lede">
        The wallet does not label them again. Remember which is which.
      </p>
      <button className="lab__btn" onClick={onAgain} type="button">
        Run it again
      </button>
    </div>
  );
}

/* ---------- the four fields ---------- */

interface FieldProps {
  variant: VariantId;
  value: string;
  onChange: (next: string) => void;
  busy: boolean;
}

function Field(props: FieldProps): JSX.Element {
  if (props.variant === "keypad") return <Keypad {...props} />;
  if (props.variant === "boxes") return <Boxes {...props} />;
  if (props.variant === "underline") return <Underline {...props} />;
  return <Single {...props} />;
}

const digitsOnly = (s: string): string =>
  s.replace(/\D/g, "").slice(0, LENGTH);

/** A · dots plus a page-drawn keypad. */
function Keypad({ value, onChange, busy }: FieldProps): JSX.Element {
  const press = (d: string): void => {
    if (busy || value.length >= LENGTH) return;
    onChange(value + d);
  };
  const back = (): void => {
    if (busy) return;
    onChange(value.slice(0, -1));
  };
  return (
    <div className="kp">
      <Dots count={value.length} />
      <div className="kp__grid">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            className="kp__key"
            disabled={busy}
            key={d}
            onClick={() => press(d)}
            type="button"
          >
            {d}
          </button>
        ))}
        <span />
        <button
          className="kp__key"
          disabled={busy}
          onClick={() => press("0")}
          type="button"
        >
          0
        </button>
        <button
          aria-label="Delete"
          className="kp__key kp__key--quiet"
          disabled={busy || value.length === 0}
          onClick={back}
          type="button"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}

function Dots({ count }: { count: number }): JSX.Element {
  return (
    <div
      className="dots"
      role="img"
      aria-label={`${String(count)} of ${String(LENGTH)} digits entered`}
    >
      {Array.from({ length: LENGTH }, (_, i) => (
        <span className="dots__dot" data-on={i < count || undefined} key={i} />
      ))}
    </div>
  );
}

/** B · four boxes, one digit each. */
function Boxes({ value, onChange, busy }: FieldProps): JSX.Element {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    refs.current[Math.min(value.length, LENGTH - 1)]?.focus();
  }, [value.length]);

  return (
    <div className="boxes">
      {Array.from({ length: LENGTH }, (_, i) => (
        <input
          aria-label={`Digit ${String(i + 1)}`}
          autoComplete="off"
          className="boxes__cell"
          disabled={busy}
          inputMode="numeric"
          key={i}
          maxLength={1}
          onChange={(e) => {
            const d = digitsOnly(e.target.value);
            if (!d) return;
            onChange(digitsOnly(value.slice(0, i) + d));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !value[i]) {
              onChange(value.slice(0, Math.max(0, i - 1)));
            }
          }}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="password"
          value={value[i] ?? ""}
        />
      ))}
    </div>
  );
}

/**
 * C · four baseline rules.
 *
 * A label rather than a div with a click handler: the browser then gives
 * click-to-focus, the whole area as a hit target, and the right semantics for
 * free. The real input sits transparent on top of the rules, which keeps the
 * caret, selection, paste and the software keyboard behaving normally while
 * the rules do the drawing.
 *
 * The next slot is marked from the value's own length rather than by a CSS
 * sibling trick, so it stays correct after a backspace. Without it the field
 * is four identical rules and nothing says where the next digit lands — the
 * one weakness this variant has against boxes.
 */
function Underline({ value, onChange, busy }: FieldProps): JSX.Element {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const active = Math.min(value.length, LENGTH - 1);

  /* Each step remounts this field, and a procedural flow that drops focus
     between steps asks the reader to tap again for every code they enter.
     Mobile browsers only honour this because the step before it was a
     keystroke, which is exactly the case here. */
  useEffect(() => {
    if (!busy) ref.current?.focus();
  }, [busy]);

  return (
    <label className="rules">
      <span className="rules__sr">Access code</span>
      <input
        autoComplete="off"
        className="rules__input"
        disabled={busy}
        inputMode="numeric"
        maxLength={LENGTH}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(digitsOnly(e.target.value))}
        onFocus={() => setFocused(true)}
        ref={ref}
        type="password"
        value={value}
      />
      <span aria-hidden="true" className="rules__row">
        {Array.from({ length: LENGTH }, (_, i) => (
          <span
            className="rules__slot"
            data-active={focused && !busy && i === active ? true : undefined}
            data-on={value[i] ? true : undefined}
            key={i}
          >
            <span className="rules__mark">{value[i] ? "\u2022" : ""}</span>
          </span>
        ))}
      </span>
    </label>
  );
}

/** D · one spaced field. */
function Single({ value, onChange, busy }: FieldProps): JSX.Element {
  return (
    <input
      aria-label="Access code"
      autoComplete="off"
      className="single"
      disabled={busy}
      inputMode="numeric"
      maxLength={LENGTH}
      onChange={(e) => onChange(digitsOnly(e.target.value))}
      placeholder="••••"
      type="password"
      value={value}
    />
  );
}

export function LabRoot({ children }: { children: ReactNode }): JSX.Element {
  return <>{children}</>;
}
