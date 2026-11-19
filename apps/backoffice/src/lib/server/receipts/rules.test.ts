import { describe, expect, it } from "vitest";

import { kindForCategory, parseCategoryRows } from "./categories";
import { decideReceipt, decimalToMinor } from "./decision";
import { normalizeNote, ReceiptInputError, safeFileName, sniffContentType, validateReceiptFile } from "./files";
import {
  amountNumber, appendNote, buildLedgerRow, COLUMN, dateSerial, dateTimeSerial, ledgerIdFor, ledgerToday, rowFromRange,
} from "./ledger";
import type { ReceiptReading } from "./reader";
import { CATEGORIES, reading } from "./test-fixtures";

describe("ledger categories", () => {
  it("reads codes, exact names and the auto / ask-first rule from the sheet", () => {
    expect(CATEGORIES.map((category) => [category.code, category.askFirst])).toEqual([
      ["5100", false], ["6100", false], ["6400", false], ["6900", true], ["8100", true], ["8400", true], ["9999", true],
    ]);
    expect(CATEGORIES[3].ruleNote).toBe("mungkin aset tetap / may be a fixed asset");
    expect(CATEGORIES[1].ruleNote).toBe("PPh 21 oleh akuntan / by accountant");
    expect(CATEGORIES[0].name).toBe("Hosting & infrastruktur cloud / Cloud hosting & infrastructure");
  });

  it("skips malformed rows and treats an unknown rule as ask first", () => {
    const parsed = parseCategoryRows([["12", "Bad"], ["7100", "Bank charges", "Other", "", "Sometimes"], ["7100", "Duplicate"], "nope", null]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ code: "7100", askFirst: true });
    expect(parseCategoryRows(undefined)).toEqual([]);
  });

  it("derives the money direction from the category", () => {
    expect(kindForCategory("8400")).toBe("income");
    expect(kindForCategory("8100")).toBe("transfer");
    expect(kindForCategory("6400")).toBe("expense");
    expect(kindForCategory("8300")).toBe("expense");
  });
});

describe("ledger rows", () => {
  it("writes dates as spreadsheet serials so SUMIFS still sees dates", () => {
    expect(dateSerial("1899-12-31")).toBe(1);
    expect(dateSerial("2026-11-16")).toBe(46342);
    expect(() => dateSerial("2026-02-30")).toThrow(RangeError);
    expect(() => dateSerial("16/11/2026")).toThrow(RangeError);
    // 2026-11-16 03:30 UTC is 10:30 in Jakarta.
    expect(dateTimeSerial(new Date("2026-11-16T03:30:00Z"))).toBeCloseTo(46342 + 10.5 / 24, 6);
  });

  it("builds all fifteen cells in column order with the sheet's exact labels", () => {
    const row = buildLedgerRow({
      ledgerId: "R-20261116-ab12cd", txnDate: "2026-11-16", kind: "expense", categoryName: CATEGORIES[2].name,
      payee: "=IMPORTXML(\"https://outside.example\")", amountMinor: 793100n, currency: "IDR", paidFrom: null,
      description: "Domain", reference: "TRX-1", receiptLink: "R-20261116-ab12cd", status: "recorded",
      recordedBy: "Owner", recordedAt: new Date("2026-11-16T03:30:00Z"), claraNotes: "ok",
    });
    expect(row).toHaveLength(15);
    expect(row[COLUMN.id]).toBe("R-20261116-ab12cd");
    expect(row[COLUMN.date]).toBe(46342);
    expect(row[COLUMN.kind]).toBe("Pengeluaran / Expense");
    expect(row[COLUMN.category]).toBe("Langganan software / Software subscriptions");
    expect(row[COLUMN.amount]).toBe(793100);
    expect(row[COLUMN.status]).toBe("Tercatat / Recorded");
    expect(row[COLUMN.paidFrom]).toBe("");
    // Written with valueInputOption=RAW, so this stays text in the sheet.
    expect(row[COLUMN.payee]).toBe("=IMPORTXML(\"https://outside.example\")");
  });

  it("converts minor units per currency and parses only single ledger rows", () => {
    expect(amountNumber(1250n, "USD")).toBe(12.5);
    expect(amountNumber(1250000n, "IDR")).toBe(1250000);
    expect(rowFromRange("Ledger!A7:O7")).toBe(7);
    expect(rowFromRange("'Ledger'!A12:O12")).toBe(12);
    expect(rowFromRange("Ledger!A7:O8")).toBeNull();
    expect(rowFromRange("Ledger!A1:O1")).toBeNull();
    expect(rowFromRange("Kategori!A7:O7")).toBeNull();
    expect(rowFromRange(undefined)).toBeNull();
  });

  it("derives ledger ids and dates in Jakarta time and keeps notes bounded", () => {
    expect(ledgerIdFor("ab12cd34-0000-4000-8000-000000000000", new Date("2026-11-15T18:00:00Z"))).toBe("R-20261116-ab12cd");
    expect(ledgerToday(new Date("2026-11-30T17:30:00Z"))).toBe("2026-12-01");
    expect(appendNote("", "first")).toBe("first");
    expect(appendNote("first", "second")).toBe("first\nsecond");
    expect(appendNote("x".repeat(2100), "end").length).toBe(2000);
  });
});

