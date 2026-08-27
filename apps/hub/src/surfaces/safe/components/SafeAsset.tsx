import type { JSX } from "react";

import { StrkTokenMark } from "../../../components/StrkTokenMark";
import { UsdcTokenMark } from "../../../components/UsdcTokenMark";

/**
 * The shared `Amount`/`Balance` in `surfaces/shared/product.tsx` only ever
 * draw STRK: a Trip Allowance can be either STRK or USDC, so this is the same
 * two shapes with the mark and the accessible name chosen by which asset is
 * actually being shown. Everything else — the ghost skeleton for a figure
 * that has not been read yet, the ordering, the sizes — matches the shared
 * component exactly, because a Trip Allowance screen and a v2 Safe screen
 * still have to read as one product.
 */

export type SafeAssetSymbol = "STRK" | "USDC";

function AssetMark(props: { symbol: SafeAssetSymbol }): JSX.Element {
  return props.symbol === "USDC" ? (
    <UsdcTokenMark className="amount__mark" />
  ) : (
    <StrkTokenMark className="amount__mark" />
  );
}

export function SafeAmount(props: {
  value: string | null;
  symbol: SafeAssetSymbol;
  sign?: "+" | "−" | undefined;
  size?: "row" | "lead" | "display" | undefined;
}): JSX.Element {
  const size = props.size ?? "row";
  if (props.value === null) {
    return (
      <span aria-label="Amount loading" className="amount" data-size={size}>
        <span aria-hidden="true" className="amount__ghost" />
      </span>
    );
  }
  return (
    <span className="amount" data-size={size}>
      <span className="amount__value">
        {props.sign ?? ""}
        {props.value}
      </span>
      <AssetMark symbol={props.symbol} />
      <span className="amount__symbol">{props.symbol}</span>
    </span>
  );
}

export function SafeBalance(props: {
  value: string | null;
  symbol: SafeAssetSymbol;
  caption: string;
}): JSX.Element {
  return (
    <div className="balance">
      <p className="balance__figure">
        <SafeAmount size="display" symbol={props.symbol} value={props.value} />
      </p>
      <p className="balance__caption">{props.caption}</p>
    </div>
  );
}
