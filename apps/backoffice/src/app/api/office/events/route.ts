import { z } from 'zod';
import { requireAdminSession } from '@/lib/server/session';
import { getOfficeRuntime, officeEnabled } from '@/lib/server/office';
import { officeError, officeJson } from '@/lib/server/office-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Short polling reauthenticates every replay; closing a tab never owns a lease.
export async function GET(request: Request) {
  try {
    await requireAdminSession();
    if (!officeEnabled()) return officeJson({ error: 'Office disabled', code: 'configuration_required' }, 503);
    const params = new URL(request.url).searchParams;
    const workspaceId = z.uuid().parse(params.get('workspaceId'));
    const after = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(params.get('after') ?? request.headers.get('last-event-id') ?? 0);
    const limit = z.coerce.number().int().min(1).max(100).parse(params.get('limit') ?? 100);
    return officeJson(await getOfficeRuntime().events(workspaceId, after, limit));
  } catch (error) { return officeError(error); }
}
