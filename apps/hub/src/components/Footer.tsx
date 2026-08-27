import type { JSX } from "react";
import { useCallback } from "react";
import { motionProfile } from "../lib/motion";
import { PoweredBy } from "./PoweredBy";
import { WrenchlessMark } from "./WrenchlessMark";

/**
 * The closing statement, on ink.
 *
 * The footer is a sticky underlay rather than a panel at the end of the flow:
 * it holds the bottom of the viewport for the whole page while the white bed
 * sits on top of it, so the last stretch of scroll uncovers it. No blur stack
 * is involved; the seam is a plain gradient drawn by the bed.
 *
 * The one thing a sticky underlay gets wrong on its own is the keyboard. The
 * footer is already inside the viewport, so the browser sees no reason to
 * scroll when a link in it takes focus, and the reader ends up typing into
 * something the bed is still covering. Focus entering the footer therefore
 * sends the page to its end itself. The jump is immediate on purpose: a
 * keyboard reader who has just pressed Tab wants to see where they landed,
 * not to watch it arrive.
 */
export function Footer(): JSX.Element {
  const { reduced } = motionProfile();

  const revealOnFocus = useCallback((): void => {
    // Under reduced motion the footer is in normal flow, so the browser's own
    // focus scrolling is already correct and must not be second-guessed.
    if (reduced) return;
    window.scrollTo({
      top: document.documentElement.scrollHeight - window.innerHeight,
    });
  }, [reduced]);

  return (
    <footer className="footer on-dark" onFocus={revealOnFocus}>
      <span className="footer__ring" aria-hidden="true" />
      <div className="footer__inner grid">
        <div className="bay footer__bay">
          <h2 className="footer__statement">
            Carry your wallet. Leave most of the balance locked.
          </h2>
          <p className="footer__honest">
            Ready Wallet keeps your keys. Your passkey protects releases and
            date changes. Recovery words return the remaining balance early.
          </p>
          <div className="footer__meta">
            <nav className="footer__links" aria-label="Footer">
              <a href="/#story">How it works</a>
              <a href="/#evidence">What protects it</a>
              <a href="/rescue">Recover locked funds</a>
              <a href="/privacy.html">Privacy</a>
            </nav>
            <span className="footer__credit">
              <span className="footer__wordmark">
                <WrenchlessMark className="footer__mark" />
                <span>wrenchless</span>
              </span>
              <PoweredBy ground="dark" />
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
