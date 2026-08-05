import { AdminShell } from "@/components/admin-shell";
import { getSessionUser } from "@/lib/server/session";

export const dynamic = "force-dynamic";

interface ProtectedLayoutProps {
  children: React.ReactNode;
}

export default async function ProtectedLayout({ children }: ProtectedLayoutProps) {
  // Proves both that Cloudflare Access authenticated the caller and that they
  // are still a provisioned operator.
  const user = await getSessionUser();
  return <AdminShell user={user}>{children}</AdminShell>;
}
