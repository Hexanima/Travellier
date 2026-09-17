import { useId } from "react";
import type { ReactNode } from "react";

export interface ModalProps {
  children: ReactNode;
  disabled?: boolean;
  error?: string;
  isOpen: boolean;
  loading?: boolean;
  onClose?: () => void;
  title: ReactNode;
}

export function Modal({
  children,
  disabled = false,
  error,
  isOpen,
  loading = false,
  onClose,
  title,
}: ModalProps) {
  const titleId = useId();
  const cannotClose = disabled || loading || !onClose;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="ui-modal-backdrop">
      <section
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading || undefined}
        aria-disabled={disabled || undefined}
      >
        <header className="ui-modal__header">
          <h2 className="ui-modal__title" id={titleId}>
            {title}
          </h2>
          <button
            className="ui-modal__close"
            type="button"
            aria-label="Cerrar"
            disabled={cannotClose}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {error ? <p className="ui-modal__error" role="alert">{error}</p> : null}
        <div className="ui-modal__content">{children}</div>
      </section>
    </div>
  );
}
