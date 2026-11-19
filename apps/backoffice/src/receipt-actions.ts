"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { DomainError } from "@/lib/server/db";
import { ReceiptsConfigurationError } from "@/lib/server/receipts/config";
import { MAX_RECEIPT_BYTES, ReceiptInputError } from "@/lib/server/receipts/files";
import { LedgerUnavailableError } from "@/lib/server/receipts/google";
import { getReceiptService, SUPPORTED_CURRENCIES, type ReviewedValues } from "@/lib/server/receipts/service";
import { AuthorizationError, getAccessScope, requireAdmin, type SessionUser } from "@/lib/server/session";

export interface ReceiptFormState {
  error: string | null;
}

const Uuid = z.string().uuid();
const Version = z.coerce.number().int().min(1);
const CategoryCode = z.string().regex(/^\d{4}$/, "Choose a category.");
const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the payment date.")
  .refine((value) => new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, "The payment date is invalid.");
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).transform((value) => value || null);

/** Receipts move money in the books, so every action is admin-only, checked here again. */
async function admin(): Promise<SessionUser> {
  const scope = await getAccessScope();
  requireAdmin(scope.user);
  return scope.user;
}

function ledgerMessage(code: string): string {
  if (code.startsWith("service_account")) {
    return "The Google service account key file can't be read. Check GOOGLE_SERVICE_ACCOUNT_FILE.";
  }
  if (/_http_40[134]$/.test(code) || code === "token_invalid") {
    return "Google refused access to the ledger. Share the spreadsheet with the service account's email as Editor.";
  }
  return "Couldn't reach the ledger spreadsheet. Try again in a minute.";
}

function friendly(error: unknown): ReceiptFormState {
  if (
    error instanceof ReceiptInputError ||
    error instanceof ReceiptsConfigurationError ||
    error instanceof DomainError ||
    error instanceof AuthorizationError
  ) {
    return { error: error.message };
  }
  if (error instanceof LedgerUnavailableError) return { error: ledgerMessage(error.code) };
  if (error instanceof z.ZodError) return { error: error.issues[0]?.message ?? "Check the highlighted details." };
  // Only the error class is logged: receipt details and credentials stay out of logs.
  console.error("Receipt action failed:", error instanceof Error ? error.name : typeof error);
  return { error: "Something went wrong. Check the receipt list and the ledger before trying again." };
}

function done(id: string): never {
  revalidatePath("/receipts");
  revalidatePath(`/receipts/${id}`);
  redirect(`/receipts/${id}`);
}

export async function uploadReceiptAction(_state: ReceiptFormState, formData: FormData): Promise<ReceiptFormState> {
  let id: string;
  try {
    const user = await admin();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose a screenshot or PDF of the receipt." };
    if (file.size > MAX_RECEIPT_BYTES) {
      return { error: "The file is larger than 5 MB. Crop the screenshot or export a smaller PDF." };
    }
    id = await getReceiptService().intake(user, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, formData.get("note"));
  } catch (error) {
    return friendly(error);
  }
  done(id);
}

function reviewedValues(formData: FormData): ReviewedValues {
  return z
    .object({
      txnDate: CalendarDate,
      categoryCode: CategoryCode,
      payee: z.string().trim().min(1, "Enter who was paid.").max(200),
      amount: z.string().trim().min(1, "Enter the amount."),
      currency: z.enum(SUPPORTED_CURRENCIES),
      paidFrom: optionalText(120),
      description: optionalText(500),
      reference: optionalText(120),
    })
    .parse({
      txnDate: formData.get("txn_date"),
      categoryCode: formData.get("category_code"),
      payee: formData.get("payee"),
      // Spaces only: "1.250.000" or "12,50" are refused with a hint instead of guessed.
      amount: String(formData.get("amount") ?? "").replace(/\s/g, ""),
      currency: formData.get("currency"),
      paidFrom: formData.get("paid_from") ?? "",
      description: formData.get("description") ?? "",
      reference: formData.get("reference") ?? "",
    });
}

export async function recordReceiptAction(id: string, _state: ReceiptFormState, formData: FormData): Promise<ReceiptFormState> {
  try {
    const user = await admin();
    await getReceiptService().record(user, Uuid.parse(id), Version.parse(formData.get("version")), reviewedValues(formData));
  } catch (error) {
    return friendly(error);
  }
  done(id);
}

export async function discardReceiptAction(id: string, _state: ReceiptFormState, formData: FormData): Promise<ReceiptFormState> {
  try {
    const user = await admin();
    await getReceiptService().discard(user, Uuid.parse(id), Version.parse(formData.get("version")));
  } catch (error) {
    return friendly(error);
  }
  done(id);
}

export async function undoReceiptAction(id: string, _state: ReceiptFormState, formData: FormData): Promise<ReceiptFormState> {
  try {
    const user = await admin();
    await getReceiptService().undo(user, Uuid.parse(id), Version.parse(formData.get("version")));
  } catch (error) {
    return friendly(error);
  }
  done(id);
}

export async function changeReceiptCategoryAction(id: string, _state: ReceiptFormState, formData: FormData): Promise<ReceiptFormState> {
  try {
    const user = await admin();
    await getReceiptService().changeCategory(
      user, Uuid.parse(id), Version.parse(formData.get("version")), CategoryCode.parse(formData.get("category_code")),
    );
  } catch (error) {
    return friendly(error);
  }
  done(id);
}
