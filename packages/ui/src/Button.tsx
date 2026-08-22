import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Blocks the action and marks it busy without changing the button's size. */
  loading?: boolean;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A pill that presses.
 *
 * The label stays mounted while loading and the spinner is laid over it, so
 * the button never changes width. That keeps a slow operation from announcing
 * its duration through layout movement — which matters on the payment path,
 * where two sessions must be indistinguishable.
 */
export function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  className,
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={rest.type ?? "button"}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-loading={loading || undefined}
      className={["ui-button", className].filter(Boolean).join(" ")}
    >
      <span className="ui-button__label">{children}</span>
      {loading ? (
        <span className="ui-button__spinner" aria-hidden="true" />
      ) : null}
    </button>
  );
}
