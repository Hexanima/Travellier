import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

interface BaseFieldProps {
  disabled?: boolean;
  error?: string;
  helpText?: string;
  id?: string;
  label: ReactNode;
}

interface FieldLayoutProps extends BaseFieldProps {
  children: (props: {
    "aria-describedby"?: string;
    "aria-invalid": boolean;
    disabled: boolean;
    id: string;
  }) => ReactNode;
}

function FieldLayout({ children, disabled = false, error, helpText, id, label }: FieldLayoutProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionIds = [helpText ? `${controlId}-help` : undefined, error ? `${controlId}-error` : undefined]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="ui-field" data-error={Boolean(error) || undefined}>
      <label className="ui-field__label" htmlFor={controlId}>
        {label}
      </label>
      {children({
        id: controlId,
        disabled,
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
  const { disabled, error, helpText, id, label, ...inputProps } = props;

  return (
    <FieldLayout disabled={disabled} error={error} helpText={helpText} id={id} label={label}>
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

export interface SelectFieldProps extends BaseFieldProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, "disabled" | "id"> {}

export function SelectField({ children, className, ...props }: SelectFieldProps) {
  const { disabled, error, helpText, id, label, ...selectProps } = props;

  return (
    <FieldLayout disabled={disabled} error={error} helpText={helpText} id={id} label={label}>
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
  const { disabled, error, helpText, id, label, ...textareaProps } = props;

  return (
    <FieldLayout disabled={disabled} error={error} helpText={helpText} id={id} label={label}>
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
