import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import {
  calculateInvoiceTotals,
  calculateLineAmounts,
  currencyFractionDigits,
  normalizeCurrency,
  parseMinorUnits,
  type LineAmounts,
} from '@/lib/money';
import {
  DomainError,
  getDb,
  type AuditActor,
} from '@/lib/server/db';

export type PersistedInvoiceStatus = 'draft' | 'sent' | 'paid' | 'void';
export type InvoiceDisplayStatus = PersistedInvoiceStatus | 'overdue';
export type PaymentKind = 'payment' | 'reversal';
export type InvoiceEmailStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'cancelled';

export type InvoiceItemInput = {
  id?: string;
  description: string;
  quantity: string;
  unitPriceMinor: bigint;
  discountMinor?: bigint;
  taxRateBps?: number;
};

export type InvoiceDraftInput = {
  clientId: string;
  currency: string;
  issueOn: string;
  dueOn: string;
  notes?: string | null;
  terms?: string | null;
  items: InvoiceItemInput[];
};

export type InvoiceListOptions = {
  search?: string;
  status?: InvoiceDisplayStatus | 'all';
  clientId?: string;
  limit?: number;
  offset?: number;
};

export type InvoiceItemRecord = LineAmounts & {
  id: string;
  position: number;
  description: string;
};

export type PaymentRecord = {
  id: string;
  kind: PaymentKind;
  amountMinor: bigint;
  currency: string;
  paidAt: string;
  method: string | null;
  provider: string | null;
  externalReference: string | null;
  reversesPaymentId: string | null;
  note: string | null;
  createdAt: string;
};

export type InvoiceSnapshotRecord = {
  id: string;
  schemaVersion: number;
  templateVersion: string;
  payload: Record<string, unknown>;
  contentSha256: string;
  createdAt: string;
};

