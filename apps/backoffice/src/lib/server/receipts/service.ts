import "server-only";

import { randomUUID } from "node:crypto";

import { DomainError, getDb, type AuditActor } from "@/lib/server/db";
import { putPrivateObject } from "@/lib/server/r2";
import type { SessionUser } from "@/lib/server/session";

import { kindForCategory, type LedgerCategory } from "./categories";
import { getLedgerConfig, getReceiptsConfig, ReceiptsConfigurationError, type ReceiptsConfig } from "./config";
import { decideReceipt, decimalToMinor, LEDGER_CURRENCY } from "./decision";
import { normalizeNote, ReceiptInputError, validateReceiptFile } from "./files";
import { createSheetsClient, loadServiceAccount, type SheetsClient } from "./google";
import {
  appendNote, buildLedgerRow, COLUMN, KIND_LABELS, ledgerIdFor, ledgerToday, STATUS_LABELS, type LedgerCell,
} from "./ledger";
import { readingReservation, readReceipt, type ReadOutcome, type ReadReceiptInput } from "./reader";
import { createReceiptRepository, type ReceiptRecord, type ReceiptRepository, type ReceiptSql } from "./repository";

export interface ReviewedValues {
  txnDate: string;
  categoryCode: string;
  payee: string;
  amount: string;
  currency: string;
  paidFrom: string | null;
  description: string | null;
  reference: string | null;
}

export interface ReceiptServiceDeps {
  repository: ReceiptRepository;
  sheets: () => SheetsClient;
  storeFile: (input: { key: string; bytes: Uint8Array; contentType: string; fileName: string; ledgerId: string }) => Promise<void>;
  read: (input: ReadReceiptInput) => Promise<ReadOutcome>;
  config: () => ReceiptsConfig;
  publicBaseUrl: () => string | null;
  now?: () => Date;
  newId?: () => string;
}

const CATEGORY_CACHE_MS = 5 * 60 * 1000;
export const SUPPORTED_CURRENCIES = ["IDR", "USD", "SGD", "EUR"] as const;

const actorFor = (user: SessionUser): AuditActor => ({ type: user.role, id: user.email });

