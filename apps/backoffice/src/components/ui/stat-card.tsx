import type { LucideIcon } from "lucide-react";

export interface StatCardProps {
  label: string;
  value: string;
  supportingText: string;
  icon: LucideIcon;
  tone?: "accent" | "success" | "warning" | "neutral";
}

const toneClasses = {
  accent: "bg-accent/10 text-accent ring-accent/20",
  success: "bg-success/10 text-success ring-success/20",
  warning: "bg-warning/10 text-warning ring-warning/20",
  neutral: "bg-white/[0.045] text-muted ring-line",
};

export function StatCard({
  label,
  value,
  supportingText,
  icon: Icon,
  tone = "accent",
}: StatCardProps) {
  return (
    <div className="rounded-2xl border border-line bg-panel/82 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.12)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted">{label}</p>
          <p className="mt-3 text-2xl font-bold tracking-[-0.035em] text-ink">{value}</p>
        </div>
        <span className={`grid size-10 place-items-center rounded-xl ring-1 ${toneClasses[tone]}`}>
          <Icon aria-hidden="true" className="size-[1.1rem]" />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">{supportingText}</p>
    </div>
  );
}
