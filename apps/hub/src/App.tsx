import type { JSX } from "react";
import { useEffect } from "react";
import { Nav } from "./components/Nav";
import { SceneHero } from "./components/SceneHero";
import { SceneStory } from "./components/SceneStory";
import { Evidence } from "./components/Evidence";
import { Footer } from "./components/Footer";
import { SmoothScroll } from "./components/SmoothScroll";
import { StatsBar } from "./components/StatsBar";
import { applyMotionClasses, motionProfile, watchReducedMotion } from "./lib/motion";

/**
 * Three grounds, in the order the page uses them.
 *
 * The hero is black and holds its position while the white bed rides over it.
 * The bed carries the argument in three moves: the name, the story dive and
 * the ledger. The dive is the one stretch where the bed goes black again, on
 * purpose: it is the only part of the page that is a place rather than a
 * paragraph. The bed then scrolls off the ink footer that has
 * been waiting underneath it the whole time.
 */
export function App(): JSX.Element {
  const { reduced } = motionProfile();

  // The motion decision is taken once at init, so a change of the preference
  // has to reload rather than re-wire a half-built page.
  useEffect(() => watchReducedMotion(), []);
  useEffect(() => applyMotionClasses(), []);

  const page: JSX.Element = (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <Nav />
      <main className="page" id="main">
        <SceneHero />
        <div className="bed">
          <StatsBar />
          <SceneStory />
          <Evidence />
        </div>
      </main>
      <Footer />
    </>
  );

  // Reduced motion gets the browser's own scrolling: no Lenis, no ticker.
  if (reduced) return page;
  return <SmoothScroll>{page}</SmoothScroll>;
}
