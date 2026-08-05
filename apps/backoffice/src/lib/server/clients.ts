import 'server-only';

import { z } from 'zod';

import { normalizeCurrency } from '@/lib/money';
import {
  DomainError,
  getDb,
  type AuditActor,
} from '@/lib/server/db';
import { AuthorizationError, type AccessScope } from '@/lib/server/session';

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
  ownerUserId: z.string().uuid().nullish(),
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
  ownerUserId?: string | null;
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
  ownerUserId: string | null;
  ownerName: string | null;
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
  owner_user_id: string | null;
  owner_name: string | null;
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
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
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

/**
 * List clients visible to the caller.
 *
 * `scope` is required rather than optional on purpose: an omitted scope would
 * silently return every client, so the type system is used to make each call
 * site state whose view it is rendering.
 */
export async function listClients(
  scope: AccessScope,
  options: ClientListOptions = {}
): Promise<ClientRecord[]> {
  const parsed = ClientListOptionsSchema.parse(options);
  const sql = getDb();
  const search = parsed.search ? `%${parsed.search}%` : null;
  const limit = parsed.limit ?? 50;
  const offset = parsed.offset ?? 0;
  const owner = scope.ownerUserId;

  const rows = await sql<ClientRow[]>`
    SELECT
      c.id, c.name, c.company_name, c.email, c.phone, c.tax_id,
      c.billing_address, c.default_currency, c.owner_user_id,
      u.name AS owner_name,
      c.archived_at, c.version, c.created_at, c.updated_at
    FROM backoffice.clients c
    LEFT JOIN backoffice.users u ON u.id = c.owner_user_id
    WHERE
      (${parsed.includeArchived ?? false} OR c.archived_at IS NULL)
      AND (${owner}::uuid IS NULL OR c.owner_user_id = ${owner})
      AND (
        ${search}::text IS NULL
        OR c.name ILIKE ${search}
        OR c.company_name ILIKE ${search}
        OR c.email ILIKE ${search}
      )
    ORDER BY c.archived_at NULLS FIRST, lower(c.name), c.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
  return rows.map(mapClient);
}

/**
 * Fetch one client, or null when it does not exist *or* is not visible to the
 * caller. The two cases are deliberately indistinguishable so that a sales
 * user cannot probe for the existence of clients they do not own.
 */
export async function getClient(
  scope: AccessScope,
  id: string
): Promise<ClientRecord | null> {
  const clientId = IdSchema.parse(id);
  const sql = getDb();
  const owner = scope.ownerUserId;

  const [row] = await sql<ClientRow[]>`
    SELECT
      c.id, c.name, c.company_name, c.email, c.phone, c.tax_id,
      c.billing_address, c.default_currency, c.owner_user_id,
      u.name AS owner_name,
      c.archived_at, c.version, c.created_at, c.updated_at
    FROM backoffice.clients c
    LEFT JOIN backoffice.users u ON u.id = c.owner_user_id
    WHERE c.id = ${clientId}
      AND (${owner}::uuid IS NULL OR c.owner_user_id = ${owner})
  `;
  return row ? mapClient(row) : null;
}

/** Guard for write paths: resolves the client or refuses. */
export async function requireVisibleClient(
  scope: AccessScope,
  id: string
): Promise<ClientRecord> {
  const client = await getClient(scope, id);
  if (!client) {
    throw new AuthorizationError('That client is not available to you');
  }
  return client;
}

/**
 * Create a client.
 *
 * A sales user always owns what they create -- an unassigned client would be
 * invisible to them the moment it was saved. Only an admin may hand a client
 * to someone else, or leave it unassigned.
 */
export async function createClient(
  scope: AccessScope,
  input: ClientInput,
  actor?: AuditActor
): Promise<ClientRecord> {
  const parsed = ClientInputSchema.parse(input);
  const auditActor = actorValues(actor);
  const currency = normalizeCurrency(parsed.defaultCurrency ?? 'IDR');
  const ownerUserId =
    scope.user.role === 'admin' ? parsed.ownerUserId ?? null : scope.user.id;
  const sql = getDb();

  const row = await sql.begin(async (transaction) => {
    const [created] = await transaction<ClientRow[]>`
      INSERT INTO backoffice.clients (
        name, company_name, email, phone, tax_id, billing_address,
        default_currency, owner_user_id
      ) VALUES (
        ${parsed.name},
        ${normalizeOptional(parsed.companyName)},
        ${parsed.email.toLowerCase()},
        ${normalizeOptional(parsed.phone)},
        ${normalizeOptional(parsed.taxId)},
        ${transaction.json(parsed.billingAddress ?? {})},
        ${currency},
        ${ownerUserId}
      )
      RETURNING
        id, name, company_name, email, phone, tax_id, billing_address,
        default_currency, owner_user_id, NULL::text AS owner_name,
        archived_at, version, created_at, updated_at
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
  scope: AccessScope,
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

  // Refuses before any write if the client is outside the caller's scope.
  const current = await requireVisibleClient(scope, clientId);
  // Reassignment is an admin power; a sales user cannot give a client away
  // (nor keep one by rewriting the field).
  const ownerUserId =
    scope.user.role === 'admin' ? parsed.ownerUserId ?? null : current.ownerUserId;

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
        owner_user_id = ${ownerUserId},
        version = version + 1
      WHERE id = ${clientId} AND version = ${expectedVersion}
      RETURNING
        id, name, company_name, email, phone, tax_id, billing_address,
        default_currency, owner_user_id, NULL::text AS owner_name,
        archived_at, version, created_at, updated_at
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
  scope: AccessScope,
  id: string,
  expectedVersion: number,
  actor?: AuditActor
): Promise<ClientRecord> {
  const clientId = IdSchema.parse(id);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new DomainError('VALIDATION_ERROR', 'Expected version must be positive');
  }

  await requireVisibleClient(scope, clientId);

  const auditActor = actorValues(actor);
  const sql = getDb();
  const row = await sql.begin(async (transaction) => {
    const [archived] = await transaction<ClientRow[]>`
      UPDATE backoffice.clients
      SET archived_at = COALESCE(archived_at, now()), version = version + 1
      WHERE id = ${clientId} AND version = ${expectedVersion}
      RETURNING
        id, name, company_name, email, phone, tax_id, billing_address,
        default_currency, owner_user_id, NULL::text AS owner_name,
        archived_at, version, created_at, updated_at
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
