import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-line bg-overlay-strong text-muted",
  info: "border-accent/25 bg-accent/10 text-accent",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-danger/25 bg-danger/10 text-danger",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ className = "", tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[0.68rem] font-bold tracking-[0.08em] uppercase ${toneClasses[tone]} ${className}`}
      {...props}
    />
  );
}
