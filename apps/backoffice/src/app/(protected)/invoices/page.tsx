import type { Metadata } from "next";
import { FileText, Plus } from "lucide-react";
import Link from "next/link";

import { formatDate, formatMinorCurrency } from "@/components/formatters";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { buttonStyles } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TableShell } from "@/components/ui/table-shell";
import { listInvoices } from "@/lib/server/invoices";

export const metadata: Metadata = {
  title: "Invoices",
};

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const invoices = await listInvoices();

  return (
    <>
      <PageHeader
        eyebrow="Billing"
        title="Invoices"
        description="Draft, issue, send, and reconcile client invoices from one ledger."
        actions={
          <Link href="/invoices/new" className={buttonStyles()}>
            <Plus aria-hidden="true" className="size-4" />
            New invoice
          </Link>
        }
      />

      <div className="mt-8">
        {invoices.length ? (
          <TableShell label="Invoices">
            <thead className="border-b border-line bg-white/[0.018]">
              <tr className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                <th scope="col" className="px-5 py-4 sm:px-6">Invoice</th>
                <th scope="col" className="px-5 py-4">Client</th>
                <th scope="col" className="px-5 py-4">Status</th>
                <th scope="col" className="px-5 py-4">Due date</th>
                <th scope="col" className="px-5 py-4 text-right">Total</th>
                <th scope="col" className="px-5 py-4 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="text-sm transition-colors hover:bg-white/[0.02]">
                  <td className="px-5 py-4 sm:px-6">
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="font-semibold text-ink hover:text-accent"
                    >
                      {invoice.invoiceNumber ?? "Draft"}
                    </Link>
                    <p className="mt-1 text-xs text-muted">Issued {formatDate(invoice.issueOn)}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="font-medium text-ink">{invoice.clientName}</p>
                    <p className="mt-1 text-xs text-muted">{invoice.clientEmail}</p>
                  </td>
                  <td className="px-5 py-4">
                    <InvoiceStatusBadge status={invoice.effectiveStatus} />
                  </td>
                  <td className="px-5 py-4 text-muted">{formatDate(invoice.dueOn)}</td>
                  <td className="px-5 py-4 text-right font-medium text-ink">
                    {formatMinorCurrency(invoice.totalMinor, invoice.currency)}
                  </td>
                  <td className="px-5 py-4 text-right font-medium text-ink">
                    {formatMinorCurrency(invoice.balanceMinor, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        ) : (
          <EmptyState
            icon={FileText}
            title="No invoices yet"
            description="Create a draft to begin your billing ledger."
            action={
              <Link href="/invoices/new" className={buttonStyles()}>
                <Plus aria-hidden="true" className="size-4" />
                New invoice
              </Link>
            }
          />
        )}
      </div>
    </>
  );
}
