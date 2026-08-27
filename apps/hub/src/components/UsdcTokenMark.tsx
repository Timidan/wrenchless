import type { JSX } from "react";

/**
 * A compact USDC mark, for the one screen that needs to tell it apart from
 * STRK at a glance: the asset picker in the Trip Allowance setup.
 *
 * Circle's own mark has no local asset file the way Starknet's does, so this
 * draws the two things that make USDC recognisable — the brand blue disc and
 * the cent-sign glyph — as plain paths rather than fetching one from a CDN.
 * Like `ReadyWalletMark`, it keeps its own colour: a third party's identity is
 * not ours to desaturate into the product's ink.
 *
 * Always decorative. The accessible name of an amount is the word USDC beside
 * it, which stays in the text; the mark only makes the asset recognisable.
 */
export function UsdcTokenMark({
  className,
}: {
  className?: string | undefined;
}): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className={className === undefined ? "usdc-mark" : className}
      focusable="false"
      viewBox="0 0 32 32"
    >
      <circle cx="16" cy="16" fill="#2775CA" r="16" />
      <path
        d="M13.6 22.6c0 .5-.4.9-.9.8-3.9-1-6.8-4.5-6.8-8.7s2.9-7.7 6.8-8.7c.5-.1.9.3.9.8v1.1c0 .4-.3.7-.6.8-2.8.9-4.8 3.5-4.8 6.6s2 5.7 4.8 6.6c.3.1.6.4.6.8v.9Zm3.7-16.6c0-.5.4-.9.9-.8 3.9 1 6.8 4.5 6.8 8.7s-2.9 7.7-6.8 8.7c-.5.1-.9-.3-.9-.8v-1.1c0-.4.3-.7.6-.8 2.8-.9 4.8-3.5 4.8-6.6s-2-5.7-4.8-6.6c-.3-.1-.6-.4-.6-.8v-.9Z"
        fill="#fff"
      />
      <path
        d="M16.9 21.4c0 .3-.2.5-.5.5h-.9c-.3 0-.5-.2-.5-.5v-1c-1.6-.2-2.7-.9-3.1-2.2-.1-.3.1-.6.4-.7l.9-.3c.3-.1.6.1.7.4.3.7 1 1.1 2 1.1 1 0 1.8-.4 1.8-1.2 0-.7-.5-1-2-1.4-2-.5-3.4-1.1-3.4-3 0-1.5 1.1-2.5 2.7-2.8v-1c0-.3.2-.5.5-.5h.9c.3 0 .5.2.5.5v1c1.4.2 2.3.9 2.7 1.9.1.3-.1.6-.4.7l-.8.3c-.3.1-.6-.1-.7-.3-.3-.6-.9-.9-1.6-.9-.9 0-1.5.4-1.5 1.1 0 .6.5.9 1.9 1.3 2.1.6 3.5 1.2 3.5 3.1 0 1.6-1.2 2.6-3.1 2.9v1Z"
        fill="#fff"
      />
    </svg>
  );
}
