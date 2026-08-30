import type { JSX, ReactNode } from "react";
import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
} from "react";

import { StrkTokenMark } from "../../components/StrkTokenMark";
import { WrenchlessMark } from "../../components/WrenchlessMark";
import { CaretLeftIcon, CheckIcon, CopyIcon, EyeIcon, EyeSlashIcon } from "../../components/icons";
import { motionProfile } from "../../lib/motion";

/**
 * The parts the two product surfaces are built from.
 *
 * There is one device now — the phone in the traveller's hand — and two things
 * it does: hold a Travel Safe, and open one again from twelve words. They share
 * one frame rather than each inventing a chrome. What differs is the label in
 * the corner and what the screen is for — never the geometry, the type or the
 * controls, because a person who has seen one of these should not have to learn
 * the next.
 *
 * Two rules run through everything here. A figure is never invented: an amount
 * that has not been read yet draws a shape, not a zero. And state is never
 * carried by colour alone — every line that reports something says it in words,
 * and the tint only agrees with the words.
 */

export type ProductRole = "safe" | "recover";

/**
 * The frame: a lockup, what this surface is, and one optional control.
 *
 * The account line is deliberately two small lines rather than one: what the
 * surface is is the thing to read at a glance, and the account is there to
 * check when you already suspect you are about to sign from the wrong one.
 */
export function ProductFrame(props: {
  role: ProductRole;
  label: string;
  detail: string;
  /**
   * Where a multi-step flow has got to, as the reader would say it out loud.
   *
   * It belongs in the chrome and not in the screen. A counter set among the
   * heading, the glyph and the button is read as one of them — it sits on the
   * centre line, at the same distance as everything else, and it is the only
   * thing there that is not about the step being asked for. In the corner it
   * is what it actually is: the frame reporting where you are, next to the
   * frame reporting which device this is.
   */
  step?: { display: string; label: string } | undefined;
  action?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="product-stage">
      <div className="product" data-role={props.role}>
        <a className="skip-link" href="#product-main">
          Skip to the content
        </a>
        <header className="product__head">
          <a className="product__brand" href="/">
            <WrenchlessMark className="product__mark" />
            <span>wrenchless</span>
          </a>
          <p className="product__account">
            <span className="product__role">{props.label}</span>
            <span className="product__detail">{props.detail}</span>
          </p>
          {props.step === undefined ? null : (
            <p className="product__step">
              <span aria-hidden="true">{props.step.display}</span>
              <span className="visually-hidden">{props.step.label}</span>
            </p>
          )}
          {props.action}
        </header>
        <main className="product__main" id="product-main">
          {props.children}
        </main>
      </div>
    </div>
  );
}

/**
 * One screen.
 *
 * Back gets a tap row of its own above the heading. Sharing a row with the
 * title is how a 44px target ends up as a 24px chevron squeezed against a
 * wrapping line of type, and it puts a control on the same baseline as the one
 * thing the screen is about.
 */
export function Screen(props: {
  title?: string | undefined;
  lede?: string | undefined;
  /** The words carry an alert; the colour only agrees with them. */
  tone?: "alert" | undefined;
  onBack?: (() => void) | undefined;
  center?: boolean | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="screen" data-center={props.center === true ? "" : undefined}>
      {/* Held even when it is empty. The first screen of a flow has nothing to
          go back to and the second one does, and rendering the row only when
          it has a control means every heading in the flow lands at a different
          height — the screen moves under the person reading it. One row, one
          baseline, whether or not there is a control in it. */}
      <div className="screen__backrow">
        {props.onBack === undefined ? null : (
          <IconButton icon={<CaretLeftIcon />} label="Back" onClick={props.onBack} />
        )}
      </div>
      {props.title === undefined ? null : (
        <div className="screen__title">
          <h1 className={props.tone === "alert" ? "alert-title" : undefined}>
            {props.title}
          </h1>
          {props.lede === undefined ? null : <p>{props.lede}</p>}
        </div>
      )}
      <div className="screen__body" data-center={props.center === true ? "" : undefined}>
        {props.children}
      </div>
    </section>
  );
}

