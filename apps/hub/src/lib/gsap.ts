/**
 * The one place GSAP is configured.
 *
 * Plugins are registered at module scope so every import shares a single
 * registration, and nothing else in the app touches `gsap.registerPlugin`.
 *
 * "settle" is the same curve the stylesheets call --ease-settle,
 * cubic-bezier(0.22, 1, 0.36, 1), written once here so a scripted settle and
 * a CSS settle cannot drift apart.
 */
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger, CustomEase);

/**
 * A phone's toolbar is not a resize.
 *
 * Mobile browsers grow and shrink the visual viewport by the height of their
 * own chrome as the reader scrolls, and every one of those reports itself as a
 * window resize. ScrollTrigger's default answer is to refresh, which
 * re-measures every pinned section mid-scroll and jumps the page under the
 * thumb. With this set it ignores a vertical-only resize on a touch device and
 * keeps the measurements it took, which is the right answer while the only
 * thing that changed is how much of the window the browser is covering.
 */
ScrollTrigger.config({ ignoreMobileResize: true });

CustomEase.create("settle", "M0,0 C0.22,1 0.36,1 1,1");

export { gsap, ScrollTrigger, useGSAP };
