import type { JSX } from "react";

import { ArrowRightIcon } from "./icons";

/**
 * The button hover.
 *
 * A 24px window holding two identical arrows stacked. Hover rolls the track up
 * by exactly one window, so the first arrow leaves through the top edge while
 * its duplicate arrives from below. It replaces a brightness shift: the button
 * says something happened instead of merely looking brighter.
 *
 * The glyph is Phosphor's, like every other interface mark in the product. The
 * roll is the part that belongs to this file; a hand-drawn arrow inside it was
 * one more drawing to keep in step with the set, for no gain.
 */
export function ArrowRoll(): JSX.Element {
  return (
    <span className="btn__roll" aria-hidden="true">
      <span className="btn__roll-track">
        <ArrowRightIcon aria-hidden="true" />
        <ArrowRightIcon aria-hidden="true" />
      </span>
    </span>
  );
}
