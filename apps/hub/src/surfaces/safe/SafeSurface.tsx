import type { JSX } from "react";

import { WRENCHLESS_MAINNET } from "../../lib/product-config";
import { readActiveTravelSafeTicketVersion } from "../../lib/refill-ticket";
import { SafeSurfaceV2 } from "./components/SafeSurfaceV2";
import { SafeSurfaceV3 } from "./components/SafeSurfaceV3";

type SafeSurfaceVersion = "v2" | "v3";

export function selectSafeSurfaceVersion(
  storedVersion: SafeSurfaceVersion | null,
  tripAllowanceAvailable: boolean,
): SafeSurfaceVersion {
  if (storedVersion !== null) return storedVersion;
  return tripAllowanceAvailable ? "v3" : "v2";
}

/**
 * Which Safe this browser actually holds, decided once and out of band.
 *
 * A v2 ticket carries a live recovery phrase against the deployed v2 helper
 * and keeps its own surface and `useTravelSafeV2` for as long as it exists.
 * A browser with no ticket uses v3 only when its helper is configured. Until
 * then it keeps the deployed v2 creation path available instead of rendering
 * a dead-end launch screen. The read is synchronous and taken once per render,
 * so the two surfaces are never both mounted and neither hook is ever called
 * conditionally: this component itself holds no hooks, only a choice of which
 * one gets to.
 */
export function SafeSurface(): JSX.Element {
  const version = selectSafeSurfaceVersion(
    readActiveTravelSafeTicketVersion(),
    WRENCHLESS_MAINNET.tripAllowanceHelperAddress !== null,
  );
  return version === "v2" ? <SafeSurfaceV2 /> : <SafeSurfaceV3 />;
}
