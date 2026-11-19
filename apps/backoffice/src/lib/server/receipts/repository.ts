import "server-only";

import type postgres from "postgres";

import { DomainError, type AuditActor, type DbClient } from "@/lib/server/db";

import type { ReceiptKind } from "./categories";
import type { DuplicateHint, ReceiptProposal } from "./decision";
import type { ReceiptContentType } from "./files";
import type { ReceiptReading } from "./reader";

export type ReceiptStatus = "needs_review" | "recorded" | "undone" | "discarded";

export interface ReceiptRecord {
  id: string;
  ledgerId: string;
  status: ReceiptStatus;
  fileKey: string;
  fileName: string;
  contentType: ReceiptContentType;
  fileBytes: number;
  fileSha256: string;
  note: string | null;
  reading: ReceiptReading | null;
  readingError: string | null;
  reviewReasons: string[];
  txnDate: string | null;
  kind: ReceiptKind | null;
  categoryCode: string | null;
  payee: string | null;
  amountMinor: bigint | null;
  currency: string | null;
  paidFrom: string | null;
  description: string | null;
  reference: string | null;
  claraNotes: string | null;
  sheetRow: number | null;
  model: string | null;
  chargedMicrounits: number;
  uploadedBy: string;
  recordedBy: string | null;
  recordedAt: string | null;
  closedBy: string | null;
  closedAt: string | null;
  version: number;
  createdAt: string;
}

export type ReceiptSql = postgres.Sql | postgres.TransactionSql;
type Sql = ReceiptSql;

type ReceiptRow = {
  id: string; ledger_id: string; status: ReceiptStatus; file_key: string; file_name: string;
  content_type: ReceiptContentType; file_bytes: number | string; file_sha256: string; note: string | null;
  reading: ReceiptReading | null; reading_error: string | null; review_reasons: string[];
  txn_date: string | null; kind: ReceiptKind | null; category_code: string | null; payee: string | null;
  amount_minor: string | null; currency: string | null; paid_from: string | null; description: string | null;
  reference: string | null; clara_notes: string | null; sheet_row: number | null; model: string | null;
  charged_microunits: string | number; uploaded_by: string; recorded_by: string | null;
  recorded_at: Date | null; closed_by: string | null; closed_at: Date | null; version: string | number; created_at: Date;
};

const COLUMNS = `
  id, ledger_id, status, file_key, file_name, content_type, file_bytes, file_sha256, note,
  reading, reading_error, review_reasons, txn_date::text AS txn_date, kind, category_code, payee,
  amount_minor::text AS amount_minor, currency, paid_from, description, reference, clara_notes,
  sheet_row, model, charged_microunits, uploaded_by, recorded_by, recorded_at, closed_by, closed_at,
  version, created_at
`;

