import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { updateClientAction } from "@/actions";
import { ClientForm } from "@/components/client-form";
import { PageHeader } from "@/components/ui/page-header";
import { getClient } from "@/lib/server/clients";

export const metadata: Metadata = {
  title: "Edit client",
};

export const dynamic = "force-dynamic";

interface EditClientPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditClientPage({ params }: EditClientPageProps) {
  const { id } = await params;
  const client = await getClient(id);

  if (!client) {
    notFound();
  }

  const updateAction = updateClientAction.bind(null, client.id);

  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title={`Edit ${client.name}`}
        description="Update this client's contact and billing information."
      />
      <ClientForm
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
