import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  error?: boolean;
  loading?: boolean;
  loadingLabel?: string;
}

export function Button({
  children,
  className,
  disabled = false,
  error = false,
  loading = false,
  loadingLabel = "Guardando…",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={["ui-button", className].filter(Boolean).join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-error={error || undefined}
    >
      {loading ? loadingLabel : children}
    </button>
  );
}
