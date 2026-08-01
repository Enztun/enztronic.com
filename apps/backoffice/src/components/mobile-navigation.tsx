"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { navigationItems } from "@/components/navigation-items";

export function MobileNavigation() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/88 px-4 py-3 backdrop-blur-xl lg:hidden">
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 rounded-lg"
          aria-label="Enztronic backoffice dashboard"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-[0.65rem] font-black tracking-[-0.04em] text-white">
            EZ
          </span>
          <span className="text-xs font-bold tracking-[0.15em]">ENZTRONIC</span>
        </Link>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls="mobile-navigation-panel"
          aria-label={isOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setIsOpen((current) => !current)}
          className="grid size-10 place-items-center rounded-xl border border-line bg-panel text-ink transition-colors hover:bg-panel-raised"
        >
          {isOpen ? (
            <X aria-hidden="true" className="size-5" />
          ) : (
            <Menu aria-hidden="true" className="size-5" />
          )}
        </button>
      </div>

      {isOpen ? (
        <nav
          id="mobile-navigation-panel"
          aria-label="Mobile navigation"
          className="absolute inset-x-0 top-full border-b border-line bg-panel p-4 shadow-2xl"
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {navigationItems.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium ${
                      isActive
                        ? "bg-accent/14 text-ink ring-1 ring-accent/20"
                        : "text-muted hover:bg-white/[0.04] hover:text-ink"
                    }`}
                  >
                    <Icon
                      aria-hidden="true"
                      className={`size-[1.1rem] ${isActive ? "text-accent" : ""}`}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
