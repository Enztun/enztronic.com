import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { updateClientAction } from "@/actions";
import { ClientForm } from "@/components/client-form";
import { PageHeader } from "@/components/ui/page-header";
import { getClient } from "@/lib/server/clients";
import { getAccessScope, listAssignableOwners } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Edit client",
};

export const dynamic = "force-dynamic";

interface EditClientPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditClientPage({ params }: EditClientPageProps) {
  const { id } = await params;
  const scope = await getAccessScope();
  const client = await getClient(scope, id);

  if (!client) {
    notFound();
  }

  // Owner reassignment is an admin-only control, so the list is only
  // fetched for an admin and the field is simply absent for sales users.
  const owners =
    scope.user.role === "admin" ? await listAssignableOwners() : [];
  const updateAction = updateClientAction.bind(null, client.id);

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title={`Edit ${client.name}`}
        description="Update this client's contact and billing information."
      />
      <ClientForm
        owners={owners.map((owner) => ({
          id: owner.id,
          name: owner.name,
          role: owner.role,
        }))}
        ownerUserId={client.ownerUserId}
        action={updateAction}
        submitLabel="Save changes"
        initialValues={{
          id: client.id,
          version: client.version,
          displayName: client.name,
          legalName: client.companyName,
          email: client.email,
          phone: client.phone,
          taxId: client.taxId,
          addressLine1: client.billingAddress.line1,
          addressLine2: client.billingAddress.line2,
          city: client.billingAddress.city,
          province: client.billingAddress.province,
          postalCode: client.billingAddress.postalCode,
          country: client.billingAddress.country,
        }}
      />
    </>
  );
}
