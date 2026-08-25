import type { JSX, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { StrkTokenMark } from "../../components/StrkTokenMark";
import { WrenchlessMark } from "../../components/WrenchlessMark";
import { CaretLeftIcon } from "../../components/icons";
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

/** Actions sit on the centre line, and wrap under each other rather than shrink. */
export function Actions(props: { children: ReactNode }): JSX.Element {
  return <div className="wactions">{props.children}</div>;
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
  /** Set only while the state machine behind this line is actively
   * working; the icon rotates and the line reports `aria-busy`. */
  iconMotion?: "spin" | undefined;
}): JSX.Element {
  const spinning = props.iconMotion === "spin";
  return (
    <p
      aria-busy={spinning ? "true" : undefined}
      aria-live={spinning ? "polite" : undefined}
      className="statusline"
      data-tone={props.tone ?? "plain"}
      role={spinning ? "status" : undefined}
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

/**
 * The twelve words, numbered, read-only, and never a control.
 *
 * They are set in the mono face at a size somebody can copy onto paper from
 * arm's length, in a grid rather than a paragraph, because a phrase written as
 * prose is a phrase people transcribe in the wrong order.
 */
export function Phrase(props: { words: readonly string[] }): JSX.Element {
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
