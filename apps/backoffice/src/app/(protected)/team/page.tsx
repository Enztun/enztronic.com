import type { Metadata } from 'next';
import Link from 'next/link';
import { OfficeView } from '@/components/office/OfficeView';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import type { OfficeActivity, OfficeAvailability } from '@/lib/office-activity';
import type { OfficeWorkspace } from '@/lib/office-contracts';
import { parseOfficeLink, type OfficeLinkState } from '@/lib/office-links';
import { getOfficeReadModel } from '@/lib/server/office-dashboard';
import { AuthorizationError, requireAdminSession } from '@/lib/server/session';
import { getOfficeRuntime, officeEnabled, unavailableOfficeSnapshot } from '@/lib/server/office';

export const metadata: Metadata = { title: 'Office' };
export const dynamic = 'force-dynamic';

// No Office record, link resolution or query happens for a non-administrator.
function OfficeAccessDenied() {
  return <>
    <PageHeader eyebrow="Office" title="Administrator access required" description="Office records are available only to active administrators. This page did not load or check any Office data." />
    <Card className="mt-8 p-5"><p className="text-sm leading-6 text-muted">If you expected access, ask an administrator to review your account under Settings → Access. <Link className="text-accent underline" href="/dashboard">Return to the dashboard</Link>.</p></Card>
  </>;
}

export default async function OfficePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  try { await requireAdminSession(); }
  catch (error) { if (error instanceof AuthorizationError) return <OfficeAccessDenied />; throw error; }
  const request = parseOfficeLink(await searchParams);
  let snapshot = unavailableOfficeSnapshot();
  let availability: OfficeAvailability = 'disabled';
  let link: OfficeLinkState = request.kind === 'none' ? { status: 'none' } : request.kind === 'invalid' ? { status: 'invalid' } : { status: 'office_disabled' };
  let catalog: OfficeWorkspace[] | undefined;
  let activity: OfficeActivity | null = null;
  if (officeEnabled()) {
    try {
      const readModel = getOfficeReadModel();
      // The link is rechecked against its exact mode, workspace and task before anything is selected.
      if (request.kind === 'link') link = await readModel.resolveLink(request);
      const workspaceId = link.status === 'ok' ? link.workspaceId : null;
      [snapshot, catalog] = await Promise.all([getOfficeRuntime().snapshot(workspaceId ?? undefined), workspaceId ? readModel.workspaces() : undefined]);
      // Run evidence is optional for first paint; the page refreshes it and labels it unavailable meanwhile.
      // A linked task's family loads even when it is older than the snapshot's newest-task window.
      const linkedTask = link.status === 'ok' && link.workspaceId && link.taskId ? { workspaceId: link.workspaceId, taskId: link.taskId } : null;
      activity = await readModel.activity({ workspaceId, task: linkedTask }).catch(() => null);
      availability = 'available';
    } catch {
      snapshot = unavailableOfficeSnapshot('Office storage is unavailable. Check the reviewed migration and worker configuration.');
      availability = 'storage_unavailable';
      if (request.kind === 'link') link = { status: 'unavailable' };
    }
  }
  return <OfficeView initialSnapshot={snapshot} initialAvailability={availability} initialLink={link} initialCatalog={catalog} initialActivity={activity} />;
}
