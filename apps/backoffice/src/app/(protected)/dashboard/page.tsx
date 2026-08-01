import type { Metadata } from "next";
import { ArrowRight, Building2, CircleDollarSign, Clock3, FilePenLine } from "lucide-react";
import Link from "next/link";

import { formatDate, formatMinorCurrency } from "@/components/formatters";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { listClients } from "@/lib/server/clients";
import { listInvoices } from "@/lib/server/invoices";

export const metadata: Metadata = {
  title: "Dashboard",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [clients, invoices] = await Promise.all([listClients(), listInvoices()]);
  const outstandingInvoices = invoices.filter(
    (invoice) =>
      invoice.effectiveStatus === "sent" || invoice.effectiveStatus === "overdue",
  );
  const balancesByCurrency = outstandingInvoices.reduce((balances, invoice) => {
    balances.set(
      invoice.currency,
      (balances.get(invoice.currency) ?? 0n) + invoice.balanceMinor,
    );
    return balances;
  }, new Map<string, bigint>());
  const overdueCount = invoices.filter(
    (invoice) => invoice.effectiveStatus === "overdue",
  ).length;
  const draftCount = invoices.filter((invoice) => invoice.status === "draft").length;
  const recentInvoices = invoices.slice(0, 5);
  const [singleBalance] = balancesByCurrency.entries();
  const outstandingValue =
    balancesByCurrency.size <= 1
      ? formatMinorCurrency(singleBalance?.[1] ?? 0n, singleBalance?.[0] ?? "IDR")
      : `${outstandingInvoices.length} invoices`;
  const outstandingSupport =
    balancesByCurrency.size > 1
      ? `Open balances across ${balancesByCurrency.size} currencies`
      : "Open balance across sent invoices";

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Commercial operations"
        description="A clear view of client records, invoice progress, and payments that need attention."
        actions={
          <Link href="/invoices/new" className={buttonStyles()}>
            Create invoice
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        }
      />

      <section aria-label="Workspace summary" className="mt-8 grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard
          label="Active clients"
          value={clients.length.toLocaleString("en-US")}
          supportingText="Available for new invoice drafts"
          icon={Building2}
          tone="accent"
        />
        <StatCard
          label="Outstanding"
          value={outstandingValue}
          supportingText={outstandingSupport}
          icon={CircleDollarSign}
          tone="success"
        />
        <StatCard
          label="Overdue"
          value={overdueCount.toLocaleString("en-US")}
          supportingText="Invoices past their due date"
          icon={Clock3}
          tone="warning"
        />
        <StatCard
          label="Drafts"
          value={draftCount.toLocaleString("en-US")}
          supportingText="Invoices still open for editing"
          icon={FilePenLine}
          tone="neutral"
        />
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-ink">Recent invoices</h2>
            <p className="mt-1 text-sm text-muted">Latest billing activity across the workspace.</p>
          </div>
          <Link
            href="/invoices"
            className="rounded-lg text-sm font-semibold text-accent hover:text-ink"
          >
            View all
          </Link>
        </div>

        {recentInvoices.length ? (
          <Card className="divide-y divide-line overflow-hidden">
            {recentInvoices.map((invoice) => (
              <Link
                key={invoice.id}
                href={`/invoices/${invoice.id}`}
                className="grid gap-3 px-5 py-4 transition-colors hover:bg-white/[0.025] sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:px-6"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {invoice.invoiceNumber ?? "Unnumbered draft"}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted">{invoice.clientName}</p>
                </div>
                <div className="sm:text-right">
                  <p className="text-sm font-semibold text-ink">
                    {formatMinorCurrency(invoice.totalMinor, invoice.currency)}
                  </p>
                  <p className="mt-1 text-xs text-muted">Due {formatDate(invoice.dueOn)}</p>
                </div>
                <InvoiceStatusBadge status={invoice.effectiveStatus} />
              </Link>
            ))}
          </Card>
        ) : (
          <EmptyState
            icon={FilePenLine}
            title="No invoices yet"
            description="Create the first draft when you are ready to bill a client."
            action={
              <Link href="/invoices/new" className={buttonStyles()}>
                Create invoice
              </Link>
            }
          />
        )}
      </section>
    </>
  );
}
