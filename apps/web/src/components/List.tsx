import type { HTMLAttributes, LiHTMLAttributes, ReactNode } from "react";

export interface ListProps extends HTMLAttributes<HTMLUListElement> {
  children: ReactNode;
  disabled?: boolean;
  error?: string;
  loading?: boolean;
}

export function List({ children, className, disabled = false, error, loading = false, ...props }: ListProps) {
  return (
    <ul
      {...props}
      className={["ui-list", className].filter(Boolean).join(" ")}
      aria-disabled={disabled || undefined}
      aria-busy={loading || undefined}
      inert={disabled || undefined}
    >
      {loading ? (
        <li className="ui-list__state" role="status">
          Cargando…
        </li>
      ) : error ? (
        <li className="ui-list__state ui-list__state--error" role="alert">
          {error}
        </li>
      ) : (
        children
      )}
    </ul>
  );
}

export interface ListItemProps extends LiHTMLAttributes<HTMLLIElement> {
  children: ReactNode;
  disabled?: boolean;
}

export function ListItem({ children, className, disabled = false, ...props }: ListItemProps) {
  return (
    <li
      {...props}
      className={["ui-list__item", className].filter(Boolean).join(" ")}
      aria-disabled={disabled || undefined}
    >
      {children}
    </li>
  );
}
