import type { JSX } from "react";
import { useEffect, useSyncExternalStore } from "react";

import { App } from "./App";
import {
  navigate,
  needsCanonicalSafeRedirect,
  readPathname,
  replaceRoute,
  resolveRoute,
  subscribeToRoute,
} from "./routes";
import { RecoverSurface } from "./surfaces/safe/RecoverSurface";
import { RescueSurfaceV3 } from "./surfaces/safe/RescueSurfaceV3";
import { SafeSurface } from "./surfaces/safe/SafeSurface";

export function Root(): JSX.Element {
  const pathname = useSyncExternalStore(subscribeToRoute, readPathname, () => "/");
  const route = resolveRoute(pathname);
  const isApp = route !== "/" && route !== null;

  useEffect(() => {
    if (needsCanonicalSafeRedirect(pathname)) replaceRoute("/safe");
  }, [pathname]);

  useEffect(() => {
    const classes = document.documentElement.classList;
    classes.toggle("app-page", isApp);
    return () => classes.remove("app-page");
  }, [isApp]);

  if (route === "/") return <App />;
  if (route === "/safe") return <SafeSurface />;
  if (route === "/recover") return <RecoverSurface />;
  if (route === "/rescue") return <RescueSurfaceV3 />;

  return (
    <main className="notfound" id="surface-main">
      <p className="notfound__title">That page does not exist</p>
      <button className="wbtn" onClick={() => navigate("/")} type="button">
        Go to the home page
      </button>
    </main>
  );
}
