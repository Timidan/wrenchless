import type { ComponentType, JSX } from "react";
import { useRef } from "react";
import { gsap, useGSAP } from "../lib/gsap";
import { motionProfile } from "../lib/motion";
import { ReadyWalletMark } from "./ReadyWalletMark";
import { StrkTokenMark } from "./StrkTokenMark";
import {
  FingerprintIcon,
  KeyIcon,
  LockSimpleIcon,
  WarningCircleIcon,
} from "./icons";

interface Station {
  name: string;
  line: string;
  note: string;
  icon: "ready" | "lock" | "passkey" | "phrase" | "public";
}

/**
 * The five actions in one Travel Safe. These are product mechanics, not sample
 * transactions or claims about activity that has not happened in this browser.
 */
const STATIONS: readonly Station[] = [
  {
    name: "Ready Wallet keeps your keys",
    line: "You approve each private wallet action in Ready Wallet. Wrenchless never receives your account keys.",
    note: "Same wallet",
    icon: "ready",
  },
  {
    name: "The schedule limits access",
    line: "Only the available amount can return. Skipped daily amounts carry over.",
    note: "Scheduled access",
    icon: "lock",
  },
  {
    name: "Your passkey protects changes",
    line: "Use it to release funds or extend the return date.",
    note: "Passkey protected",
    icon: "passkey",
  },
  {
    name: "Recovery words return everything early",
    line: "Save the 12 words during setup. On another compatible device, use them to return the remaining balance to a Ready account.",
    note: "Emergency return",
    icon: "phrase",
  },
  {
    name: "Know what Starknet shows",
    line: "Your wallet balance and private note ownership stay hidden. Starknet still shows the token, locked amount, schedule, and transaction times.",
    note: "Public details",
    icon: "public",
  },
];

const PHOSPHOR_STATION_ICONS = {
  lock: LockSimpleIcon,
  passkey: FingerprintIcon,
  phrase: KeyIcon,
  public: WarningCircleIcon,
} satisfies Record<
  Exclude<Station["icon"], "ready">,
  ComponentType<{ "aria-hidden": true }>
>;

function StationIcon({ icon }: { icon: Station["icon"] }): JSX.Element {
  if (icon === "ready") {
    return <ReadyWalletMark className="station__brand-mark" />;
  }
  const Icon = PHOSPHOR_STATION_ICONS[icon];
  return <Icon aria-hidden={true} />;
}

function MechanicLabel({ children }: { children: string }): JSX.Element {
  return (
    <div className="station__proof">
      <span className="tag">{children}</span>
    </div>
  );
}

/** The pinned run is worth about two and a half screens of scroll. */
const RUN_SCREENS = 2.5;

/**
 * How far a station may still hang off the right edge and count as arrived.
 *
 * A station lights when it is on screen rather than at a position computed
 * from its index, so the rule stays true at any window width and for any
 * number of stations: the geometry is measured, never predicted.
 */
const ARRIVED_SLACK = 32;

/**
 * The ledger, walked rather than listed.
 *
 * On a wide screen with motion allowed the whole section becomes one held
 * frame: the heading, the five entries and the progress line are a single
 * group centred in the viewport, and the group's track moves sideways under
 * the heading as the reader scrolls. Each station lights as it arrives.
 *
 * The run is the section rather than a wide-screen extra, so it happens at
 * every width; only the figures change, and a phone frame carries one station
 * where a desktop carries about three. Under reduced motion none of it runs
 * and the ledger is a plain vertical list. Nothing inside a station is
 * focusable, so the sideways run can never carry a focused control off the
 * screen, and the tab order is the same on every path.
 */
export function Evidence(): JSX.Element {
  const root = useRef<HTMLElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLOListElement>(null);
  const fill = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const { reduced } = motionProfile();
      const stage = scene.current;
      const rail = track.current;
      const bar = fill.current;
      if (reduced || !stage || !rail || !bar) return;

      const media = gsap.matchMedia();

      media.add("all", () => {
        const stops = [...rail.querySelectorAll<HTMLElement>(".station")];
        const travel = (): number =>
          Math.max(0, rail.scrollWidth - stage.clientWidth);

        /**
         * A station has arrived once its whole box is inside the frame.
         *
         * Read as two passes, every rectangle before any attribute, so a
         * frame never interleaves a measurement with a write and forces the
         * browser to lay the row out again in the middle of the run.
         */
        const lightArrived = (): void => {
          const edge = stage.clientWidth + ARRIVED_SLACK;
          const arrived = stops.map(
            (stop) => stop.getBoundingClientRect().right <= edge,
          );
          stops.forEach((stop, index) => {
            stop.dataset["reached"] = arrived[index] ? "true" : "false";
          });
        };

        const timeline = gsap.timeline({
          scrollTrigger: {
            trigger: stage,
            start: "top top",
            end: () => `+=${Math.round(window.innerHeight * RUN_SCREENS)}`,
            pin: true,
            scrub: true,
            anticipatePin: 1,
            invalidateOnRefresh: true,
            onUpdate: lightArrived,
            onRefresh: lightArrived,
          },
        });

        timeline.fromTo(
          rail,
          { x: 0 },
          { x: () => -travel(), ease: "none", duration: 1 },
          0,
        );
        timeline.fromTo(
          bar,
          { scaleX: 0 },
          { scaleX: 1, ease: "none", duration: 1 },
          0,
        );

        lightArrived();

        return () => {
          for (const stop of stops) delete stop.dataset["reached"];
        };
      });

      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <section className="section section--evidence" id="evidence" ref={root}>
      <div className="evidence__scene" ref={scene}>
        <div className="evidence__stage">
          <div className="grid">
            <div className="bay bay--left evidence__head">
              <span className="evidence__token" aria-hidden="true">
                <StrkTokenMark className="evidence__token-mark" />
              </span>
              <h2>Wrenchless works with Ready Wallet.</h2>
              <p className="evidence__intro">
                Ready Wallet signs each action. Wrenchless controls when the
                locked balance can return. You do not create another wallet or
                account.
              </p>
            </div>
          </div>

          <ol className="evidence__track" ref={track}>
            {STATIONS.map((station) => (
              <li className="station" key={station.name}>
                <span className="station__icon" aria-hidden="true">
                  <StationIcon icon={station.icon} />
                </span>
                <h3 className="station__name">{station.name}</h3>
                <p className="station__line">{station.line}</p>
                <MechanicLabel>{station.note}</MechanicLabel>
              </li>
            ))}
          </ol>

          <span className="evidence__rail" aria-hidden="true">
            <span className="evidence__fill" ref={fill} />
          </span>
        </div>
      </div>
    </section>
  );
}
