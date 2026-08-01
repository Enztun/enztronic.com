import { ShieldCheck } from "lucide-react";

import { MobileNavigation } from "@/components/mobile-navigation";
import { PrimaryNavigation } from "@/components/primary-navigation";

interface AdminShellProps {
  children: React.ReactNode;
}

export function AdminShell({ children }: AdminShellProps) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-line/80 bg-panel/92 px-5 py-6 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="px-2">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-3 rounded-lg"
            aria-label="Enztronic backoffice dashboard"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-accent text-sm font-black tracking-[-0.04em] text-white shadow-[0_12px_35px_rgba(47,116,223,0.34)]">
              EZ
            </span>
            <span>
              <span className="block text-sm font-bold tracking-[0.16em] text-ink">
                ENZTRONIC
              </span>
              <span className="mt-0.5 block text-xs text-muted">Backoffice</span>
            </span>
          </a>
        </div>

        <div className="mt-10 flex-1">
          <PrimaryNavigation />
        </div>

        <div className="rounded-2xl border border-line bg-canvas/35 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-success">
            <ShieldCheck aria-hidden="true" className="size-4" />
            Private workspace
          </div>
          <p className="mt-2 text-xs leading-5 text-muted">
            Access is restricted and activity is handled server-side.
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        <MobileNavigation />
        <main className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10 xl:px-12">
          <div className="page-enter">{children}</div>
        </main>
      </div>
    </div>
  );
}
