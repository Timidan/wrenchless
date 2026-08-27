import type { JSX, ReactNode } from "react";
import { useRef } from "react";
import { gsap, useGSAP } from "../lib/gsap";
import { motionProfile } from "../lib/motion";

interface Scene {
  id: string;
  src: string;
  alt: string;
  /**
   * Where the next scene is hiding, as a percentage of the frame.
   *
   * The same pair is used twice: once as `object-position`, so the crop keeps
   * that point at that fraction of the box whatever shape the window is, and
   * once as `transform-origin`, so the zoom aims at it. Setting both from one
   * figure is what stops the portal drifting off the dive when the window
   * changes aspect ratio. Every figure was measured off the source frame
   * rather than read off the composition by eye.
   */
  portal: string;
  /**
   * The intrinsic size of the file this scene actually ships, so the browser
   * can reserve the right box before the bytes land. The five plates no longer
   * share one ratio (three were re-rendered at 4:5 and 4:3), so a single pair
   * written once for all of them would reserve the wrong box for four of the
   * five.
   */
  width: number;
  height: number;
  title: string;
  line: ReactNode;
}

const SCENES: readonly Scene[] = [
  {
    id: "street",
    src: "/images/story/s1-street.webp",
    alt: "A hand slipping a phone into a coat pocket on a night street.",
    portal: "36% 38%",
    width: 922,
    height: 1152,
    title: "Choose your plan.",
    line: "Pick the token, amount, daily release, and return date. Or keep everything locked until one date.",
  },
  {
    id: "counter",
    src: "/images/story/s2-counter.webp",
    alt: "A small counter room in lamplight, with a door standing open onto a bright hallway.",
    portal: "74% 48%",
    width: 1536,
    height: 1024,
    title: "Approve it in Ready Wallet.",
    line: "Ready Wallet signs the private transfer. Wrenchless never sees your wallet keys.",
  },
  {
    id: "pool",
    src: "/images/story/s3-pool.webp",
    alt: "Three sealed envelopes falling one behind another into a round pool of light set in the floor.",
    portal: "64% 70%",
    width: 1536,
    height: 1024,
    title: "The schedule controls access.",
    line: "Daily amounts become available on time. Skip a day and it carries over. Later amounts stay locked.",
  },
  {
    id: "vault",
    src: "/images/story/s4-vault.webp",
    alt: "An open drawer of string-tied letter bundles, one bundle lit and the rest in shadow.",
    portal: "58% 58%",
    width: 1280,
    height: 960,
    title: "Release what is available.",
    line: "Use your passkey to move the available amount back to Ready Wallet.",
  },
  {
    id: "hallway",
    src: "/images/story/s5-hallway.webp",
    alt: "A single wax-sealed envelope lying on dark cloth under one narrow shaft of light.",
    portal: "64% 57%",
    width: 922,
    height: 1152,
    title: "Return the remaining balance.",
    line: "Move everything back on your return date. Recovery words can do this earlier from another compatible device.",
  },
];

/** One transition per pair of frames, so four dives for five scenes. */
const DIVES = SCENES.length - 1;

/** Half a screen of stillness on the last frame before the pin lets go. */
const HOLD = 0.5;

/** The pinned run, in viewport heights. One unit of timeline is one screen. */
const RUN_SCREENS = DIVES + HOLD;

/**
 * The dive, as three keyframe positions rather than an ease.
 *
 * A scrubbed tween has no ease of its own, so the acceleration has to come
 * from where the values sit inside the segment: the first half of the segment
 * covers under a third of the travel, and the last fifth covers as much again.
 * That is what makes the approach read as falling into the portal rather than
 * as a poster being pushed at the reader.
 */
const ZOOM: readonly { at: number; to: number; span: number }[] = [
  { at: 0, to: 1.35, span: 0.5 },
  { at: 0.5, to: 1.75, span: 0.3 },
  { at: 0.8, to: 2.2, span: 0.2 },
];

/** Where the outgoing frame starts to go, leaving the last third as overlap. */
const HANDOFF = 0.7;

/** The incoming frame is already a little too close, and settles back. */
const ARRIVE_SCALE = 1.12;

/** Small enough to read as a caption settling rather than as travel. */
const CAPTION_RISE = 16;

/** The storyboard's own rise. A picture is a bigger object than a line of
    type, so it is allowed a little more travel than a caption gets. */
const BOARD_RISE = 24;

