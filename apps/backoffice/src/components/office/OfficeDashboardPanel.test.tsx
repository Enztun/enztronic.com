import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => createElement('a', { href, ...props }, children) }));

import type { OfficeDashboardData, OfficeModeSummary, OfficeRoleCounts } from '@/lib/office-activity';
import { OfficeDashboardPanel, queuedRoleSteps } from './OfficeDashboardPanel';

const workspace = '00000000-0000-4000-8000-000000000001';
const parent = '6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';
const child = '7a1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';
const artifact = '8b1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5';
const zeroCounts: OfficeRoleCounts = { open: 0, queued: 0, inProgress: 0, awaitingReview: 0, changesRequested: 0, reviewPassed: 0, waitingForOwner: 0, blocked: 0, failed: 0, stopping: 0, paused: 0, completed: 0, cancelled: 0, decisionsPending: 0, decisionsRenewal: 0, runnableSteps: 0, runnableReviews: 0, waitingOnDependencies: 0, retryScheduled: 0, exhaustedSteps: 0, executingRuns: 0, stalledRuns: 0, stoppingRuns: 0 };
const summary = (mode: 'demo' | 'live', tasks: Partial<OfficeModeSummary['tasks']>, decisions: Partial<OfficeModeSummary['decisions']> = {}): OfficeModeSummary => ({ mode, workspaces: 1, tasks: { total: 0, parents: 0, queued: 0, inProgress: 0, startedNotExecuting: 0, executing: 0, awaitingReview: 0, changesRequested: 0, reviewPassed: 0, waitingForOwner: 0, blocked: 0, failed: 0, stopping: 0, paused: 0, completed: 0, cancelled: 0, ...tasks }, steps: { runnable: 0, waitingOnDependencies: 0, retryScheduled: 0, leasedLive: 0, stalled: 0, exhausted: 0 }, decisions: { pending: 0, renewal: 0, approved: 0, rejected: 0, ...decisions } });
const available: OfficeDashboardData = {
  state: 'available',
  generatedAt: '2026-11-04T10:00:00.000Z',
  worker: { workersSeen: 1, online: true, lastHeartbeatAt: '2026-11-04T09:59:58.000Z', heartbeatAgeSeconds: 2, latest: { heartbeatAt: '2026-11-04T09:59:58.000Z', startedAt: '2026-11-04T09:40:00.000Z', stopping: false, ageSeconds: 2 }, onlineThresholdSeconds: 60 },
  execution: { adapter: 'deterministic_demo', providerConfigured: false, commandExecutionEnabled: false },
  modes: { demo: summary('demo', { total: 216, parents: 27, waitingForOwner: 1, reviewPassed: 7, executing: 1 }, { pending: 1 }), live: summary('live', { total: 1, parents: 1, blocked: 1 }) },
  roles: [{ agentId: 'sam', demo: { ...zeroCounts, open: 2, executingRuns: 1 }, live: zeroCounts, lastActivityAt: '2026-11-04T09:59:00.000Z' }],
  decisions: { pending: 1, renewal: 0, latest: [{ approvalId: 'approval-1', link: { mode: 'demo', workspaceId: workspace, taskId: parent, view: 'inbox' }, goal: 'Synthetic five-page proposal', workspaceName: 'Internal demonstration', revision: 1, createdAt: '2026-11-04T09:58:00.000Z', expiresAt: '2026-11-11T09:58:00.000Z', renewalNeeded: false }] },
  outputs: [
    { reviewId: 'review-1', artifactId: artifact, link: { mode: 'demo', workspaceId: workspace, taskId: child, artifactId: artifact, view: 'tasks' }, title: 'sam — simulated internal draft', revision: 1, authorAgentId: 'sam', ownerPrepared: false, reviewerId: 'theo', decidedAt: '2026-11-04T09:57:00.000Z', status: 'review_passed' },
    { reviewId: 'review-2', artifactId: 'owner-revision', link: { mode: 'demo', workspaceId: workspace, taskId: parent, artifactId: 'owner-revision', view: 'tasks' }, title: 'Rebuilt package', revision: 2, authorAgentId: 'adrian', ownerPrepared: true, reviewerId: 'nadia', decidedAt: '2026-11-04T09:56:00.000Z', status: 'owner_accepted' },
  ],
  events: [{ eventId: 'event-1', eventType: 'work_started', occurredAt: '2026-11-04T09:30:00.000Z', actorType: 'owner', agentId: null, ownerRecordedUnderRole: false, coordination: true, mode: 'demo', link: { mode: 'demo', workspaceId: workspace, taskId: parent, view: 'tasks' }, goal: 'Synthetic five-page proposal' }],
  windows: { decisions: 5, outputs: 5, events: 8 },
};

