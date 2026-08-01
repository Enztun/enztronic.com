import { headers } from "next/headers";

import { AdminShell } from "@/components/admin-shell";
import { authenticateAccessHeaders } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

interface ProtectedLayoutProps {
  children: React.ReactNode;
}

export default async function ProtectedLayout({ children }: ProtectedLayoutProps) {
  await authenticateAccessHeaders(await headers());
  return <AdminShell>{children}</AdminShell>;
}
