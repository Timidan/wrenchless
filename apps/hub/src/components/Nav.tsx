import type { JSX } from "react";
import { ArrowRoll } from "./ArrowRoll";
import { HeaderMorph } from "./HeaderMorph";
import { WrenchlessMark } from "./WrenchlessMark";

/**
 * Two elements, in the order they have always been in: the wordmark and one
 * pill. What changed is the box around them.
 *
 * HeaderMorph holds the state; nothing here watches the scroll position, and
 * the connect button is untouched.
 */
export function Nav(): JSX.Element {
  return (
    <HeaderMorph label="Primary">
      <a className="nav__wordmark" href="#top">
        <WrenchlessMark className="nav__mark" />
        <span>wrenchless</span>
      </a>
      <a className="btn btn--primary nav__cta" href="/start">
        <span>Start Wrenchless</span>
        <ArrowRoll />
      </a>
    </HeaderMorph>
  );
}
