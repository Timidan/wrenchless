import type { JSX } from "react";

/**
 * Starknet's own token mark, in one place.
 *
 * It appears beside every STRK figure the product shows, so it is a component
 * rather than repeated markup: the asset is somebody else's and must not be
 * recoloured, cropped or redrawn, and one file is the only way to keep that
 * true across five surfaces.
 *
 * It is always decorative. The accessible name of an amount is the word STRK
 * beside it, which stays in the text; the mark only makes the asset
 * recognisable at a glance.
 */
export function StrkTokenMark({
  className,
}: {
  className?: string | undefined;
}): JSX.Element {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={className === undefined ? "strk-mark" : className}
      decoding="async"
      draggable={false}
      height={24}
      src="/logos/starknet-mark-light.svg"
      width={24}
    />
  );
}
