import { z } from 'zod';
import { requireAdminSession } from '@/lib/server/session';
import { getOfficeRuntime, officeEnabled } from '@/lib/server/office';
import { officeError, officeJson } from '@/lib/server/office-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdminSession();
    if (!officeEnabled()) return officeJson({ error: 'Office disabled', code: 'configuration_required' }, 503);
    const id = z.uuid().parse((await context.params).id);
    const workspaceId = z.uuid().parse(new URL(request.url).searchParams.get('workspaceId'));
    const artifact = await getOfficeRuntime().artifact(workspaceId, id);
    if (!artifact) return officeJson({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
    return officeJson(artifact);
  } catch (error) { return officeError(error); }
}
