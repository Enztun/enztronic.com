"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  currencyFractionDigits,
  parseMinorUnits,
} from "@/lib/money";
import { authenticateAccessHeaders } from "@/lib/server/auth";
import {
  updateBusinessProfile,
  type BusinessProfileInput,
} from "@/lib/server/business";
import { createClient, updateClient, type ClientInput } from "@/lib/server/clients";
import type { AuditActor } from "@/lib/server/db";
import { deliverInvoiceEmail } from "@/lib/server/invoice-delivery";
import {
  createDraftInvoice,
  finalizeInvoice,
  getInvoice,
  recordPayment,
  updateDraftInvoice,
  voidInvoice,
  type InvoiceDraftInput,
  type InvoiceItemInput,
} from "@/lib/server/invoices";

const Uuid = z.string().uuid();
const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date is invalid");
const Currency = z.enum(["IDR", "USD", "SGD", "EUR"]);

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string") throw new Error(`${name} is required`);
  return value;
}

function optionalFormString(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function positiveVersion(formData: FormData): number {
  const value = Number(formString(formData, "version"));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Record version is invalid");
  }
  return value;
}

async function ownerActor(): Promise<AuditActor> {
  const identity = await authenticateAccessHeaders(await headers());
  return { type: "owner", id: identity.email };
}

function decimalAmountToMinor(value: string, currency: string): bigint {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(normalized)) {
    throw new Error("Amount is invalid");
  }

  const fractionDigits = currencyFractionDigits(currency);
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > fractionDigits && /[1-9]/.test(fraction.slice(fractionDigits))) {
    throw new Error(`${currency} supports at most ${fractionDigits} decimal places`);
  }
  const normalizedFraction = fraction.slice(0, fractionDigits).padEnd(fractionDigits, "0");
  const minor =
    BigInt(whole) * 10n ** BigInt(fractionDigits) +
    BigInt(normalizedFraction || "0");
  return parseMinorUnits(minor, "Amount");
}

function taxPercentToBasisPoints(value: string): number {
  const normalized = value.trim() || "0";
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Tax percentage is invalid");
  }
  const [whole, fraction = ""] = normalized.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(basisPoints) || basisPoints > 10_000) {
    throw new Error("Tax percentage must be between 0 and 100");
  }
  return basisPoints;
}

function clientInput(formData: FormData): ClientInput {
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(160),
      companyName: z.string().trim().max(160).nullable(),
      email: z.string().trim().email().max(254),
      phone: z.string().trim().max(50).nullable(),
      taxId: z.string().trim().max(80).nullable(),
      line1: z.string().trim().max(200).nullable(),
      line2: z.string().trim().max(200).nullable(),
      city: z.string().trim().max(120).nullable(),
      province: z.string().trim().max(120).nullable(),
      postalCode: z.string().trim().max(24).nullable(),
      country: z.string().trim().max(80).nullable(),
    })
    .parse({
      name: formString(formData, "display_name"),
      companyName: optionalFormString(formData, "legal_name"),
      email: formString(formData, "email"),
      phone: optionalFormString(formData, "phone"),
      taxId: optionalFormString(formData, "tax_id"),
      line1: optionalFormString(formData, "address_line1"),
      line2: optionalFormString(formData, "address_line2"),
      city: optionalFormString(formData, "city"),
      province: optionalFormString(formData, "province"),
      postalCode: optionalFormString(formData, "postal_code"),
      country: optionalFormString(formData, "country"),
    });

  return {
    name: parsed.name,
    companyName: parsed.companyName,
    email: parsed.email,
    phone: parsed.phone,
    taxId: parsed.taxId,
    defaultCurrency: "IDR",
    billingAddress: {
      line1: parsed.line1 ?? undefined,
      line2: parsed.line2 ?? undefined,
      city: parsed.city ?? undefined,
      province: parsed.province ?? undefined,
      postalCode: parsed.postalCode ?? undefined,
      country: parsed.country ?? undefined,
    },
  };
}

