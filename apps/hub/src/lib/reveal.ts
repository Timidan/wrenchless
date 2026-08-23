/**
 * The page's one scroll reveal.
 *
 * Every section uses the same gesture: elements marked `data-reveal` fade up
 * a little, once, in document order, staggered inside their own group. No
 * section invents its own timing, and nothing re-runs on the way back up.
 *
 * A group is any element carrying `data-reveal-group`, and it is also the
 * thing the reveal is triggered on. Grouping is not decoration: the protocol
 * section is ten screens tall, and one trigger on the section box would fire
 * the closing line while it is still nine screens below the fold, so by the
 * time the reader reached it the reveal would already be over.
 */
import type { RefObject } from "react";
import { gsap, useGSAP } from "./gsap";
import { motionProfile } from "./motion";

/** Small enough to read as settling rather than as travel. */
const RISE_PX = 18;

export function useSectionReveal(scope: RefObject<HTMLElement | null>): void {
  useGSAP(
    () => {
      const section = scope.current;
      const { reduced } = motionProfile();
      if (reduced || !section) return;

      for (const group of section.querySelectorAll<HTMLElement>(
        "[data-reveal-group]",
      )) {
        const items = group.querySelectorAll<HTMLElement>("[data-reveal]");
        if (items.length === 0) continue;

        gsap.fromTo(
          items,
          { opacity: 0, y: RISE_PX },
          {
            opacity: 1,
            y: 0,
            duration: 0.45,
            ease: "settle",
            stagger: 0.06,
            scrollTrigger: { trigger: group, start: "top 85%" },
          },
        );
      }
    },
    { scope },
  );
}
