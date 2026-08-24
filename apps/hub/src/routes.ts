export const ROUTES = ["/", "/safe", "/recover"] as const;

export type Route = (typeof ROUTES)[number];

const LEGACY_SAFE_PATHS = new Set([
  "/start",
  "/setup",
  "/cover",
  "/vault",
  "/guardian",
  "/wallet",
  "/reserve",
  "/signal",
  "/signals",
]);

function normalize(pathname: string): string {
  const trimmed =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return trimmed.toLowerCase();
}

function isRoute(value: string): value is Route {
  return ROUTES.some((route) => route === value);
}

export function resolveRoute(pathname: string): Route | null {
  const normalized = normalize(pathname);
  if (isRoute(normalized)) return normalized;
  return LEGACY_SAFE_PATHS.has(normalized) ? "/safe" : null;
}

export function needsCanonicalSafeRedirect(pathname: string): boolean {
  return LEGACY_SAFE_PATHS.has(normalize(pathname));
}

export function navigate(route: Route): void {
  if (window.location.pathname === route) return;
  window.history.pushState(null, "", route);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "auto" });
}

export function replaceRoute(route: Route): void {
  window.history.replaceState(null, "", route);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function subscribeToRoute(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

export function readPathname(): string {
  return window.location.pathname;
}
