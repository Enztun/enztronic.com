import { z } from 'zod';
import { requireAdminSession } from '@/lib/server/session';
import { getOfficeRuntime, officeEnabled, unavailableOfficeSnapshot } from '@/lib/server/office';
import { boundedOfficeBody, officeError, officeJson, sameOriginMutation } from '@/lib/server/office-http';
import { approvalDecisionSchema, artifactRevisionSchema, submitTaskSchema, taskActionSchema } from '@/lib/office-contracts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requireAdminSession();
    if (!officeEnabled()) return officeJson(unavailableOfficeSnapshot());
    const workspaceId = z.uuid().optional().parse(new URL(request.url).searchParams.get('workspaceId') ?? undefined);
    return officeJson(await getOfficeRuntime().snapshot(workspaceId));
  } catch (error) { return officeError(error); }
}

export async function POST(request: Request) {
  try {
    const owner = await requireAdminSession();
    sameOriginMutation(request);
    if (!officeEnabled()) return officeJson({ error: 'Office activation is disabled', code: 'configuration_required' }, 503);
    const body = z.object({ operation: z.enum(['submit', 'task_action', 'decide_approval', 'revise_artifact']), input: z.unknown() }).strict().parse(await boundedOfficeBody(request));
    const office = getOfficeRuntime();
    switch (body.operation) {
      case 'submit': return officeJson(await office.submitTask(owner.id, submitTaskSchema.parse(body.input)), 201);
      case 'task_action': return officeJson(await office.requestTaskAction(owner.id, taskActionSchema.parse(body.input)));
      case 'decide_approval': return officeJson(await office.decideApproval(owner.id, approvalDecisionSchema.parse(body.input)));
      case 'revise_artifact': return officeJson(await office.reviseArtifact(owner.id, artifactRevisionSchema.parse(body.input)));
    }
  } catch (error) { return officeError(error); }
}
