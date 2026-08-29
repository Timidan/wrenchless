import { formatTokenAmount } from "@wrenchless/canary-core";
import type { JSX } from "react";
import { useEffect, useState } from "react";

import { readParkedStrk } from "../lib/landing-stats";
import { StrkTokenMark } from "./StrkTokenMark";

type StatState =
  | { status: "loading" }
  | { status: "ready"; total: bigint }
  | { status: "error" };

export function StatsBar(): JSX.Element {
  const [state, setState] = useState<StatState>({ status: "loading" });

  useEffect(() => {
    let current = true;
    void readParkedStrk()
      .then((total) => {
        if (current) setState({ status: "ready", total });
      })
      .catch(() => {
        if (current) setState({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, []);

  const total = state.status === "ready" ? formatTokenAmount(state.total, 18) : "—";
  const detail =
    state.status === "loading"
      ? "Reading Starknet"
      : state.status === "error"
        ? "Live total unavailable"
        : "currently parked";

  return (
    <section aria-label="Wrenchless statistics" className="stats-bar">
      <div className="grid">
        <div className="bay stats-bar__inner">
          <div aria-live="polite" className="stats-bar__metric">
            <StrkTokenMark className="stats-bar__mark" />
            <span className="stats-bar__number">{total}</span>
            <span className="stats-bar__unit">STRK</span>
            <span className="stats-bar__detail">{detail}</span>
          </div>
          <span className="stats-bar__source">Starknet mainnet · live contracts</span>
        </div>
      </div>
    </section>
  );
}
