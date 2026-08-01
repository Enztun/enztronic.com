import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { minorUnitsToDecimal } from "@/lib/money";
import type { AuditActor } from "@/lib/server/db";
import { getEmailEnv } from "@/lib/env";
import { sendInvoiceEmail } from "@/lib/server/email";
import {
  queueInvoiceEmail,
  recordInvoicePdf,
  updateInvoiceEmailStatus,
  type InvoiceDetail,
  type InvoiceEmailRecord,
} from "@/lib/server/invoices";
import { renderInvoicePdf, type InvoicePdfInput } from "@/lib/server/pdf";
import { putPrivateObject } from "@/lib/server/r2";

const OptionalText = z.string().trim().max(10_000).nullish();
const Address = z.record(z.string(), z.unknown()).default({});
const SnapshotSchema = z.object({
  seller: z.object({
    businessName: z.string().trim().min(1).max(160),
    legalName: OptionalText,
    email: OptionalText,
    phone: OptionalText,
    taxId: OptionalText,
    billingAddress: Address,
    paymentInstructions: OptionalText,
  }),
  client: z.object({
    name: z.string().trim().min(1).max(160),
    companyName: OptionalText,
    email: z.string().trim().email().max(254),
    phone: OptionalText,
    taxId: OptionalText,
    billingAddress: Address,
  }),
  invoice: z.object({
    invoiceNumber: z.string().trim().min(1).max(80),
    currency: z.string().regex(/^[A-Z]{3}$/),
    currencyFractionDigits: z.number().int().min(0).max(4),
    issueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: OptionalText,
    terms: OptionalText,
    items: z
      .array(
        z.object({
          description: z.string().trim().min(1).max(500),
          quantity: z.string().trim().min(1).max(32),
          unitPriceMinor: z.string().regex(/^\d+$/),
          subtotalMinor: z.string().regex(/^\d+$/),
        }),
      )
      .min(1)
      .max(100),
    totals: z.object({
      subtotalMinor: z.string().regex(/^\d+$/),
      discountMinor: z.string().regex(/^\d+$/),
      taxMinor: z.string().regex(/^\d+$/),
      totalMinor: z.string().regex(/^\d+$/),
    }),
  }),
});

export interface GeneratedInvoicePdf {
  buffer: Buffer;
  filename: string;
  contentSha256: string;
  storedInR2: boolean;
  storageKey: string | null;
}

export interface InvoiceDeliveryResult {
  email: InvoiceEmailRecord;
  alreadySent: boolean;
}

function addressText(address: Record<string, unknown>, key: string): string | null {
  const value = address[key];
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 180) : null;
}

function addressLines(address: Record<string, unknown>): string[] {
  const formatted = addressText(address, "formatted");
  if (formatted) {
    return formatted
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  const locality = [
    addressText(address, "city"),
    addressText(address, "province"),
    addressText(address, "postalCode"),
  ]
    .filter((value): value is string => Boolean(value))
    .join(", ");
  return [
    addressText(address, "line1"),
    addressText(address, "line2"),
    locality || null,
    addressText(address, "country"),
  ].filter((value): value is string => Boolean(value));
}

function snapshot(invoice: InvoiceDetail) {
  if (!invoice.snapshot) throw new Error("Finalized invoice snapshot is missing");
  return {
    record: invoice.snapshot,
    payload: SnapshotSchema.parse(invoice.snapshot.payload),
  };
}

export function invoicePdfInput(invoice: InvoiceDetail): InvoicePdfInput {
  const { payload } = snapshot(invoice);
  const fractionDigits = payload.invoice.currencyFractionDigits;
  const decimal = (value: string | bigint) =>
    minorUnitsToDecimal(value, fractionDigits);

  return {
    invoiceNumber: payload.invoice.invoiceNumber,
    currency: payload.invoice.currency,
    currencyFractionDigits: fractionDigits,
    issueDate: payload.invoice.issueOn,
    dueDate: payload.invoice.dueOn,
    company: {
      name: payload.seller.legalName || payload.seller.businessName,
      addressLines: addressLines(payload.seller.billingAddress),
      email: payload.seller.email || undefined,
      phone: payload.seller.phone || undefined,
      taxId: payload.seller.taxId || undefined,
    },
    client: {
      name: payload.client.companyName || payload.client.name,
      addressLines: addressLines(payload.client.billingAddress),
      email: payload.client.email,
      phone: payload.client.phone || undefined,
      taxId: payload.client.taxId || undefined,
    },
    items: payload.invoice.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: decimal(item.unitPriceMinor),
      lineTotal: decimal(item.subtotalMinor),
    })),
    subtotalAmount: decimal(payload.invoice.totals.subtotalMinor),
    taxAmount: decimal(payload.invoice.totals.taxMinor),
    discountAmount: decimal(payload.invoice.totals.discountMinor),
    totalAmount: decimal(payload.invoice.totals.totalMinor),
    amountPaid: decimal(0n),
    notes: payload.invoice.notes || undefined,
    paymentInstructions: payload.seller.paymentInstructions || payload.invoice.terms || undefined,
  };
}

