import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root";
import { applyMotionClasses } from "./lib/motion";
import { resolveRoute } from "./routes";
import "./styles/app.css";

/**
 * The capability classes go on <html> before the first paint, not after it.
 *
 * Two sections choose their whole layout from `.motion-on`, and both of them
 * are pinned. A pin measures its element the moment it is created, which is
 * inside a layout effect: if the class only arrives in a passive effect after
 * that, the pin has already recorded the height of the shape the page was
 * never going to use, and it holds that figure for the rest of the session.
 */
applyMotionClasses();

// The four working surfaces are held in a viewport rather than scrolled like a
// document. The class goes on before the first paint so the frame never starts
// in the landing page's shape and flips a frame later.
const firstRoute = resolveRoute(window.location.pathname);
if (firstRoute !== "/" && firstRoute !== null) {
  document.documentElement.classList.add("app-page");
}

const container = document.getElementById("root");
if (!container) throw new Error("Wrenchless hub: #root is missing.");

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
