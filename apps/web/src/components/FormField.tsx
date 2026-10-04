import { useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

interface BaseFieldProps {
  disabled?: boolean;
  error?: string;
  helpText?: string;
  id?: string;
  label: ReactNode;
  loading?: boolean;
}

interface FieldLayoutProps extends BaseFieldProps {
  children: (props: {
    "aria-describedby"?: string;
    "aria-invalid": boolean;
    disabled: boolean;
    id: string;
  }) => ReactNode;
}

function FieldLayout({ children, disabled = false, error, helpText, id, label, loading = false }: FieldLayoutProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const isDisabled = disabled || loading;
  const descriptionIds = [helpText ? `${controlId}-help` : undefined, error ? `${controlId}-error` : undefined]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="ui-field" data-error={Boolean(error) || undefined} aria-busy={loading || undefined}>
      <label className="ui-field__label" htmlFor={controlId}>
        {label}
      </label>
      {children({
        id: controlId,
        disabled: isDisabled,
        "aria-invalid": Boolean(error),
        "aria-describedby": descriptionIds || undefined,
      })}
      {helpText ? (
        <p className="ui-field__help" id={`${controlId}-help`}>
          {helpText}
        </p>
      ) : null}
      {error ? (
        <p className="ui-field__error" id={`${controlId}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends BaseFieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, "disabled" | "id"> {}

export function TextField({ className, type = "text", ...props }: TextFieldProps) {
  const { disabled, error, helpText, id, label, loading, ...inputProps } = props;

  return (
    <FieldLayout disabled={disabled} error={error} helpText={helpText} id={id} label={label} loading={loading}>
      {(controlProps) => (
        <input
          {...inputProps}
          {...controlProps}
          className={["ui-control", className].filter(Boolean).join(" ")}
          type={type}
        />
      )}
    </FieldLayout>
  );
}

export type PasswordFieldProps = Omit<TextFieldProps, "type">;

export function PasswordField({ className, disabled, error, helpText, id, label, loading, ...inputProps }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <FieldLayout disabled={disabled} error={error} helpText={helpText} id={id} label={label} loading={loading}>
      {(controlProps) => (
        <div className="ui-password-control">
          <input {...inputProps} {...controlProps}
            className={["ui-control", "ui-control--password", className].filter(Boolean).join(" ")}
            type={visible ? "text" : "password"} />
          <button className="ui-password-toggle" type="button" disabled={controlProps.disabled}
            aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"} aria-controls={controlProps.id}
            onClick={() => setVisible((current) => !current)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {visible ? <path d="m3 3 18 18" /> : null}
            </svg>
          </button>
        </div>
      )}
    </FieldLayout>
  );
}

export interface SelectFieldProps extends BaseFieldProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, "disabled" | "id"> {}

export function SelectField({ children, className, ...props }: SelectFieldProps) {
  const { disabled, error, helpText, id, label, loading, ...selectProps } = props;

  return (
    <FieldLayout disabled={disabled} error={error} helpText={helpText} id={id} label={label} loading={loading}>
      {(controlProps) => (
        <select
          {...selectProps}
          {...controlProps}
          className={["ui-control", className].filter(Boolean).join(" ")}
        >
          {children}
        </select>
      )}
    </FieldLayout>
  );
}

export interface TextAreaFieldProps extends BaseFieldProps, Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "disabled" | "id"> {}

export function TextAreaField({ className, ...props }: TextAreaFieldProps) {
  const { disabled, error, helpText, id, label, loading, ...textareaProps } = props;

  return (
    <FieldLayout disabled={disabled} error={error} helpText={helpText} id={id} label={label} loading={loading}>
      {(controlProps) => (
        <textarea
          {...textareaProps}
          {...controlProps}
          className={["ui-control", "ui-control--textarea", className].filter(Boolean).join(" ")}
        />
      )}
    </FieldLayout>
  );
}
