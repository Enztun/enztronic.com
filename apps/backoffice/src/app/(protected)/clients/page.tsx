import type { Metadata } from "next";
import { Building2, Mail, MapPin, Plus } from "lucide-react";
import Link from "next/link";

import { formatDate } from "@/components/formatters";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TableShell } from "@/components/ui/table-shell";
import { listClients } from "@/lib/server/clients";
import { getAccessScope } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Clients",
};

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const scope = await getAccessScope();
  const clients = await listClients(scope);

  return (
    <>
      <PageHeader
        eyebrow="Directory"
        title="Clients"
        description="Manage billing contacts and the business details used on invoices."
        actions={
          <Link href="/clients/new" className={buttonStyles()}>
            <Plus aria-hidden="true" className="size-4" />
            Add client
          </Link>
        }
      />

      <div className="mt-8">
        {clients.length ? (
          <TableShell label="Clients">
            <thead className="border-b border-line bg-overlay-strong">
              <tr className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                <th scope="col" className="px-5 py-4 sm:px-6">Client</th>
                <th scope="col" className="px-5 py-4">Contact</th>
                <th scope="col" className="px-5 py-4">Location</th>
                <th scope="col" className="px-5 py-4">Added</th>
                <th scope="col" className="px-5 py-4 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {clients.map((client) => {
                const location = [client.billingAddress.city, client.billingAddress.country]
                  .filter(Boolean)
                  .join(", ");

                return (
                  <tr key={client.id} className="text-sm transition-colors hover:bg-overlay-strong">
                    <td className="px-5 py-4 sm:px-6">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-xs font-bold text-accent">
                          {client.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">{client.name}</p>
                          <p className="mt-0.5 max-w-56 truncate text-xs text-muted">
                            {client.companyName ?? "Individual client"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <a
                        href={`mailto:${client.email}`}
                        className="inline-flex items-center gap-2 text-muted hover:text-ink"
                      >
                        <Mail aria-hidden="true" className="size-3.5" />
                        {client.email}
                      </a>
                    </td>
                    <td className="px-5 py-4 text-muted">
                      {location ? (
                        <span className="inline-flex items-center gap-2">
                          <MapPin aria-hidden="true" className="size-3.5" />
                          {location}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-4 text-muted">{formatDate(client.createdAt)}</td>
                    <td className="px-5 py-4 text-right">
                      {client.archivedAt ? (
                        <Badge>Archived</Badge>
                      ) : (
                        <Link
                          href={`/clients/${client.id}/edit`}
                          className="rounded-lg text-sm font-semibold text-accent hover:text-ink"
                        >
                          Edit
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        ) : (
          <EmptyState
            icon={Building2}
            title="No clients yet"
            description="Add a client profile before creating your first invoice."
            action={
              <Link href="/clients/new" className={buttonStyles()}>
                <Plus aria-hidden="true" className="size-4" />
                Add client
              </Link>
            }
          />
        )}
      </div>
    </>
  );
}
