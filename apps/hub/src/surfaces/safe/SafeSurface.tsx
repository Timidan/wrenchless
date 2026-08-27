import type { JSX } from "react";

import { readActiveTravelSafeTicketVersion } from "../../lib/refill-ticket";
import { SafeSurfaceV2 } from "./components/SafeSurfaceV2";
import { SafeSurfaceV3 } from "./components/SafeSurfaceV3";

/**
 * Which Safe this browser actually holds, decided once and out of band.
 *
 * A v2 ticket carries a live recovery phrase against the deployed v2 helper
 * and keeps its own surface and `useTravelSafeV2` for as long as it exists.
 * Everything else, including a browser with no ticket at all, is a v3 Trip
 * Allowance. The read is synchronous and taken once per render rather than
 * in an effect, so the two surfaces are never both mounted and neither hook
 * is ever called conditionally: this component itself holds no hooks, only a
 * choice of which one gets to.
 */
export function SafeSurface(): JSX.Element {
  const version = readActiveTravelSafeTicketVersion();
  return version === "v2" ? <SafeSurfaceV2 /> : <SafeSurfaceV3 />;
}
