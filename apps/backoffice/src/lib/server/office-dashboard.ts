import 'server-only';

import type { OfficeDashboardData } from '@/lib/office-activity';
import { getDb } from '@/lib/server/db';
import { officeEnabled } from '@/lib/server/office';
import { createOfficeReadModel } from '@/lib/server/office-read-model';
import { requireAdmin, type SessionUser } from '@/lib/server/session';

/** SQLSTATEs that mean the additive Office schema is absent or incomplete. */
const SCHEMA_MISSING = new Set(['42P01', '3F000', '42883', '42703']);

export function officeStorageFailure(error: unknown): 'schema_missing' | 'storage_error' {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
  return SCHEMA_MISSING.has(code) ? 'schema_missing' : 'storage_error';
}

/** Constructs no runtime and opens no connection until first query. Check officeEnabled() first. */
export function getOfficeReadModel() {
  return createOfficeReadModel(getDb());
}

/**
 * Admin-only dashboard summary. Authorization precedes every Office decision;
 * a disabled Office never touches the database. A storage failure is reported
 * as unavailable, never as zero counts.
 */
export async function loadOfficeDashboard(user: SessionUser): Promise<OfficeDashboardData> {
  requireAdmin(user);
  if (!officeEnabled()) return { state: 'disabled' };
  try {
    return await getOfficeReadModel().dashboard();
  } catch (error) {
    const reason = officeStorageFailure(error);
    console.error('Office dashboard summary unavailable', { reason, code: typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : null, name: error instanceof Error ? error.name : 'UnknownError' });
    return { state: 'unavailable', reason };
  }
}
