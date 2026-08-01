import type { Metadata } from "next";

import { createClientAction } from "@/actions";
import { ClientForm } from "@/components/client-form";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "New client",
};

export default function NewClientPage() {
  return (
    <>
      <PageHeader
        eyebrow="Clients"
        title="Add a client"
        description="Create a reusable billing profile for invoices and correspondence."
      />
      <ClientForm action={createClientAction} submitLabel="Create client" />
    </>
  );
}
