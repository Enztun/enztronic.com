import 'server-only';

import postgres from 'postgres';

import { getDatabaseEnv } from '@/lib/env';

export type DbClient = ReturnType<typeof postgres>;

export type AuditActor = {
  /**
   * 'owner' is retained only for rows written before named users existed;
   * new writes use the actor's role.
   */
  type: 'owner' | 'admin' | 'sales' | 'system';
  id?: string;
};

export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

let database: DbClient | null = null;

export function getDb(): DbClient {
  if (!database) {
    const { databaseUrl } = getDatabaseEnv();
    database = postgres(databaseUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      max_lifetime: 60 * 30,
      onnotice: () => undefined,
    });
  }
  return database;
}

export async function closeDbForTests() {
  if (!database) return;
  const activeDatabase = database;
  database = null;
  await activeDatabase.end({ timeout: 1 });
}
