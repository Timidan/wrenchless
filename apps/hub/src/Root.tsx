import type { JSX } from "react";
import { useEffect, useSyncExternalStore } from "react";

import { App } from "./App";
import { OnboardingSurface } from "./surfaces/onboarding/OnboardingSurface";
import { ReserveSurface } from "./surfaces/reserve/ReserveSurface";
import { SignalsSurface } from "./surfaces/signals/SignalsSurface";
import { WalletSurface } from "./surfaces/wallet/WalletSurface";
import { navigate, readPathname, resolveRoute, subscribeToRoute } from "./routes";

/**
 * One decision: which of the five addresses this is.
 *
 * The landing page keeps its pinned scenes and its smooth scroll. The four
 * product surfaces are still: none of them should animate while someone is
 * deciding whether to send money.
 *
 * Each of the four draws its own chrome and is returned whole rather than
 * wrapped. A shared frame here would have to know about all three roles, and
 * would end up putting a link from one device to another — which is the one
 * thing this product must never do.
 */
export function Root(): JSX.Element {
  const pathname = useSyncExternalStore(subscribeToRoute, readPathname, () => "/");
  const route = resolveRoute(pathname);
  const isApp = route !== "/" && route !== null;

  // Set before paint in `main.tsx` for the first load; kept in step here for
  // client navigation, so the chrome never starts in the wrong shape.
  useEffect(() => {
    const classes = document.documentElement.classList;
    classes.toggle("app-page", isApp);
    return () => {
      classes.remove("app-page");
    };
  }, [isApp]);

  if (route === "/") return <App />;
  if (route === "/wallet") return <WalletSurface />;
  if (route === "/start") return <OnboardingSurface />;
  if (route === "/reserve") return <ReserveSurface />;
  if (route === "/signals") return <SignalsSurface />;

  return (
    <main className="notfound" id="surface-main">
      <p className="notfound__title">That page does not exist</p>
      <button className="wbtn" onClick={() => navigate("/")} type="button">
        Go to the home page
      </button>
    </main>
  );
}