describe("receipt files", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const pdf = new TextEncoder().encode("%PDF-1.7\n...");
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0]);

  it("identifies files by their bytes, not their names", () => {
    expect(sniffContentType(png)).toBe("image/png");
    expect(sniffContentType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffContentType(webp)).toBe("image/webp");
    expect(sniffContentType(pdf)).toBe("application/pdf");
    expect(sniffContentType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    const validated = validateReceiptFile("../../etc/passwd.png", pdf);
    expect(validated.contentType).toBe("application/pdf");
    expect(validated.fileName).toBe("etc passwd.pdf");
    expect(validated.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses empty, oversized and unsupported uploads with a plain message", () => {
    expect(() => validateReceiptFile("a.png", new Uint8Array())).toThrow(ReceiptInputError);
    expect(() => validateReceiptFile("a.png", new Uint8Array(5 * 1024 * 1024 + 1).fill(0xff))).toThrow(/5 MB/);
    expect(() => validateReceiptFile("a.html", new TextEncoder().encode("<html>"))).toThrow(/PNG, JPEG, WebP/);
    expect(safeFileName("   ", "png")).toBe("receipt.png");
    expect(normalizeNote("  lunch \r\n with client ")).toBe("lunch \n with client");
    expect(normalizeNote("   ")).toBeNull();
    expect(() => normalizeNote("x".repeat(1001))).toThrow(ReceiptInputError);
  });
});

describe("record or ask", () => {
  const today = "2026-11-20";
  const decide = (overrides: Partial<ReceiptReading> = {}, duplicates: Parameters<typeof decideReceipt>[0]["duplicates"] = []) =>
    decideReceipt({ reading: reading(overrides), readingError: null, categories: CATEGORIES, duplicates, today });

  it("records a clear, paid, auto-category Rupiah receipt with no duplicates", () => {
    const decision = decide();
    expect(decision).toMatchObject({ autoRecord: true, reasons: [] });
    expect(decision.proposal).toMatchObject({ amountMinor: 793100n, kind: "expense", categoryCode: "6400", txnDate: "2026-11-16" });
  });

  it.each([
    [{ categoryCode: "6900" }, /ask-first category \(mungkin aset tetap/],
    [{ categoryCode: "8400" }, /Pemasukan \/ Income received is an ask-first/],
    [{ isPaymentProof: false, documentKind: "unpaid_bill" as const }, /not a proof of payment/],
    [{ confidence: "medium" as const }, /wasn't fully confident/],
    [{ uncertain: ["payee" as const], confidence: "medium" as const }, /Check the payee/],
    [{ amount: null }, /Missing or unreadable: amount/],
    [{ currency: "USD", amount: "12.50" }, /Paid in USD/],
    [{ date: "2026-12-01" }, /in the future/],
    [{ categoryCode: "1234" }, /isn't in the ledger's category list/],
  ])("asks first for %o", (overrides, reason) => {
    const decision = decide(overrides);
    expect(decision.autoRecord).toBe(false);
    expect(decision.reasons.join(" ")).toMatch(reason);
  });

  it("asks first about duplicates of the same file or the same payment", () => {
    const decision = decide({}, [{ ledgerId: "R-20261101-aaaaaa", reason: "same_file" }, { ledgerId: "R-20261102-bbbbbb", reason: "same_payment" }]);
    expect(decision.autoRecord).toBe(false);
    expect(decision.reasons).toEqual([
      "The same file was already uploaded as R-20261101-aaaaaa.",
      "R-20261102-bbbbbb has the same amount and date. Check it isn't the same payment.",
    ]);
  });

  it("keeps an unreadable or unbudgeted receipt for manual entry", () => {
    for (const [code, message] of [["budget_reached", /budget is used up/], ["rejected_401_invalid_api_key", /receipts key/], ["timeout", /couldn't read this file/]] as const) {
      const decision = decideReceipt({ reading: null, readingError: code, categories: CATEGORIES, duplicates: [], today });
      expect(decision.autoRecord).toBe(false);
      expect(decision.reasons[0]).toMatch(message);
      expect(decision.proposal.amountMinor).toBeNull();
    }
  });

  it("converts decimal amounts exactly and refuses what a currency cannot hold", () => {
    expect(decimalToMinor("1250000", "IDR")).toBe(1250000n);
    expect(decimalToMinor("12.5", "USD")).toBe(1250n);
    expect(decimalToMinor("12.505", "USD")).toBeNull();
    expect(decimalToMinor("1250000.00", "IDR")).toBe(1250000n);
    expect(decimalToMinor("1.250.000", "IDR")).toBeNull();
    expect(decimalToMinor("0", "IDR")).toBeNull();
    expect(decimalToMinor("10", "JPY")).toBeNull();
  });
});
