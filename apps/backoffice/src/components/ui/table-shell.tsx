import type { ReactNode } from "react";

export interface TableShellProps {
  children: ReactNode;
  label: string;
}

export function TableShell({ children, label }: TableShellProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel/82 shadow-[0_22px_70px_rgba(0,0,0,0.13)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left" aria-label={label}>
          {children}
        </table>
      </div>
    </div>
  );
}
