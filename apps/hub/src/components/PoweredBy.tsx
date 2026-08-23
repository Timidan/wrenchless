import type { JSX } from "react";

/**
 * Which ground the pill is sitting on, which is also the only thing that
 * changes: the hairline, the type colour and which of Starknet's two official
 * lockups is loaded.
 */
type Ground = "dark" | "light";

interface PoweredByProps {
  /** The ground under the pill. Defaults to the white bed. */
  ground?: Ground;
}

/**
 * One hairline pill: who runs the private half of this wallet, and where.
 *
 * The STRK[20] half is typographic on purpose. The protocol has no official
 * icon, and inventing one would put a mark on the page that no one else uses.
 * The Starknet half is the official lockup, unaltered, at 16px with the
 * brand's clear space (half the lockup height, so 8px) satisfied by the pill's
 * own padding on three sides and by the gap on the fourth.
 *
 * Nothing here animates and nothing here is a link: it is a credit line, and a
 * credit line that reaches for the cursor reads as an advert.
 */
export function PoweredBy({ ground = "light" }: PoweredByProps): JSX.Element {
  return (
    <span className="powered" data-ground={ground}>
      <span className="powered__label">Powered by</span>
      <span className="powered__strk">
        STRK
        <span className="powered__bracket">[20]</span>
      </span>
      <span className="powered__on">on</span>
      <img
        className="powered__lockup"
        src={`/logos/starknet-wordmark-${ground}.svg`}
        alt="Starknet"
        width={70}
        height={16}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}