function optionalIntegration(
  names: readonly string[],
  label: string,
): boolean {
  const configured = names.map((name) => Boolean(process.env[name]?.trim()));
  if (configured.every(Boolean)) return true;
  if (configured.some(Boolean)) {
    throw new Error(`${label} configuration is incomplete`);
  }
  return false;
}

function r2IsConfigured(): boolean {
  const credentials = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ];
  if (credentials.every((name) => !process.env[name]?.trim())) {
    return false;
  }
  return optionalIntegration(
    [...credentials, "R2_BUCKET_NAME"],
    "R2",
  );
}

export async function generateInvoicePdf(
  invoice: InvoiceDetail,
  actor?: AuditActor,
): Promise<GeneratedInvoicePdf> {
  const { record, payload } = snapshot(invoice);
  const buffer = await renderInvoicePdf(invoicePdfInput(invoice));
  const contentSha256 = createHash("sha256").update(buffer).digest("hex");
  const filename = `${payload.invoice.invoiceNumber}.pdf`;

  if (!r2IsConfigured()) {
    return {
      buffer,
      filename,
      contentSha256,
      storedInR2: false,
      storageKey: null,
    };
  }

  const storageKey = `invoices/${payload.invoice.issueOn.slice(0, 4)}/${filename}`;
  await putPrivateObject({
    key: storageKey,
    body: buffer,
    contentType: "application/pdf",
    contentDisposition: `attachment; filename="${filename}"`,
    metadata: {
      invoice_id: invoice.id,
      snapshot_id: record.id,
      sha256: contentSha256,
    },
  });
  await recordInvoicePdf(
    {
      invoiceId: invoice.id,
      snapshotId: record.id,
      storageKey,
      byteSize: BigInt(buffer.byteLength),
      contentSha256,
      contentType: "application/pdf",
      templateVersion: record.templateVersion,
    },
    actor,
  );

  return {
    buffer,
    filename,
    contentSha256,
    storedInR2: true,
    storageKey,
  };
}

export async function deliverInvoiceEmail(
  invoice: InvoiceDetail,
  actor?: AuditActor,
): Promise<InvoiceDeliveryResult> {
  getEmailEnv();
  const { record, payload } = snapshot(invoice);
  let email = await queueInvoiceEmail(
    {
      invoiceId: invoice.id,
      purpose: "invoice",
      recipient: invoice.clientEmail,
      idempotencyKey: `invoice:${record.id}:manual`,
    },
    actor,
  );

  if (email.status === "sent" || email.status === "delivered") {
    return { email, alreadySent: true };
  }
  if (email.status === "failed" || email.status === "bounced" || email.status === "cancelled") {
    email = await queueInvoiceEmail(
      {
        invoiceId: invoice.id,
        purpose: "invoice",
        recipient: invoice.clientEmail,
        idempotencyKey: `invoice:${record.id}:retry:${randomUUID()}`,
      },
      actor,
    );
  }

  if (email.status === "queued") {
    email = await updateInvoiceEmailStatus(email.id, "sending", {}, actor);
  }

  try {
    const pdf = await generateInvoicePdf(invoice, actor);
    const totalAmount = minorUnitsToDecimal(
      payload.invoice.totals.totalMinor,
      payload.invoice.currencyFractionDigits,
    );
    const sent = await sendInvoiceEmail({
      idempotencyKey: `resend:${email.id}`,
      to: email.recipient,
      companyName: payload.seller.businessName,
      clientName: payload.client.companyName || payload.client.name,
      invoiceNumber: payload.invoice.invoiceNumber,
      issueDate: payload.invoice.issueOn,
      dueDate: payload.invoice.dueOn,
      totalAmount,
      currency: payload.invoice.currency,
      attachment: { filename: pdf.filename, content: pdf.buffer },
    });
    const updated = await updateInvoiceEmailStatus(
      email.id,
      "sent",
      {
        provider: "resend",
        providerMessageId: sent.messageId,
      },
      actor,
    );
    return { email: updated, alreadySent: false };
  } catch (error) {
    try {
      await updateInvoiceEmailStatus(
        email.id,
        "failed",
        { errorCode: "delivery_failed" },
        actor,
      );
    } catch {
      // Preserve the original sanitized delivery failure.
    }
    throw new Error("Invoice email could not be delivered", { cause: error });
  }
}
