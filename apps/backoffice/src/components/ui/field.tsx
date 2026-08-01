import type { ReactNode } from "react";

export interface FieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  children,
  hint,
  required = false,
  className = "",
}: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-2 block text-sm font-semibold text-ink">
        {label}
        {required ? <span className="ml-1 text-accent">*</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-2 text-xs leading-5 text-muted">{hint}</p> : null}
    </div>
  );
}
