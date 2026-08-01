import type { SelectHTMLAttributes } from "react";

export function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`min-h-11 w-full rounded-xl border border-line bg-canvas/45 px-3.5 text-sm text-ink transition-colors hover:border-line/90 focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/12 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}
