import type { JSX } from "react";

/**
 * The live mark inherits its ground from the lockup. That keeps the nav morph
 * and the dark footer on the same geometry without maintaining a third asset
 * variant that could drift from the exports.
 */
export function WrenchlessMark({
  className,
}: {
  className: string;
}): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 7.5 12.5 24.5 20 7.5"
        stroke="currentColor"
        strokeOpacity=".55"
        strokeWidth="2.5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M12 7.5 19.5 24.5 27 7.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