/**
 * The words hand over slightly ahead of the picture they belong to, and they
 * do not overlap while they do it.
 *
 * Both captions occupy the same box, so a true crossfade puts two sentences
 * on top of each other and neither one can be read. The outgoing line is
 * therefore gone before the incoming one starts, and the two-layer overlap is
 * left to the pictures, where it is the point.
 *
 * They meet exactly, though. `CAPTION_IN` is `CAPTION_OUT + CAPTION_SPAN` and
 * not a hair more: the two figures used to be 0.02 apart, which is a stretch
 * of scroll with no caption in the box at all, and an empty caption band reads
 * as a dropped frame rather than as a handoff.
 */
const CAPTION_OUT = 0.6;
const CAPTION_SPAN = 0.18;
const CAPTION_IN = CAPTION_OUT + CAPTION_SPAN;

/**
 * One frame of the dive, resolved to the three boxes the timeline moves.
 *
 * It is the picture that fades, not the whole figure. The caption is a child
 * of the figure so the storyboard can keep them together as one `figure`, and
 * if the figure carried the crossfade the caption's own tween would be
 * multiplied by it: a caption meant to be fully arrived would land at a third
 * of its opacity, and its contrast figure with it.
 */
interface Layer {
  media: HTMLElement;
  image: HTMLElement;
  caption: HTMLElement;
}

/**
 * The dive.
 *
 * Five frames, each composed around its own portal: a lit phone screen, a door
 * left open, a pool of light in the floor, an envelope on a desk. On a wide
 * window with motion allowed the section pins for four and a half screens and
 * the reader falls through those portals one at a time. The outgoing frame
 * scales toward its portal and fades over the last third of its segment while
 * the next frame settles in underneath it, so there is always a stretch with
 * two layers moving at once and never a cut.
 *
 * Below 1024px the same five frames are a plain vertical storyboard: picture,
 * caption, picture, caption, each one arriving with the page's own reveal as
 * the reader reaches it. Nothing is pinned and nothing is measured. Under
 * reduced motion that storyboard is simply present, with no reveal at all.
 * The markup is identical on all three paths, so the reading order is too, and
 * nothing inside the section is focusable in the first place.
 */
