import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => createElement('a', { href, ...props }, children) }));
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  readModel: { dashboard: vi.fn(), activity: vi.fn(), resolveLink: vi.fn(), workspaces: vi.fn() },
  createReadModel: vi.fn(),
  runtime: { snapshot: vi.fn(), submitTask: vi.fn() },
  getRuntime: vi.fn(),
  requireAdminSession: vi.fn(),
  getAccessScope: vi.fn(),
  officeView: vi.fn(() => null),
  listClients: vi.fn(async () => []),
  listInvoices: vi.fn(async () => []),
  getEarningsSummary: vi.fn(async () => ({ byCurrency: [], commissionRateBps: 0 })),
}));
vi.mock('@/lib/server/db', () => ({ getDb: mocks.getDb }));
vi.mock('@/lib/server/office-read-model', () => ({ createOfficeReadModel: mocks.createReadModel }));
vi.mock('@/lib/server/office', () => ({
  officeEnabled: () => process.env.OFFICE_ENABLED === 'true',
  getOfficeRuntime: mocks.getRuntime,
  unavailableOfficeSnapshot: (reason = 'disabled') => ({ available: false, workspaces: [], agents: [], tasks: [], artifacts: [], reviews: [], approvals: [], events: [], latestSequence: 0, health: { workerOnline: false, lastHeartbeatAt: null, providerConfigured: false, commandExecutionEnabled: false, status: 'configuration_required', disclosure: reason }, configurationRequired: [reason], limits: { taskLimit: 100, eventLimit: 100 } }),
}));
vi.mock('@/lib/server/session', () => {
  class AuthorizationError extends Error {}
  return {
    AuthorizationError,
    requireAdminSession: mocks.requireAdminSession,
    getAccessScope: mocks.getAccessScope,
    requireAdmin: (user: { role: string }) => { if (user.role !== 'admin') throw new AuthorizationError('Only an administrator can perform this action'); },
  };
});
vi.mock('@/components/office/OfficeView', () => ({ OfficeView: mocks.officeView }));
vi.mock('@/lib/server/clients', () => ({ listClients: mocks.listClients }));
vi.mock('@/lib/server/invoices', () => ({ listInvoices: mocks.listInvoices }));
vi.mock('@/lib/server/earnings', () => ({ getEarningsSummary: mocks.getEarningsSummary }));

import { AuthorizationError } from '@/lib/server/session';
import { AccessAuthenticationError } from '@/lib/server/auth';
import { loadOfficeDashboard, officeStorageFailure } from './office-dashboard';
import { GET as status } from '@/app/api/office/status/route';
import { POST } from '@/app/api/office/route';
import OfficePage from '@/app/(protected)/team/page';
import DashboardPage from '@/app/(protected)/dashboard/page';
import { OfficeDashboardPanel } from '@/components/office/OfficeDashboardPanel';

const admin = { id: '10000000-0000-4000-8000-000000000001', email: 'owner@example.test', name: 'Owner fixture', role: 'admin' as const, commissionRateBps: 0 };
const sales = { ...admin, id: '10000000-0000-4000-8000-000000000002', email: 'sales@example.test', role: 'sales' as const };
const workspace = '00000000-0000-4000-8000-000000000001';
const task = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';
const base = 'http://localhost:3118';
const page = (params: Record<string, string>) => OfficePage({ searchParams: Promise.resolve(params) }) as Promise<ReactElement<Record<string, unknown>>>;

function findElement(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) { for (const child of node) { const found = findElement(child, type); if (found) return found; } return null; }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node as ReactElement<Record<string, unknown>>;
  return findElement((node.props as { children?: ReactNode }).children, type);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OFFICE_ENABLED = 'false';
  mocks.getDb.mockImplementation(() => { throw new Error('getDb must not be called'); });
  mocks.createReadModel.mockReturnValue(mocks.readModel);
  mocks.getRuntime.mockReturnValue(mocks.runtime);
  mocks.requireAdminSession.mockResolvedValue(admin);
});
afterEach(() => { delete process.env.OFFICE_ENABLED; });

