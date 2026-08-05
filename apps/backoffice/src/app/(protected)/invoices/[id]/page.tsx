import type { Metadata } from "next";
import {
  ArrowLeft,
  CalendarDays,
  CircleDollarSign,
  Download,
  ExternalLink,
  FileText,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  emailInvoiceAction,
  finalizeInvoiceAction,
  recordPaymentAction,
  updateDraftInvoiceAction,
  voidInvoiceAction,
} from "@/actions";
import {
  basisPointsToPercent,
  formatDate,
  formatMinorCurrency,
  minorToInputValue,
} from "@/components/formatters";
import { InvoiceActions } from "@/components/invoice-actions";
import { InvoiceForm } from "@/components/invoice-form";
import { InvoiceStatusBadge } from "@/components/invoice-status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TableShell } from "@/components/ui/table-shell";
import { listClients } from "@/lib/server/clients";
import { getInvoice } from "@/lib/server/invoices";
import { getAccessScope } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Invoice detail",
};

export const dynamic = "force-dynamic";

interface InvoiceDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function InvoiceDetailPage({ params }: InvoiceDetailPageProps) {
  const { id } = await params;
  const scope = await getAccessScope();
  const invoice = await getInvoice(scope, id);

  if (!invoice) {
    notFound();
  }

  const clients = invoice.status === "draft" ? await listClients(scope) : [];
  const canManageBilling = scope.user.role === "admin";
  const updateAction = updateDraftInvoiceAction.bind(null, invoice.id);
  const finalizeAction = finalizeInvoiceAction.bind(null, invoice.id);
  const voidAction = voidInvoiceAction.bind(null, invoice.id);
  const paymentAction = recordPaymentAction.bind(null, invoice.id);
  const emailAction = emailInvoiceAction.bind(null, invoice.id);
  const invoiceLabel = invoice.invoiceNumber ?? "Draft invoice";

