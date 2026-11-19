import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DomainError } from "@/lib/server/db";
import type { SessionUser } from "@/lib/server/session";

import type { ReceiptsConfig } from "./config";
import { decideReceipt } from "./decision";
import type { SheetsClient } from "./google";
import { COLUMN, LEDGER_COLUMNS, type LedgerCell } from "./ledger";
import type { ReadOutcome, ReceiptReading } from "./reader";
import type { ReceiptRecord, ReceiptRepository } from "./repository";
import { createReceiptService } from "./service";
import { CATEGORIES, FAKE_OPENAI_KEY, reading } from "./test-fixtures";

const owner: SessionUser = { id: "u1", email: "owner@example.test", name: "Owner", role: "admin", commissionRateBps: 0 };
const config: ReceiptsConfig = {
  openaiApiKey: FAKE_OPENAI_KEY, model: "gpt-6-luna", reasoningEffort: "low",
  monthlyBudgetMicrounits: 5_000_000, serviceAccountFile: "C:/private/key.json", spreadsheetId: "1AbCdEfGhIjKlMnOpQrStUvWxYz", publicBaseUrl: null,
};
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const otherPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

/** The ledger sheet as rows of cells; row 1 is the header. */
class FakeSheet implements SheetsClient {
  rows: LedgerCell[][] = [["ID"]];
  failAppend = false;
  appended = 0;
  async categories() { return CATEGORIES; }
  async findLedgerRow(ledgerId: string, hint?: number | null) {
    if (hint && this.rows[hint - 1]?.[0] === ledgerId) return { row: hint, values: this.rows[hint - 1].map(String) };
    const index = this.rows.findIndex((row) => row[0] === ledgerId);
    return index >= 1 ? { row: index + 1, values: this.rows[index].map(String) } : null;
  }
  async appendLedgerRow(cells: LedgerCell[]) {
    if (cells.length !== LEDGER_COLUMNS) throw new Error("bad row");
    if (this.failAppend) throw new Error("ledger down");
    this.appended += 1;
    this.rows.push([...cells]);
    return this.rows.length;
  }
  async updateLedgerCells(row: number, cells: Partial<Record<number, LedgerCell>>) {
    for (const [column, value] of Object.entries(cells)) this.rows[row - 1][Number(column)] = value!;
  }
  cell(ledgerId: string, column: number) {
    return this.rows.find((row) => row[0] === ledgerId)?.[column];
  }
}