describe('dashboard Office panel', () => {
  it('states a disabled Office plainly without counts', () => {
    const html = renderToStaticMarkup(<OfficeDashboardPanel data={{ state: 'disabled' }} />);
    expect(html).toContain('Office is disabled on this server');
    expect(html).toContain('OFFICE_ENABLED');
    expect(html).not.toMatch(/Executing|Queued/);
  });
  it('reports a missing schema as unavailable instead of zeros', () => {
    const html = renderToStaticMarkup(<OfficeDashboardPanel data={{ state: 'unavailable', reason: 'schema_missing' }} />);
    expect(html).toContain('migration 003');
    expect(html).toContain('No counts are shown rather than reporting zeros');
  });
  it('links every decision, output and event to its exact Office task and separates simulated from live work', () => {
    const html = renderToStaticMarkup(<OfficeDashboardPanel data={available} />);
    expect(html).toContain(`href="/team?mode=demo&amp;workspace=${workspace}&amp;task=${parent}&amp;view=inbox"`);
    expect(html).toContain(`href="/team?mode=demo&amp;workspace=${workspace}&amp;task=${child}&amp;artifact=${artifact}&amp;view=tasks"`);
    expect(html).toContain('Demonstration records');
    expect(html).toContain('Live internal records');
    expect(html).toContain('Simulated');
    expect(html).toContain('Not connected');
    expect(html).toContain('216 tasks (27 packages)');
    expect(html).toContain('Exact totals');
    expect(html).toContain('recent window, not a total');
    // A server-rendered page never updates, so lease figures are labelled as of generation, not "now".
    expect(html).toContain('Executing when loaded');
    expect(html).not.toContain('Executing now');
  });
  it('never reports unmetered usage as zero and never credits owner or request bookkeeping to a role', () => {
    const html = renderToStaticMarkup(<OfficeDashboardPanel data={available} />);
    expect(html).toContain('Usage / cost: unavailable');
    expect(html).not.toMatch(/\$\s?0|USD 0|IDR 0/);
    expect(html).toContain('Owner revision recorded under Adrian');
    expect(html).toContain('Authored by Sam');
    expect(html).toContain('Scheduling recorded with the request (no worker step)');
    expect(html).toContain('Reviewed · not owner-accepted');
    expect(html).toContain('Owner accepted');
  });
  it('shows a connected live provider with metered, conservative usage and limits', () => {
    const live: OfficeDashboardData = { ...available, execution: { adapter: 'openai_responses', providerConfigured: true, commandExecutionEnabled: false, provider: { provider: 'openai', draftModel: 'gpt-6-luna', packageModel: 'gpt-6.1-sol', reasoningEffort: 'low' }, budget: { enabled: true, currency: 'USD', monthUsedMicrounits: 17226, monthLimitMicrounits: 10_000_000, lifetimeUsedMicrounits: 17226, lifetimeLimitMicrounits: 10_000_000, familyLimitMicrounits: 1_000_000, requestLimitMicrounits: 150000 } } };
    const html = renderToStaticMarkup(<OfficeDashboardPanel data={live} />);
    expect(html).toContain('Live provider: OpenAI · gpt-6-luna for drafts and reviews; gpt-6.1-sol for the package and its review · low reasoning');
    expect(html).toContain('Usage / cost: metered');
    expect(html).toContain('USD 0.0172 of USD 10.00 this month (UTC), conservative estimate');
    expect(html).toContain('Live: OpenAI');
    expect(html).not.toContain('Live provider: not connected');
    const switchedOff = renderToStaticMarkup(<OfficeDashboardPanel data={{ ...live, execution: { ...live.execution, budget: { ...live.execution.budget!, enabled: false } } }} />);
    expect(switchedOff).toContain('live switch is off, so nothing runs');
  });
  it('includes ready live author and review steps in each role queue without counting merely open work', () => {
    const demo = { ...zeroCounts, open: 100, queued: 99, runnableSteps: 2, runnableReviews: 1 };
    const live = { ...zeroCounts, open: 200, queued: 198, runnableSteps: 3, runnableReviews: 2 };
    expect(queuedRoleSteps(demo, live)).toBe(8);
    const html = renderToStaticMarkup(<OfficeDashboardPanel data={{ ...available, roles: [{ agentId: 'sam', demo, live, lastActivityAt: null }] }} />);
    const row = html.match(/<tr data-agent-id="sam">([\s\S]*?)<\/tr>/)![1];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1]);
    expect(cells[2]).toBe('8');
  });
});
