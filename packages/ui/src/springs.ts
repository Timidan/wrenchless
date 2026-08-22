/**
 * The whole motion vocabulary.
 *
 * Seven springs, frozen. Do not add an eighth: a menu, a dialog and a tab bar
 * built months apart feel like siblings because they inherit from this table.
 *
 * There is a second reason here that does not apply to an ordinary product.
 * The unlock and payment flows must move identically no matter which valid PIN
 * opened the session. One shared table with no per-state variants means there
 * is no motion parameter that could differ between them — the guarantee comes
 * from the absence of a choice, not from remembering to make the same one.
 */

export type Spring = {
  readonly type: "spring";
  readonly stiffness: number;
  readonly damping: number;
};

export type SpringName =
  | "PANEL"
  | "LAYOUT"
  | "POP"
  | "POP_EXIT"
  | "BANNER"
  | "FLICK"
  | "CHART";

export const SPRINGS: Readonly<Record<SpringName, Spring>> = Object.freeze({
  /** Dropdowns, menus, toggles — anything that opens in place. */
  PANEL: Object.freeze({ type: "spring", stiffness: 550, damping: 38 }),
  /** Measured height and width, sliding pills, marker moves. */
  LAYOUT: Object.freeze({ type: "spring", stiffness: 550, damping: 40 }),
  /** Dialog entrance. */
  POP: Object.freeze({ type: "spring", stiffness: 400, damping: 26 }),
  /** Dialog exit — softer, gets out of the way. */
  POP_EXIT: Object.freeze({ type: "spring", stiffness: 380, damping: 28 }),
  /** Floating pills and page-level strips. */
  BANNER: Object.freeze({ type: "spring", stiffness: 400, damping: 30 }),
  /** Icon micro-moves: a chevron turning, a glyph swapping. */
  FLICK: Object.freeze({ type: "spring", stiffness: 900, damping: 50 }),
  /** Tooltips and crosshair followers. */
  CHART: Object.freeze({ type: "spring", stiffness: 300, damping: 28 }),
} as const);

/**
 * Fades that accompany the springs. Nothing in app chrome tweens past 0.2s;
 * if it feels slow, lower the damping rather than lengthening this.
 */
export const MICRO_FADE = Object.freeze({
  in: 0.16,
  out: 0.1,
  ease: "easeOut",
} as const);