function invoiceItems(formData: FormData, currency: string): InvoiceItemInput[] {
  const descriptions = formData.getAll("item_description[]");
  const quantities = formData.getAll("item_quantity[]");
  const prices = formData.getAll("item_unit_price[]");
  const taxes = formData.getAll("item_tax_percent[]");
  const count = descriptions.length;

  if (
    count < 1 ||
    count > 100 ||
    quantities.length !== count ||
    prices.length !== count ||
    taxes.length !== count
  ) {
    throw new Error("Invoice line items are invalid");
  }

  return descriptions.map((description, index) => {
    const quantity = quantities[index];
    const price = prices[index];
    const tax = taxes[index];
    if (
      typeof description !== "string" ||
      typeof quantity !== "string" ||
      typeof price !== "string" ||
      typeof tax !== "string"
    ) {
      throw new Error("Invoice line item is invalid");
    }
    return {
      description: z.string().trim().min(1).max(500).parse(description),
      quantity: z
        .string()
        .trim()
        .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/)
        .refine((value) => Number(value) > 0)
        .parse(quantity),
      unitPriceMinor: decimalAmountToMinor(price, currency),
      discountMinor: 0n,
      taxRateBps: taxPercentToBasisPoints(tax),
    };
  });
}

function invoiceInput(formData: FormData): InvoiceDraftInput {
  const currency = Currency.parse(formString(formData, "currency").toUpperCase());
  const issueOn = CalendarDate.parse(formString(formData, "issue_on"));
  const dueOn = CalendarDate.parse(formString(formData, "due_on"));
  if (dueOn < issueOn) throw new Error("Due date cannot be before issue date");

  return {
    clientId: Uuid.parse(formString(formData, "client_id")),
    currency,
    issueOn,
    dueOn,
    notes: z.string().trim().max(10_000).nullable().parse(optionalFormString(formData, "notes")),
    terms: z.string().trim().max(10_000).nullable().parse(optionalFormString(formData, "terms")),
    items: invoiceItems(formData, currency),
  };
}

function businessInput(formData: FormData): {
  input: BusinessProfileInput;
  version: number;
} {
  const emailReplyTo = optionalFormString(formData, "email_reply_to");
  if (emailReplyTo) z.string().email().max(254).parse(emailReplyTo);
  const timezone = formString(formData, "timezone").trim();
  if (timezone !== "Asia/Jakarta") {
    throw new Error("This release supports the Asia/Jakarta billing timezone");
  }

  const defaultPaymentTermsDays = Number(
    formString(formData, "default_payment_terms_days"),
  );
  if (
    !Number.isSafeInteger(defaultPaymentTermsDays) ||
    defaultPaymentTermsDays < 0 ||
    defaultPaymentTermsDays > 365
  ) {
    throw new Error("Default payment terms must be between 0 and 365 days");
  }

  return {
    version: positiveVersion(formData),
    input: {
      businessName: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .parse(formString(formData, "business_name")),
      legalName: z.string().trim().max(160).nullable().parse(optionalFormString(formData, "legal_name")),
      email: z.string().trim().email().max(254).parse(formString(formData, "email")),
      phone: z.string().trim().max(80).nullable().parse(optionalFormString(formData, "phone")),
      taxId: z.string().trim().max(80).nullable().parse(optionalFormString(formData, "tax_id")),
      billingAddress: {
        line1: optionalFormString(formData, "address_line1"),
        line2: optionalFormString(formData, "address_line2"),
        city: optionalFormString(formData, "city"),
        province: optionalFormString(formData, "province"),
        postalCode: optionalFormString(formData, "postal_code"),
        country: optionalFormString(formData, "country"),
      },
      defaultCurrency: Currency.parse(
        formString(formData, "default_currency").toUpperCase(),
      ),
      invoicePrefix: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z][A-Z0-9-]{1,11}$/)
        .parse(formString(formData, "invoice_prefix")),
      timezone,
      defaultPaymentTermsDays,
      paymentInstructions: z
        .string()
        .trim()
        .max(2_000)
        .nullable()
        .parse(optionalFormString(formData, "payment_instructions")),
      emailFromName: z
        .string()
        .trim()
        .max(120)
        .nullable()
        .parse(optionalFormString(formData, "email_from_name")),
      emailReplyTo,
    },
  };
}

