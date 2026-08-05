"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { navigationFor } from "@/components/navigation-items";
import type { UserRole } from "@/lib/server/session";

interface PrimaryNavigationProps {
  role: UserRole;
}

export function PrimaryNavigation({ role }: PrimaryNavigationProps) {
  const pathname = usePathname();
  const items = navigationFor(role);

  return (
    <nav aria-label="Primary navigation">
      <p className="px-3 text-[0.68rem] font-bold tracking-[0.18em] text-muted/80 uppercase">
        Workspace
      </p>
      <ul className="mt-3 space-y-1.5">
        {items.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-accent/14 text-ink ring-1 ring-accent/20"
                    : "text-muted hover:bg-overlay-strong hover:text-ink"
                }`}
              >
                <Icon
                  aria-hidden="true"
                  className={`size-[1.1rem] ${isActive ? "text-accent" : "text-muted group-hover:text-ink"}`}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
