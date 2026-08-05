import "server-only";

import { headers } from "next/headers";
import { z } from "zod";

import { authenticateAccessHeaders } from "@/lib/server/auth";
import { DomainError, getDb, type AuditActor } from "@/lib/server/db";

export type UserRole = "admin" | "sales";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  commissionRateBps: number;
}

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  commission_rate_bps: number | string;
};

export class AuthorizationError extends Error {
  constructor(message = "You do not have access to this resource") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * The visibility rule every read path is scoped against.
 *
 * `ownerUserId` is null for an admin, meaning "no ownership filter". For a
 * sales user it is their own id, and unassigned clients stay invisible to them.
 */
export interface AccessScope {
  user: SessionUser;
  ownerUserId: string | null;
}

function mapUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    commissionRateBps: Number(row.commission_rate_bps),
  };
}

/**
 * Resolve the Cloudflare Access identity to a back-office user.
 *
 * Access proves *who* the caller is; this proves they are still a provisioned
 * operator. Both boundaries matter: revoking a user here locks them out even
 * if the edge policy still lets them reach the app.
 */
export async function getSessionUser(): Promise<SessionUser> {
  const identity = await authenticateAccessHeaders(await headers());
  const email = identity.email.trim().toLowerCase();
  const sql = getDb();

  const [row] = await sql<UserRow[]>`
    SELECT id, email, name, role, commission_rate_bps
    FROM backoffice.users
    WHERE email = ${email} AND archived_at IS NULL
  `;

  if (!row) {
    throw new AuthorizationError(
      "This account is not provisioned for the back office",
    );
  }
  return mapUser(row);
}

export async function getAccessScope(): Promise<AccessScope> {
  const user = await getSessionUser();
  return {
    user,
    ownerUserId: user.role === "admin" ? null : user.id,
  };
}

export function auditActor(user: SessionUser): AuditActor {
  return { type: user.role, id: user.email };
}

/** Throw unless the caller is an admin. Use for money and settings paths. */
export function requireAdmin(user: SessionUser): void {
  if (user.role !== "admin") {
    throw new AuthorizationError(
      "Only an administrator can perform this action",
    );
  }
}

export async function requireAdminSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  requireAdmin(user);
  return user;
}

// -- user administration ----------------------------------------------------

const UserInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(160),
  role: z.enum(["admin", "sales"]),
  commissionRateBps: z.number().int().min(0).max(10_000),
});

export type UserInput = z.infer<typeof UserInputSchema>;

export type UserRecord = SessionUser & {
  archivedAt: string | null;
  version: number;
};

type FullUserRow = UserRow & {
  archived_at: Date | string | null;
  version: number | string;
};

function mapFullUser(row: FullUserRow): UserRecord {
  return {
    ...mapUser(row),
    archivedAt:
      row.archived_at === null
        ? null
        : new Date(row.archived_at).toISOString(),
    version: Number(row.version),
  };
}

export async function listUsers(): Promise<UserRecord[]> {
  const sql = getDb();
  const rows = await sql<FullUserRow[]>`
    SELECT id, email, name, role, commission_rate_bps, archived_at, version
    FROM backoffice.users
    ORDER BY archived_at NULLS FIRST, role, lower(name)
  `;
  return rows.map(mapFullUser);
}

/** Sales users available as client owners, for the assignment dropdown. */
export async function listAssignableOwners(): Promise<SessionUser[]> {
  const sql = getDb();
  const rows = await sql<UserRow[]>`
    SELECT id, email, name, role, commission_rate_bps
    FROM backoffice.users
    WHERE archived_at IS NULL
    ORDER BY role, lower(name)
  `;
  return rows.map(mapUser);
}

