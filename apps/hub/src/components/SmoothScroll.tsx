import type { JSX, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { ReactLenis } from "lenis/react";
import type { LenisRef } from "lenis/react";
import type { LenisOptions } from "lenis";
import { gsap, ScrollTrigger } from "../lib/gsap";

/**
 * Lenis drives the scroll position, GSAP's ticker drives Lenis, and every
 * Lenis frame tells ScrollTrigger to re-read. One clock, so a scrubbed
 * animation can never be a frame behind the page it is scrubbing.
 *
 * Never rendered under `prefers-reduced-motion: reduce`: the reader gets the
 * browser's own scrolling, untouched.
 */
const OPTIONS: LenisOptions = {
  lerp: 0.1,
  duration: 1.2,
  smoothWheel: true,
  // GSAP owns the frame loop; Lenis must not run a second one.
  autoRaf: false,
  // In-page links are the nav's only job, so Lenis has to honour them.
  anchors: true,
};

export function SmoothScroll({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const lenisRef = useRef<LenisRef>(null);

  useEffect(() => {
    // ReactLenis creates its instance on its own schedule, which can land
    // after this effect runs. Resolving the instance inside the tick (the
    // pattern Lenis's own GSAP docs use) makes the wiring independent of
    // that timing; a one-time flag attaches the ScrollTrigger listener as
    // soon as the instance exists.
    const onScroll = (): void => {
      ScrollTrigger.update();
    };
    let subscribed: typeof lenisRef.current extends null
      ? never
      : ReturnType<() => LenisRef["lenis"]> = undefined;
    const onTick = (time: number): void => {
      const lenis = lenisRef.current?.lenis;
      if (!lenis) return;
      if (subscribed !== lenis) {
        subscribed?.off("scroll", onScroll);
        lenis.on("scroll", onScroll);
        subscribed = lenis;
      }
      lenis.raf(time * 1000);
    };

    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);

    // Everything above the two pins is now type on a ground rather than a
    // picture in a reserved box, so the height of the run-up is settled by the
    // webfont and by nothing else. The swap can land after ScrollTrigger has
    // already measured, which would leave both pins starting a few pixels off
    // where their section actually begins.
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) ScrollTrigger.refresh();
    });

    return () => {
      live = false;
      subscribed?.off("scroll", onScroll);
      gsap.ticker.remove(onTick);
      gsap.ticker.lagSmoothing(500, 33);
    };
  }, []);

  return (
    <ReactLenis root options={OPTIONS} ref={lenisRef}>
      {children}
    </ReactLenis>
  );
}
