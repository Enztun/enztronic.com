import {
  Building2,
  FileText,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { UserRole } from "@/lib/server/session";

export interface NavigationItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const navigationItems: NavigationItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Building2 },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/team", label: "Team", icon: Users, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, adminOnly: true },
];

/**
 * Hiding a link is presentation only -- every admin route re-checks the role
 * server-side, so a sales user typing the URL still gets refused.
 */
export function navigationFor(role: UserRole): NavigationItem[] {
  return role === "admin"
    ? navigationItems
    : navigationItems.filter((item) => !item.adminOnly);
}
