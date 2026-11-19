import type { Metadata } from "next";
import { CheckCircle2, CircleDashed, ReceiptText } from "lucide-react";
import Link from "next/link";

import { formatDate, formatDateTime, formatMinorCurrency } from "@/components/formatters";
import { ReceiptStatusBadge } from "@/components/receipts/receipt-status-badge";
import { ReceiptUploadForm } from "@/components/receipts/receipt-upload-form";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TableShell } from "@/components/ui/table-shell";
import { getReceiptsSetup } from "@/lib/server/receipts/config";
import { getReceiptRepository } from "@/lib/server/receipts/service";
import { requireAdminSession } from "@/lib/server/session";
import { uploadReceiptAction } from "@/receipt-actions";

export const metadata: Metadata = {
  title: "Receipts",
};

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  await requireAdminSession();
  const setup = getReceiptsSetup();
  const ready = setup.items.every((item) => item.ready);
  const receipts = await getReceiptRepository().list(100);
  const waiting = receipts.filter((receipt) => receipt.status === "needs_review").length;

  return (
    <>
      <PageHeader
        eyebrow="Finance · Clara"
        title="Receipts"
        description="Send Clara a proof of payment. Clear receipts go straight into the ledger; anything unclear or ask-first waits here for you."
      />

      {!ready ? (
        <Card tone="quiet" className="mt-8 p-5 sm:p-7">
          <h2 className="text-base font-semibold text-ink">Set up receipt reading</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Uploads stay switched off until each item below is set in this app&apos;s environment.
            The steps are in <code className="text-ink">docs/RECEIPTS_SETUP.md</code>.
          </p>
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {setup.items.map((item) => (
              <li key={item.key} className="flex items-start gap-2.5 text-sm">
                {item.ready ? (
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
                )}
                <span>
                  <span className={item.ready ? "text-ink" : "text-muted"}>{item.label}</span>
                  <span className="ml-2 font-mono text-xs text-muted">{item.key}</span>
                  <span className="sr-only">{item.ready ? " (set)" : " (not set)"}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mt-8">
        <ReceiptUploadForm action={uploadReceiptAction} disabled={!ready} />
      </div>

      <div className="mt-8">
        {receipts.length ? (
          <>
            {waiting ? (
              <p className="mb-3 text-sm font-medium text-warning">
                {waiting} receipt{waiting === 1 ? "" : "s"} waiting for your review.
              </p>
            ) : null}
            <TableShell label="Receipts">
              <thead className="border-b border-line bg-overlay-strong">
                <tr className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                  <th scope="col" className="px-5 py-4 sm:px-6">Receipt</th>
                  <th scope="col" className="px-5 py-4">Paid to</th>
                  <th scope="col" className="px-5 py-4">Status</th>
                  <th scope="col" className="px-5 py-4">Payment date</th>
                  <th scope="col" className="px-5 py-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {receipts.map((receipt) => (
                  <tr key={receipt.id} className="text-sm transition-colors hover:bg-overlay-strong">
                    <td className="px-5 py-4 sm:px-6">
                      <Link href={`/receipts/${receipt.id}`} className="font-mono text-[0.82rem] font-semibold text-ink hover:text-accent">
                        {receipt.ledgerId}
                      </Link>
                      <p className="mt-1 text-xs text-muted">Uploaded {formatDateTime(receipt.createdAt)}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-ink">{receipt.payee ?? "Not read yet"}</p>
                      <p className="mt-1 max-w-72 truncate text-xs text-muted">{receipt.description ?? receipt.fileName}</p>
                    </td>
                    <td className="px-5 py-4">
                      <ReceiptStatusBadge status={receipt.status} />
                    </td>
                    <td className="px-5 py-4 text-muted">{receipt.txnDate ? formatDate(receipt.txnDate) : "—"}</td>
                    <td className="px-5 py-4 text-right font-medium text-ink">
                      {receipt.amountMinor !== null && receipt.currency
                        ? formatMinorCurrency(receipt.amountMinor, receipt.currency)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </>
        ) : (
          <EmptyState
            icon={ReceiptText}
            title="No receipts yet"
            description="Upload a transfer screenshot or a paid invoice. Clara reads it and suggests the category."
          />
        )}
      </div>
    </>
  );
}
