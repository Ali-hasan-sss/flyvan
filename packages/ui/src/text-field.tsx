import type { InputHTMLAttributes, ReactNode } from "react";

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({ label, hint, error, id, ...props }: TextFieldProps) {
  const fieldId = id ?? props.name;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="fv-field">
      <label className="fv-label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        className="fv-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {hint ? (
        <p id={hintId} className="fv-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="fv-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FieldNote({ children }: { children: ReactNode }) {
  return <p className="fv-hint">{children}</p>;
}