export function createReceiptService(deps: ReceiptServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  let categoryCache: { value: LedgerCategory[]; expiresAt: number } | null = null;

  async function categories(): Promise<LedgerCategory[]> {
    if (categoryCache && categoryCache.expiresAt > now().getTime()) return categoryCache.value;
    const value = await deps.sheets().categories();
    categoryCache = { value, expiresAt: now().getTime() + CATEGORY_CACHE_MS };
    return value;
  }

  function receiptLink(receipt: ReceiptRecord): string {
    const base = deps.publicBaseUrl();
    return base ? `${base}/receipts/${receipt.id}` : receipt.ledgerId;
  }

  /** Writes the row (or repairs a row a lost response already wrote), then marks the receipt recorded. */
  async function writeRecorded(
    transaction: ReceiptSql,
    receipt: ReceiptRecord,
    values: Omit<ReviewedValues, "amount"> & { amountMinor: bigint; claraNotes: string | null },
    user: SessionUser,
    automatic: boolean,
  ): Promise<void> {
    const list = await categories();
    const category = list.find((candidate) => candidate.code === values.categoryCode);
    if (!category) throw new ReceiptInputError("Choose a category from the ledger's list.");
    const recordedAt = now();
    const kind = kindForCategory(category.code);
    const cells = buildLedgerRow({
      ledgerId: receipt.ledgerId,
      txnDate: values.txnDate,
      kind,
      categoryName: category.name,
      payee: values.payee,
      amountMinor: values.amountMinor,
      currency: values.currency,
      paidFrom: values.paidFrom,
      description: values.description,
      reference: values.reference,
      receiptLink: receiptLink(receipt),
      status: "recorded",
      recordedBy: user.name,
      recordedAt,
      claraNotes: values.claraNotes,
    });
    const sheets = deps.sheets();
    const existing = await sheets.findLedgerRow(receipt.ledgerId, receipt.sheetRow);
    let row: number;
    if (existing) {
      await sheets.updateLedgerCells(existing.row, Object.fromEntries(cells.map((cell, index) => [index, cell])));
      row = existing.row;
    } else {
      row = await sheets.appendLedgerRow(cells);
    }
    await deps.repository.markRecorded(transaction, receipt, {
      txnDate: values.txnDate, kind, categoryCode: category.code, payee: values.payee,
      amountMinor: values.amountMinor, currency: values.currency, paidFrom: values.paidFrom,
      description: values.description, reference: values.reference, claraNotes: values.claraNotes,
      sheetRow: row, recordedBy: user.name, recordedAt,
    }, actorFor(user), automatic);
  }

  return {
    categories,

    /** Stores the file, lets Clara read it, and records it when everything is clear. Returns the receipt id. */
    async intake(user: SessionUser, file: { name: string; bytes: Uint8Array }, rawNote: unknown): Promise<string> {
      const config = deps.config();
      const validated = validateReceiptFile(file.name, file.bytes);
      const note = normalizeNote(rawNote);
      // Fail before storing anything if the ledger is unreachable or unshared.
      const list = await categories();

      const id = newId();
      const uploadedAt = now();
      const ledgerId = ledgerIdFor(id, uploadedAt);
      const month = ledgerToday(uploadedAt).slice(0, 7).replace("-", "/");
      const fileKey = `receipts/${month}/${id}.${validated.extension}`;
      await deps.storeFile({ key: fileKey, bytes: validated.bytes, contentType: validated.contentType, fileName: validated.fileName, ledgerId });
      const receipt = await deps.repository.insert({
        id, ledgerId, fileKey, fileName: validated.fileName, contentType: validated.contentType,
        fileBytes: validated.bytes.byteLength, fileSha256: validated.sha256, note, uploadedBy: user.email,
      }, actorFor(user));

      const spent = await deps.repository.chargedThisMonth();
      const outcome: ReadOutcome = spent + readingReservation(config.model) > config.monthlyBudgetMicrounits
        ? { ok: false, code: "budget_reached", chargedMicrounits: 0, configuration: false }
        : await deps.read({
            apiKey: config.openaiApiKey, model: config.model, reasoningEffort: config.reasoningEffort,
            ledgerId, bytes: validated.bytes, contentType: validated.contentType, fileName: validated.fileName,
            note, categories: list, today: ledgerToday(uploadedAt),
          });

      const reading = outcome.ok ? outcome.reading : null;
      const amountMinor = reading?.amount && reading.currency ? decimalToMinor(reading.amount, reading.currency) : null;
      const duplicates = await deps.repository.duplicates({
        id, sha256: validated.sha256, amountMinor, currency: reading?.currency ?? null, txnDate: reading?.date ?? null,
      });
      const decision = decideReceipt({
        reading, readingError: outcome.ok ? null : outcome.code, categories: list, duplicates, today: ledgerToday(uploadedAt),
      });
      const saved = await deps.repository.saveReading(receipt.id, {
        reading, readingError: outcome.ok ? null : outcome.code, reasons: decision.reasons,
        proposal: decision.proposal, model: !outcome.ok && outcome.code === "budget_reached" ? null : config.model,
        chargedMicrounits: outcome.chargedMicrounits,
      });

      if (decision.autoRecord) {
        const proposal = decision.proposal;
        try {
          await deps.repository.withLock(saved.id, saved.version, (locked, transaction) => writeRecorded(transaction, locked, {
            txnDate: proposal.txnDate!, categoryCode: proposal.categoryCode!, payee: proposal.payee!,
            amountMinor: proposal.amountMinor!, currency: proposal.currency!, paidFrom: proposal.paidFrom,
            description: proposal.description, reference: proposal.reference, claraNotes: proposal.claraNotes,
          }, user, true));
        } catch {
          // The reading is kept; the owner records it from the review page.
          await deps.repository.flagForReview(saved.id, "Clara read this receipt but couldn't write it to the ledger. Check the details and record it again.");
        }
      }
      return saved.id;
    },

    async record(user: SessionUser, id: string, expectedVersion: number, values: ReviewedValues): Promise<void> {
      const amountMinor = decimalToMinor(values.amount, values.currency);
      if (!amountMinor) throw new ReceiptInputError(`Enter the amount as a number, for example 1250000${values.currency === LEDGER_CURRENCY ? "" : " or 12.50"}.`);
      await deps.repository.withLock(id, expectedVersion, async (receipt, transaction) => {
        if (receipt.status !== "needs_review") throw new DomainError("INVALID_STATE", "This receipt has already been handled.");
        const confirmation = `Checked and recorded by ${user.name}.`;
        await writeRecorded(transaction, receipt, {
          ...values, amountMinor, claraNotes: appendNote(receipt.claraNotes, confirmation),
        }, user, false);
      });
    },

    async discard(user: SessionUser, id: string, expectedVersion: number): Promise<void> {
      await deps.repository.withLock(id, expectedVersion, async (receipt, transaction) => {
        if (receipt.status !== "needs_review") throw new DomainError("INVALID_STATE", "Only receipts waiting for review can be discarded.");
        // A save whose response was lost may still have written a row; never leave it as Recorded.
        let row: number | null = null;
        try {
          const existing = await deps.sheets().findLedgerRow(receipt.ledgerId, receipt.sheetRow);
          if (existing) {
            await deps.sheets().updateLedgerCells(existing.row, {
              [COLUMN.status]: STATUS_LABELS.undone,
              [COLUMN.notes]: appendNote(existing.values[COLUMN.notes], `Discarded by ${user.name} on ${ledgerToday(now())}.`),
            });
            row = existing.row;
          }
        } catch (error) {
          if (!(error instanceof ReceiptsConfigurationError)) throw error;
        }
        await deps.repository.markClosed(transaction, receipt, "discarded", user.name, actorFor(user), row);
      });
    },

    /** Marks the ledger row "Dibatalkan / Undone"; the row itself stays in the sheet. */
    async undo(user: SessionUser, id: string, expectedVersion: number): Promise<{ rowFound: boolean }> {
      return deps.repository.withLock(id, expectedVersion, async (receipt, transaction) => {
        if (receipt.status !== "recorded") throw new DomainError("INVALID_STATE", "Only recorded receipts can be undone.");
        const sheets = deps.sheets();
        const existing = await sheets.findLedgerRow(receipt.ledgerId, receipt.sheetRow);
        if (existing) {
          await sheets.updateLedgerCells(existing.row, {
            [COLUMN.status]: STATUS_LABELS.undone,
            [COLUMN.notes]: appendNote(existing.values[COLUMN.notes], `Undone by ${user.name} on ${ledgerToday(now())}.`),
          });
        }
        await deps.repository.markClosed(transaction, receipt, "undone", user.name, actorFor(user), existing?.row ?? null);
        return { rowFound: Boolean(existing) };
      });
    },

    async changeCategory(user: SessionUser, id: string, expectedVersion: number, categoryCode: string): Promise<void> {
      await deps.repository.withLock(id, expectedVersion, async (receipt, transaction) => {
        if (receipt.status !== "recorded") throw new DomainError("INVALID_STATE", "Only recorded receipts can change category.");
        if (receipt.categoryCode === categoryCode) return;
        const list = await categories();
        const next = list.find((candidate) => candidate.code === categoryCode);
        if (!next) throw new ReceiptInputError("Choose a category from the ledger's list.");
        const previous = list.find((candidate) => candidate.code === receipt.categoryCode);
        const sheets = deps.sheets();
        const existing = await sheets.findLedgerRow(receipt.ledgerId, receipt.sheetRow);
        if (!existing) throw new DomainError("NOT_FOUND", `Row ${receipt.ledgerId} is no longer in the ledger sheet.`);
        const kind = kindForCategory(next.code);
        const change = `Category changed from ${previous?.code ?? receipt.categoryCode} to ${next.code} by ${user.name}.`;
        const cells: Partial<Record<number, LedgerCell>> = {
          [COLUMN.category]: next.name,
          [COLUMN.kind]: KIND_LABELS[kind],
          [COLUMN.notes]: appendNote(existing.values[COLUMN.notes], change),
        };
        await sheets.updateLedgerCells(existing.row, cells);
        await deps.repository.changeCategory(transaction, receipt, {
          categoryCode: next.code, kind, claraNotes: appendNote(receipt.claraNotes, change), sheetRow: existing.row,
        }, actorFor(user));
      });
    },
  };
}