describe('dashboard Office summary loader', () => {
  it('refuses a sales user before checking Office or opening any connection', async () => {
    process.env.OFFICE_ENABLED = 'true';
    await expect(loadOfficeDashboard(sales)).rejects.toBeInstanceOf(AuthorizationError);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.createReadModel).not.toHaveBeenCalled();
  });
  it('reports a disabled Office without constructing a read model or touching the database', async () => {
    expect(await loadOfficeDashboard(admin)).toEqual({ state: 'disabled' });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.createReadModel).not.toHaveBeenCalled();
  });
  it('reports a missing migration as unavailable, never as zero counts, and logs only fixed fields', async () => {
    process.env.OFFICE_ENABLED = 'true';
    mocks.getDb.mockReturnValue({});
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.readModel.dashboard.mockRejectedValueOnce(Object.assign(new Error('relation "backoffice.office_tasks" does not exist'), { code: '42P01' }));
    expect(await loadOfficeDashboard(admin)).toEqual({ state: 'unavailable', reason: 'schema_missing' });
    mocks.readModel.dashboard.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    expect(await loadOfficeDashboard(admin)).toEqual({ state: 'unavailable', reason: 'storage_error' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('does not exist');
    log.mockRestore();
    expect(officeStorageFailure({ code: '3F000' })).toBe('schema_missing');
    expect(officeStorageFailure(new TypeError('x'))).toBe('storage_error');
  });
});

