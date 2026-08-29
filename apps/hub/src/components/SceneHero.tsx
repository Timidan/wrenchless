import type { JSX } from "react";
import { useRef } from "react";
import { gsap, useGSAP } from "../lib/gsap";
import { motionProfile } from "../lib/motion";
import { ArrowRoll } from "./ArrowRoll";
import { PoweredBy } from "./PoweredBy";

/** How far outside the button's own box the pull still reaches. */
const MAGNET_RANGE = 28;
/** Fraction of the cursor's offset the button actually travels. */
const MAGNET_PULL = 0.34;

/**
 * The counter, at night.
 *
 * The photograph fills the viewport and the copy is anchored to the lower left
 * rather than the middle, so the picture keeps its own centre. The section is
 * sticky: the white bed rides over it instead of pushing it away.
 *
 * Two pieces of motion, both kept from the previous build. The headline
 * arrives a line at a time, once, on load. The primary call to action is the
 * one magnetic thing on the page.
 */
export function SceneHero(): JSX.Element {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const section = root.current;
      const { reduced } = motionProfile();
      if (reduced || !section) return;

      // Two headline lines, then the sub, the actions and the plumbing line.
      // Everything is over inside 1.5s and none of it repeats.
      gsap.fromTo(
        ".hero__line-in",
        { yPercent: 110, opacity: 0 },
        {
          yPercent: 0,
          opacity: 1,
          duration: 0.7,
          ease: "settle",
          stagger: 0.08,
        },
      );
      gsap.fromTo(
        ".hero__step",
        { y: 24, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.45,
          ease: "settle",
          stagger: 0.1,
          delay: 0.5,
        },
      );

      // A lightly dithered STRK20 coral reveal follows the cursor across the
      // complete headline. Each line owns its duplicate paint layer, but both
      // layers read the same pointer position, so the radius crosses the line
      // break as one continuous field.
      const finePointer = window.matchMedia(
        "(hover: hover) and (pointer: fine)",
      ).matches;
      const heroTitle = section.querySelector<HTMLElement>(".hero__title");
      const heroLines = [
        ...section.querySelectorAll<HTMLElement>(".hero__line-in--strk20"),
      ];
      let removeHeroReveal = (): void => undefined;

      if (finePointer && heroTitle && heroLines.length > 0) {
        let currentX = 0;
        let currentY = 0;
        let targetX = 0;
        let targetY = 0;
        let tracking = false;

        const locate = (event: PointerEvent): void => {
          targetX = event.clientX;
          targetY = event.clientY;
        };
        const paint = (): void => {
          currentX += (targetX - currentX) * 0.28;
          currentY += (targetY - currentY) * 0.28;
          for (const line of heroLines) {
            const box = line.getBoundingClientRect();
            line.style.setProperty("--spotlight-x", `${currentX - box.left}px`);
            line.style.setProperty("--spotlight-y", `${currentY - box.top}px`);
          }
        };
        const enter = (event: PointerEvent): void => {
          locate(event);
          currentX = targetX;
          currentY = targetY;
          paint();
          for (const line of heroLines) line.dataset.revealActive = "true";
          if (!tracking) {
            tracking = true;
            gsap.ticker.add(paint);
          }
        };
        const leave = (): void => {
          for (const line of heroLines) delete line.dataset.revealActive;
          if (tracking) {
            tracking = false;
            gsap.ticker.remove(paint);
          }
        };

        heroTitle.addEventListener("pointerenter", enter);
        heroTitle.addEventListener("pointermove", locate, { passive: true });
        heroTitle.addEventListener("pointerleave", leave);
        removeHeroReveal = () => {
          leave();
          heroTitle.removeEventListener("pointerenter", enter);
          heroTitle.removeEventListener("pointermove", locate);
          heroTitle.removeEventListener("pointerleave", leave);
        };
      }

      // The magnet. Fine pointers only, and only this one button: a page where
      // everything reaches for the cursor is a page that cannot be aimed at.
      const button = section.querySelector<HTMLElement>(".hero__magnet");
      if (!button || !finePointer) return removeHeroReveal;

      // Both clocks are the page's own. The pull tracks the cursor and the
      // release undoes it in a little over half the time, which is the same
      // ratio every other exit on the page uses: arriving is the event, and
      // leaving is not. Nothing here overshoots; a button that bounces past
      // its own resting position is the one thing the reader cannot aim at.
      const xTo = gsap.quickTo(button, "x", { duration: 0.3, ease: "power2.out" });
      const yTo = gsap.quickTo(button, "y", { duration: 0.3, ease: "power2.out" });
      let held = false;

      const release = (): void => {
        held = false;
        gsap.to(button, { x: 0, y: 0, duration: 0.2, ease: "power2.out" });
      };

      const onMove = (event: PointerEvent): void => {
        const box = button.getBoundingClientRect();
        const dx = event.clientX - (box.left + box.width / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        // Distance measured from the button's edge, not its centre, so the
        // catchment is an even band around a rectangle of any width.
        const outX = Math.max(0, Math.abs(dx) - box.width / 2);
        const outY = Math.max(0, Math.abs(dy) - box.height / 2);

        if (Math.hypot(outX, outY) > MAGNET_RANGE) {
          if (held) release();
          return;
        }
        held = true;
        xTo(dx * MAGNET_PULL);
        yTo(dy * MAGNET_PULL);
      };

      // A pointer that leaves through the edge of the window sends no further
      // move events, so without this the button keeps whatever offset it had
      // when the cursor crossed the edge, and the next reader finds it sitting
      // a few pixels off its own layout.
      const onLeave = (): void => {
        if (held) release();
      };

      window.addEventListener("pointermove", onMove, { passive: true });
      document.addEventListener("pointerleave", onLeave);
      window.addEventListener("blur", onLeave);
      return () => {
        removeHeroReveal();
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerleave", onLeave);
        window.removeEventListener("blur", onLeave);
        gsap.set(button, { x: 0, y: 0 });
      };
    },
    { scope: root },
  );

  return (
    <section className="hero on-dark" id="top" aria-label="Wrenchless" ref={root}>
      <div className="hero__media">
        <img
          className="hero__image"
          src="/images/hero-wallet.webp"
          width={1600}
          height={900}
          alt="A worn wallet left on a sealed envelope under one warm light."
          fetchPriority="high"
          decoding="async"
        />
      </div>
      <span className="hero__scrim" aria-hidden="true" />

      <div className="hero__inner grid">
        <div className="bay hero__bay">
          <h1 className="hero__title">
            <span className="hero__line">
              <span
                className="hero__line-in hero__line-in--strk20"
                data-text="Keep most of your balance locked while you travel."
              >
                Keep most of your balance locked while you travel.
              </span>
            </span>
            <span className="hero__line">
              <span
                className="hero__line-in hero__line-in--strk20"
                data-text="Release a set amount each day."
              >
                Release a set amount each day.
              </span>
            </span>
          </h1>
          <p className="hero__lede hero__step">
            Choose private STRK or USDC from your wallet. Set the daily amount
            and the date when the remaining balance can return.
          </p>
          <div className="hero__actions hero__step">
            <a className="btn btn--primary hero__magnet" href="/safe">
              <span>Set up your allowance</span>
              <ArrowRoll />
            </a>
            <a className="btn btn--secondary" href="#story">
              <span>How it works</span>
              <ArrowRoll />
            </a>
          </div>
          <span className="hero__powered hero__step">
            <PoweredBy ground="dark" />
          </span>
        </div>
      </div>
    </section>
  );
}