  return (
    <>
      <PageHeader
        eyebrow="Invoices"
        title={invoiceLabel}
        description={`${invoice.clientName} · ${formatMinorCurrency(invoice.totalMinor, invoice.currency)}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <InvoiceStatusBadge status={invoice.effectiveStatus} />
            {invoice.status !== "draft" ? (
              <>
                <a
                  href={`/api/invoices/${invoice.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonStyles({ variant: "secondary", size: "sm" })}
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                  View PDF
                </a>
                <a
                  href={`/api/invoices/${invoice.id}/pdf?download=1`}
                  className={buttonStyles({ variant: "secondary", size: "sm" })}
                >
                  <Download aria-hidden="true" className="size-4" />
                  Download
                </a>
              </>
            ) : null}
            <Link href="/invoices" className={buttonStyles({ variant: "quiet" })}>
              <ArrowLeft aria-hidden="true" className="size-4" />
              All invoices
            </Link>
          </div>
        }
      />

      {invoice.status === "draft" ? (
        <>
          <InvoiceForm
            action={updateAction}
            submitLabel="Save draft"
            cancelHref="/invoices"
            clients={clients.map((client) => ({
              id: client.id,
              label: client.companyName ? `${client.name} · ${client.companyName}` : client.name,
              defaultCurrency: client.defaultCurrency,
            }))}
            initialValues={{
              version: invoice.version,
              clientId: invoice.clientId,
              issueOn: invoice.issueOn,
              dueOn: invoice.dueOn,
              currency: invoice.currency,
              notes: invoice.notes,
              terms: invoice.terms,
              items: invoice.items.map((item) => ({
                id: item.id,
                description: item.description,
                quantity: item.quantity,
                unitPrice: minorToInputValue(item.unitPriceMinor, invoice.currency),
                taxPercent: basisPointsToPercent(item.taxRateBps),
              })),
            }}
          />
          <section className="mt-8 max-w-sm" aria-label="Invoice actions">
            <InvoiceActions
              canManageBilling={canManageBilling}
              status="draft"
              version={invoice.version}
              currency={invoice.currency}
              balanceInputValue={minorToInputValue(invoice.balanceMinor, invoice.currency)}
              finalizeAction={finalizeAction}
              voidAction={voidAction}
              paymentAction={paymentAction}
              emailAction={emailAction}
            />
          </section>
        </>
      ) : (
        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            <section aria-label="Invoice summary" className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
              <Card className="p-5">
                <span className="grid size-9 place-items-center rounded-xl bg-accent/10 text-accent">
                  <UserRound aria-hidden="true" className="size-[1.1rem]" />
                </span>
                <p className="mt-4 text-xs font-medium text-muted">Client</p>
                <p className="mt-1 truncate text-sm font-semibold text-ink">{invoice.clientName}</p>
              </Card>
              <Card className="p-5">
                <span className="grid size-9 place-items-center rounded-xl bg-accent/10 text-accent">
                  <CalendarDays aria-hidden="true" className="size-[1.1rem]" />
                </span>
                <p className="mt-4 text-xs font-medium text-muted">Due date</p>
                <p className="mt-1 text-sm font-semibold text-ink">{formatDate(invoice.dueOn)}</p>
              </Card>
              <Card className="p-5">
                <span className="grid size-9 place-items-center rounded-xl bg-success/10 text-success">
                  <FileText aria-hidden="true" className="size-[1.1rem]" />
                </span>
                <p className="mt-4 text-xs font-medium text-muted">Invoice total</p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {formatMinorCurrency(invoice.totalMinor, invoice.currency)}
                </p>
              </Card>
              <Card className="p-5">
                <span className="grid size-9 place-items-center rounded-xl bg-warning/10 text-warning">
                  <CircleDollarSign aria-hidden="true" className="size-[1.1rem]" />
                </span>
                <p className="mt-4 text-xs font-medium text-muted">Balance due</p>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {formatMinorCurrency(invoice.balanceMinor, invoice.currency)}
                </p>
              </Card>
            </section>

            <TableShell label={`Line items for ${invoiceLabel}`}>
              <thead className="border-b border-line bg-overlay-strong">
                <tr className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                  <th scope="col" className="px-5 py-4 sm:px-6">Description</th>
                  <th scope="col" className="px-5 py-4 text-right">Qty</th>
                  <th scope="col" className="px-5 py-4 text-right">Unit price</th>
                  <th scope="col" className="px-5 py-4 text-right">Tax</th>
                  <th scope="col" className="px-5 py-4 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {invoice.items.map((item) => (
                  <tr key={item.id} className="text-sm">
                    <td className="px-5 py-4 font-medium text-ink sm:px-6">{item.description}</td>
                    <td className="px-5 py-4 text-right text-muted">{item.quantity}</td>
                    <td className="px-5 py-4 text-right text-muted">
                      {formatMinorCurrency(item.unitPriceMinor, invoice.currency)}
                    </td>
                    <td className="px-5 py-4 text-right text-muted">
                      {basisPointsToPercent(item.taxRateBps)}%
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-ink">
                      {formatMinorCurrency(item.totalMinor, invoice.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line bg-overlay-strong text-sm">
                <tr>
                  <th scope="row" colSpan={4} className="px-5 py-3 text-right font-medium text-muted">
                    Subtotal
                  </th>
                  <td className="px-5 py-3 text-right font-semibold text-ink">
                    {formatMinorCurrency(invoice.subtotalMinor, invoice.currency)}
                  </td>
                </tr>
                <tr>
                  <th scope="row" colSpan={4} className="px-5 py-3 text-right font-medium text-muted">
                    Tax
                  </th>
                  <td className="px-5 py-3 text-right font-semibold text-ink">
                    {formatMinorCurrency(invoice.taxMinor, invoice.currency)}
                  </td>
                </tr>
                <tr>
                  <th scope="row" colSpan={4} className="px-5 py-4 text-right font-semibold text-ink">
                    Total
                  </th>
                  <td className="px-5 py-4 text-right text-base font-bold text-ink">
                    {formatMinorCurrency(invoice.totalMinor, invoice.currency)}
                  </td>
                </tr>
              </tfoot>
            </TableShell>

            <Card className="grid gap-6 p-5 sm:grid-cols-2 sm:p-7">
              <div>
                <h2 className="text-sm font-semibold text-ink">Client note</h2>
                <p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted">
                  {invoice.notes || "No note was added to this invoice."}
                </p>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Payment terms</h2>
                <p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted">
                  {invoice.terms || "No custom payment terms were added."}
                </p>
              </div>
              {invoice.voidReason ? (
                <div className="rounded-xl border border-danger/25 bg-danger/[0.07] p-4 sm:col-span-2">
                  <h2 className="text-sm font-semibold text-danger">Void reason</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">{invoice.voidReason}</p>
                </div>
              ) : null}
            </Card>

            {invoice.payments.length ? (
              <section>
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-ink">Payment history</h2>
                  <p className="mt-1 text-sm text-muted">
                    Immutable ledger entries recorded against this invoice.
                  </p>
                </div>
                <TableShell label={`Payments for ${invoiceLabel}`}>
                  <thead className="border-b border-line bg-overlay-strong">
                    <tr className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                      <th scope="col" className="px-5 py-4 sm:px-6">Entry</th>
                      <th scope="col" className="px-5 py-4">Date</th>
                      <th scope="col" className="px-5 py-4">Method</th>
                      <th scope="col" className="px-5 py-4">Reference</th>
                      <th scope="col" className="px-5 py-4 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {invoice.payments.map((payment) => (
                      <tr key={payment.id} className="text-sm">
                        <td className="px-5 py-4 sm:px-6">
                          <Badge tone={payment.kind === "payment" ? "success" : "warning"}>
                            {payment.kind}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 text-muted">{formatDate(payment.paidAt)}</td>
                        <td className="px-5 py-4 text-muted">
                          {payment.method ?? payment.provider ?? "—"}
                        </td>
                        <td className="px-5 py-4 text-muted">
                          {payment.externalReference ?? "—"}
                        </td>
                        <td className="px-5 py-4 text-right font-semibold text-ink">
                          {payment.kind === "reversal" ? "−" : ""}
                          {formatMinorCurrency(payment.amountMinor, payment.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableShell>
              </section>
            ) : null}
          </div>

          <aside aria-label="Invoice actions" className="xl:sticky xl:top-10 xl:self-start">
            <InvoiceActions
              canManageBilling={canManageBilling}
              status={invoice.effectiveStatus}
              version={invoice.version}
              currency={invoice.currency}
              balanceInputValue={minorToInputValue(invoice.balanceMinor, invoice.currency)}
              finalizeAction={finalizeAction}
              voidAction={voidAction}
              paymentAction={paymentAction}
              emailAction={emailAction}
            />
          </aside>
        </div>
      )}
    </>
  );
}