export async function createClientAction(formData: FormData): Promise<void> {
  const actor = await ownerActor();
  const client = await createClient(clientInput(formData), actor);
  revalidatePath("/clients");
  redirect(`/clients/${client.id}/edit`);
}

export async function updateClientAction(
  id: string,
  formData: FormData,
): Promise<void> {
  const actor = await ownerActor();
  const clientId = Uuid.parse(id);
  await updateClient(clientId, clientInput(formData), positiveVersion(formData), actor);
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}/edit`);
  redirect("/clients");
}

export async function createInvoiceAction(formData: FormData): Promise<void> {
  const actor = await ownerActor();
  const invoice = await createDraftInvoice(invoiceInput(formData), actor);
  revalidatePath("/dashboard");
  revalidatePath("/invoices");
  redirect(`/invoices/${invoice.id}`);
}

export async function updateDraftInvoiceAction(
  id: string,
  formData: FormData,
): Promise<void> {
  const actor = await ownerActor();
  const invoiceId = Uuid.parse(id);
  await updateDraftInvoice(
    invoiceId,
    invoiceInput(formData),
    positiveVersion(formData),
    actor,
  );
  revalidatePath("/dashboard");
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}`);
}

export async function finalizeInvoiceAction(
  id: string,
  formData: FormData,
): Promise<void> {
  const actor = await ownerActor();
  const invoiceId = Uuid.parse(id);
  const version = positiveVersion(formData);
  await finalizeInvoice(invoiceId, version, `finalize:${invoiceId}:v${version}`, actor);
  revalidatePath("/dashboard");
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}`);
}

export async function voidInvoiceAction(
  id: string,
  formData: FormData,
): Promise<void> {
  const actor = await ownerActor();
  const invoiceId = Uuid.parse(id);
  const reason = z
    .string()
    .trim()
    .min(3)
    .max(1_000)
    .parse(formString(formData, "reason"));
  await voidInvoice(invoiceId, positiveVersion(formData), reason, actor);
  revalidatePath("/dashboard");
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}`);
}

export async function recordPaymentAction(
  id: string,
  formData: FormData,
): Promise<void> {
  const actor = await ownerActor();
  const invoiceId = Uuid.parse(id);
  const currency = Currency.parse(formString(formData, "currency").toUpperCase());
  const paidOn = CalendarDate.parse(formString(formData, "paid_on"));
  const version = positiveVersion(formData);
  await recordPayment(
    {
      invoiceId,
      amountMinor: decimalAmountToMinor(formString(formData, "amount"), currency),
      currency,
      paidAt: new Date(`${paidOn}T12:00:00+07:00`).toISOString(),
      method: "Bank transfer",
      externalReference: z
        .string()
        .trim()
        .max(200)
        .nullable()
        .parse(optionalFormString(formData, "reference")),
      idempotencyKey: `payment:${invoiceId}:v${version}`,
    },
    actor,
  );
  revalidatePath("/dashboard");
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}`);
}

export async function emailInvoiceAction(
  id: string,
  _formData: FormData,
): Promise<void> {
  void _formData;
  const actor = await ownerActor();
  const invoiceId = Uuid.parse(id);
  const invoice = await getInvoice(invoiceId);
  if (!invoice || invoice.status === "draft" || invoice.status === "void") {
    throw new Error("Only a finalized active invoice can be emailed");
  }
  await deliverInvoiceEmail(invoice, actor);
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/invoices/${invoiceId}`);
}

export async function saveSettingsAction(formData: FormData): Promise<void> {
  const actor = await ownerActor();
  const { input, version } = businessInput(formData);
  await updateBusinessProfile(input, version, actor);
  revalidatePath("/settings");
  redirect("/settings");
}
