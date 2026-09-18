import type { HTMLAttributes, ReactNode } from "react";

export type FeedbackVariant = "error" | "info" | "success";

export interface FeedbackProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  variant?: FeedbackVariant;
}

export function Feedback({
  children,
  className,
  disabled = false,
  loading = false,
  variant = "info",
  ...props
}: FeedbackProps) {
  const isError = variant === "error";

  return (
    <div
      {...props}
      className={["ui-feedback", `ui-feedback--${variant}`, className].filter(Boolean).join(" ")}
      role={isError ? "alert" : "status"}
      aria-busy={loading || undefined}
      aria-disabled={disabled || undefined}
    >
      {children}
    </div>
  );
}

export interface LoadingStateProps extends Omit<FeedbackProps, "children" | "variant"> {
  label?: string;
}

export function LoadingState({ label = "Cargando…", loading = true, ...props }: LoadingStateProps) {
  return (
    <Feedback {...props} loading={loading}>
      <span className="ui-spinner" aria-hidden="true" />
      {label}
    </Feedback>
  );
}