export type ReceiptService = ReturnType<typeof createReceiptService>;

let service: ReceiptService | null = null;
let sheetsClient: { key: string; client: SheetsClient } | null = null;

/** The app's service: real database, R2, OpenAI and Google Sheets. */
export function getReceiptService(): ReceiptService {
  service ??= createReceiptService({
    repository: createReceiptRepository(getDb()),
    sheets: () => {
      const ledger = getLedgerConfig();
      const key = `${ledger.spreadsheetId}:${ledger.serviceAccountFile}`;
      if (sheetsClient?.key !== key) {
        sheetsClient = {
          key,
          client: createSheetsClient({ spreadsheetId: ledger.spreadsheetId, account: () => loadServiceAccount(ledger.serviceAccountFile) }),
        };
      }
      return sheetsClient.client;
    },
    storeFile: async ({ key, bytes, contentType, fileName, ledgerId }) => {
      await putPrivateObject({
        key, body: bytes, contentType,
        contentDisposition: `attachment; filename="${fileName.replace(/[^A-Za-z0-9._ ()-]/g, "_")}"`,
        metadata: { "ledger-id": ledgerId },
      });
    },
    read: readReceipt,
    config: getReceiptsConfig,
    publicBaseUrl: () => {
      try {
        return getLedgerConfig().publicBaseUrl;
      } catch {
        return null;
      }
    },
  });
  return service;
}

export function getReceiptRepository(): ReceiptRepository {
  return createReceiptRepository(getDb());
}
