import 'server-only';

import { z } from 'zod';

import { normalizeCurrency } from '@/lib/money';
import {
  DomainError,
  getDb,
  type AuditActor,
} from '@/lib/server/db';

const IdSchema = z.string().uuid();
const BillingAddressSchema = z
  .object({
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().max(120).optional(),
    province: z.string().trim().max(120).optional(),
    postalCode: z.string().trim().max(24).optional(),
    country: z.string().trim().max(80).optional(),
  })
  .strict();

const ClientInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  companyName: z.string().trim().max(160).nullish(),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(50).nullish(),
  taxId: z.string().trim().max(80).nullish(),
  billingAddress: BillingAddressSchema.optional(),
  defaultCurrency: z.string().trim().length(3).optional(),
});

const ClientListOptionsSchema = z.object({
  search: z.string().trim().max(160).optional(),
  includeArchived: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
});

export type BillingAddress = z.infer<typeof BillingAddressSchema>;

export type ClientInput = {
  name: string;
  companyName?: string | null;
  email: string;
  phone?: string | null;
  taxId?: string | null;
  billingAddress?: BillingAddress;
  defaultCurrency?: string;
};

export type ClientListOptions = {
  search?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
};

export type ClientRecord = {
  id: string;
  name: string;
  companyName: string | null;
  email: string;
  phone: string | null;
  taxId: string | null;
  billingAddress: BillingAddress;
  defaultCurrency: string;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type ClientRow = {
  id: string;
  name: string;
  company_name: string | null;
  email: string;
  phone: string | null;
  tax_id: string | null;
  billing_address: BillingAddress;
  default_currency: string;
  archived_at: Date | string | null;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

function toIso(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapClient(row: ClientRow): ClientRecord {
  return {
    id: row.id,
    name: row.name,
    companyName: row.company_name,
    email: row.email,
    phone: row.phone,
    taxId: row.tax_id,
    billingAddress: row.billing_address ?? {},
    defaultCurrency: row.default_currency,
    archivedAt: toIso(row.archived_at),
    version: Number(row.version),
    createdAt: toIso(row.created_at)!,
    updatedAt: toIso(row.updated_at)!,
  };
}

function normalizeOptional(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function actorValues(actor: AuditActor | undefined) {
  return {
    type: actor?.type ?? 'owner',
    id: actor?.id ?? null,
  } as const;
}

export async function listClients(
  options: ClientListOptions = {}
): Promise<ClientRecord[]> {
  const parsed = ClientListOptionsSchema.parse(options);
  const sql = getDb();
  const search = parsed.search ? `%${parsed.search}%` : null;
  const limit = parsed.limit ?? 50;
  const offset = parsed.offset ?? 0;

  const rows = await sql<ClientRow[]>`
    SELECT
      id, name, company_name, email, phone, tax_id, billing_address,
      default_currency, archived_at, version, created_at, updated_at
    FROM backoffice.clients
    WHERE
      (${parsed.includeArchived ?? false} OR archived_at IS NULL)
      AND (
        ${search}::text IS NULL
        OR name ILIKE ${search}
        OR company_name ILIKE ${search}
        OR email ILIKE ${search}
      )
    ORDER BY archived_at NULLS FIRST, lower(name), created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return rows.map(mapClient);
}

export async function getClient(id: string): Promise<ClientRecord | null> {
  const clientId = IdSchema.parse(id);
  const sql = getDb();
  const [row] = await sql<ClientRow[]>`
    SELECT
      id, name, company_name, email, phone, tax_id, billing_address,
      default_currency, archived_at, version, created_at, updated_at
    FROM backoffice.clients
    WHERE id = ${clientId}
  `;
  return row ? mapClient(row) : null;
}

export async function createClient(
  input: ClientInput,
  actor?: AuditActor
): Promise<ClientRecord> {
  const parsed = ClientInputSchema.parse(input);
  const auditActor = actorValues(actor);
  const currency = normalizeCurrency(parsed.defaultCurrency ?? 'IDR');
  const sql = getDb();

  const row = await sql.begin(async (transaction) => {
    const [created] = await transaction<ClientRow[]>`
      INSERT INTO backoffice.clients (
        name, company_name, email, phone, tax_id, billing_address, default_currency
      ) VALUES (
        ${parsed.name},
        ${normalizeOptional(parsed.companyName)},
        ${parsed.email.toLowerCase()},
        ${normalizeOptional(parsed.phone)},
        ${normalizeOptional(parsed.taxId)},
        ${transaction.json(parsed.billingAddress ?? {})},
        ${currency}
      )
      RETURNING
        id, name, company_name, email, phone, tax_id, billing_address,
        default_currency, archived_at, version, created_at, updated_at
    `;

    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, actor_type, actor_id, event_type, details
      ) VALUES (
        'client', ${created.id}, ${auditActor.type}, ${auditActor.id},
        'client.created', ${transaction.json({ name: created.name })}
      )
    `;
    return created;
  });

  return mapClient(row);
}

export async function updateClient(
  id: string,
  input: ClientInput,
  expectedVersion: number,
  actor?: AuditActor
): Promise<ClientRecord> {
  const clientId = IdSchema.parse(id);
  const parsed = ClientInputSchema.parse(input);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new DomainError('VALIDATION_ERROR', 'Expected version must be positive');
  }

  const auditActor = actorValues(actor);
  const currency = normalizeCurrency(parsed.defaultCurrency ?? 'IDR');
  const sql = getDb();
  const row = await sql.begin(async (transaction) => {
    const [updated] = await transaction<ClientRow[]>`
      UPDATE backoffice.clients
      SET
        name = ${parsed.name},
        company_name = ${normalizeOptional(parsed.companyName)},
        email = ${parsed.email.toLowerCase()},
        phone = ${normalizeOptional(parsed.phone)},
        tax_id = ${normalizeOptional(parsed.taxId)},
        billing_address = ${transaction.json(parsed.billingAddress ?? {})},
        default_currency = ${currency},
        version = version + 1
      WHERE id = ${clientId} AND version = ${expectedVersion}
      RETURNING
        id, name, company_name, email, phone, tax_id, billing_address,
        default_currency, archived_at, version, created_at, updated_at
    `;

    if (!updated) {
      const [existing] = await transaction<{ exists: boolean }[]>`
        SELECT true AS exists FROM backoffice.clients WHERE id = ${clientId}
      `;
      throw new DomainError(
        existing ? 'CONFLICT' : 'NOT_FOUND',
        existing ? 'Client was changed by another request' : 'Client not found'
      );
    }

    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, actor_type, actor_id, event_type,
        details
      ) VALUES (
        'client', ${updated.id}, ${auditActor.type}, ${auditActor.id},
        'client.updated', ${transaction.json({ version: Number(updated.version) })}
      )
    `;
    return updated;
  });

  return mapClient(row);
}

export async function archiveClient(
  id: string,
  expectedVersion: number,
  actor?: AuditActor
): Promise<ClientRecord> {
  const clientId = IdSchema.parse(id);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new DomainError('VALIDATION_ERROR', 'Expected version must be positive');
  }

  const auditActor = actorValues(actor);
  const sql = getDb();
  const row = await sql.begin(async (transaction) => {
    const [archived] = await transaction<ClientRow[]>`
      UPDATE backoffice.clients
      SET archived_at = COALESCE(archived_at, now()), version = version + 1
      WHERE id = ${clientId} AND version = ${expectedVersion}
      RETURNING
        id, name, company_name, email, phone, tax_id, billing_address,
        default_currency, archived_at, version, created_at, updated_at
    `;

    if (!archived) {
      const [existing] = await transaction<{ exists: boolean }[]>`
        SELECT true AS exists FROM backoffice.clients WHERE id = ${clientId}
      `;
      throw new DomainError(
        existing ? 'CONFLICT' : 'NOT_FOUND',
        existing ? 'Client was changed by another request' : 'Client not found'
      );
    }

    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, actor_type, actor_id, event_type, details
      ) VALUES (
        'client', ${archived.id}, ${auditActor.type}, ${auditActor.id},
        'client.archived', '{}'::jsonb
      )
    `;
    return archived;
  });

  return mapClient(row);
}
