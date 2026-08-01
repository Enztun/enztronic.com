import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "default" | "quiet";
}

export function Card({ className = "", tone = "default", ...props }: CardProps) {
  const toneClass =
    tone === "quiet"
      ? "border-line/70 bg-panel/55"
      : "border-line bg-panel/82 shadow-[0_22px_70px_rgba(0,0,0,0.13)]";

  return (
    <div
      className={`rounded-2xl border backdrop-blur-sm ${toneClass} ${className}`}
      {...props}
    />
  );
}