/**
 * The one control shape in the product: a hairline pill sized to its own words.
 *
 * Nothing here is ever filled or stretched. A black slab across the width of the
 * screen is how a page demands a decision, and these screens ask for a series of
 * small ones. The whole of the feedback is a wash, a stronger hairline and two
 * pixels of lift.
 */
export function Button(props: {
  label: string;
  icon?: ReactNode;
  onClick?: (() => void) | undefined;
  disabled?: boolean | undefined;
  tone?: "outline" | "quiet" | undefined;
  type?: "button" | "submit" | undefined;
  /** Set only while the state machine backing this button is actively
   * working; the icon rotates and the button reports `aria-busy`. */
  iconMotion?: "spin" | undefined;
}): JSX.Element {
  const spinning = props.iconMotion === "spin";
  return (
    <button
      aria-busy={spinning ? "true" : undefined}
      className={props.tone === "quiet" ? "wbtn wbtn--quiet" : "wbtn"}
      disabled={props.disabled === true}
      {...(props.onClick === undefined ? {} : { onClick: props.onClick })}
      type={props.type ?? "button"}
    >
      {props.icon === undefined ? null : (
        <span
          aria-hidden="true"
          className="wbtn__icon"
          data-icon-motion={spinning ? "spin" : undefined}
        >
          {props.icon}
        </span>
      )}
      <span>{props.label}</span>
    </button>
  );
}

/**
 * Actions sit on the centre line, and wrap under each other rather than shrink.
 *
 * A stack of two or more is one decision, and it is drawn as one: the buttons
 * give up their own outlines and a single hairline ring rests on the strong
 * action, travelling to whatever is pointed at or tabbed to. A stack of one is
 * not a decision, so it keeps the outline and the lift a lone button has always
 * had. Which of the two this is, is counted here, because this is the only
 * place that can see all of them.
 *
 * The ring is measured rather than described. Its buttons are sized by their
 * own words, they wrap, and the face they are set in arrives after first paint;
 * every one of those moves the edges any fixed figure would have been written
 * against. A ResizeObserver on the stack and on each button is what keeps the
 * ring honest through all three.
 */
export function Actions(props: {
  children: ReactNode;
  /** A column rather than a row: one strong action with quiet alternatives
   *  under it, which is the shape the travelling ring is drawn for. */
  stack?: boolean | undefined;
}): JSX.Element {
  const stack = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [box, setBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [primed, setPrimed] = useState(false);

  // The ring belongs only to an explicit stack with a real choice. Ordinary
  // multi-button rows keep their independent controls and outlines.
  const marked = props.stack === true && Children.count(props.children) > 1;

  const measure = useCallback(() => {
    const frame = stack.current;
    if (!frame || !marked) return;
    const all = [...frame.querySelectorAll<HTMLButtonElement>(".wbtn")];

    // Where the ring rests: the strong action, which is the first one that is
    // not quiet and not disabled. A stack whose primary is disabled has nothing
    // to recommend, so the ring rests on the first thing that can be pressed.
    const strong = all.findIndex(
      (button) => !button.classList.contains("wbtn--quiet") && !button.disabled,
    );
    const pressable = all.findIndex((button) => !button.disabled);
    const home = strong === -1 ? Math.max(pressable, 0) : strong;

    const target = all[at ?? home];
    if (!target) return;
    const outer = frame.getBoundingClientRect();
    const inner = target.getBoundingClientRect();
    setBox({
      x: inner.left - outer.left,
      y: inner.top - outer.top,
      w: inner.width,
      h: inner.height,
    });
  }, [at, marked]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const frame = stack.current;
    if (!frame || !marked) return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    for (const button of frame.querySelectorAll(".wbtn")) observer.observe(button);
    return () => {
      observer.disconnect();
    };
  }, [marked, measure]);

  // Travel is switched on only after the first placement has been painted.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setPrimed(true);
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, []);

  // Which button the pointer or the keyboard is on. Both are answered, because
  // a treatment that only exists for a mouse is half a treatment.
  const seek = (target: EventTarget | null): void => {
    const frame = stack.current;
    if (!(target instanceof Element) || !frame) return;
    const button = target.closest<HTMLButtonElement>(".wbtn");
    if (!button || button.disabled) return;
    const index = [...frame.querySelectorAll(".wbtn")].indexOf(button);
    if (index !== -1) setAt(index);
  };

  return (
    <div
      className={props.stack === true ? "wactions wactions--stack" : "wactions"}
      data-marked={marked ? "" : undefined}
      data-primed={primed ? "" : undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setAt(null);
      }}
      onFocus={(event) => {
        seek(event.target);
      }}
      onPointerLeave={() => {
        setAt(null);
      }}
      onPointerDown={(event) => {
        seek(event.target);
      }}
      onPointerOver={(event) => {
        seek(event.target);
      }}
      ref={stack}
    >
      {marked && box !== null ? (
        <span
          aria-hidden="true"
          className="wactions__ring"
          /*
           * Written as real properties rather than through four `--ring-*`
           * custom properties read by the stylesheet.
           *
           * Both shapes work. This one is chosen because it puts nothing
           * between the measurement and the box: these are the three properties
           * the stylesheet transitions, and they are set here with the numbers
           * this component just took off the target. The custom-property
           * version needs a cast to write a `--*` key through `CSSProperties`,
           * and it splits one fact — where the ring is — across a component and
           * a stylesheet.
           */
          style={{
            height: `${String(box.h)}px`,
            transform: `translate(${String(box.x)}px, ${String(box.y)}px)`,
            width: `${String(box.w)}px`,
          }}
        />
      ) : null}
      {props.children}
    </div>
  );
}

