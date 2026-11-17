import type { OfficeMode } from '@/lib/office-contracts';

// Office deep links carry identifiers only. Brief text, notes and artifact
// content never enter a URL, browser history or analytics.
export const OFFICE_LINK_VIEWS = ['scene', 'tasks', 'inbox', 'activity', 'status'] as const;
export type OfficeLinkView = (typeof OFFICE_LINK_VIEWS)[number];
export type OfficeLinkTarget = { mode: OfficeMode; workspaceId?: string | null; taskId?: string | null; artifactId?: string | null; view?: OfficeLinkView | null };
export type OfficeLinkRequest =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'link'; mode: OfficeMode; workspaceId: string | null; taskId: string | null; artifactId: string | null; view: OfficeLinkView | null };
// Resolution never says whether a record exists in another workspace or mode. For `ok`,
// `artifactId` is the requested revision and `artifact` says whether it belongs to the task;
// an unavailable revision stays requested and is never replaced by another one.
export type OfficeLinkState =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'office_disabled' }
  | { status: 'unavailable' }
  | { status: 'not_found'; mode: OfficeMode }
  | { status: 'ok'; mode: OfficeMode; workspaceId: string | null; taskId: string | null; artifactId: string | null; artifact: 'none' | 'found' | 'not_found'; view: OfficeLinkView | null };

const LINK_KEYS = ['mode', 'workspace', 'task', 'artifact', 'view'] as const;
// RFC 9562 versioned UUIDs, as issued by gen_random_uuid() and the seeded workspaces. Kept
// dependency-free so the client bundle that builds links does not pull in a schema library.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES: readonly OfficeMode[] = ['demo', 'live'];

export function parseOfficeLink(params: URLSearchParams | Record<string, string | string[] | undefined>): OfficeLinkRequest {
  const raw: Record<string, string> = {};
  for (const key of LINK_KEYS) {
    const value = params instanceof URLSearchParams ? params.getAll(key) : params[key];
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    if (!values.length) continue;
    // Repeated parameters are ambiguous; never guess which record was meant.
    if (values.length !== 1 || values[0].length > 64) return { kind: 'invalid' };
    raw[key] = values[0];
  }
  if (!Object.keys(raw).length) return { kind: 'none' };
  const mode = raw.mode as OfficeMode | undefined;
  const view = raw.view as OfficeLinkView | undefined;
  if ((mode !== undefined && !MODES.includes(mode)) || (view !== undefined && !OFFICE_LINK_VIEWS.includes(view))) return { kind: 'invalid' };
  if ([raw.workspace, raw.task, raw.artifact].some((value) => value !== undefined && !UUID.test(value))) return { kind: 'invalid' };
  // A workspace names its mode, a task its workspace and an artifact its task.
  if ((raw.workspace && !mode) || (raw.task && !raw.workspace) || (raw.artifact && !raw.task)) return { kind: 'invalid' };
  const id = (value: string | undefined) => (value ? value.toLowerCase() : null);
  return { kind: 'link', mode: mode ?? 'demo', workspaceId: id(raw.workspace), taskId: id(raw.task), artifactId: id(raw.artifact), view: view ?? null };
}

/** `/team` alone is the demonstration overview; any other selection is explicit. */
export function officeHref(target: OfficeLinkTarget): string {
  const query = new URLSearchParams();
  const workspaceId = target.workspaceId || null;
  const taskId = workspaceId ? target.taskId || null : null;
  const artifactId = taskId ? target.artifactId || null : null;
  if (target.mode !== 'demo' || workspaceId || target.view) query.set('mode', target.mode);
  if (workspaceId) query.set('workspace', workspaceId);
  if (taskId) query.set('task', taskId);
  if (artifactId) query.set('artifact', artifactId);
  if (target.view) query.set('view', target.view);
  const search = query.toString();
  return search ? `/team?${search}` : '/team';
}