export type InvoiceSummary = {
  id: string;
  clientId: string;
  clientName: string;
  clientEmail: string;
  invoiceNumber: string | null;
  status: PersistedInvoiceStatus;
  effectiveStatus: InvoiceDisplayStatus;
  currency: string;
  issueOn: string;
  dueOn: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  paidMinor: bigint;
  balanceMinor: bigint;
  version: number;
  finalizedAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceDetail = InvoiceSummary & {
  notes: string | null;
  terms: string | null;
  voidReason: string | null;
  items: InvoiceItemRecord[];
  payments: PaymentRecord[];
  snapshot: InvoiceSnapshotRecord | null;
};

export type RecordPaymentInput = {
  invoiceId: string;
  amountMinor: bigint;
  currency: string;
  paidAt?: string;
  method?: string | null;
  provider?: string | null;
  externalReference?: string | null;
  idempotencyKey: string;
  note?: string | null;
};

export type RecordInvoicePdfInput = {
  invoiceId: string;
  snapshotId: string;
  storageKey: string;
  byteSize: bigint;
  contentSha256: string;
  contentType?: string;
  templateVersion?: string;
};

export type InvoiceDocumentRecord = {
  id: string;
  invoiceId: string;
  snapshotId: string;
  kind: 'invoice_pdf' | 'receipt_pdf';
  status: 'queued' | 'ready' | 'failed';
  templateVersion: string;
  storageKey: string | null;
  contentType: string | null;
  byteSize: bigint | null;
  contentSha256: string | null;
  errorCode: string | null;
  generatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QueueInvoiceEmailInput = {
  invoiceId: string;
  purpose: 'invoice' | 'reminder' | 'receipt';
  recipient: string;
  idempotencyKey: string;
};

export type InvoiceEmailRecord = {
  id: string;
  invoiceId: string;
  snapshotId: string;
  purpose: 'invoice' | 'reminder' | 'receipt';
  recipient: string;
  status: InvoiceEmailStatus;
  provider: string | null;
  providerMessageId: string | null;
  attempts: number;
  errorCode: string | null;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceEmailStatusMetadata = {
  provider?: string | null;
  providerMessageId?: string | null;
  errorCode?: string | null;
  sentAt?: string | null;
  deliveredAt?: string | null;
};

const UuidSchema = z.string().uuid();
const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'Date must be a real ISO calendar date');
const OptionalTextSchema = (maximum: number) =>
  z.string().trim().max(maximum).nullish();

const InvoiceItemInputSchema = z.object({
  id: UuidSchema.optional(),
  description: z.string().trim().min(1).max(500),
  quantity: z.string().trim().min(1).max(32),
  unitPriceMinor: z.bigint().nonnegative(),
  discountMinor: z.bigint().nonnegative().optional(),
  taxRateBps: z.number().int().min(0).max(100_000).optional(),
});

const InvoiceDraftInputSchema = z.object({
  clientId: UuidSchema,
  currency: z.string().trim().length(3),
  issueOn: IsoDateSchema,
  dueOn: IsoDateSchema,
  notes: OptionalTextSchema(10_000),
  terms: OptionalTextSchema(10_000),
  items: z.array(InvoiceItemInputSchema).max(200),
});

const InvoiceListOptionsSchema = z.object({
  search: z.string().trim().max(160).optional(),
  status: z.enum(['all', 'draft', 'sent', 'paid', 'overdue', 'void']).optional(),
  clientId: UuidSchema.optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
});

const RecordPaymentInputSchema = z.object({
  invoiceId: UuidSchema,
  amountMinor: z.bigint().positive(),
  currency: z.string().trim().length(3),
  paidAt: z.string().datetime({ offset: true }).optional(),
  method: OptionalTextSchema(80),
  provider: OptionalTextSchema(80),
  externalReference: OptionalTextSchema(200),
  idempotencyKey: z.string().trim().min(8).max(200),
  note: OptionalTextSchema(1_000),
});

type InvoiceSummaryRow = {
  id: string;
  client_id: string;
  client_name: string;
  client_email: string;
  invoice_number: string | null;
  status: PersistedInvoiceStatus;
  currency: string;
  issue_on: string;
  due_on: string;
  notes: string | null;
  terms: string | null;
  void_reason: string | null;
  subtotal_minor: string;
  discount_minor: string;
  tax_minor: string;
  total_minor: string;
  paid_minor: string;
  balance_minor: string;
  version: string | number;
  finalized_at: Date | string | null;
  paid_at: Date | string | null;
  voided_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type InvoiceItemRow = {
  id: string;
  position: number;
  description: string;
  quantity: string;
  unit_price_minor: string;
  discount_minor: string;
  tax_rate_bps: number;
  subtotal_minor: string;
  tax_minor: string;
  total_minor: string;
};

type PaymentRow = {
  id: string;
  invoice_id: string;
  kind: PaymentKind;
  amount_minor: string;
  currency: string;
  paid_at: Date | string;
  method: string | null;
  provider: string | null;
  external_reference: string | null;
  reverses_payment_id: string | null;
  note: string | null;
  created_at: Date | string;
};

type SnapshotRow = {
  id: string;
  schema_version: number;
  template_version: string;
  payload: Record<string, unknown>;
  content_sha256: string;
  created_at: Date | string;
};

type DocumentRow = {
  id: string;
  invoice_id: string;
  snapshot_id: string;
  kind: 'invoice_pdf' | 'receipt_pdf';
  status: 'queued' | 'ready' | 'failed';
  template_version: string;
  storage_key: string | null;
  content_type: string | null;
  byte_size: string | null;
  content_sha256: string | null;
  error_code: string | null;
  generated_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type EmailRow = {
  id: string;
  invoice_id: string;
  snapshot_id: string;
  purpose: 'invoice' | 'reminder' | 'receipt';
  recipient: string;
  status: InvoiceEmailStatus;
  provider: string | null;
  provider_message_id: string | null;
  attempts: number;
  error_code: string | null;
  queued_at: Date | string;
  sent_at: Date | string | null;
  delivered_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type PreparedInvoiceItem = InvoiceItemRecord;

function toIso(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function jakartaCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function getInvoiceDisplayStatus(
  status: PersistedInvoiceStatus,
  dueOn: string,
  balanceMinor: bigint,
  now = new Date()
): InvoiceDisplayStatus {
  if (status !== 'sent') return status;
  return balanceMinor > 0n && dueOn < jakartaCalendarDate(now) ? 'overdue' : 'sent';
}

export function formatInvoiceNumber(
  year: number,
  serial: bigint,
  prefix = 'INV'
) {
  if (!Number.isInteger(year) || year < 2000 || year > 9999 || serial < 1n) {
    throw new DomainError('VALIDATION_ERROR', 'Invalid invoice number scope');
  }
  const normalizedPrefix = prefix.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9-]{1,11}$/.test(normalizedPrefix)) {
    throw new DomainError('VALIDATION_ERROR', 'Invalid invoice number prefix');
  }
  return `${normalizedPrefix}-${year}-${serial.toString().padStart(6, '0')}`;
}

function mapInvoiceSummary(row: InvoiceSummaryRow): InvoiceSummary {
  const balanceMinor = BigInt(row.balance_minor);
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    clientEmail: row.client_email,
    invoiceNumber: row.invoice_number,
    status: row.status,
    effectiveStatus: getInvoiceDisplayStatus(row.status, row.due_on, balanceMinor),
    currency: row.currency,
    issueOn: row.issue_on,
    dueOn: row.due_on,
    subtotalMinor: BigInt(row.subtotal_minor),
    discountMinor: BigInt(row.discount_minor),
    taxMinor: BigInt(row.tax_minor),
    totalMinor: BigInt(row.total_minor),
    paidMinor: BigInt(row.paid_minor),
    balanceMinor,
    version: Number(row.version),
    finalizedAt: toIso(row.finalized_at),
    paidAt: toIso(row.paid_at),
    voidedAt: toIso(row.voided_at),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapItem(row: InvoiceItemRow): InvoiceItemRecord {
  return {
    id: row.id,
    position: row.position,
    description: row.description,
    quantity: row.quantity.includes('.')
      ? row.quantity.replace(/0+$/, '').replace(/\.$/, '')
      : row.quantity,
    unitPriceMinor: BigInt(row.unit_price_minor),
    discountMinor: BigInt(row.discount_minor),
    taxRateBps: row.tax_rate_bps,
    subtotalMinor: BigInt(row.subtotal_minor),
    taxMinor: BigInt(row.tax_minor),
    totalMinor: BigInt(row.total_minor),
  };
}

function mapPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    kind: row.kind,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency,
    paidAt: toIso(row.paid_at)!,
    method: row.method,
    provider: row.provider,
    externalReference: row.external_reference,
    reversesPaymentId: row.reverses_payment_id,
    note: row.note,
    createdAt: toIso(row.created_at)!,
  };
}

function mapSnapshot(row: SnapshotRow): InvoiceSnapshotRecord {
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    templateVersion: row.template_version,
    payload: row.payload,
    contentSha256: row.content_sha256,
    createdAt: toIso(row.created_at)!,
  };
}

function mapDocument(row: DocumentRow): InvoiceDocumentRecord {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    snapshotId: row.snapshot_id,
    kind: row.kind,
    status: row.status,
    templateVersion: row.template_version,
    storageKey: row.storage_key,
    contentType: row.content_type,
    byteSize: row.byte_size === null ? null : BigInt(row.byte_size),
    contentSha256: row.content_sha256,
    errorCode: row.error_code,
    generatedAt: toIso(row.generated_at),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function mapEmail(row: EmailRow): InvoiceEmailRecord {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    snapshotId: row.snapshot_id,
    purpose: row.purpose,
    recipient: row.recipient,
    status: row.status,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    attempts: row.attempts,
    errorCode: row.error_code,
    queuedAt: toIso(row.queued_at)!,
    sentAt: toIso(row.sent_at),
    deliveredAt: toIso(row.delivered_at),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function actorValues(actor: AuditActor | undefined) {
  return { type: actor?.type ?? 'owner', id: actor?.id ?? null } as const;
}

function optionalText(value: string | null | undefined) {
  return value?.trim() || null;
}

function parseVersion(value: number) {
  if (!Number.isInteger(value) || value < 1) {
    throw new DomainError('VALIDATION_ERROR', 'Expected version must be positive');
  }
  return value;
}

function prepareDraft(input: InvoiceDraftInput) {
  const result = InvoiceDraftInputSchema.safeParse(input);
  if (!result.success) {
    throw new DomainError(
      'VALIDATION_ERROR',
      result.error.issues[0]?.message ?? 'Invoice input is invalid'
    );
  }

  const parsed = result.data;
  if (parsed.dueOn < parsed.issueOn) {
    throw new DomainError('VALIDATION_ERROR', 'Due date cannot precede issue date');
  }
  const itemIds = new Set<string>();
  const items = parsed.items.map<PreparedInvoiceItem>((item, position) => {
    const id = item.id ?? randomUUID();
    if (itemIds.has(id)) {
      throw new DomainError('VALIDATION_ERROR', 'Invoice item IDs must be unique');
    }
    itemIds.add(id);
    return {
      id,
      position,
      description: item.description,
      ...calculateLineAmounts(item),
    };
  });

  return {
    clientId: parsed.clientId,
    currency: normalizeCurrency(parsed.currency),
    issueOn: parsed.issueOn,
    dueOn: parsed.dueOn,
    notes: optionalText(parsed.notes),
    terms: optionalText(parsed.terms),
    items,
    totals: calculateInvoiceTotals(items),
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

async function requireInvoice(id: string) {
  const invoice = await getInvoice(id);
  if (!invoice) throw new DomainError('NOT_FOUND', 'Invoice not found');
  return invoice;
}

export async function listInvoices(
  options: InvoiceListOptions = {}
): Promise<InvoiceSummary[]> {
  const parsed = InvoiceListOptionsSchema.parse(options);
  const sql = getDb();
  const search = parsed.search ? `%${parsed.search}%` : null;
  const status = parsed.status ?? 'all';
  const limit = parsed.limit ?? 50;
  const offset = parsed.offset ?? 0;

  const rows = await sql<InvoiceSummaryRow[]>`
    SELECT
      i.id,
      i.client_id,
      c.name AS client_name,
      c.email AS client_email,
      i.invoice_number,
      i.status,
      i.currency,
      i.issue_on::text,
      i.due_on::text,
      i.notes,
      i.terms,
      i.void_reason,
      i.subtotal_minor::text,
      i.discount_minor::text,
      i.tax_minor::text,
      i.total_minor::text,
      payments.paid_minor::text,
      GREATEST(i.total_minor - payments.paid_minor, 0)::text AS balance_minor,
      i.version,
      i.finalized_at,
      i.paid_at,
      i.voided_at,
      i.created_at,
      i.updated_at
    FROM backoffice.invoices i
    JOIN backoffice.clients c ON c.id = i.client_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(
        CASE WHEN p.kind = 'payment' THEN p.amount_minor ELSE -p.amount_minor END
      ), 0)::bigint AS paid_minor
      FROM backoffice.invoice_payments p
      WHERE p.invoice_id = i.id
    ) payments ON true
    WHERE
      (${parsed.clientId ?? null}::uuid IS NULL OR i.client_id = ${parsed.clientId ?? null})
      AND (
        ${search}::text IS NULL
        OR i.invoice_number ILIKE ${search}
        OR c.name ILIKE ${search}
        OR c.email ILIKE ${search}
      )
      AND (
        ${status} = 'all'
        OR (${status} IN ('draft', 'paid', 'void') AND i.status = ${status})
        OR (
          ${status} = 'overdue'
          AND i.status = 'sent'
          AND i.due_on < (now() AT TIME ZONE 'Asia/Jakarta')::date
          AND payments.paid_minor < i.total_minor
        )
        OR (
          ${status} = 'sent'
          AND i.status = 'sent'
          AND NOT (
            i.due_on < (now() AT TIME ZONE 'Asia/Jakarta')::date
            AND payments.paid_minor < i.total_minor
          )
        )
      )
    ORDER BY i.created_at DESC, i.id DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return rows.map(mapInvoiceSummary);
}

export async function getInvoice(id: string): Promise<InvoiceDetail | null> {
  const invoiceId = UuidSchema.parse(id);
  const sql = getDb();
  const [row] = await sql<InvoiceSummaryRow[]>`
    SELECT
      i.id,
      i.client_id,
      c.name AS client_name,
      c.email AS client_email,
      i.invoice_number,
      i.status,
      i.currency,
      i.issue_on::text,
      i.due_on::text,
      i.notes,
      i.terms,
      i.void_reason,
      i.subtotal_minor::text,
      i.discount_minor::text,
      i.tax_minor::text,
      i.total_minor::text,
      payments.paid_minor::text,
      GREATEST(i.total_minor - payments.paid_minor, 0)::text AS balance_minor,
      i.version,
      i.finalized_at,
      i.paid_at,
      i.voided_at,
      i.created_at,
      i.updated_at
    FROM backoffice.invoices i
    JOIN backoffice.clients c ON c.id = i.client_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(
        CASE WHEN p.kind = 'payment' THEN p.amount_minor ELSE -p.amount_minor END
      ), 0)::bigint AS paid_minor
      FROM backoffice.invoice_payments p
      WHERE p.invoice_id = i.id
    ) payments ON true
    WHERE i.id = ${invoiceId}
  `;
  if (!row) return null;

  const [items, payments, snapshots] = await Promise.all([
    sql<InvoiceItemRow[]>`
      SELECT
        id, position, description, quantity::text, unit_price_minor::text,
        discount_minor::text, tax_rate_bps, subtotal_minor::text,
        tax_minor::text, total_minor::text
      FROM backoffice.invoice_items
      WHERE invoice_id = ${invoiceId}
      ORDER BY position
    `,
    sql<PaymentRow[]>`
      SELECT
        id, invoice_id, kind, amount_minor::text, currency, paid_at,
        method, provider, external_reference, reverses_payment_id, note, created_at
      FROM backoffice.invoice_payments
      WHERE invoice_id = ${invoiceId}
      ORDER BY created_at, id
    `,
    sql<SnapshotRow[]>`
      SELECT id, schema_version, template_version, payload, content_sha256, created_at
      FROM backoffice.invoice_snapshots
      WHERE invoice_id = ${invoiceId}
    `,
  ]);

  return {
    ...mapInvoiceSummary(row),
    notes: row.notes,
    terms: row.terms,
    voidReason: row.void_reason,
    items: items.map(mapItem),
    payments: payments.map(mapPayment),
    snapshot: snapshots[0] ? mapSnapshot(snapshots[0]) : null,
  };
}

export async function createDraftInvoice(
  input: InvoiceDraftInput,
  actor?: AuditActor
): Promise<InvoiceDetail> {
  const draft = prepareDraft(input);
  const auditActor = actorValues(actor);
  const sql = getDb();
  const invoiceId = await sql.begin(async (transaction) => {
    const [client] = await transaction<{ id: string }[]>`
      SELECT id FROM backoffice.clients
      WHERE id = ${draft.clientId} AND archived_at IS NULL
    `;
    if (!client) throw new DomainError('NOT_FOUND', 'Active client not found');

    const [invoice] = await transaction<{ id: string }[]>`
      INSERT INTO backoffice.invoices (
        client_id, currency, issue_on, due_on, notes, terms,
        subtotal_minor, discount_minor, tax_minor, total_minor
      ) VALUES (
        ${draft.clientId}, ${draft.currency}, ${draft.issueOn}, ${draft.dueOn},
        ${draft.notes}, ${draft.terms}, ${draft.totals.subtotalMinor.toString()},
        ${draft.totals.discountMinor.toString()}, ${draft.totals.taxMinor.toString()},
        ${draft.totals.totalMinor.toString()}
      )
      RETURNING id
    `;

    for (const item of draft.items) {
      await transaction`
        INSERT INTO backoffice.invoice_items (
          id, invoice_id, position, description, quantity, unit_price_minor,
          discount_minor, tax_rate_bps, subtotal_minor, tax_minor, total_minor
        ) VALUES (
          ${item.id}, ${invoice.id}, ${item.position}, ${item.description},
          ${item.quantity}, ${item.unitPriceMinor.toString()}, ${item.discountMinor.toString()},
          ${item.taxRateBps}, ${item.subtotalMinor.toString()}, ${item.taxMinor.toString()},
          ${item.totalMinor.toString()}
        )
      `;
    }

    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, invoice_id, actor_type, actor_id,
        event_type, to_status, details
      ) VALUES (
        'invoice', ${invoice.id}, ${invoice.id}, ${auditActor.type}, ${auditActor.id},
        'invoice.created', 'draft', ${transaction.json({ clientId: draft.clientId })}
      )
    `;
    return invoice.id;
  });
  return requireInvoice(invoiceId);
}

export async function updateDraftInvoice(
  id: string,
  input: InvoiceDraftInput,
  expectedVersion: number,
  actor?: AuditActor
): Promise<InvoiceDetail> {
  const invoiceId = UuidSchema.parse(id);
  const version = parseVersion(expectedVersion);
  const draft = prepareDraft(input);
  const auditActor = actorValues(actor);
  const sql = getDb();

  await sql.begin(async (transaction) => {
    const [existing] = await transaction<
      { id: string; status: PersistedInvoiceStatus; version: string }[]
    >`
      SELECT id, status, version::text
      FROM backoffice.invoices
      WHERE id = ${invoiceId}
      FOR UPDATE
    `;
    if (!existing) throw new DomainError('NOT_FOUND', 'Invoice not found');
    if (existing.status !== 'draft') {
      throw new DomainError('INVALID_STATE', 'Only draft invoices can be edited');
    }
    if (Number(existing.version) !== version) {
      throw new DomainError('CONFLICT', 'Invoice was changed by another request');
    }

    const [client] = await transaction<{ id: string }[]>`
      SELECT id FROM backoffice.clients
      WHERE id = ${draft.clientId} AND archived_at IS NULL
    `;
    if (!client) throw new DomainError('NOT_FOUND', 'Active client not found');

    await transaction`
      DELETE FROM backoffice.invoice_items WHERE invoice_id = ${invoiceId}
    `;
    for (const item of draft.items) {
      await transaction`
        INSERT INTO backoffice.invoice_items (
          id, invoice_id, position, description, quantity, unit_price_minor,
          discount_minor, tax_rate_bps, subtotal_minor, tax_minor, total_minor
        ) VALUES (
          ${item.id}, ${invoiceId}, ${item.position}, ${item.description},
          ${item.quantity}, ${item.unitPriceMinor.toString()}, ${item.discountMinor.toString()},
          ${item.taxRateBps}, ${item.subtotalMinor.toString()}, ${item.taxMinor.toString()},
          ${item.totalMinor.toString()}
        )
      `;
    }

    await transaction`
      UPDATE backoffice.invoices
      SET
        client_id = ${draft.clientId}, currency = ${draft.currency},
        issue_on = ${draft.issueOn}, due_on = ${draft.dueOn}, notes = ${draft.notes},
        terms = ${draft.terms}, subtotal_minor = ${draft.totals.subtotalMinor.toString()},
        discount_minor = ${draft.totals.discountMinor.toString()},
        tax_minor = ${draft.totals.taxMinor.toString()},
        total_minor = ${draft.totals.totalMinor.toString()}, version = version + 1
      WHERE id = ${invoiceId}
    `;
    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, invoice_id, actor_type, actor_id,
        event_type, from_status, to_status, details
      ) VALUES (
        'invoice', ${invoiceId}, ${invoiceId}, ${auditActor.type}, ${auditActor.id},
        'invoice.updated', 'draft', 'draft', ${transaction.json({ version: version + 1 })}
      )
    `;
  });
  return requireInvoice(invoiceId);
}

type FinalizeRow = {
  id: string;
  status: PersistedInvoiceStatus;
  version: string;
  finalize_idempotency_key: string | null;
  client_id: string;
  currency: string;
  issue_on: string;
  due_on: string;
  notes: string | null;
  terms: string | null;
  client_name: string;
  client_company_name: string | null;
  client_email: string;
  client_phone: string | null;
  client_tax_id: string | null;
  client_billing_address: Record<string, string>;
  business_name: string;
  business_legal_name: string | null;
  business_email: string | null;
  business_phone: string | null;
  business_tax_id: string | null;
  business_billing_address: Record<string, string>;
  payment_instructions: string | null;
  invoice_prefix: string;
};

export async function finalizeInvoice(
  id: string,
  expectedVersion: number,
  idempotencyKey: string,
  actor?: AuditActor
): Promise<InvoiceDetail> {
  const invoiceId = UuidSchema.parse(id);
  const version = parseVersion(expectedVersion);
  const key = z.string().trim().min(8).max(200).parse(idempotencyKey);
  const auditActor = actorValues(actor);
  const sql = getDb();

  await sql.begin(async (transaction) => {
    const [invoice] = await transaction<FinalizeRow[]>`
      SELECT
        i.id, i.status, i.version::text, i.finalize_idempotency_key,
        i.client_id, i.currency, i.issue_on::text, i.due_on::text, i.notes, i.terms,
        c.name AS client_name, c.company_name AS client_company_name,
        c.email AS client_email, c.phone AS client_phone, c.tax_id AS client_tax_id,
        c.billing_address AS client_billing_address,
        b.business_name, b.legal_name AS business_legal_name,
        b.email AS business_email, b.phone AS business_phone, b.tax_id AS business_tax_id,
        b.billing_address AS business_billing_address, b.payment_instructions,
        b.invoice_prefix
      FROM backoffice.invoices i
      JOIN backoffice.clients c ON c.id = i.client_id
      CROSS JOIN backoffice.business_profile b
      WHERE i.id = ${invoiceId} AND b.id = 1
      FOR UPDATE OF i
    `;
    if (!invoice) throw new DomainError('NOT_FOUND', 'Invoice not found');
    if (invoice.status !== 'draft') {
      if (invoice.finalize_idempotency_key === key) return;
      throw new DomainError('INVALID_STATE', 'Invoice has already been finalized');
    }
    if (Number(invoice.version) !== version) {
      throw new DomainError('CONFLICT', 'Invoice was changed by another request');
    }

    const itemRows = await transaction<InvoiceItemRow[]>`
      SELECT
        id, position, description, quantity::text, unit_price_minor::text,
        discount_minor::text, tax_rate_bps, subtotal_minor::text,
        tax_minor::text, total_minor::text
      FROM backoffice.invoice_items
      WHERE invoice_id = ${invoiceId}
      ORDER BY position
    `;
    if (itemRows.length === 0) {
      throw new DomainError('VALIDATION_ERROR', 'Invoice needs at least one item');
    }
    const items = itemRows.map(mapItem);
    const totals = calculateInvoiceTotals(items);
    if (totals.totalMinor <= 0n) {
      throw new DomainError('VALIDATION_ERROR', 'Invoice total must be positive');
    }

    const numberYear = Number(invoice.issue_on.slice(0, 4));
    const [counter] = await transaction<{ last_value: string }[]>`
      INSERT INTO backoffice.invoice_number_counters (scope_year, last_value)
      VALUES (${numberYear}, 1)
      ON CONFLICT (scope_year) DO UPDATE
      SET
        last_value = backoffice.invoice_number_counters.last_value + 1,
        updated_at = now()
      RETURNING last_value::text
    `;
    const numberSerial = BigInt(counter.last_value);
    const invoiceNumber = formatInvoiceNumber(
      numberYear,
      numberSerial,
      invoice.invoice_prefix
    );
    const snapshotId = randomUUID();
    const now = new Date();
    const snapshotPayload = {
      schemaVersion: 1,
      templateVersion: 'v1',
      createdAt: now.toISOString(),
      roundingPolicy: 'line-half-up-v1',
      seller: {
        businessName: invoice.business_name,
        legalName: invoice.business_legal_name,
        email: invoice.business_email,
        phone: invoice.business_phone,
        taxId: invoice.business_tax_id,
        billingAddress: invoice.business_billing_address,
        paymentInstructions: invoice.payment_instructions,
      },
      client: {
        id: invoice.client_id,
        name: invoice.client_name,
        companyName: invoice.client_company_name,
        email: invoice.client_email,
        phone: invoice.client_phone,
        taxId: invoice.client_tax_id,
        billingAddress: invoice.client_billing_address,
      },
      invoice: {
        id: invoice.id,
        invoiceNumber,
        currency: invoice.currency,
        currencyFractionDigits: currencyFractionDigits(invoice.currency),
        issueOn: invoice.issue_on,
        dueOn: invoice.due_on,
        notes: invoice.notes,
        terms: invoice.terms,
        items: items.map((item) => ({
          id: item.id,
          position: item.position,
          description: item.description,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor.toString(),
          discountMinor: item.discountMinor.toString(),
          taxRateBps: item.taxRateBps,
          subtotalMinor: item.subtotalMinor.toString(),
          taxMinor: item.taxMinor.toString(),
          totalMinor: item.totalMinor.toString(),
        })),
        totals: {
          subtotalMinor: totals.subtotalMinor.toString(),
          discountMinor: totals.discountMinor.toString(),
          taxMinor: totals.taxMinor.toString(),
          totalMinor: totals.totalMinor.toString(),
        },
      },
    };
    const contentSha256 = createHash('sha256')
      .update(canonicalJson(snapshotPayload))
      .digest('hex');

    await transaction`
      INSERT INTO backoffice.invoice_snapshots (
        id, invoice_id, invoice_number, schema_version, template_version,
        currency, subtotal_minor, discount_minor, tax_minor, total_minor,
        payload, content_sha256, created_at
      ) VALUES (
        ${snapshotId}, ${invoiceId}, ${invoiceNumber}, 1, 'v1', ${invoice.currency},
        ${totals.subtotalMinor.toString()}, ${totals.discountMinor.toString()},
        ${totals.taxMinor.toString()}, ${totals.totalMinor.toString()},
        ${transaction.json(snapshotPayload)}, ${contentSha256}, ${now}
      )
    `;
    await transaction`
      UPDATE backoffice.invoices
      SET
        status = 'sent', invoice_number = ${invoiceNumber},
        number_year = ${numberYear}, number_serial = ${numberSerial.toString()},
        subtotal_minor = ${totals.subtotalMinor.toString()},
        discount_minor = ${totals.discountMinor.toString()},
        tax_minor = ${totals.taxMinor.toString()}, total_minor = ${totals.totalMinor.toString()},
        finalize_idempotency_key = ${key}, finalized_at = ${now}, version = version + 1
      WHERE id = ${invoiceId}
    `;

    const [document] = await transaction<{ id: string }[]>`
      INSERT INTO backoffice.invoice_documents (
        invoice_id, snapshot_id, kind, status, template_version
      ) VALUES (${invoiceId}, ${snapshotId}, 'invoice_pdf', 'queued', 'v1')
      RETURNING id
    `;
    await transaction`
      INSERT INTO backoffice.outbox_events (
        topic, aggregate_id, idempotency_key, payload
      ) VALUES
      (
        'invoice.pdf.generate', ${invoiceId}, ${`pdf:${snapshotId}:v1`},
        ${transaction.json({ invoiceId, snapshotId, documentId: document.id })}
      )
    `;
    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, invoice_id, actor_type, actor_id,
        event_type, from_status, to_status, details
      ) VALUES (
        'invoice', ${invoiceId}, ${invoiceId}, ${auditActor.type}, ${auditActor.id},
        'invoice.finalized', 'draft', 'sent',
        ${transaction.json({ invoiceNumber, totalMinor: totals.totalMinor.toString() })}
      )
    `;
  });

  return requireInvoice(invoiceId);
}

export async function voidInvoice(
  id: string,
  expectedVersion: number,
  reason: string,
  actor?: AuditActor
): Promise<InvoiceDetail> {
  const invoiceId = UuidSchema.parse(id);
  const version = parseVersion(expectedVersion);
  const voidReason = z.string().trim().min(3).max(1_000).parse(reason);
  const auditActor = actorValues(actor);
  const sql = getDb();

  await sql.begin(async (transaction) => {
    const [invoice] = await transaction<
      { status: PersistedInvoiceStatus; version: string; paid_minor: string }[]
    >`
      SELECT
        i.status,
        i.version::text,
        COALESCE(SUM(
          CASE WHEN p.kind = 'payment' THEN p.amount_minor ELSE -p.amount_minor END
        ), 0)::text AS paid_minor
      FROM backoffice.invoices i
      LEFT JOIN backoffice.invoice_payments p ON p.invoice_id = i.id
      WHERE i.id = ${invoiceId}
      GROUP BY i.id
      FOR UPDATE OF i
    `;
    if (!invoice) throw new DomainError('NOT_FOUND', 'Invoice not found');
    if (invoice.status !== 'sent') {
      throw new DomainError('INVALID_STATE', 'Only an unpaid sent invoice can be voided');
    }
    if (Number(invoice.version) !== version) {
      throw new DomainError('CONFLICT', 'Invoice was changed by another request');
    }
    if (BigInt(invoice.paid_minor) !== 0n) {
      throw new DomainError('INVALID_STATE', 'Reverse payments before voiding this invoice');
    }

    await transaction`
      UPDATE backoffice.invoices
      SET
        status = 'void', voided_at = now(), void_reason = ${voidReason},
        paid_at = NULL, version = version + 1
      WHERE id = ${invoiceId}
    `;
    await transaction`
      UPDATE backoffice.invoice_email_messages
      SET status = 'cancelled', error_code = 'invoice_voided'
      WHERE invoice_id = ${invoiceId} AND status IN ('queued', 'sending')
    `;
    await transaction`
      UPDATE backoffice.outbox_events
      SET processed_at = now(), last_error_code = 'invoice_voided'
      WHERE aggregate_id = ${invoiceId} AND processed_at IS NULL
    `;
    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, invoice_id, actor_type, actor_id,
        event_type, from_status, to_status, details
      ) VALUES (
        'invoice', ${invoiceId}, ${invoiceId}, ${auditActor.type}, ${auditActor.id},
        'invoice.voided', 'sent', 'void', ${transaction.json({ reason: voidReason })}
      )
    `;
  });
  return requireInvoice(invoiceId);
}

export async function recordPayment(
  input: RecordPaymentInput,
  actor?: AuditActor
): Promise<InvoiceDetail> {
  const result = RecordPaymentInputSchema.safeParse(input);
  if (!result.success) {
    throw new DomainError(
      'VALIDATION_ERROR',
      result.error.issues[0]?.message ?? 'Payment input is invalid'
    );
  }
  const payment = result.data;
  const amountMinor = parseMinorUnits(payment.amountMinor, 'Payment amount');
  const currency = normalizeCurrency(payment.currency);
  const auditActor = actorValues(actor);
  const sql = getDb();

  const invoiceId = await sql.begin(async (transaction) => {
    const [duplicate] = await transaction<{ invoice_id: string }[]>`
      SELECT invoice_id FROM backoffice.invoice_payments
      WHERE idempotency_key = ${payment.idempotencyKey}
    `;
    if (duplicate) return duplicate.invoice_id;

    const [invoice] = await transaction<
      {
        id: string;
        status: PersistedInvoiceStatus;
        currency: string;
        total_minor: string;
      }[]
    >`
      SELECT id, status, currency, total_minor::text
      FROM backoffice.invoices
      WHERE id = ${payment.invoiceId}
      FOR UPDATE
    `;
    if (!invoice) throw new DomainError('NOT_FOUND', 'Invoice not found');
    if (!['sent', 'paid'].includes(invoice.status)) {
      throw new DomainError('INVALID_STATE', 'Payments require a sent invoice');
    }
    if (invoice.currency !== currency) {
      throw new DomainError('VALIDATION_ERROR', 'Payment currency does not match invoice');
    }

    const [current] = await transaction<{ paid_minor: string }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN kind = 'payment' THEN amount_minor ELSE -amount_minor END
      ), 0)::text AS paid_minor
      FROM backoffice.invoice_payments
      WHERE invoice_id = ${invoice.id}
    `;
    const nextPaidMinor = BigInt(current.paid_minor) + amountMinor;
    if (nextPaidMinor > BigInt(invoice.total_minor)) {
      throw new DomainError('VALIDATION_ERROR', 'Payment exceeds invoice balance');
    }

    const paymentId = randomUUID();
    const paidAt = payment.paidAt ? new Date(payment.paidAt) : new Date();
    await transaction`
      INSERT INTO backoffice.invoice_payments (
        id, invoice_id, kind, amount_minor, currency, paid_at, method,
        provider, external_reference, idempotency_key, note
      ) VALUES (
        ${paymentId}, ${invoice.id}, 'payment', ${amountMinor.toString()}, ${currency}, ${paidAt},
        ${optionalText(payment.method)}, ${optionalText(payment.provider)},
        ${optionalText(payment.externalReference)}, ${payment.idempotencyKey},
        ${optionalText(payment.note)}
      )
    `;

    const nextStatus: PersistedInvoiceStatus =
      nextPaidMinor === BigInt(invoice.total_minor) ? 'paid' : 'sent';
    await transaction`
      UPDATE backoffice.invoices
      SET
        status = ${nextStatus},
        paid_at = ${nextStatus === 'paid' ? paidAt : null},
        version = version + 1
      WHERE id = ${invoice.id}
    `;
    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, invoice_id, actor_type, actor_id,
        event_type, from_status, to_status, details
      ) VALUES (
        'payment', ${paymentId}, ${invoice.id}, ${auditActor.type}, ${auditActor.id},
        'payment.recorded', ${invoice.status}, ${nextStatus},
        ${transaction.json({ amountMinor: amountMinor.toString(), currency })}
      )
    `;
    return invoice.id;
  });
  return requireInvoice(invoiceId);
}

export async function reversePayment(
  paymentId: string,
  idempotencyKey: string,
  reason?: string | null,
  actor?: AuditActor
): Promise<InvoiceDetail> {
  const originalPaymentId = UuidSchema.parse(paymentId);
  const key = z.string().trim().min(8).max(200).parse(idempotencyKey);
  const reversalReason = OptionalTextSchema(1_000).parse(reason);
  const auditActor = actorValues(actor);
  const sql = getDb();

  const invoiceId = await sql.begin(async (transaction) => {
    const [duplicate] = await transaction<{ invoice_id: string }[]>`
      SELECT invoice_id FROM backoffice.invoice_payments WHERE idempotency_key = ${key}
    `;
    if (duplicate) return duplicate.invoice_id;

    const [original] = await transaction<
      {
        id: string;
        invoice_id: string;
        kind: PaymentKind;
        amount_minor: string;
        currency: string;
        status: PersistedInvoiceStatus;
        total_minor: string;
      }[]
    >`
      SELECT
        p.id, p.invoice_id, p.kind, p.amount_minor::text, p.currency,
        i.status, i.total_minor::text
      FROM backoffice.invoice_payments p
      JOIN backoffice.invoices i ON i.id = p.invoice_id
      WHERE p.id = ${originalPaymentId}
      FOR UPDATE OF i, p
    `;
    if (!original) throw new DomainError('NOT_FOUND', 'Payment not found');
    if (original.kind !== 'payment') {
      throw new DomainError('INVALID_STATE', 'Only payments can be reversed');
    }
    if (!['sent', 'paid'].includes(original.status)) {
      throw new DomainError('INVALID_STATE', 'Invoice cannot accept a reversal');
    }

    const reversalId = randomUUID();
    await transaction`
      INSERT INTO backoffice.invoice_payments (
        id, invoice_id, kind, amount_minor, currency, paid_at,
        idempotency_key, reverses_payment_id, note
      ) VALUES (
        ${reversalId}, ${original.invoice_id}, 'reversal', ${original.amount_minor},
        ${original.currency}, now(), ${key}, ${original.id}, ${optionalText(reversalReason)}
      )
    `;
    const [current] = await transaction<{ paid_minor: string }[]>`
      SELECT COALESCE(SUM(
        CASE WHEN kind = 'payment' THEN amount_minor ELSE -amount_minor END
      ), 0)::text AS paid_minor
      FROM backoffice.invoice_payments
      WHERE invoice_id = ${original.invoice_id}
    `;
    const paidMinor = BigInt(current.paid_minor);
    const nextStatus: PersistedInvoiceStatus =
      paidMinor === BigInt(original.total_minor) ? 'paid' : 'sent';
    await transaction`
      UPDATE backoffice.invoices
      SET
        status = ${nextStatus}, paid_at = ${nextStatus === 'paid' ? new Date() : null},
        version = version + 1
      WHERE id = ${original.invoice_id}
    `;
    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, invoice_id, actor_type, actor_id,
        event_type, from_status, to_status, details
      ) VALUES (
        'payment', ${reversalId}, ${original.invoice_id},
        ${auditActor.type}, ${auditActor.id}, 'payment.reversed',
        ${original.status}, ${nextStatus},
        ${transaction.json({ paymentId: original.id, reason: optionalText(reversalReason) })}
      )
    `;
    return original.invoice_id;
  });
  return requireInvoice(invoiceId);
}