/** An icon-only control always carries its name; the glyph never carries it. */
export function IconButton(props: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean | undefined;
}): JSX.Element {
  return (
    <button
      aria-label={props.label}
      className="iconbtn"
      disabled={props.disabled === true}
      onClick={props.onClick}
      type="button"
    >
      <span aria-hidden="true">{props.icon}</span>
    </button>
  );
}

/**
 * An amount, with the token it is denominated in.
 *
 * The mark is decorative and the word STRK is not: a screen reader still hears
 * the asset, and a person still recognises it without reading. `pending` draws
 * the line's height without drawing a number, because a zero here would be a
 * claim about someone's money and the wrong one.
 */
export function Amount(props: {
  value: string | null;
  sign?: "+" | "−" | undefined;
  size?: "row" | "lead" | "display" | undefined;
}): JSX.Element {
  const size = props.size ?? "row";
  if (props.value === null) {
    return (
      <span aria-label="Amount loading" className="amount" data-size={size}>
        <span aria-hidden="true" className="amount__ghost" />
      </span>
    );
  }
  return (
    <span className="amount" data-size={size}>
      <span className="amount__value">
        {props.sign ?? ""}
        {props.value}
      </span>
      <StrkTokenMark className="amount__mark" />
      <span className="amount__symbol">STRK</span>
    </span>
  );
}

/** The one figure a screen is allowed to make large. */
export function Balance(props: {
  value: string | null;
  caption: string;
}): JSX.Element {
  return (
    <div className="balance">
      <p className="balance__figure">
        <Amount size="display" value={props.value} />
      </p>
      <p className="balance__caption">{props.caption}</p>
    </div>
  );
}

export function Facts(props: { children: ReactNode }): JSX.Element {
  return <dl className="wfacts">{props.children}</dl>;
}

export function Fact(props: {
  label: string;
  value: ReactNode;
  mono?: boolean | undefined;
  full?: string | undefined;
  strong?: boolean | undefined;
}): JSX.Element {
  return (
    <div className="wfacts__row" data-strong={props.strong === true ? "" : undefined}>
      <dt>{props.label}</dt>
      <dd
        className={props.mono === true ? "wfacts__value wfacts__value--mono" : "wfacts__value"}
        {...(props.full === undefined ? {} : { title: props.full })}
      >
        {props.value}
      </dd>
    </div>
  );
}

/**
 * A line of state: one glyph, one sentence.
 *
 * The tone changes the rule at its left edge and nothing else, because the
 * sentence has to be the message on a screen where a quarter of readers will
 * not see the difference between the two rules.
 */
