import { describe, expect, it } from "vitest";

import { MICRO_FADE, SPRINGS } from "./springs.js";

describe("springs", () => {
  it("has exactly seven, named", () => {
    expect(Object.keys(SPRINGS).sort()).toEqual([
      "BANNER",
      "CHART",
      "FLICK",
      "LAYOUT",
      "PANEL",
      "POP",
      "POP_EXIT",
    ]);
  });

  it("carries the source language's values", () => {
    expect(SPRINGS.PANEL).toEqual({
      type: "spring",
      stiffness: 550,
      damping: 38,
    });
    expect(SPRINGS.LAYOUT).toEqual({
      type: "spring",
      stiffness: 550,
      damping: 40,
    });
    expect(SPRINGS.POP).toEqual({
      type: "spring",
      stiffness: 400,
      damping: 26,
    });
    expect(SPRINGS.POP_EXIT).toEqual({
      type: "spring",
      stiffness: 380,
      damping: 28,
    });
    expect(SPRINGS.BANNER).toEqual({
      type: "spring",
      stiffness: 400,
      damping: 30,
    });
    expect(SPRINGS.FLICK).toEqual({
      type: "spring",
      stiffness: 900,
      damping: 50,
    });
    expect(SPRINGS.CHART).toEqual({
      type: "spring",
      stiffness: 300,
      damping: 28,
    });
  });

  it("cannot grow an eighth at runtime", () => {
    expect(Object.isFrozen(SPRINGS)).toBe(true);
    expect(() => {
      (SPRINGS as unknown as Record<string, unknown>).WOBBLE = {};
    }).toThrow();
  });

  it("keeps micro fades under the 0.2s chrome ceiling", () => {
    expect(MICRO_FADE.in).toBeLessThanOrEqual(0.2);
    expect(MICRO_FADE.out).toBeLessThanOrEqual(0.2);
  });
});
