import type { Metadata } from "next";

import { createClientAction } from "@/actions";
import { ClientForm } from "@/components/client-form";
import { getAccessScope, listAssignableOwners } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "New client",
};

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  const scope = await getAccessScope();
  const owners =
    scope.user.role === "admin" ? await listAssignableOwners() : [];

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title="Add a client"
        description="Create a reusable billing profile for invoices and correspondence."
      />
      <ClientForm
        action={createClientAction}
        submitLabel="Create client"
        owners={owners.map((owner) => ({
          id: owner.id,
          name: owner.name,
          role: owner.role,
        }))}
      />
    </>
  );
}
