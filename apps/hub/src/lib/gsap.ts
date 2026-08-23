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

CustomEase.create("settle", "M0,0 C0.22,1 0.36,1 1,1");

export { gsap, ScrollTrigger, useGSAP };