export async function recordInvoicePdf(
  input: RecordInvoicePdfInput,
  actor?: AuditActor
): Promise<InvoiceDocumentRecord> {
  const parsed = z
    .object({
      invoiceId: UuidSchema,
      snapshotId: UuidSchema,
      storageKey: z.string().trim().min(1).max(1_024),
      byteSize: z.bigint().positive(),
      contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
      contentType: z.string().trim().max(120).optional(),
      templateVersion: z.string().trim().max(80).optional(),
    })
    .parse(input);
  const auditActor = actorValues(actor);
  const sql = getDb();

  const row = await sql.begin(async (transaction) => {
    const [document] = await transaction<DocumentRow[]>`
      SELECT
        id, invoice_id, snapshot_id, kind, status, template_version,
        storage_key, content_type, byte_size::text, content_sha256, error_code,
        generated_at, created_at, updated_at
      FROM backoffice.invoice_documents
      WHERE
        invoice_id = ${parsed.invoiceId}
        AND snapshot_id = ${parsed.snapshotId}
        AND kind = 'invoice_pdf'
        AND template_version = ${parsed.templateVersion ?? 'v1'}
      FOR UPDATE
    `;
    if (!document) throw new DomainError('NOT_FOUND', 'Queued invoice PDF not found');
    if (document.status === 'ready') {
      if (
        document.storage_key === parsed.storageKey &&
        document.content_sha256 === parsed.contentSha256
      ) return document;
      throw new DomainError('CONFLICT', 'Invoice PDF metadata is already finalized');
    }

    const [updated] = await transaction<DocumentRow[]>`
      UPDATE backoffice.invoice_documents
      SET
        status = 'ready', storage_key = ${parsed.storageKey},
        content_type = ${parsed.contentType ?? 'application/pdf'},
        byte_size = ${parsed.byteSize.toString()}, content_sha256 = ${parsed.contentSha256},
        error_code = NULL, generated_at = now()
      WHERE id = ${document.id}
      RETURNING
        id, invoice_id, snapshot_id, kind, status, template_version,
        storage_key, content_type, byte_size::text, content_sha256, error_code,
        generated_at, created_at, updated_at
    `;
    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, invoice_id, actor_type, actor_id, event_type, details
      ) VALUES (
        'document', ${updated.id}, ${updated.invoice_id}, ${auditActor.type}, ${auditActor.id},
        'invoice.pdf.ready', ${transaction.json({ sha256: updated.content_sha256 })}
      )
    `;
    await transaction`
      UPDATE backoffice.outbox_events
      SET processed_at = now(), last_error_code = NULL
      WHERE
        topic = 'invoice.pdf.generate'
        AND payload ->> 'documentId' = ${updated.id}
        AND processed_at IS NULL
    `;
    return updated;
  });
  return mapDocument(row);
}

export async function queueInvoiceEmail(
  input: QueueInvoiceEmailInput,
  actor?: AuditActor
): Promise<InvoiceEmailRecord> {
  const parsed = z
    .object({
      invoiceId: UuidSchema,
      purpose: z.enum(['invoice', 'reminder', 'receipt']),
      recipient: z.string().trim().email().max(254),
      idempotencyKey: z.string().trim().min(8).max(200),
    })
    .parse(input);
  const auditActor = actorValues(actor);
  const sql = getDb();

  const row = await sql.begin(async (transaction) => {
    const [existing] = await transaction<EmailRow[]>`
      SELECT
        id, invoice_id, snapshot_id, purpose, recipient, status, provider,
        provider_message_id, attempts, error_code, queued_at, sent_at,
        delivered_at, created_at, updated_at
      FROM backoffice.invoice_email_messages
      WHERE idempotency_key = ${parsed.idempotencyKey}
    `;
    if (existing) return existing;

    const [snapshot] = await transaction<{ id: string; status: PersistedInvoiceStatus }[]>`
      SELECT s.id, i.status
      FROM backoffice.invoice_snapshots s
      JOIN backoffice.invoices i ON i.id = s.invoice_id
      WHERE s.invoice_id = ${parsed.invoiceId}
    `;
    if (!snapshot) throw new DomainError('NOT_FOUND', 'Finalized invoice snapshot not found');
    if (snapshot.status === 'void') {
      throw new DomainError('INVALID_STATE', 'Cannot email a void invoice');
    }

    const [created] = await transaction<EmailRow[]>`
      INSERT INTO backoffice.invoice_email_messages (
        invoice_id, snapshot_id, purpose, recipient, status, idempotency_key
      ) VALUES (
        ${parsed.invoiceId}, ${snapshot.id}, ${parsed.purpose},
        ${parsed.recipient.toLowerCase()}, 'queued', ${parsed.idempotencyKey}
      )
      RETURNING
        id, invoice_id, snapshot_id, purpose, recipient, status, provider,
        provider_message_id, attempts, error_code, queued_at, sent_at,
        delivered_at, created_at, updated_at
    `;
    await transaction`
      INSERT INTO backoffice.outbox_events (
        topic, aggregate_id, idempotency_key, payload
      ) VALUES (
        'invoice.email.send', ${parsed.invoiceId}, ${`email:${created.id}`},
        ${transaction.json({ invoiceId: parsed.invoiceId, emailMessageId: created.id })}
      )
    `;
    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, invoice_id, actor_type, actor_id, event_type, details
      ) VALUES (
        'email', ${created.id}, ${parsed.invoiceId}, ${auditActor.type}, ${auditActor.id},
        'invoice.email.queued', ${transaction.json({ purpose: parsed.purpose })}
      )
    `;
    return created;
  });
  return mapEmail(row);
}

