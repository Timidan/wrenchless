import type { JSX, ReactNode } from "react";
import { useId } from "react";

import { StrkTokenMark } from "../../components/StrkTokenMark";
import { WrenchlessMark } from "../../components/WrenchlessMark";
import { CaretLeftIcon } from "../../components/icons";

/**
 * The parts all four devices are built from.
 *
 * Three of them are a phone in someone's hand and the fourth is a phone-shaped
 * setup flow, so they share one frame rather than each inventing a chrome. What
 * differs between them is the label in the corner and what the screen is for —
 * never the geometry, the type or the controls, because a person who has seen
 * one of these should not have to learn the next.
 *
 * Two rules run through everything here. A figure is never invented: an amount
 * that has not been read yet draws a shape, not a zero. And state is never
 * carried by colour alone — every line that reports something says it in words,
 * and the tint only agrees with the words.
 */

export type ProductRole = "wallet" | "vault" | "guardian" | "setup";

/**
 * The frame: a lockup, whose device this is, and one optional control.
 *
 * The account line is deliberately two small lines rather than one: the role is
 * the thing to read at a glance, and the address is there to check when you
 * already suspect you are on the wrong device.
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
  tabs?: ReactNode;
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
        {props.tabs}
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
  /**
   * The one place a heading is allowed to carry the alert hue, and it is on the
   * screen that is not the covert one. It never carries the message on its own:
   * the words say what happened, and the colour only agrees with them.
   */
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
      className="statusline"
      data-tone={props.tone ?? "plain"}
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

export function Section(props: {
  title: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="sectionhead">
      <p className="eyebrow">{props.title}</p>
      {props.action}
    </div>
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

/** What is missing, and the one thing to do about it. */
export function Empty(props: {
  title: string;
  body: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="wempty">
      <p className="wempty__title">{props.title}</p>
      <p className="wempty__body">{props.body}</p>
      {props.action === undefined ? null : (
        <div className="wempty__action">{props.action}</div>
      )}
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
 * Preparing a private restore takes as long as it takes and nothing here can
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

/**
 * The technical half of a failure, folded away.
 *
 * A person needs one sentence about what happened and what to do next; the
 * HTTP status, the RPC message and the contract's own words are for whoever
 * they eventually show the screen to. So the sentence stays in the open and
 * this holds the rest, closed, and only on the surfaces where reading it costs
 * nothing — never on the carried wallet.
 */
export function TechnicalDetail(props: { children: ReactNode }): JSX.Element {
  return (
    <details className="detail">
      <summary>What the service said</summary>
      <p>{props.children}</p>
    </details>
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
