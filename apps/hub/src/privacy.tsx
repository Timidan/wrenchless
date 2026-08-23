import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivacyPage } from "./components/PrivacyPage";
import { applyMotionClasses } from "./lib/motion";
import "./styles/app.css";

applyMotionClasses();
// Before the first paint, like the motion classes: the bar and the footer
// pick their shape from this, and a late class would flash the hero layout.
document.documentElement.classList.add("document-page");

const container = document.getElementById("root");
if (!container) throw new Error("Wrenchless hub: #root is missing.");

createRoot(container).render(
  <StrictMode>
    <PrivacyPage />
  </StrictMode>,
);
