import type { HTMLAttributes, ReactNode } from "react";

export interface SquircleCardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article";
  /** The recessed grey layer that sits inside a white frame. */
  inset?: boolean;
  children: ReactNode;
}

/**
 * The surface.
 *
 * Two layers and the gap is the page: a white frame holding a recessed grey
 * inset, with the page background between plates as the only divider. No
 * horizontal rules anywhere.
 */
export function SquircleCard({
  as: Tag = "div",
  inset = false,
  children,
  className,
  ...rest
}: SquircleCardProps) {
  return (
    <Tag
      {...rest}
      data-inset={inset || undefined}
      className={["ui-squircle", className].filter(Boolean).join(" ")}
    >
      {children}
    </Tag>
  );
}