/** Mirrors the repository's state rules closely enough to test the service's ordering. */
function fakeRepository() {
  const receipts = new Map<string, ReceiptRecord>();
  const events: string[] = [];
  const bump = (record: ReceiptRecord, changes: Partial<ReceiptRecord>) => receipts.set(record.id, { ...record, ...changes, version: record.version + 1 });
  const repository = {
    events,
    receipts,
    charged: 0,
    async get(id: string) { return receipts.get(id) ?? null; },
    async list() { return [...receipts.values()]; },
    async insert(receipt: Record<string, unknown>) {
      const record = {
        ...receipt, status: "needs_review", reading: null, readingError: null, reviewReasons: ["Clara is still reading this receipt."],
        txnDate: null, kind: null, categoryCode: null, payee: null, amountMinor: null, currency: null, paidFrom: null,
        description: null, reference: null, claraNotes: null, sheetRow: null, model: null, chargedMicrounits: 0,
        recordedBy: null, recordedAt: null, closedBy: null, closedAt: null, version: 1, createdAt: new Date().toISOString(),
      } as unknown as ReceiptRecord;
      receipts.set(record.id, record);
      events.push("receipt.uploaded");
      return record;
    },
    async chargedThisMonth() { return this.charged; },
    async duplicates(input: { id: string; sha256: string; amountMinor: bigint | null; currency: string | null; txnDate: string | null }) {
      const hints = [];
      for (const other of receipts.values()) {
        if (other.id === input.id || other.status === "discarded") continue;
        if (other.fileSha256 === input.sha256) hints.push({ ledgerId: other.ledgerId, reason: "same_file" as const });
        else if (other.status === "recorded" && other.amountMinor === input.amountMinor && other.txnDate === input.txnDate) {
          hints.push({ ledgerId: other.ledgerId, reason: "same_payment" as const });
        }
      }
      return hints;
    },
    async saveReading(id: string, input: { reading: ReceiptReading | null; readingError: string | null; reasons: string[]; proposal: Record<string, unknown>; chargedMicrounits: number }) {
      const record = receipts.get(id)!;
      bump(record, { ...input.proposal, reading: input.reading, readingError: input.readingError, reviewReasons: input.reasons, chargedMicrounits: record.chargedMicrounits + input.chargedMicrounits });
      this.charged += input.chargedMicrounits;
      return receipts.get(id)!;
    },
    async flagForReview(id: string, reason: string) {
      const record = receipts.get(id)!;
      if (record.status === "needs_review") bump(record, { reviewReasons: [...record.reviewReasons, reason] });
    },
    async withLock<T>(id: string, version: number, work: (receipt: ReceiptRecord, transaction: unknown) => Promise<T>) {
      const record = receipts.get(id);
      if (!record) throw new DomainError("NOT_FOUND", "Receipt not found");
      if (record.version !== version) throw new DomainError("CONFLICT", "changed");
      return work(record, {});
    },
    async markRecorded(_tx: unknown, receipt: ReceiptRecord, values: Record<string, unknown>, _actor: unknown, automatic: boolean) {
      bump(receipts.get(receipt.id)!, { ...values, status: "recorded", reviewReasons: [], recordedAt: (values.recordedAt as Date).toISOString() } as Partial<ReceiptRecord>);
      events.push(automatic ? "receipt.recorded_automatically" : "receipt.recorded");
    },
    async markClosed(_tx: unknown, receipt: ReceiptRecord, status: "undone" | "discarded", closedBy: string, _actor: unknown, row: number | null) {
      bump(receipts.get(receipt.id)!, { status, closedBy, closedAt: new Date().toISOString(), sheetRow: row ?? receipt.sheetRow });
      events.push(`receipt.${status}`);
    },
    async changeCategory(_tx: unknown, receipt: ReceiptRecord, values: Partial<ReceiptRecord>) {
      bump(receipts.get(receipt.id)!, values);
      events.push("receipt.category_changed");
    },
  };
  return repository;
}