function map(row: ReceiptRow): ReceiptRecord {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    status: row.status,
    fileKey: row.file_key,
    fileName: row.file_name,
    contentType: row.content_type,
    fileBytes: Number(row.file_bytes),
    fileSha256: row.file_sha256.trim(),
    note: row.note,
    reading: row.reading,
    readingError: row.reading_error,
    reviewReasons: row.review_reasons ?? [],
    txnDate: row.txn_date,
    kind: row.kind,
    categoryCode: row.category_code,
    payee: row.payee,
    amountMinor: row.amount_minor === null ? null : BigInt(row.amount_minor),
    currency: row.currency,
    paidFrom: row.paid_from,
    description: row.description,
    reference: row.reference,
    claraNotes: row.clara_notes,
    sheetRow: row.sheet_row,
    model: row.model,
    chargedMicrounits: Number(row.charged_microunits),
    uploadedBy: row.uploaded_by,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at ? new Date(row.recorded_at).toISOString() : null,
    closedBy: row.closed_by,
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    version: Number(row.version),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export interface NewReceipt {
  id: string;
  ledgerId: string;
  fileKey: string;
  fileName: string;
  contentType: ReceiptContentType;
  fileBytes: number;
  fileSha256: string;
  note: string | null;
  uploadedBy: string;
}

async function audit(sql: Sql, receiptId: string, actor: AuditActor, eventType: string, details: Record<string, string | number | null>) {
  await sql`
    INSERT INTO backoffice.audit_events (entity_type, entity_id, actor_type, actor_id, event_type, details)
    VALUES ('receipt', ${receiptId}, ${actor.type}, ${actor.id ?? null}, ${eventType}, ${sql.json(details)})
  `;
}

export function createReceiptRepository(sql: DbClient) {
  async function get(id: string, from: Sql = sql, lock = false): Promise<ReceiptRecord | null> {
    const rows = lock
      ? await from.unsafe<ReceiptRow[]>(`SELECT ${COLUMNS} FROM backoffice.receipts WHERE id = $1 FOR UPDATE`, [id])
      : await from.unsafe<ReceiptRow[]>(`SELECT ${COLUMNS} FROM backoffice.receipts WHERE id = $1`, [id]);
    return rows[0] ? map(rows[0]) : null;
  }

  function assertVersion(receipt: ReceiptRecord | null, expectedVersion: number): ReceiptRecord {
    if (!receipt) throw new DomainError("NOT_FOUND", "Receipt not found");
    if (receipt.version !== expectedVersion) throw new DomainError("CONFLICT", "This receipt was changed in another tab. Reload and try again.");
    return receipt;
  }

  return {
    get: (id: string) => get(id),

    async list(limit = 100): Promise<ReceiptRecord[]> {
      const rows = await sql.unsafe<ReceiptRow[]>(
        `SELECT ${COLUMNS} FROM backoffice.receipts ORDER BY created_at DESC, id DESC LIMIT $1`,
        [Math.max(1, Math.min(limit, 500))],
      );
      return rows.map(map);
    },

    async insert(receipt: NewReceipt, actor: AuditActor): Promise<ReceiptRecord> {
      return sql.begin(async (transaction) => {
        await transaction`
          INSERT INTO backoffice.receipts (
            id, ledger_id, status, file_key, file_name, content_type, file_bytes, file_sha256, note,
            review_reasons, uploaded_by
          ) VALUES (
            ${receipt.id}, ${receipt.ledgerId}, 'needs_review', ${receipt.fileKey}, ${receipt.fileName},
            ${receipt.contentType}, ${receipt.fileBytes}, ${receipt.fileSha256}, ${receipt.note},
            ${["Clara is still reading this receipt."]}, ${receipt.uploadedBy}
          )
        `;
        await audit(transaction, receipt.id, actor, "receipt.uploaded", { ledgerId: receipt.ledgerId, contentType: receipt.contentType });
        return (await get(receipt.id, transaction))!;
      });
    },

    /** Everything this month, including readings that failed after reaching OpenAI. */
    async chargedThisMonth(): Promise<number> {
      const [row] = await sql<{ total: string | null }[]>`
        SELECT sum(charged_microunits)::text AS total FROM backoffice.receipts
        WHERE created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')
      `;
      return Number(row?.total ?? 0);
    },

    async duplicates(input: { id: string; sha256: string; amountMinor: bigint | null; currency: string | null; txnDate: string | null }): Promise<DuplicateHint[]> {
      const sameFile = await sql<{ ledger_id: string }[]>`
        SELECT ledger_id FROM backoffice.receipts
        WHERE file_sha256 = ${input.sha256} AND id <> ${input.id} AND status <> 'discarded'
        ORDER BY created_at LIMIT 3
      `;
      const hints: DuplicateHint[] = sameFile.map((row) => ({ ledgerId: row.ledger_id, reason: "same_file" }));
      if (input.amountMinor !== null && input.currency && input.txnDate) {
        const samePayment = await sql<{ ledger_id: string }[]>`
          SELECT ledger_id FROM backoffice.receipts
          WHERE status = 'recorded' AND id <> ${input.id} AND amount_minor = ${input.amountMinor.toString()}
            AND currency = ${input.currency} AND txn_date = ${input.txnDate}
          ORDER BY created_at LIMIT 3
        `;
        for (const row of samePayment) {
          if (!hints.some((hint) => hint.ledgerId === row.ledger_id)) hints.push({ ledgerId: row.ledger_id, reason: "same_payment" });
        }
      }
      return hints;
    },

    async saveReading(id: string, input: {
      reading: ReceiptReading | null; readingError: string | null; reasons: string[];
      proposal: ReceiptProposal; model: string | null; chargedMicrounits: number;
    }): Promise<ReceiptRecord> {
      const proposal = input.proposal;
      const [row] = await sql<{ id: string }[]>`
        UPDATE backoffice.receipts SET
          reading = ${input.reading ? sql.json(JSON.parse(JSON.stringify(input.reading))) : null},
          reading_error = ${input.readingError},
          review_reasons = ${input.reasons},
          txn_date = ${proposal.txnDate}, kind = ${proposal.kind}, category_code = ${proposal.categoryCode},
          payee = ${proposal.payee}, amount_minor = ${proposal.amountMinor === null ? null : proposal.amountMinor.toString()},
          currency = ${proposal.currency}, paid_from = ${proposal.paidFrom}, description = ${proposal.description},
          reference = ${proposal.reference}, clara_notes = ${proposal.claraNotes},
          model = ${input.model}, charged_microunits = charged_microunits + ${input.chargedMicrounits},
          version = version + 1
        WHERE id = ${id} AND status = 'needs_review'
        RETURNING id
      `;
      if (!row) throw new DomainError("INVALID_STATE", "Receipt is no longer waiting for review");
      return (await get(id))!;
    },

    async flagForReview(id: string, reason: string): Promise<void> {
      await sql`
        UPDATE backoffice.receipts
        SET review_reasons = array_append(review_reasons, ${reason}), version = version + 1
        WHERE id = ${id} AND status = 'needs_review'
      `;
    },

    /**
     * Runs `work` (the ledger call) while the receipt row is locked, so a double
     * click or a second tab waits and then sees the new status instead of writing twice.
     */
    async withLock<T>(id: string, expectedVersion: number, work: (receipt: ReceiptRecord, transaction: Sql) => Promise<T>): Promise<T> {
      const result = await sql.begin(async (transaction) => work(assertVersion(await get(id, transaction, true), expectedVersion), transaction));
      return result as T;
    },

    async markRecorded(transaction: Sql, receipt: ReceiptRecord, values: {
      txnDate: string; kind: ReceiptKind; categoryCode: string; payee: string; amountMinor: bigint; currency: string;
      paidFrom: string | null; description: string | null; reference: string | null; claraNotes: string | null;
      sheetRow: number; recordedBy: string; recordedAt: Date;
    }, actor: AuditActor, automatic: boolean): Promise<void> {
      await transaction`
        UPDATE backoffice.receipts SET
          status = 'recorded', review_reasons = '{}',
          txn_date = ${values.txnDate}, kind = ${values.kind}, category_code = ${values.categoryCode},
          payee = ${values.payee}, amount_minor = ${values.amountMinor.toString()}, currency = ${values.currency},
          paid_from = ${values.paidFrom}, description = ${values.description}, reference = ${values.reference},
          clara_notes = ${values.claraNotes}, sheet_row = ${values.sheetRow},
          recorded_by = ${values.recordedBy}, recorded_at = ${values.recordedAt}, version = version + 1
        WHERE id = ${receipt.id} AND status = 'needs_review'
      `;
      await audit(transaction, receipt.id, actor, automatic ? "receipt.recorded_automatically" : "receipt.recorded", {
        ledgerId: receipt.ledgerId, categoryCode: values.categoryCode, sheetRow: values.sheetRow,
      });
    },

    async markClosed(transaction: Sql, receipt: ReceiptRecord, status: "undone" | "discarded", closedBy: string, actor: AuditActor, sheetRow: number | null = null): Promise<void> {
      await transaction`
        UPDATE backoffice.receipts SET
          status = ${status}, closed_by = ${closedBy}, closed_at = now(),
          sheet_row = COALESCE(${sheetRow}, sheet_row), version = version + 1
        WHERE id = ${receipt.id}
      `;
      await audit(transaction, receipt.id, actor, status === "undone" ? "receipt.undone" : "receipt.discarded", { ledgerId: receipt.ledgerId });
    },

    async changeCategory(transaction: Sql, receipt: ReceiptRecord, values: { categoryCode: string; kind: ReceiptKind; claraNotes: string | null; sheetRow: number }, actor: AuditActor): Promise<void> {
      await transaction`
        UPDATE backoffice.receipts SET
          category_code = ${values.categoryCode}, kind = ${values.kind}, clara_notes = ${values.claraNotes},
          sheet_row = ${values.sheetRow}, version = version + 1
        WHERE id = ${receipt.id} AND status = 'recorded'
      `;
      await audit(transaction, receipt.id, actor, "receipt.category_changed", {
        ledgerId: receipt.ledgerId, from: receipt.categoryCode, to: values.categoryCode,
      });
    },
  };
}

export type ReceiptRepository = ReturnType<typeof createReceiptRepository>;
