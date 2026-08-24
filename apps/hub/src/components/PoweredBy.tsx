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
 * The Starknet half uses the official mark beside a text label. Keeping the
 * mark local means this credit never depends on a font or image request to a
 * third-party host.
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
      <span className="powered__network">
        <img
          className="powered__mark"
          src="/logos/starknet-mark-light.svg"
          alt=""
          width={16}
          height={16}
          loading="lazy"
          decoding="async"
        />
        <span>Starknet</span>
      </span>
    </span>
  );
}