const EmailTransitions: Record<InvoiceEmailStatus, readonly InvoiceEmailStatus[]> = {
  queued: ['sending', 'sent', 'failed', 'cancelled'],
  sending: ['sent', 'failed', 'cancelled'],
  sent: ['delivered', 'bounced', 'failed'],
  delivered: [],
  bounced: [],
  failed: [],
  cancelled: [],
};

export async function updateInvoiceEmailStatus(
  id: string,
  status: InvoiceEmailStatus,
  metadata: InvoiceEmailStatusMetadata = {},
  actor?: AuditActor
): Promise<InvoiceEmailRecord> {
  const emailId = UuidSchema.parse(id);
  const nextStatus = z
    .enum(['queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'cancelled'])
    .parse(status);
  const auditActor = actorValues(actor);
  const sql = getDb();

  const row = await sql.begin(async (transaction) => {
    const [existing] = await transaction<EmailRow[]>`
      SELECT
        id, invoice_id, snapshot_id, purpose, recipient, status, provider,
        provider_message_id, attempts, error_code, queued_at, sent_at,
        delivered_at, created_at, updated_at
      FROM backoffice.invoice_email_messages
      WHERE id = ${emailId}
      FOR UPDATE
    `;
    if (!existing) throw new DomainError('NOT_FOUND', 'Invoice email not found');
    if (existing.status === nextStatus) return existing;
    if (!EmailTransitions[existing.status].includes(nextStatus)) {
      throw new DomainError(
        'INVALID_STATE',
        `Invalid email transition: ${existing.status} -> ${nextStatus}`
      );
    }

    const sentAt = metadata.sentAt
      ? new Date(z.string().datetime({ offset: true }).parse(metadata.sentAt))
      : nextStatus === 'sent'
        ? new Date()
        : existing.sent_at;
    const deliveredAt = metadata.deliveredAt
      ? new Date(z.string().datetime({ offset: true }).parse(metadata.deliveredAt))
      : nextStatus === 'delivered'
        ? new Date()
        : existing.delivered_at;

    const [updated] = await transaction<EmailRow[]>`
      UPDATE backoffice.invoice_email_messages
      SET
        status = ${nextStatus},
        provider = ${optionalText(metadata.provider) ?? existing.provider},
        provider_message_id = ${optionalText(metadata.providerMessageId) ?? existing.provider_message_id},
        error_code = ${optionalText(metadata.errorCode)},
        attempts = attempts + ${nextStatus === 'sending' ? 1 : 0},
        sent_at = ${sentAt},
        delivered_at = ${deliveredAt}
      WHERE id = ${existing.id}
      RETURNING
        id, invoice_id, snapshot_id, purpose, recipient, status, provider,
        provider_message_id, attempts, error_code, queued_at, sent_at,
        delivered_at, created_at, updated_at
    `;
    if (['sent', 'delivered', 'bounced', 'failed', 'cancelled'].includes(nextStatus)) {
      await transaction`
        UPDATE backoffice.outbox_events
        SET
          processed_at = now(),
          last_error_code = ${nextStatus === 'failed' || nextStatus === 'bounced'
            ? optionalText(metadata.errorCode) ?? nextStatus
            : null}
        WHERE
          topic = 'invoice.email.send'
          AND payload ->> 'emailMessageId' = ${existing.id}
          AND processed_at IS NULL
      `;
    }
    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, invoice_id, actor_type, actor_id,
        event_type, from_status, to_status, details
      ) VALUES (
        'email', ${updated.id}, ${updated.invoice_id}, ${auditActor.type}, ${auditActor.id},
        'invoice.email.status_changed', ${existing.status}, ${updated.status}, '{}'::jsonb
      )
    `;
    return updated;
  });
  return mapEmail(row);
}
