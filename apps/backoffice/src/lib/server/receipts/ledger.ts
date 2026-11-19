// Mapping between a receipt and one row of the ledger's "Ledger" tab (A–O).
// Rows are written with valueInputOption=RAW so text read off a receipt can never
// become a formula; dates are sent as spreadsheet serial numbers so the column's
// date format and the Ringkasan tab's SUMIFS still treat them as dates.

import { currencyFractionDigits, minorUnitsToDecimal } from "@/lib/money";

import type { ReceiptKind } from "./categories";

export const LEDGER_SHEET = "Ledger";
export const CATEGORY_SHEET = "Kategori";
export const LEDGER_COLUMNS = 15; // A..O

export const KIND_LABELS: Record<ReceiptKind, string> = {
  expense: "Pengeluaran / Expense",
  income: "Pemasukan / Income",
  transfer: "Transfer",
};

export const STATUS_LABELS = {
  recorded: "Tercatat / Recorded",
  undone: "Dibatalkan / Undone",
} as const;

/** Zero-based column positions, so cell updates never drift from the row layout. */
export const COLUMN = {
  id: 0, date: 1, kind: 2, category: 3, payee: 4, amount: 5, currency: 6, paidFrom: 7,
  description: 8, reference: 9, receipt: 10, status: 11, recordedBy: 12, recordedAt: 13, notes: 14,
} as const;

export interface LedgerEntry {
  ledgerId: string;
  txnDate: string; // YYYY-MM-DD
  kind: ReceiptKind;
  categoryName: string;
  payee: string;
  amountMinor: bigint;
  currency: string;
  paidFrom: string | null;
  description: string | null;
  reference: string | null;
  receiptLink: string;
  status: keyof typeof STATUS_LABELS;
  recordedBy: string;
  recordedAt: Date;
  claraNotes: string | null;
}

export type LedgerCell = string | number;

const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
/** The ledger's spreadsheet time zone (Asia/Jakarta, UTC+7, no daylight saving). */
const LEDGER_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

export function dateSerial(isoDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new RangeError("Ledger date must be YYYY-MM-DD");
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(time).toISOString().slice(0, 10) !== isoDate) throw new RangeError("Ledger date is invalid");
  return Math.round((time - SERIAL_EPOCH_MS) / DAY_MS);
}

export function dateTimeSerial(moment: Date): number {
  const local = moment.getTime() + LEDGER_UTC_OFFSET_MS;
  // Minute precision is what the column displays; avoid long binary fractions.
  return Math.round(((local - SERIAL_EPOCH_MS) / DAY_MS) * 1440) / 1440;
}

export function amountNumber(amountMinor: bigint, currency: string): number {
  return Number(minorUnitsToDecimal(amountMinor, currencyFractionDigits(currency)));
}

export function buildLedgerRow(entry: LedgerEntry): LedgerCell[] {
  const row: LedgerCell[] = new Array(LEDGER_COLUMNS).fill("");
  row[COLUMN.id] = entry.ledgerId;
  row[COLUMN.date] = dateSerial(entry.txnDate);
  row[COLUMN.kind] = KIND_LABELS[entry.kind];
  row[COLUMN.category] = entry.categoryName;
  row[COLUMN.payee] = entry.payee;
  row[COLUMN.amount] = amountNumber(entry.amountMinor, entry.currency);
  row[COLUMN.currency] = entry.currency;
  row[COLUMN.paidFrom] = entry.paidFrom ?? "";
  row[COLUMN.description] = entry.description ?? "";
  row[COLUMN.reference] = entry.reference ?? "";
  row[COLUMN.receipt] = entry.receiptLink;
  row[COLUMN.status] = STATUS_LABELS[entry.status];
  row[COLUMN.recordedBy] = entry.recordedBy;
  row[COLUMN.recordedAt] = dateTimeSerial(entry.recordedAt);
  row[COLUMN.notes] = entry.claraNotes ?? "";
  return row;
}

/** "Ledger!A7:O7" -> 7. Returns null for anything that is not one ledger row. */
export function rowFromRange(range: unknown): number | null {
  if (typeof range !== "string") return null;
  const match = /^'?Ledger'?!A(\d+)(?::O(\d+))?$/.exec(range);
  if (!match || (match[2] && match[2] !== match[1])) return null;
  const row = Number(match[1]);
  return Number.isSafeInteger(row) && row >= 2 ? row : null;
}

/** A1 column letter for a zero-based column index within A..O. */
export function columnLetter(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= LEDGER_COLUMNS) throw new RangeError("Ledger column is out of range");
  return String.fromCharCode(65 + index);
}

export function appendNote(existing: unknown, addition: string): string {
  const current = typeof existing === "string" ? existing.trim() : "";
  const combined = current ? `${current}\n${addition}` : addition;
  // Sheets cells hold 50,000 characters; keep notes readable and bounded.
  return combined.length > 2000 ? combined.slice(combined.length - 2000) : combined;
}

export function ledgerIdFor(receiptId: string, uploadedAt: Date): string {
  const local = new Date(uploadedAt.getTime() + LEDGER_UTC_OFFSET_MS).toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = receiptId.replaceAll("-", "").slice(0, 6).toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(suffix)) throw new RangeError("Receipt id is invalid");
  return `R-${local}-${suffix}`;
}

/** Today's date in the ledger's time zone, YYYY-MM-DD. */
export function ledgerToday(now = new Date()): string {
  return new Date(now.getTime() + LEDGER_UTC_OFFSET_MS).toISOString().slice(0, 10);
}
