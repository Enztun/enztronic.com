import type { Metadata } from "next";
import { AlertTriangle, ArrowLeft, ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { formatDate, formatDateTime, formatMinorCurrency } from "@/components/formatters";
import { ReceiptRecordedActions } from "@/components/receipts/receipt-recorded-actions";
import { ReceiptReviewForm, type CategoryOption } from "@/components/receipts/receipt-review-form";
import { ReceiptStatusBadge } from "@/components/receipts/receipt-status-badge";
import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { currencyFractionDigits, minorUnitsToDecimal } from "@/lib/money";
import { getLedgerConfig } from "@/lib/server/receipts/config";
import { getReceiptRepository, getReceiptService, SUPPORTED_CURRENCIES } from "@/lib/server/receipts/service";
import { requireAdminSession } from "@/lib/server/session";
import {
  changeReceiptCategoryAction,
  discardReceiptAction,
  recordReceiptAction,
  undoReceiptAction,
} from "@/receipt-actions";

export const metadata: Metadata = {
  title: "Receipt",
};

export const dynamic = "force-dynamic";

interface ReceiptPageProps {
  params: Promise<{ id: string }>;
}

function amountInput(amountMinor: bigint | null, currency: string | null): string {
  if (amountMinor === null || !currency) return "";
  try {
    return minorUnitsToDecimal(amountMinor, currencyFractionDigits(currency));
  } catch {
    return "";
  }
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

export default async function ReceiptPage({ params }: ReceiptPageProps) {
  await requireAdminSession();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const receipt = await getReceiptRepository().get(id);
  if (!receipt) notFound();

  let categories: CategoryOption[] = [];
  let ledgerProblem: string | null = null;
  if (receipt.status === "needs_review" || receipt.status === "recorded") {
    try {
      categories = (await getReceiptService().categories()).map(({ code, name, group, askFirst }) => ({ code, name, group, askFirst }));
    } catch {
      ledgerProblem = "The ledger's category list couldn't be loaded, so recording and changes are unavailable right now.";
    }
  }
  let sheetLink: string | null = null;
  try {
    const { spreadsheetId } = getLedgerConfig();
    sheetLink = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=0${receipt.sheetRow ? `&range=A${receipt.sheetRow}` : ""}`;
  } catch {
    sheetLink = null;
  }
  const category = categories.find((candidate) => candidate.code === receipt.categoryCode);
  const fileUrl = `/api/receipts/${receipt.id}/file`;
  const isImage = receipt.contentType.startsWith("image/");

  return (
    <>
      <Link href="/receipts" className={buttonStyles({ variant: "quiet", size: "sm", className: "-ml-3 mb-4" })}>
        <ArrowLeft aria-hidden="true" className="size-4" />
        Receipts
      </Link>
      <PageHeader
        eyebrow={`Receipt · uploaded ${formatDateTime(receipt.createdAt)}`}
        title={receipt.ledgerId}
        description={receipt.note ? `Your note: ${receipt.note}` : "No note was added."}
        actions={<ReceiptStatusBadge status={receipt.status} />}
      />

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <Card className="self-start overflow-hidden p-3">
          {isImage ? (
            // Served from this app behind Access; next/image would cache a private file.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt={`Receipt ${receipt.ledgerId}`} className="mx-auto max-h-[42rem] w-auto rounded-xl" />
          ) : (
            <div className="grid place-items-center gap-3 px-6 py-16 text-center">
              <FileText aria-hidden="true" className="size-8 text-accent" />
              <p className="text-sm text-muted">{receipt.fileName}</p>
              <a href={fileUrl} target="_blank" rel="noreferrer" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                Open PDF
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          {receipt.status === "needs_review" && receipt.reviewReasons.length ? (
            <Card tone="quiet" className="border-warning/30 p-5 sm:p-6">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-warning">
                <AlertTriangle aria-hidden="true" className="size-4" />
                Why Clara is asking
              </h2>
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-ink">
                {receipt.reviewReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {receipt.claraNotes ? (
            <Card tone="quiet" className="p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-ink">Clara&apos;s notes</h2>
              <p className="mt-2 text-sm leading-6 whitespace-pre-line text-muted">{receipt.claraNotes}</p>
            </Card>
          ) : null}

          {ledgerProblem ? (
            <p role="status" className="text-sm font-medium text-danger">{ledgerProblem}</p>
          ) : null}

          {receipt.status === "needs_review" && categories.length ? (
            <ReceiptReviewForm
              recordAction={recordReceiptAction.bind(null, receipt.id)}
              discardAction={discardReceiptAction.bind(null, receipt.id)}
              version={receipt.version}
              categories={categories}
              currencies={SUPPORTED_CURRENCIES}
              values={{
                txnDate: receipt.txnDate ?? "",
                categoryCode: receipt.categoryCode ?? "",
                payee: receipt.payee ?? "",
                amount: amountInput(receipt.amountMinor, receipt.currency),
                currency: receipt.currency && (SUPPORTED_CURRENCIES as readonly string[]).includes(receipt.currency) ? receipt.currency : "IDR",
                paidFrom: receipt.paidFrom ?? "",
                description: receipt.description ?? "",
                reference: receipt.reference ?? "",
              }}
            />
          ) : null}

          {receipt.status !== "needs_review" ? (
            <Card className="p-5 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-ink">In the ledger</h2>
                {sheetLink && receipt.sheetRow ? (
                  <a href={sheetLink} target="_blank" rel="noreferrer" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                    Open row {receipt.sheetRow}
                    <ExternalLink aria-hidden="true" className="size-4" />
                  </a>
                ) : null}
              </div>
              <dl className="mt-5 grid gap-5 sm:grid-cols-2">
                <Detail label="Payment date">{receipt.txnDate ? formatDate(receipt.txnDate) : "—"}</Detail>
                <Detail label="Amount">
                  {receipt.amountMinor !== null && receipt.currency ? formatMinorCurrency(receipt.amountMinor, receipt.currency) : "—"}
                </Detail>
                <Detail label="Paid to">{receipt.payee ?? "—"}</Detail>
                <Detail label="Category">
                  {category ? `${category.code} · ${category.name}` : receipt.categoryCode ?? "—"}
                </Detail>
                <Detail label="Paid from">{receipt.paidFrom ?? "—"}</Detail>
                <Detail label="Reference">{receipt.reference ?? "—"}</Detail>
                <Detail label="Description">{receipt.description ?? "—"}</Detail>
                <Detail label="Recorded">
                  {receipt.recordedAt ? `${formatDateTime(receipt.recordedAt)} by ${receipt.recordedBy}` : "Not recorded"}
                </Detail>
                {receipt.closedAt ? (
                  <Detail label={receipt.status === "undone" ? "Undone" : "Discarded"}>
                    {`${formatDateTime(receipt.closedAt)} by ${receipt.closedBy}`}
                  </Detail>
                ) : null}
              </dl>
            </Card>
          ) : null}

          {receipt.status === "recorded" ? (
            <ReceiptRecordedActions
              changeCategoryAction={changeReceiptCategoryAction.bind(null, receipt.id)}
              undoAction={undoReceiptAction.bind(null, receipt.id)}
              version={receipt.version}
              categories={categories}
              categoryCode={receipt.categoryCode ?? ""}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
