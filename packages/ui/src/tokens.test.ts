// @vitest-environment node
//
// A text scan over the stylesheet needs no DOM, and under jsdom
// `import.meta.url` is not a file: URL, so resolving a path from it throws.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "tokens.css"), "utf8");

/** Strip comments so documented counter-examples cannot fail the scan. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("tokens", () => {
  it("defines the single ink the neutral system derives from", () => {
    expect(code).toMatch(/--ink:\s*#292929;/);
  });

  it("derives every neutral from ink at a stated percentage", () => {
    for (const [name, percent] of [
      ["border", "12%"],
      ["input", "14%"],
      ["accent", "5%"],
      ["muted", "5%"],
    ] as const) {
      expect(code).toContain(
        `--${name}: color-mix(in srgb, var(--ink) ${percent}, transparent)`,
      );
    }
  });

  it("introduces no second grey", () => {
    // Every six-digit hex whose channels are equal is a grey. Only the ink,
    // the stage, the card, and the muted foreground may be literal.
    const allowed = new Set(["#292929", "#f6f6f6", "#ffffff", "#6d6d6d"]);
    const matches: string[] = code.match(/#[0-9a-f]{6}/gi) ?? [];
    const greys = matches
      .map((hex) => hex.toLowerCase())
      .filter((hex) => {
        const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)];
        return r === g && g === b;
      });
    expect(greys.filter((hex) => !allowed.has(hex))).toEqual([]);
  });

  it("sets the Wrenchless type stacks, not oa-design's defaults", () => {
    expect(code).toContain("Hanken Grotesk");
    expect(code).toContain("Fragment Mono");
    expect(code).not.toContain("Inter Tight");
    expect(code).not.toContain("Geist Mono");
  });

  it("caps weight at 500", () => {
    const lines: string[] = code.match(/--weight-[a-z]+:\s*(\d{3})/g) ?? [];
    const weights = lines.map((line) => Number(line.split(":")[1]?.trim()));
    expect(weights.length).toBeGreaterThan(0);
    expect(Math.max(...weights)).toBeLessThanOrEqual(500);
  });
});