describe('Office status route', () => {
  it('denies sales and expired sessions before any Office work', async () => {
    process.env.OFFICE_ENABLED = 'true';
    mocks.requireAdminSession.mockRejectedValueOnce(new AuthorizationError());
    expect((await status(new Request(`${base}/api/office/status`))).status).toBe(403);
    mocks.requireAdminSession.mockRejectedValueOnce(new AccessAuthenticationError('invalid_token', 401));
    expect((await status(new Request(`${base}/api/office/status`))).status).toBe(401);
    expect(mocks.createReadModel).not.toHaveBeenCalled();
  });
  it('reports a disabled Office as configuration required without querying', async () => {
    const response = await status(new Request(`${base}/api/office/status`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'configuration_required' });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it('validates scope parameters and requires a task and its workspace together', async () => {
    process.env.OFFICE_ENABLED = 'true';
    mocks.getDb.mockReturnValue({});
    expect((await status(new Request(`${base}/api/office/status?workspaceId=nope`))).status).toBe(400);
    expect((await status(new Request(`${base}/api/office/status?taskId=${task}`))).status).toBe(400);
    mocks.readModel.activity.mockResolvedValueOnce({ ok: true });
    const response = await status(new Request(`${base}/api/office/status?workspaceId=${workspace}&taskId=${task}&taskWorkspaceId=${workspace}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.readModel.activity).toHaveBeenCalledWith({ workspaceId: workspace, task: { workspaceId: workspace, taskId: task } });
  });
});

describe('saving cannot bypass the server guard', () => {
  it('rejects a brief submission while Office is disabled without constructing the runtime', async () => {
    const request = new Request(`${base}/api/office`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ operation: 'submit', input: { workspaceId: workspace, mode: 'demo', goal: 'Synthetic goal', brief: 'Synthetic brief text', idempotencyKey: 'synthetic-key-1' } }) });
    const response = await POST(request);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'configuration_required' });
    expect(mocks.getRuntime).not.toHaveBeenCalled();
    expect(mocks.runtime.submitTask).not.toHaveBeenCalled();
  });
});

describe('Office page deep links', () => {
  it('renders an administrator-only denial for a sales session without any Office lookup', async () => {
    process.env.OFFICE_ENABLED = 'true';
    mocks.requireAdminSession.mockRejectedValueOnce(new AuthorizationError());
    const element = await page({ mode: 'demo', workspace, task });
    const html = renderToStaticMarkup(element);
    expect(html).toContain('Administrator access required');
    expect(html).not.toContain(task);
    expect(mocks.createReadModel).not.toHaveBeenCalled();
    expect(mocks.getRuntime).not.toHaveBeenCalled();
  });
  it('reports links as Office-disabled or invalid without issuing queries while disabled', async () => {
    expect((await page({ mode: 'demo', workspace, task })).props).toMatchObject({ initialAvailability: 'disabled', initialLink: { status: 'office_disabled' } });
    expect((await page({ mode: 'demo', workspace: 'bad' })).props).toMatchObject({ initialLink: { status: 'invalid' } });
    expect((await page({})).props).toMatchObject({ initialLink: { status: 'none' } });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.getRuntime).not.toHaveBeenCalled();
  });
  it('rechecks the exact link server-side and loads the linked family into the first render', async () => {
    process.env.OFFICE_ENABLED = 'true';
    mocks.getDb.mockReturnValue({});
    mocks.readModel.resolveLink.mockResolvedValueOnce({ status: 'ok', mode: 'demo', workspaceId: workspace, taskId: task, artifactId: null, artifact: 'none', view: 'inbox' });
    mocks.runtime.snapshot.mockResolvedValueOnce({ available: true, workspaces: [] });
    mocks.readModel.workspaces.mockResolvedValueOnce([{ id: workspace }]);
    mocks.readModel.activity.mockResolvedValueOnce({ generatedAt: 'x' });
    const props = (await page({ mode: 'demo', workspace, task, view: 'inbox' })).props;
    expect(mocks.readModel.resolveLink).toHaveBeenCalledWith({ kind: 'link', mode: 'demo', workspaceId: workspace, taskId: task, artifactId: null, view: 'inbox' });
    expect(mocks.runtime.snapshot).toHaveBeenCalledWith(workspace);
    expect(mocks.readModel.activity).toHaveBeenCalledWith({ workspaceId: workspace, task: { workspaceId: workspace, taskId: task } });
    expect(props).toMatchObject({ initialAvailability: 'available', initialCatalog: [{ id: workspace }], initialActivity: { generatedAt: 'x' } });
  });
  it('does not open an unmatched link and reports storage failure as unavailable', async () => {
    process.env.OFFICE_ENABLED = 'true';
    mocks.getDb.mockReturnValue({});
    mocks.readModel.resolveLink.mockResolvedValueOnce({ status: 'not_found', mode: 'live' });
    mocks.runtime.snapshot.mockResolvedValueOnce({ available: true, workspaces: [] });
    mocks.readModel.activity.mockResolvedValueOnce(null);
    expect((await page({ mode: 'live', workspace, task })).props).toMatchObject({ initialLink: { status: 'not_found', mode: 'live' } });
    expect(mocks.runtime.snapshot).toHaveBeenLastCalledWith(undefined);
    mocks.readModel.resolveLink.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: '42P01' }));
    expect((await page({ mode: 'demo', workspace, task })).props).toMatchObject({ initialAvailability: 'storage_unavailable', initialLink: { status: 'unavailable' } });
  });
});

describe('main dashboard integration', () => {
  it('never queries or renders Office data for a sales session', async () => {
    process.env.OFFICE_ENABLED = 'true';
    mocks.getAccessScope.mockResolvedValueOnce({ user: sales, ownerUserId: sales.id });
    // Calling the admin-only loader for a sales user would throw, so resolving proves it was never invoked.
    const tree = await DashboardPage();
    expect(findElement(tree, OfficeDashboardPanel)).toBeNull();
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain('dashboard-office-title');
    expect(html).not.toContain('Office');
    expect(mocks.createReadModel).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it('adds the Office panel for an administrator while keeping the existing sections', async () => {
    mocks.getAccessScope.mockResolvedValueOnce({ user: admin, ownerUserId: null });
    const tree = await DashboardPage();
    expect(findElement(tree, OfficeDashboardPanel)?.props.data).toEqual({ state: 'disabled' });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('Commercial operations');
    expect(html).toContain('Recent invoices');
    expect(html).toContain('Office is disabled on this server');
    expect(mocks.listClients).toHaveBeenCalledTimes(1);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