describe("Clara's receipt intake", () => {
  let sheet: FakeSheet;
  let repository: ReturnType<typeof fakeRepository>;
  let stored: { key: string; contentType: string }[];
  let read: ReturnType<typeof vi.fn<(input: unknown) => Promise<ReadOutcome>>>;
  let ids: string[];

  const service = () => createReceiptService({
    repository: repository as unknown as ReceiptRepository,
    sheets: () => sheet,
    storeFile: async ({ key, contentType }) => { stored.push({ key, contentType }); },
    read,
    config: () => config,
    publicBaseUrl: () => "https://office.example.test",
    now: () => new Date("2026-11-20T03:00:00Z"),
    newId: () => ids.shift()!,
  });
  const answer = (overrides: Partial<ReceiptReading> = {}): ReadOutcome => ({ ok: true, reading: reading(overrides), chargedMicrounits: 1200 });

  beforeEach(() => {
    sheet = new FakeSheet();
    repository = fakeRepository();
    stored = [];
    read = vi.fn(async () => answer());
    ids = ["ab12cd34-0000-4000-8000-000000000001", "cd34ef56-0000-4000-8000-000000000002", "ef56ab78-0000-4000-8000-000000000003"];
  });

  it("records a clear receipt straight away and links back to it", async () => {
    const id = await service().intake(owner, { name: "transfer.png", bytes: png }, "Domain for the website");
    const receipt = repository.receipts.get(id)!;
    expect(receipt.status).toBe("recorded");
    expect(stored).toEqual([{ key: `receipts/2026/11/${id}.png`, contentType: "image/png" }]);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.cell("R-20261120-ab12cd", COLUMN.status)).toBe("Tercatat / Recorded");
    expect(sheet.cell("R-20261120-ab12cd", COLUMN.category)).toBe("Langganan software / Software subscriptions");
    expect(sheet.cell("R-20261120-ab12cd", COLUMN.amount)).toBe(793100);
    expect(sheet.cell("R-20261120-ab12cd", COLUMN.receipt)).toBe(`https://office.example.test/receipts/${id}`);
    expect(sheet.cell("R-20261120-ab12cd", COLUMN.recordedBy)).toBe("Owner");
    expect(repository.events).toEqual(["receipt.uploaded", "receipt.recorded_automatically"]);
    expect(receipt.sheetRow).toBe(2);
  });

  it("holds an ask-first receipt until the owner confirms it", async () => {
    read.mockResolvedValueOnce(answer({ categoryCode: "6900", payee: "Tokopedia", amount: "5686918" }));
    const id = await service().intake(owner, { name: "vga.png", bytes: png }, null);
    const waiting = repository.receipts.get(id)!;
    expect(waiting.status).toBe("needs_review");
    expect(waiting.reviewReasons.join(" ")).toMatch(/ask-first category/);
    expect(sheet.rows).toHaveLength(1);

    await service().record(owner, id, waiting.version, {
      txnDate: "2026-11-16", categoryCode: "6900", payee: "Tokopedia", amount: "5686918", currency: "IDR",
      paidFrom: null, description: "Graphics card", reference: null,
    });
    const recorded = repository.receipts.get(id)!;
    expect(recorded.status).toBe("recorded");
    expect(recorded.claraNotes).toMatch(/Checked and recorded by Owner\.$/);
    expect(sheet.cell("R-20261120-ab12cd", COLUMN.amount)).toBe(5686918);
    expect(repository.events.at(-1)).toBe("receipt.recorded");
  });

  it("refuses an amount it cannot represent instead of guessing", async () => {
    read.mockResolvedValueOnce(answer({ categoryCode: "6900" }));
    const id = await service().intake(owner, { name: "a.png", bytes: png }, null);
    const version = repository.receipts.get(id)!.version;
    await expect(service().record(owner, id, version, {
      txnDate: "2026-11-16", categoryCode: "6900", payee: "Toko", amount: "1.250.000", currency: "IDR", paidFrom: null, description: null, reference: null,
    })).rejects.toThrow(/Enter the amount as a number/);
    expect(sheet.rows).toHaveLength(1);
  });

  it("stops reading when the month's budget would be exceeded", async () => {
    repository.charged = config.monthlyBudgetMicrounits;
    const id = await service().intake(owner, { name: "a.png", bytes: png }, null);
    expect(read).not.toHaveBeenCalled();
    expect(repository.receipts.get(id)!.reviewReasons[0]).toMatch(/budget is used up/);
  });

  it("stores nothing when the ledger cannot be reached", async () => {
    const down = createReceiptService({
      repository: repository as unknown as ReceiptRepository,
      sheets: () => ({ ...sheet, categories: async () => { throw new Error("unreachable"); } }) as unknown as SheetsClient,
      storeFile: async () => { stored.push({ key: "x", contentType: "x" }); },
      read, config: () => config, publicBaseUrl: () => null,
    });
    await expect(down.intake(owner, { name: "a.png", bytes: png }, null)).rejects.toThrow("unreachable");
    expect(stored).toEqual([]);
    expect(repository.receipts.size).toBe(0);
  });

  it("keeps the reading for review when the ledger write fails, and never writes twice on retry", async () => {
    sheet.failAppend = true;
    const id = await service().intake(owner, { name: "a.png", bytes: png }, null);
    const waiting = repository.receipts.get(id)!;
    expect(waiting.status).toBe("needs_review");
    expect(waiting.reviewReasons.at(-1)).toMatch(/couldn't write it to the ledger/);

    // A save whose response was lost: the row reached the sheet, the database never heard.
    sheet.failAppend = false;
    sheet.rows.push(["R-20261120-ab12cd", "partial"]);
    await service().record(owner, id, waiting.version, {
      txnDate: "2026-11-16", categoryCode: "6400", payee: "PT Jetorbit", amount: "793100", currency: "IDR",
      paidFrom: null, description: null, reference: null,
    });
    expect(sheet.rows.filter((row) => row[0] === "R-20261120-ab12cd")).toHaveLength(1);
    expect(sheet.appended).toBe(0);
    expect(sheet.cell("R-20261120-ab12cd", COLUMN.status)).toBe("Tercatat / Recorded");
  });

  it("undoes by marking the row, even after the owner sorted the sheet", async () => {
    const id = await service().intake(owner, { name: "a.png", bytes: png }, null);
    sheet.rows.splice(1, 0, ["R-20261101-zzzzzz", "inserted above"]);
    const recorded = repository.receipts.get(id)!;
    await service().undo(owner, id, recorded.version);
    expect(sheet.rows).toHaveLength(3);
    expect(sheet.cell("R-20261120-ab12cd", COLUMN.status)).toBe("Dibatalkan / Undone");
    expect(String(sheet.cell("R-20261120-ab12cd", COLUMN.notes))).toMatch(/Undone by Owner on 2026-11-20\.$/);
    const undone = repository.receipts.get(id)!;
    expect(undone).toMatchObject({ status: "undone", closedBy: "Owner", sheetRow: 3 });
    await expect(service().undo(owner, id, undone.version)).rejects.toThrow(/Only recorded receipts/);
    await expect(service().undo(owner, id, recorded.version)).rejects.toThrow(DomainError);
  });

  it("changes the category and the money direction in the sheet", async () => {
    const id = await service().intake(owner, { name: "a.png", bytes: png }, null);
    await service().changeCategory(owner, id, repository.receipts.get(id)!.version, "8400");
    expect(sheet.cell("R-20261120-ab12cd", COLUMN.category)).toBe("Pemasukan / Income received");
    expect(sheet.cell("R-20261120-ab12cd", COLUMN.kind)).toBe("Pemasukan / Income");
    expect(String(sheet.cell("R-20261120-ab12cd", COLUMN.notes))).toMatch(/Category changed from 6400 to 8400 by Owner\.$/);
    expect(repository.receipts.get(id)!).toMatchObject({ categoryCode: "8400", kind: "income" });
    await expect(service().changeCategory(owner, id, repository.receipts.get(id)!.version, "1234")).rejects.toThrow(/category from the ledger's list/);
  });

  it("asks about a second upload of the same file or the same payment", async () => {
    await service().intake(owner, { name: "a.png", bytes: png }, null);
    const sameFile = await service().intake(owner, { name: "again.png", bytes: png }, null);
    expect(repository.receipts.get(sameFile)!.reviewReasons.join(" ")).toMatch(/same file was already uploaded as R-20261120-ab12cd/);
    const samePayment = await service().intake(owner, { name: "other.png", bytes: otherPng }, null);
    expect(repository.receipts.get(samePayment)!.reviewReasons.join(" ")).toMatch(/R-20261120-ab12cd has the same amount and date/);
  });

  it("discarding repairs a row that a lost response already wrote", async () => {
    read.mockResolvedValueOnce(answer({ categoryCode: "6900" }));
    const id = await service().intake(owner, { name: "a.png", bytes: png }, null);
    sheet.rows.push(["R-20261120-ab12cd", 46342, "", "", "", "", "", "", "", "", "", "Tercatat / Recorded", "", "", ""]);
    await service().discard(owner, id, repository.receipts.get(id)!.version);
    expect(repository.receipts.get(id)!.status).toBe("discarded");
    expect(sheet.cell("R-20261120-ab12cd", COLUMN.status)).toBe("Dibatalkan / Undone");
  });

  it("matches the decision rules exactly", () => {
    expect(decideReceipt({ reading: reading(), readingError: null, categories: CATEGORIES, duplicates: [], today: "2026-11-20" }).autoRecord).toBe(true);
  });
});
