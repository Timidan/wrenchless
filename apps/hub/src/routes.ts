/**
 * The whole router, in one file and with no dependency.
 *
 * There are only five addresses, and four of them are documents rather than an
 * application with nested navigation, so the History API is enough: a path in,
 * a path out, one `popstate` listener.
 *
 * The wallet is deliberately one address. Its own sections — send, top up,
 * activity, settings — are state inside that screen, not routes, because a
 * spending wallet should not put where you are into the URL bar.
 *
 * `/privacy.html` is absent on purpose: it is a separate HTML entry with its
 * own root, so the server resolves it before this file is ever parsed.
 */

export const ROUTES = ["/", "/start", "/wallet", "/reserve", "/signals"] as const;

export type Route = (typeof ROUTES)[number];

/** Earlier addresses, kept working rather than dropped on the floor. */
const ALIASES = new Map<string, Route>([
  ["/cover", "/wallet"],
  ["/vault", "/reserve"],
  ["/guardian", "/signals"],
  ["/setup", "/start"],
]);

function isRoute(value: string): value is Route {
  return ROUTES.some((route) => route === value);
}

/**
 * A pathname becomes a route only if it matches exactly, after one trailing
 * slash is removed. Unknown paths return null so the shell can say so rather
 * than silently rendering the landing page under the wrong address.
 */
export function resolveRoute(pathname: string): Route | null {
  const trimmed =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  const normalized = trimmed.toLowerCase();
  if (isRoute(normalized)) return normalized;
  return ALIASES.get(normalized) ?? null;
}

export function navigate(route: Route): void {
  if (window.location.pathname === route) return;
  window.history.pushState(null, "", route);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "auto" });
}

export function subscribeToRoute(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

export function readPathname(): string {
  return window.location.pathname;
}
