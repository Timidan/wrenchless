import type { JSX } from "react";

/**
 * Ready Wallet's own mark, held in one place.
 *
 * It appears on the connect button, in the emblem above it, and on the public
 * page's evidence run, and it is somebody else's asset, so all three draw the
 * same two paths rather than a redrawn copy that could drift from the export.
 *
 * It draws in Ready's own orange rather than in ink. The argument is the one
 * already made for Starknet's coral in `tokens.css`: a third party's identity
 * is not ours to desaturate, and the exception is bought by the mark appearing
 * exactly where that company's name appears and nowhere else.
 *
 * The two paths stay separate rather than being flattened into one, because
 * the spark is the only part of the mark that is allowed to move: on a control
 * it turns while the chevron — which is the mark — holds absolutely still.
 */
export const READY_MARK_VIEW_BOX = "0 0 40 40";

export const READY_MARK_PATHS: readonly string[] = [
  "M20.837 12.049h-5.255c-.175 0-.316.152-.32.34-.106 5.281-2.688 10.294-7.131 13.845-.141.113-.174.325-.07.477l3.074 4.55c.105.155.308.19.452.076 2.778-2.205 5.013-4.866 6.623-7.816 1.609 2.95 3.844 5.61 6.623 7.816.143.114.347.079.451-.076l3.075-4.55c.103-.152.07-.364-.07-.477-4.444-3.55-7.026-8.564-7.132-13.845-.004-.188-.144-.34-.32-.34Z",
  "m28.241 15.351-.574-1.774a1.165 1.165 0 0 0-.763-.752l-1.783-.548a.263.263 0 0 1-.003-.502l1.773-.574c.36-.117.642-.402.753-.764l.547-1.782c.076-.246.424-.249.503-.004l.574 1.774c.117.36.401.64.763.752l1.783.548c.246.075.248.423.003.503l-1.773.574c-.36.116-.642.401-.752.763l-.548 1.782c-.075.246-.423.249-.503.004Z",
];

export function ReadyWalletMark({
  className,
}: {
  className: string;
}): JSX.Element {
  const [chevron, spark] = READY_MARK_PATHS;
  return (
    <svg
      aria-hidden="true"
      className={`readymark ${className}`}
      fill="none"
      focusable="false"
      viewBox={READY_MARK_VIEW_BOX}
    >
      <path d={chevron} fill="currentColor" />
      <path className="readymark__spark" d={spark} fill="currentColor" />
    </svg>
  );
}