export async function createUser(
  input: UserInput,
  actor?: AuditActor,
): Promise<UserRecord> {
  const parsed = UserInputSchema.parse(input);
  const sql = getDb();

  const row = await sql.begin(async (transaction) => {
    const [existing] = await transaction<{ id: string }[]>`
      SELECT id FROM backoffice.users WHERE email = ${parsed.email}
    `;
    if (existing) {
      throw new DomainError("CONFLICT", "A user with that email already exists");
    }

    const [created] = await transaction<FullUserRow[]>`
      INSERT INTO backoffice.users (email, name, role, commission_rate_bps)
      VALUES (
        ${parsed.email}, ${parsed.name}, ${parsed.role},
        ${parsed.commissionRateBps}
      )
      RETURNING id, email, name, role, commission_rate_bps, archived_at, version
    `;

    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, actor_type, actor_id, event_type, details
      ) VALUES (
        'business', ${created.id}, ${actor?.type ?? "admin"}, ${actor?.id ?? null},
        'user.created',
        ${transaction.json({ email: created.email, role: created.role })}
      )
    `;
    return created;
  });

  return mapFullUser(row);
}

export async function updateUser(
  id: string,
  input: UserInput,
  expectedVersion: number,
  actor?: AuditActor,
): Promise<UserRecord> {
  const userId = z.string().uuid().parse(id);
  const parsed = UserInputSchema.parse(input);
  const sql = getDb();

  const row = await sql.begin(async (transaction) => {
    const [updated] = await transaction<FullUserRow[]>`
      UPDATE backoffice.users
      SET email = ${parsed.email},
          name = ${parsed.name},
          role = ${parsed.role},
          commission_rate_bps = ${parsed.commissionRateBps},
          version = version + 1
      WHERE id = ${userId} AND version = ${expectedVersion}
      RETURNING id, email, name, role, commission_rate_bps, archived_at, version
    `;

    if (!updated) {
      const [exists] = await transaction<{ ok: boolean }[]>`
        SELECT true AS ok FROM backoffice.users WHERE id = ${userId}
      `;
      throw new DomainError(
        exists ? "CONFLICT" : "NOT_FOUND",
        exists ? "User was changed by another request" : "User not found",
      );
    }

    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, actor_type, actor_id, event_type, details
      ) VALUES (
        'business', ${updated.id}, ${actor?.type ?? "admin"}, ${actor?.id ?? null},
        'user.updated', ${transaction.json({ role: updated.role })}
      )
    `;
    return updated;
  });

  return mapFullUser(row);
}

/**
 * Archive a user. Refuses to remove the last active admin, which would leave
 * the back office with no one able to finalize invoices or manage users.
 */
export async function archiveUser(
  id: string,
  expectedVersion: number,
  actor?: AuditActor,
): Promise<UserRecord> {
  const userId = z.string().uuid().parse(id);
  const sql = getDb();

  const row = await sql.begin(async (transaction) => {
    const [target] = await transaction<{ role: UserRole }[]>`
      SELECT role FROM backoffice.users
      WHERE id = ${userId} AND archived_at IS NULL
    `;
    if (target?.role === "admin") {
      const [{ count }] = await transaction<{ count: string }[]>`
        SELECT count(*) AS count FROM backoffice.users
        WHERE role = 'admin' AND archived_at IS NULL
      `;
      if (Number(count) <= 1) {
        throw new DomainError(
          "INVALID_STATE",
          "The last administrator cannot be archived",
        );
      }
    }

    const [archived] = await transaction<FullUserRow[]>`
      UPDATE backoffice.users
      SET archived_at = COALESCE(archived_at, now()), version = version + 1
      WHERE id = ${userId} AND version = ${expectedVersion}
      RETURNING id, email, name, role, commission_rate_bps, archived_at, version
    `;

    if (!archived) {
      const [exists] = await transaction<{ ok: boolean }[]>`
        SELECT true AS ok FROM backoffice.users WHERE id = ${userId}
      `;
      throw new DomainError(
        exists ? "CONFLICT" : "NOT_FOUND",
        exists ? "User was changed by another request" : "User not found",
      );
    }

    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type, entity_id, actor_type, actor_id, event_type, details
      ) VALUES (
        'business', ${archived.id}, ${actor?.type ?? "admin"}, ${actor?.id ?? null},
        'user.archived', '{}'::jsonb
      )
    `;
    return archived;
  });

  return mapFullUser(row);
}
