// @vitest-environment node
//
// A filesystem scan needs no DOM, and under jsdom `import.meta` carries no
// usable directory to resolve the source tree from.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Words that must never reach the cover application's bundle.
 *
 * The cover surface may not disclose that a covert path exists, and a string
 * that ships but never renders is still readable by anyone holding the device
 * with developer tools open. This package is imported by the cover, so the
 * ban applies here too — including in comments.
 *
 * This test is the reason it is safe to say the guarantee is enforced rather
 * than merely intended.
 */
const FORBIDDEN = [
  "distress",
  "duress",
  "guardian",
  "panic",
  "emergency",
  "heartbeat",
  "vault",
  "mailbox",
  "envelope",
] as const;

const SRC = import.meta.dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : [];
  });
}

describe("cover-safe vocabulary", () => {
  const files = sourceFiles(SRC).filter(
    (path) => !path.endsWith("vocabulary.test.ts"),
  );

  it("finds source files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN)("ships no occurrence of %s", (word) => {
    const offenders = files.filter((path) =>
      readFileSync(path, "utf8").toLowerCase().includes(word),
    );
    expect(offenders).toEqual([]);
  });
});