export function StatusLine(props: {
  icon: ReactNode;
  tone?: "plain" | "alert" | undefined;
  children: ReactNode;
  announce?: boolean | undefined;
  /** Set only while the state machine behind this line is actively
   * working; the icon rotates and the line reports `aria-busy`. */
  iconMotion?: "spin" | undefined;
}): JSX.Element {
  const spinning = props.iconMotion === "spin";
  const announcing = spinning || props.announce === true;
  return (
    <p
      aria-busy={spinning ? "true" : undefined}
      aria-live={announcing ? "polite" : undefined}
      className="statusline"
      data-tone={props.tone ?? "plain"}
      role={announcing ? "status" : undefined}
    >
      <span
        aria-hidden="true"
        className="statusline__icon"
        data-icon-motion={spinning ? "spin" : undefined}
      >
        {props.icon}
      </span>
      <span>{props.children}</span>
    </p>
  );
}

/** Short, plain, and never a wall. One sentence is the target. */
export function Note(props: {
  tone?: "plain" | "caution" | undefined;
  children: ReactNode;
}): JSX.Element {
  return (
    <p className="wnote" data-tone={props.tone ?? "plain"}>
      {props.children}
    </p>
  );
}

export function WalletField(props: {
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
  children: (ids: {
    inputId: string;
    describedBy: string | undefined;
  }) => ReactNode;
}): JSX.Element {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy =
    [props.hint === undefined ? null : hintId, props.error ? errorId : null]
      .filter((value): value is string => value !== null)
      .join(" ") || undefined;

  return (
    <div className="wfield">
      <label className="wfield__label" htmlFor={inputId}>
        {props.label}
      </label>
      {props.children({ inputId, describedBy })}
      {props.hint === undefined ? null : (
        <p className="wfield__hint" id={hintId}>
          {props.hint}
        </p>
      )}
      {props.error ? (
        <p className="wfield__error" id={errorId} role="alert">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

/** One live region per screen, so a change is announced once and not thrice. */
export function Live(props: { message: string | null }): JSX.Element {
  return (
    <p aria-live="polite" className="wlive" role="status">
      {props.message ?? ""}
    </p>
  );
}

/**
 * Waiting, with no invented progress.
 *
 * Preparing a private action takes as long as it takes and nothing here can
 * predict it. An elapsed count is the honest shape; a bar filling to 90% and
 * stopping is a promise the code cannot keep.
 */
export function Waiting(props: { seconds: number | null }): JSX.Element {
  return (
    <p className="waiting">
      <span aria-hidden="true" className="waiting__pulse" />
      <span className="waiting__text">
        {props.seconds === null ? "Working" : `Working · ${props.seconds}s`}
      </span>
    </p>
  );
}

/** The circular glyph a full-screen prompt is built around. */
export function Emblem(props: { children: ReactNode }): JSX.Element {
  return (
    <span aria-hidden="true" className="emblem">
      {props.children}
    </span>
  );
}

function PhraseGrid(props: { words: readonly string[] }): JSX.Element {
  return (
    <ol className="phrase">
      {props.words.map((word, index) => (
        <li className="phrase__word" key={`${String(index)}-${word}`}>
          <span aria-hidden="true" className="phrase__index">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="phrase__text">{word}</span>
        </li>
      ))}
    </ol>
  );
}

type CopyState = "idle" | "copied" | "failed";

/**
 * The twelve words, numbered, read-only, and never a control.
 *
 * They are set in the mono face at a size somebody can copy onto paper from
 * arm's length, in a grid rather than a paragraph, because a phrase written as
 * prose is a phrase people transcribe in the wrong order.
 *
 * Pass `conceal` where the words are being shown for the first time. They then
 * arrive blurred behind a deliberate Reveal, because this screen is opened in
 * public places and a recovery phrase that paints itself onto a phone the
 * moment a screen loads has already been handed to whoever is behind you. The
 * blur is a visual guard only: the words stay in the accessibility tree, where
 * the person holding the phone is the one reading them.
 *
 * Copy sits beside it because the realistic alternative is retyping twelve
 * words into a notes app, and a phrase transcribed by hand is a phrase with a
 * typo in it. The button reports what actually happened — a clipboard the
 * browser refuses is said out loud rather than shown as a silent success.
 */
export function Phrase(props: {
  words: readonly string[];
  conceal?: boolean;
  /** Called the first time the words are revealed or copied. */
  onSeen?: () => void;
}): JSX.Element {
  const guarded = props.conceal === true;
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<CopyState>("idle");
  const shown = revealed || !guarded;

  useEffect(() => {
    if (copied === "idle") return;
    const timer = window.setTimeout(() => setCopied("idle"), 2_400);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const { onSeen } = props;
  const seen = useCallback((): void => {
    onSeen?.();
  }, [onSeen]);

  const copy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.words.join(" "));
      setCopied("copied");
      seen();
    } catch {
      setCopied("failed");
    }
  }, [props.words, seen]);

  if (!guarded) return <PhraseGrid words={props.words} />;

  return (
    <div className="phrasebox">
      <div className="phrasebox__sheet" data-concealed={shown ? undefined : "true"}>
        <PhraseGrid words={props.words} />
        {shown ? null : (
          <button
            className="phrasebox__reveal"
            onClick={() => {
              setRevealed(true);
              seen();
            }}
            type="button"
          >
            <span aria-hidden="true">
              <EyeIcon />
            </span>
            Reveal the words
          </button>
        )}
      </div>
      <div className="phrasebox__controls">
        <button
          className="phrasebox__action"
          onClick={() => {
            setRevealed(!revealed);
            if (!revealed) seen();
          }}
          type="button"
        >
          <span aria-hidden="true">{shown ? <EyeSlashIcon /> : <EyeIcon />}</span>
          {shown ? "Hide" : "Reveal"}
        </button>
        <button
          className="phrasebox__action"
          onClick={() => {
            void copy();
          }}
          type="button"
        >
          <span aria-hidden="true">
            {copied === "copied" ? <CheckIcon /> : <CopyIcon />}
          </span>
          {copied === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <p aria-live="polite" className="phrasebox__said" role="status">
        {copied === "copied"
          ? "The twelve words are on your clipboard. Paste them somewhere you keep, then clear it."
          : copied === "failed"
            ? "This browser would not give up the clipboard. Reveal the words and write them down."
            : ""}
      </p>
    </div>
  );
}

function formatRemaining(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

/**
 * How long the safe still has, counted down from the chain's own clock.
 *
 * The starting figure is the difference between the return date and the
 * timestamp of the accepted block the state was read at — never the device
 * clock, which decides nothing here. What ticks afterwards is only elapsed
 * time on this page, so the number stays a reading of that block rather than
 * an opinion about now, and the screen re-reads the chain to change state.
 *
 * Above an hour it moves once a minute, below it once a second, and under
 * reduced motion it does not move at all: the same figure, said once.
 */
export function Countdown(props: {
  returnDateSeconds: string;
  chainTimeSeconds: string;
}): JSX.Element {
  const span = Number(props.returnDateSeconds) - Number(props.chainTimeSeconds);
  const anchor = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const { reduced } = motionProfile();
  const remaining = Number.isFinite(span) ? Math.max(0, Math.round(span - elapsed)) : 0;
  const fast = remaining <= 3_600;

  useEffect(() => {
    if (reduced || !Number.isFinite(span)) return;
    if (anchor.current === 0) anchor.current = performance.now();
    const step = fast ? 1_000 : 60_000;
    const timer = window.setInterval(() => {
      setElapsed((performance.now() - anchor.current) / 1_000);
    }, step);
    return () => window.clearInterval(timer);
  }, [fast, reduced, span]);

  if (!Number.isFinite(span)) return <p className="countdown" />;
  return (
    <p className="countdown" data-live={reduced ? undefined : ""}>
      <span aria-hidden="true" className="countdown__tick" />
      <span className="countdown__value">
        {remaining === 0
          ? "The return date has passed"
          : `${reduced ? "About " : ""}${formatRemaining(remaining)} left`}
      </span>
    </p>
  );
}

/**
 * One transaction, as evidence rather than as decoration.
 *
 * Shown only when this browser actually has a hash for it; there is no row
 * standing by with a dash in it, because an empty reference reads as a
 * transaction that failed rather than as one that was never made here.
 */
export function TransactionRef(props: {
  label: string;
  hash: string;
  href: string;
}): JSX.Element {
  return (
    <p className="txref">
      <span className="txref__label">{props.label}</span>
      <a
        className="wref"
        href={props.href}
        rel="noreferrer noopener"
        target="_blank"
        title={props.hash}
      >
        {props.hash}
      </a>
    </p>
  );
}
