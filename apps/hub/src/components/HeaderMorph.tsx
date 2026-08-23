import type { JSX, ReactNode } from "react";
import { useEffect, useState } from "react";

/**
 * The oa-design header morph (skills/oa-design/11-header-morph.md), fitted to
 * this page.
 *
 * At rest the bar is transparent, borderless and full width: the wordmark sits
 * on the left edge and the one pill sits on the right, which is the shape the
 * page has always had. Past a short scroll it collapses into a floating glass
 * pill, and that is the point of the change: the old bar carried
 * `mix-blend-mode: difference`, which inverted unpredictably over the bright
 * frames of the story dive and left the wordmark sitting directly on top of
 * photograph detail on a phone. A pill brings its own ground, so contrast
 * becomes local and stops depending on whatever happens to be behind it.
 *
 * Three rules from the recipe carry the effect, and all three are kept:
 *
 * - The state lives in a `data-scrolled` attribute and the whole morph is CSS
 *   transitions. Nothing animates styles from JS, so the browser interpolates
 *   max-width, height, margin, padding, background, border and shadow in one
 *   composited pass.
 * - The wrapper's box is a CONSTANT height. Only the bar inside it changes, so
 *   no measurement under it ever moves. (The wrapper is fixed rather than
 *   sticky: this page opens on a sticky full-height hero that the bar has to
 *   sit over, and a sticky header would take its 64px out of the flow above
 *   the hero.)
 * - 700ms cubic-bezier(0.32, 0.72, 0, 1). The slow clock is for scroll effects
 *   only; the button inside keeps the page's own 120ms press.
 *
 * The listener is passive and does nothing but compare a number, so it is
 * cheap enough to run on Lenis's scroll stream.
 */
const THRESHOLD_PX = 24;

/**
 * How far back the page has to come before the bar opens out again.
 *
 * A single figure would be a bug here rather than a simplification. Lenis
 * eases toward its target rather than landing on it, so a scroll that stops
 * near the threshold crosses it several times on the way to rest, and a bar
 * on a 700ms tween answers every one of those crossings: the pill flickers
 * open and shut for the better part of a second. The band below is wider
 * than that overshoot, so the state can only change once per real gesture.
 */
const RELEASE_PX = 8;

export function HeaderMorph({
  children,
  label,
  threshold = THRESHOLD_PX,
}: {
  children: ReactNode;
  /** Accessible name for the navigation landmark inside the bar. */
  label: string;
  /** Scroll-Y in px after which the pill state engages. */
  threshold?: number;
}): JSX.Element {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const release = Math.max(0, threshold - RELEASE_PX);
    const onScroll = (): void =>
      setScrolled((was) =>
        was ? window.scrollY > release : window.scrollY > threshold,
      );
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  return (
    <header className="nav" data-scrolled={scrolled}>
      <nav className="nav__bar" aria-label={label}>
        {children}
      </nav>
    </header>
  );
}
