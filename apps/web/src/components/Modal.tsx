import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.closest("[inert]"),
  );
}

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
  const dialogRef = useRef<HTMLElement>(null);
  const cannotClose = loading || !onClose;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    return () => {
      if (previouslyFocusedElement?.isConnected) {
        previouslyFocusedElement.focus();
      }
    };
  }, [isOpen]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusableElements = getFocusableElements(dialog);
    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;
    if (activeElement === dialog || !dialog.contains(activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }

    if ((event.shiftKey && activeElement === first) || (!event.shiftKey && activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="ui-modal-backdrop">
      <section
        ref={dialogRef}
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading || undefined}
        aria-disabled={disabled || loading || undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
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
        <fieldset className="ui-modal__content" disabled={disabled || loading} inert={disabled || loading || undefined}>
          {children}
        </fieldset>
      </section>
    </div>
  );
}