export function SceneStory(): JSX.Element {
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLOListElement>(null);

  useGSAP(
    () => {
      const { reduced } = motionProfile();
      const frame = stage.current;
      if (reduced || !frame) return;

      const media = gsap.matchMedia();

      media.add("(min-width: 64rem)", () => {
        const layers: Layer[] = [];
        for (const figure of frame.querySelectorAll<HTMLElement>(
          ".story__scene",
        )) {
          const media = figure.querySelector<HTMLElement>(".story__media");
          const image = figure.querySelector<HTMLElement>(".story__image");
          const caption = figure.querySelector<HTMLElement>(".story__caption");
          if (!media || !image || !caption) return;
          layers.push({ media, image, caption });
        }
        if (layers.length !== SCENES.length) return;

        const tally = count.current;

        // The resting state of the dive: the first frame is the page and the
        // rest are behind it at nothing. Written here rather than in the
        // stylesheet, so the storyboard path and a document whose scripts
        // never arrive both keep all five frames visible.
        layers.forEach((layer, index) => {
          const first = index === 0;
          gsap.set(layer.media, { opacity: first ? 1 : 0 });
          gsap.set(layer.image, { scale: first ? 1 : ARRIVE_SCALE });
          gsap.set(layer.caption, {
            opacity: first ? 1 : 0,
            y: first ? 0 : CAPTION_RISE,
          });
        });

        /**
         * Which frame the reader is actually looking at.
         *
         * The number flips in the middle of a crossfade rather than at either
         * end of it, so it changes at the moment the incoming frame takes over
         * the screen. It is written only when it changes: a dataset write on
         * every scrubbed frame is a style recalculation nobody asked for.
         */
        let shown = -1;
        const markScene = (progress: number): void => {
          if (!tally) return;
          const units = progress * RUN_SCREENS;
          const index = Math.min(
            SCENES.length - 1,
            Math.max(0, Math.floor(units + (1 - HANDOFF) / 2)),
          );
          if (index === shown) return;
          shown = index;
          tally.dataset["scene"] = String(index);
        };

        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: frame,
            start: "top top",
            end: () => `+=${Math.round(window.innerHeight * RUN_SCREENS)}`,
            pin: true,
            scrub: true,
            anticipatePin: 1,
            onUpdate: (self) => markScene(self.progress),
            onRefresh: (self) => markScene(self.progress),
          },
        });

        const overlap = 1 - HANDOFF;

        for (let index = 0; index < DIVES; index += 1) {
          const leaving = layers[index];
          const arriving = layers[index + 1];
          if (!leaving || !arriving) break;

          for (const step of ZOOM) {
            timeline.to(
              leaving.image,
              { scale: step.to, ease: "none", duration: step.span },
              index + step.at,
            );
          }

          // The overlap. Both layers move for the whole of it: the one in
          // front is still opening up and fading, the one behind is easing
          // back off its own overshoot.
          //
          // Only one of them fades, and that is the whole trick. The frames
          // are stacked front to back, so the arriving one is ALREADY behind
          // the leaving one: opening it to full opacity at the top of the
          // overlap costs nothing, because nothing of it can be seen until the
          // frame in front dissolves. Fading both at once instead looks
          // correct on paper and is not: two linear alphas crossing at a half
          // leave a quarter of the composite showing the black stage behind
          // them, so every one of the four handoffs dipped through a
          // measurable shadow. Measured on the composited frame, the darkest
          // point of a handoff was 50% of full coverage before this and is
          // 100% after it.
          timeline.set(arriving.media, { opacity: 1 }, index + HANDOFF);
          timeline.to(
            leaving.media,
            { opacity: 0, ease: "none", duration: overlap },
            index + HANDOFF,
          );
          timeline.to(
            arriving.image,
            { scale: 1, ease: "none", duration: overlap },
            index + HANDOFF,
          );

          timeline.to(
            leaving.caption,
            {
              opacity: 0,
              y: -CAPTION_RISE,
              ease: "none",
              duration: CAPTION_SPAN,
            },
            index + CAPTION_OUT,
          );
          timeline.to(
            arriving.caption,
            { opacity: 1, y: 0, ease: "none", duration: CAPTION_SPAN },
            index + CAPTION_IN,
          );
        }

        // The last frame holds still for half a screen before the pin lets go.
        // A timeline is only as long as the tweens in it, so the pause has to
        // be a tween of its own: without it the four dives stretch to fill the
        // whole pinned run, every segment ends up longer than the screen it
        // was measured in, and the scene counter drifts off the pictures it is
        // counting.
        const last = layers[layers.length - 1];
        if (last) {
          timeline.to(
            last.media,
            { opacity: 1, ease: "none", duration: HOLD },
            DIVES,
          );
        }

        return () => {
          if (tally) tally.dataset["scene"] = "0";
        };
      });

      /**
       * The storyboard's own motion.
       *
       * The dive is not available at this width, but "no dive" was reading as
       * "no motion at all": five full-bleed photographs and five captions
       * simply present, while every other section on the page arrives. Each
       * figure now uses the page's one reveal gesture, with the picture a beat
       * ahead of the words it belongs to, and each one is triggered on itself
       * so the reader meets them one at a time rather than all five at once.
       */
      media.add("(max-width: 63.99rem)", () => {
        for (const figure of frame.querySelectorAll<HTMLElement>(
          ".story__scene",
        )) {
          const parts = figure.querySelectorAll<HTMLElement>(
            ".story__media, .story__caption",
          );
          if (parts.length === 0) continue;

          gsap.fromTo(
            parts,
            { opacity: 0, y: BOARD_RISE },
            {
              opacity: 1,
              y: 0,
              duration: 0.5,
              ease: "settle",
              stagger: 0.05,
              scrollTrigger: { trigger: figure, start: "top 88%" },
            },
          );
        }
      });

      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <section className="section section--story" id="story" ref={root}>
      <h2 className="visually-hidden">
        How Wrenchless works, in five steps.
      </h2>

      <div className="story__stage" ref={stage}>
        {SCENES.map((scene, index) => (
          <figure
            className="story__scene"
            data-scene={scene.id}
            key={scene.id}
            style={{ zIndex: SCENES.length - index }}
          >
            <div className="story__media">
              <img
                className="story__image"
                src={scene.src}
                alt={scene.alt}
                width={scene.width}
                height={scene.height}
                style={{
                  objectPosition: scene.portal,
                  transformOrigin: scene.portal,
                }}
                loading={index === 0 ? "eager" : "lazy"}
                fetchPriority={index === 0 ? "high" : "auto"}
                decoding="async"
              />
              <span className="story__scrim" aria-hidden="true" />
            </div>
            <figcaption className="story__caption">
              <h3 className="story__title">{scene.title}</h3>
              <p className="story__line">{scene.line}</p>
            </figcaption>
          </figure>
        ))}

        <ol
          className="story__count"
          data-scene="0"
          aria-hidden="true"
          ref={count}
        >
          {SCENES.map((scene, index) => (
            <li className="story__count-item" key={scene.id}>
              {String(index + 1).padStart(2, "0")}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
