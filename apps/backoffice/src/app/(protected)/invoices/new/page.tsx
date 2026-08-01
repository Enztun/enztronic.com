import type { Metadata } from "next";
import { Building2, Plus } from "lucide-react";
import Link from "next/link";

import { createInvoiceAction } from "@/actions";
import { InvoiceForm } from "@/components/invoice-form";
import { buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { addCalendarDays, currentDateInTimeZone } from "@/lib/calendar";
import { getBusinessProfile } from "@/lib/server/business";
import { listClients } from "@/lib/server/clients";

export const metadata: Metadata = {
  title: "New invoice",
};

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const [clients, profile] = await Promise.all([
    listClients(),
    getBusinessProfile(),
  ]);
  const issueDate = currentDateInTimeZone(profile.timezone);
  const dueDate = addCalendarDays(issueDate, profile.defaultPaymentTermsDays);

  return (
    <>
      <PageHeader
        eyebrow="Invoices"
        title="Create invoice"
        description="Build a draft now, then review and finalize it before sending."
      />
      {clients.length ? (
        <InvoiceForm
          action={createInvoiceAction}
          submitLabel="Create draft"
          clients={clients.map((client) => ({
            id: client.id,
            label: client.companyName ? `${client.name} · ${client.companyName}` : client.name,
            defaultCurrency: client.defaultCurrency,
          }))}
          initialValues={{
            issueOn: issueDate,
            dueOn: dueDate,
            currency: profile.defaultCurrency,
          }}
        />
      ) : (
        <div className="mt-8">
          <EmptyState
            icon={Building2}
            title="Add a client first"
            description="An invoice needs a billing profile. Create a client, then return here to draft the invoice."
            action={
              <Link href="/clients/new" className={buttonStyles()}>
                <Plus aria-hidden="true" className="size-4" />
                Add client
              </Link>
            }
          />
        </div>
      )}
    </>
  );
}
