// Shared fixtures for the receipt tests; not a test file itself.
import { parseCategoryRows, type LedgerCategory } from "./categories";
import type { ReceiptReading } from "./reader";

// Fake credentials, assembled at runtime so secret scanners never see a key-shaped literal.
export const FAKE_OPENAI_KEY = ["sk", "fixture", "x".repeat(24)].join("-");
export const FAKE_ACCESS_TOKEN = ["fixture", "access", "token"].join("-");
export const PEM_HEADER = ["-----BEGIN", "PRIVATE", "KEY-----"].join(" ");

// Rows exactly as the ledger's Kategori tab returns them.
export const SHEET_CATEGORY_ROWS = [
  ["5100", "Hosting & infrastruktur cloud / Cloud hosting & infrastructure", "Beban pokok pendapatan / Cost of revenue", "Vercel, AWS", "Otomatis / Auto"],
  ["6100", "Gaji & tunjangan / Salaries & benefits", "Beban usaha / Operating expenses", "Gaji, THR", "Otomatis / Auto — PPh 21 oleh akuntan / by accountant"],
  ["6400", "Langganan software / Software subscriptions", "Beban usaha / Operating expenses", "SaaS, domain", "Otomatis / Auto"],
  ["6900", "Peralatan & perangkat / Equipment & hardware", "Beban usaha / Operating expenses", "Laptop, monitor", "Tanya dulu / Ask first — mungkin aset tetap / may be a fixed asset"],
  ["8100", "Transfer antar rekening / Internal transfer", "Bukan beban / Not an expense", "", "Tanya dulu / Ask first"],
  ["8400", "Pemasukan / Income received", "Bukan beban / Not an expense", "", "Tanya dulu / Ask first — cocokkan dengan invoice / match to invoice"],
  ["9999", "Lain-lain (perlu dicek) / Other (needs review)", "Perlu dicek / Needs review", "", "Tanya dulu / Ask first"],
];
export const CATEGORIES: LedgerCategory[] = parseCategoryRows(SHEET_CATEGORY_ROWS);

export function reading(overrides: Partial<ReceiptReading> = {}): ReceiptReading {
  return {
    isPaymentProof: true, documentKind: "bank_transfer", date: "2026-11-16", amount: "793100", currency: "IDR",
    payee: "PT Jetorbit", paidFrom: "BCA •••1234", reference: "TRX-75916", description: "Domain renewal",
    categoryCode: "6400", confidence: "high", uncertain: [], notes: "Transfer successful.", ...overrides,
  };
}
