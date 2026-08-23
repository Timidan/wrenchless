/**
 * Capability gates.
 *
 * All of them are decided once, at init, and cached: a page that is half
 * pinned and half not is worse than either. A change of the reduced-motion
 * preference reloads rather than re-wires.
 */

/** At or below either of these, the page stops asking for backdrop filters. */
const LOW_CORES = 4;
const LOW_MEMORY_GB = 4;

/** `deviceMemory` is an extension some browsers simply do not ship. */
interface CapabilityNavigator extends Navigator {
  deviceMemory?: number;
}

export interface MotionProfile {
  /** The reader asked for less motion. Nothing animates, nothing is pinned. */
  reduced: boolean;
  /**
   * Few cores or little memory. The page still pins and still scrubs: those
   * are the argument, and a machine that cannot run them has nothing to read
   * instead. What it drops is the one backdrop-filter on the page, the glass
   * behind the scrolled nav, which is per-frame GPU work that buys nothing but
   * a look and is the first thing to cost a phone its frame rate.
   */
  lowPower: boolean;
}

/**
 * Reads one optional capability hint as a number. A browser that does not
 * report the hint is treated as capable, because guessing "slow" from silence
 * would quietly downgrade most of the web.
 */
const reported = (hint: number | undefined): number =>
  Number.isFinite(hint) && hint !== undefined ? hint : Number.POSITIVE_INFINITY;

const readProfile = (): MotionProfile => {
  // SAFETY: `deviceMemory` is an optional extension to Navigator. The wider
  // interface declares it as possibly absent, and `reported` turns whatever is
  // actually there into a number before it is compared.
  const nav: CapabilityNavigator = navigator;

  return {
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    lowPower:
      reported(nav.hardwareConcurrency) <= LOW_CORES ||
      reported(nav.deviceMemory) <= LOW_MEMORY_GB,
  };
};

let cached: MotionProfile | null = null;

/** The profile for this page load. Read as often as you like; measured once. */
export const motionProfile = (): MotionProfile => (cached ??= readProfile());

/**
 * Writes the profile onto <html> so CSS can answer the same questions the
 * scripts do, and returns a teardown.
 */
export function applyMotionClasses(): () => void {
  const root = document.documentElement;
  const { reduced, lowPower } = motionProfile();

  root.classList.toggle("reduced-motion", reduced);
  root.classList.toggle("low-power", lowPower);
  root.classList.toggle("motion-on", !reduced);

  return () => {
    root.classList.remove("reduced-motion", "low-power", "motion-on");
  };
}

/** Reload once the reduced-motion preference flips: the choice is init-time. */
export function watchReducedMotion(): () => void {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const onChange = (): void => window.location.reload();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
