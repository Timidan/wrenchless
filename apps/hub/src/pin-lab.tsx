import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PinLab } from "./pin-lab/PinLab";
import "./styles/tokens.css";
import "./pin-lab/pin-lab.css";

const container = document.getElementById("root");
if (!container) throw new Error("pin lab: #root is missing.");

createRoot(container).render(
  <StrictMode>
    <PinLab />
  </StrictMode>,
);
