export interface SkeletonProps {
  /** Defaults to filling the container. */
  width?: string;
  /** Required: the skeleton must match the height of what replaces it. */
  height: string;
  radius?: string;
  /**
   * Keep this generic. A label naming the specific operation would let two
   * sessions announce different text, and the unlock and payment paths must
   * announce identically.
   */
  label?: string;
}

/**
 * A pixel-matched wait.
 *
 * Chrome never waits — layout and titles render immediately and only data
 * swaps from one of these. Because the box is the exact size of what replaces
 * it, the frame does not move when the data lands, so a slow read and a fast
 * read are indistinguishable to the eye.
 */
export function Skeleton({
  width = "100%",
  height,
  radius,
  label = "Loading",
}: SkeletonProps) {
  return (
    <span
      role="status"
      aria-label={label}
      className="ui-skeleton"
      style={{ width, height, borderRadius: radius ?? "var(--radius-card)" }}
    />
  );
}
