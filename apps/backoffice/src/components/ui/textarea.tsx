import type { TextareaHTMLAttributes } from "react";

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`min-h-28 w-full resize-y rounded-xl border border-line bg-canvas/45 px-3.5 py-3 text-sm leading-6 text-ink placeholder:text-muted/65 transition-colors hover:border-line/90 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/12 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}
