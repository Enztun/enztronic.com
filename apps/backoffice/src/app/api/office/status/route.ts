import { z } from 'zod';
import { requireAdminSession } from '@/lib/server/session';
import { officeEnabled } from '@/lib/server/office';
import { getOfficeReadModel } from '@/lib/server/office-dashboard';
import { officeError, officeJson } from '@/lib/server/office-http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Read-only worker, role and run evidence. Reauthenticates every poll.
export async function GET(request: Request) {
  try {
    await requireAdminSession();
    if (!officeEnabled()) return officeJson({ error: 'Office disabled', code: 'configuration_required' }, 503);
    const params = new URL(request.url).searchParams;
    const workspaceId = z.uuid().optional().parse(params.get('workspaceId') ?? undefined);
    // A selected task's family is rechecked against the task's own workspace; both are required together.
    const task = z.object({ taskId: z.uuid(), taskWorkspaceId: z.uuid() }).strict().optional().parse(params.has('taskId') || params.has('taskWorkspaceId') ? { taskId: params.get('taskId'), taskWorkspaceId: params.get('taskWorkspaceId') } : undefined);
    return officeJson(await getOfficeReadModel().activity({ workspaceId: workspaceId ?? null, task: task ? { workspaceId: task.taskWorkspaceId, taskId: task.taskId } : null }));
  } catch (error) { return officeError(error); }
}
