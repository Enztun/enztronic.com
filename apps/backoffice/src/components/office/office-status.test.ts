import { describe, expect, it } from 'vitest';
import type { OfficeApproval, OfficeArtifact, OfficeHealth, OfficeReview, OfficeTask } from '@/lib/office-contracts';
import type { OfficeActivity, OfficeActiveRun, OfficeRoleActivity, OfficeRoleCounts, OfficeTaskExecution } from '@/lib/office-activity';
import { agedRole, classifySubmitFailure, dataFreshness, deriveRoleStatus, evidenceAge, evidenceStages, isOfficeActivity, leasedRunState, leaseNow, leaseWording, liveProviderLabel, liveUnavailable, liveUsageLine, mergeFamily, nextEvidenceChangeMs, nextSubmitLock, persistenceState, savedBriefExecution, taskDecision, taskExecutionLine, workerIndicator, type WorkerIndicator } from './office-status';
import type { OfficeExecutionCapability } from '@/lib/office-activity';

const NOW = Date.parse('2026-11-04T10:00:00.000Z');
const at = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();
const health: OfficeHealth = { workerOnline: false, lastHeartbeatAt: null, providerConfigured: false, commandExecutionEnabled: false, status: 'worker_offline', disclosure: 'test' };
const online: WorkerIndicator = { state: 'online', label: 'Worker online', detail: '', ageSeconds: 3 };
const offline: WorkerIndicator = { state: 'never_seen', label: 'No worker connected', detail: '', ageSeconds: null };
const ctx = { availability: 'available' as const, stale: false, mode: 'demo' as const, worker: online, evidenceAgeMs: 0 };

function counts(overrides: Partial<OfficeRoleCounts> = {}): OfficeRoleCounts {
  return { open: 0, queued: 0, inProgress: 0, awaitingReview: 0, changesRequested: 0, reviewPassed: 0, waitingForOwner: 0, blocked: 0, failed: 0, stopping: 0, paused: 0, completed: 0, cancelled: 0, decisionsPending: 0, decisionsRenewal: 0, runnableSteps: 0, runnableReviews: 0, waitingOnDependencies: 0, retryScheduled: 0, exhaustedSteps: 0, executingRuns: 0, stalledRuns: 0, stoppingRuns: 0, ...overrides };
}
function role(overrides: Partial<OfficeRoleActivity> = {}, countOverrides: Partial<OfficeRoleCounts> = {}): OfficeRoleActivity {
  // The server lists the active run among the role's leased runs.
  const leasedRuns = overrides.leasedRuns ?? (overrides.activeRun ? [overrides.activeRun] : []);
  return { agentId: 'sam', mode: 'demo', enabled: true, counts: counts(countOverrides), activeRun: null, leasedRuns, latestRun: null, lastEvent: null, latestArtifact: null, latestOwnerRevision: null, latestReviewGiven: null, reviewInProgress: null, blocked: null, nextRetryAt: null, focusTaskId: 'task-1', ...overrides };
}
function run(overrides: Partial<OfficeActiveRun> = {}): OfficeActiveRun {
  return { id: 'run-12345678', taskId: 'task-1', agentId: 'sam', step: 'draft', state: 'running', attempt: 1, startedAt: at(5), finishedAt: null, errorCode: null, predecessorRunId: null, leaseUntil: at(-25), leaseLive: true, leaseRemainingMs: 25000, ...overrides };
}
function task(overrides: Partial<OfficeTask> = {}): OfficeTask {
  return { id: 'task-1', workspaceId: 'ws', clientId: 'internal:office-demo', projectId: 'internal:website-proposal-demo', parentTaskId: 'parent', agentId: 'sam', goal: 'Synthetic goal', brief: 'Synthetic brief', priority: 0, state: 'queued', mode: 'demo', version: 1, createdAt: at(60), updatedAt: at(30), blockedReason: null, currentArtifactId: null, acceptanceEvidenceId: null, ...overrides };
}
function execution(overrides: Partial<OfficeTaskExecution> = {}, steps: Partial<OfficeTaskExecution['steps']> = {}): OfficeTaskExecution {
  const leasedRuns = overrides.leasedRuns ?? (overrides.activeRun ? [overrides.activeRun] : []);
  return { taskId: 'task-1', activeRun: null, leasedRuns, latestRun: null, runs: { total: 0, succeeded: 0, failed: 0, interrupted: 0, cancelled: 0 }, steps: { pending: 0, runnable: 0, waitingOnDependencies: 0, retryScheduled: 0, nextRetryAt: null, leased: 0, done: 0, exhausted: 0, cancelled: 0, ...steps }, coordination: null, ...overrides };
}
function artifact(overrides: Partial<OfficeArtifact> = {}): OfficeArtifact {
  return { id: 'artifact-1', taskId: 'task-1', workspaceId: 'ws', clientId: 'c', projectId: 'p', authorAgentId: 'sam', title: 'Draft', revision: 1, revisionId: 'artifact-1', artifactHash: 'a'.repeat(64), hashAlgorithm: 'SHA-256', content: 'Synthetic content', manifest: [], createdAt: at(50), ...overrides };
}
function review(overrides: Partial<OfficeReview> = {}): OfficeReview {
  return { id: 'review-1', taskId: 'task-1', workspaceId: 'ws', artifactId: 'artifact-1', revisionId: 'artifact-1', artifactHash: 'a'.repeat(64), reviewerId: 'theo', state: 'pending', criteria: [], evidence: [], findings: [], createdAt: at(45), ...overrides };
}
function approval(overrides: Partial<OfficeApproval> = {}): OfficeApproval {
  return { id: 'approval-1', taskId: 'parent', workspaceId: 'ws', artifactId: 'package-1', revisionId: 'package-1', artifactHash: 'b'.repeat(64), actionScope: 'accept_internal_proposal_package', state: 'pending', version: 1, expiresAt: at(-3600), reason: null, decidedAt: null, acceptanceEvidenceId: null, ...overrides };
}

describe('brief submission outcomes never create a duplicate parent task', () => {
  it('treats only proofs of non-commit as definitive rejections', () => {
    for (const status of [400, 401, 403, 404, 409, 413, 422]) expect(classifySubmitFailure({ status })).toBe('rejected');
    expect(classifySubmitFailure({ status: 503, code: 'configuration_required' })).toBe('rejected');
    for (const failure of [{}, { aborted: true }, { status: 500 }, { status: 502 }, { status: 504 }, { status: 503, code: 'storage_unavailable' }, { status: 429 }]) expect(classifySubmitFailure(failure)).toBe('uncertain');
  });
  it('releases the key only after a first-attempt rejection; an earlier uncertain outcome keeps the same payload locked', () => {
    expect(nextSubmitLock(false, 'rejected')).toEqual({ keepLocked: false, uncertain: false });
    expect(nextSubmitLock(false, 'uncertain')).toEqual({ keepLocked: true, uncertain: true });
    // A refused retry (for example an expired session) cannot prove the first attempt was not saved.
    expect(nextSubmitLock(true, 'rejected')).toEqual({ keepLocked: true, uncertain: true });
    expect(nextSubmitLock(true, 'uncertain')).toEqual({ keepLocked: true, uncertain: true });
  });
});

describe('worker availability and page freshness are separate', () => {
  const activity = (worker: Partial<OfficeActivity['worker']>) => ({ worker: { workersSeen: 1, online: true, lastHeartbeatAt: at(10), heartbeatAgeSeconds: 10, latest: { heartbeatAt: at(10), startedAt: at(100), stopping: false, ageSeconds: 10 }, onlineThresholdSeconds: 60, ...worker } }) as OfficeActivity;
  it('uses server-computed age re-aged by local elapsed time against the 60 s threshold', () => {
    expect(workerIndicator({ availability: 'available', activity: activity({}), evidenceAgeMs: 5000, health, stale: false }).state).toBe('online');
    expect(workerIndicator({ availability: 'available', activity: activity({ heartbeatAgeSeconds: 50 }), evidenceAgeMs: 15000, health, stale: false }).state).toBe('offline');
    // Ageing starts when the request was sent, so a slow response counts against the heartbeat too.
    expect(workerIndicator({ availability: 'available', activity: activity({ heartbeatAgeSeconds: 55 }), evidenceAgeMs: evidenceAge(1000, 6000), health, stale: false }).state).toBe('offline');
  });
  it('distinguishes never seen, gracefully stopped, offline, unknown and not activated', () => {
    expect(workerIndicator({ availability: 'available', activity: activity({ workersSeen: 0, online: false, lastHeartbeatAt: null, heartbeatAgeSeconds: null, latest: null }), evidenceAgeMs: 0, health, stale: false }).state).toBe('never_seen');
    expect(workerIndicator({ availability: 'available', activity: activity({ online: false, heartbeatAgeSeconds: 300, lastHeartbeatAt: at(300), latest: { heartbeatAt: at(200), startedAt: at(900), stopping: true, ageSeconds: 200 } }), evidenceAgeMs: 0, health, stale: false }).state).toBe('stopped');
    expect(workerIndicator({ availability: 'available', activity: activity({ online: false, heartbeatAgeSeconds: 300, lastHeartbeatAt: at(300), latest: { heartbeatAt: at(300), startedAt: at(900), stopping: false, ageSeconds: 300 } }), evidenceAgeMs: 0, health, stale: false }).state).toBe('offline');
    expect(workerIndicator({ availability: 'available', activity: activity({}), evidenceAgeMs: 0, health, stale: true }).state).toBe('unknown');
    expect(workerIndicator({ availability: 'disabled', activity: null, evidenceAgeMs: 0, health, stale: false }).state).toBe('not_activated');
  });
  it('marks page data stale after 45 s or a sync error, independent of the worker', () => {
    const base = { now: NOW, offline: false, syncError: null, denied: false, staleAfterMs: 45000 };
    expect(dataFreshness({ ...base, lastConfirmedAt: at(10) }).state).toBe('fresh');
    expect(dataFreshness({ ...base, lastConfirmedAt: at(46) }).state).toBe('stale');
    expect(dataFreshness({ ...base, lastConfirmedAt: at(1), syncError: 'x' }).state).toBe('stale');
    expect(dataFreshness({ ...base, lastConfirmedAt: at(1), offline: true }).state).toBe('offline');
    expect(dataFreshness({ ...base, lastConfirmedAt: null }).state).toBe('never');
  });
});

describe('saving availability explains the precise prerequisite and never depends on worker telemetry', () => {
  const base = { availability: 'available' as const, denied: false, offline: false, stale: false, mode: 'demo' as const, workspaceAvailable: true, worker: online };
  it('names the switched-off flag, migration 003 and the worker before the owner writes', () => {
    const state = persistenceState({ ...base, availability: 'disabled' });
    expect(state.canSave).toBe(false);
    expect(state.detail).toContain('OFFICE_ENABLED');
    expect(state.detail).toContain('migration 003');
    expect(persistenceState({ ...base, availability: 'storage_unavailable' }).title).toContain('storage could not be read');
  });
  it('blocks on session, offline, stale records and missing workspace', () => {
    for (const override of [{ denied: true }, { offline: true }, { stale: true }, { workspaceAvailable: false }]) expect(persistenceState({ ...base, ...override }).canSave).toBe(false);
  });
  it('allows a save while the worker is offline or unknown, and says nothing executes', () => {
    const state = persistenceState({ ...base, worker: offline });
    expect(state.canSave).toBe(true);
    expect(state.detail).toContain('nothing executes until a worker runs');
    expect(persistenceState({ ...base, worker: { state: 'unknown', label: 'Worker status unavailable', detail: '', ageSeconds: null } }).canSave).toBe(true);
    expect(persistenceState({ ...base, mode: 'live' }).detail).toContain('configuration_required');
  });
});

describe('role indicators come only from persisted state', () => {
  it('shows not activated, not connected, executing, reviewing, stop requested and stalled', () => {
    expect(deriveRoleStatus('sam', role(), { ...ctx, availability: 'disabled' }).indicator).toBe('not_activated');
    expect(deriveRoleStatus('sam', role({ mode: 'live' }, { blocked: 1 }), { ...ctx, mode: 'live' }).indicator).toBe('not_connected');
    expect(deriveRoleStatus('sam', role({ activeRun: run() }), ctx)).toMatchObject({ indicator: 'executing', runId: 'run-12345678', activeTaskId: 'task-1' });
    expect(deriveRoleStatus('sam', role({ activeRun: run({ step: 'review' }) }), ctx).indicator).toBe('reviewing');
    expect(deriveRoleStatus('sam', role({ activeRun: run({ state: 'pause_requested' }) }), ctx).indicator).toBe('stopping');
    expect(deriveRoleStatus('sam', role({ activeRun: run({ leaseLive: false }) }), ctx)).toMatchObject({ indicator: 'stalled', label: 'Stalled' });
  });
  it('never calls a drained family idle: children are reviewed and the coordinator waits for the owner', () => {
    expect(deriveRoleStatus('adrian', role({ agentId: 'adrian' }, { open: 2, waitingForOwner: 1, reviewPassed: 1, decisionsPending: 1 }), ctx).indicator).toBe('waiting_for_owner');
    for (const agent of ['clara', 'nadia', 'leo', 'lisa', 'sam', 'theo']) expect(deriveRoleStatus(agent, role({ agentId: agent as OfficeRoleActivity['agentId'] }, { open: 1, reviewPassed: 1 }), ctx).indicator).toBe('reviewed');
  });
  it('separates renewal, owner revision, pause, recovery, retry and blocked', () => {
    expect(deriveRoleStatus('adrian', role({}, { open: 1, waitingForOwner: 1, decisionsRenewal: 1 }), ctx).indicator).toBe('renewal_needed');
    expect(deriveRoleStatus('sam', role({}, { open: 1, changesRequested: 1 }), ctx).indicator).toBe('revision_needed');
    expect(deriveRoleStatus('sam', role({}, { open: 1, paused: 1 }), ctx).indicator).toBe('paused');
    expect(deriveRoleStatus('sam', role({}, { open: 1, stopping: 1 }), ctx).indicator).toBe('stopping');
    expect(deriveRoleStatus('sam', role({ blocked: { taskId: 't', reason: 'retry_exhausted: owner recovery decision required', since: at(5) } }, { open: 1, blocked: 1, exhaustedSteps: 1 }), ctx).indicator).toBe('needs_recovery');
    expect(deriveRoleStatus('sam', role({}, { open: 1, blocked: 1, retryScheduled: 1 }), ctx).indicator).toBe('retry_scheduled');
    expect(deriveRoleStatus('sam', role({ blocked: { taskId: 't', reason: 'A child component changed', since: at(5) } }, { open: 1, blocked: 1 }), ctx)).toMatchObject({ indicator: 'blocked', detail: expect.stringContaining('A child component changed') });
  });
  it('queues only runnable work and says plainly when nothing executes', () => {
    expect(deriveRoleStatus('theo', role({}, { open: 0, runnableReviews: 1 }), { ...ctx, worker: offline })).toMatchObject({ indicator: 'review_queued', detail: expect.stringContaining('not executing') });
    expect(deriveRoleStatus('sam', role({}, { open: 1, queued: 1, runnableSteps: 1 }), { ...ctx, worker: offline })).toMatchObject({ indicator: 'queued', detail: expect.stringContaining('not executing') });
    expect(deriveRoleStatus('adrian', role({ agentId: 'adrian' }, { open: 1, inProgress: 1, waitingOnDependencies: 1 }), ctx).indicator).toBe('waiting_on_dependencies');
    expect(deriveRoleStatus('lisa', role({ reviewInProgress: { reviewerId: 'sam', runId: 'run-abcdefgh', taskId: 'task-9', leaseRemainingMs: 20000 } }, { open: 1, awaitingReview: 1 }), ctx)).toMatchObject({ indicator: 'awaiting_review', activeTaskId: 'task-9', detail: expect.stringContaining('Being reviewed now by Sam') });
    expect(deriveRoleStatus('sam', role({}, { open: 1, queued: 1 }), ctx).indicator).toBe('waiting');
    expect(deriveRoleStatus('sam', role({}, { completed: 3 }), ctx)).toMatchObject({ indicator: 'idle', detail: expect.stringContaining('Idle is not a failure') });
  });
  it('shows status unavailable with the last confirmed state when evidence is stale', () => {
    expect(deriveRoleStatus('sam', role({ activeRun: run() }), { ...ctx, stale: true, evidenceAgeMs: 0 })).toMatchObject({ indicator: 'unknown', stale: true, detail: expect.stringContaining('Last confirmed: executing') });
    expect(deriveRoleStatus('sam', undefined, ctx).indicator).toBe('unknown');
  });
});

describe('task execution lines never equate a saved or delegated task with execution', () => {
  const children = Array.from({ length: 7 }, (_, index) => task({ id: `child-${index}` }));
  it('describes a freshly delegated parent as not executing even though its canonical state is in progress', () => {
    const line = taskExecutionLine(task({ id: 'parent', parentTaskId: null, agentId: 'adrian', state: 'in_progress' }), { execution: execution({ coordination: { runId: 'coord', step: 'delegate_internal_demo', recordedAt: at(5) } }, { pending: 1, waitingOnDependencies: 1 }), children, worker: offline, stale: false, evidenceAgeMs: 0 });
    expect(line.state).toBe('delegated');
    expect(line.label).toContain('0 of 7');
    expect(line.label).not.toMatch(/Executing/);
  });
  it('shows queued work as not executing while no worker is online', () => {
    expect(taskExecutionLine(task(), { execution: execution({}, { pending: 1, runnable: 1 }), children: [], worker: offline, stale: false, evidenceAgeMs: 0 })).toMatchObject({ state: 'queued', label: expect.stringContaining('not executing') });
  });
  it('reports a live lease, a review lease, a stop request and an expired lease', () => {
    expect(taskExecutionLine(task({ state: 'in_progress' }), { execution: execution({ activeRun: run() }), children: [], worker: online, stale: false, evidenceAgeMs: 0 }).state).toBe('executing');
    expect(taskExecutionLine(task({ state: 'waiting_for_review' }), { execution: execution({ activeRun: run({ step: 'review', agentId: 'theo' }) }), children: [], worker: online, stale: false, evidenceAgeMs: 0 }).label).toContain('Theo');
    expect(taskExecutionLine(task({ state: 'pause_requested' }), { execution: execution({ activeRun: run({ state: 'pause_requested' }) }), children: [], worker: online, stale: false, evidenceAgeMs: 0 }).state).toBe('stopping');
    expect(taskExecutionLine(task({ state: 'in_progress' }), { execution: execution({ activeRun: run({ leaseLive: false }) }), children: [], worker: online, stale: false, evidenceAgeMs: 0 }).state).toBe('stalled');
  });
  it('separates scheduled retry, exhausted recovery, renewal, live and unavailable evidence', () => {
    expect(taskExecutionLine(task({ state: 'blocked', blockedReason: 'interrupted' }), { execution: execution({}, { pending: 1, retryScheduled: 1, nextRetryAt: at(-4) }), children: [], worker: online, stale: false, evidenceAgeMs: 0 })).toMatchObject({ state: 'retry_scheduled', at: at(-4) });
    expect(taskExecutionLine(task({ state: 'blocked' }), { execution: execution({}, { exhausted: 1 }), children: [], worker: online, stale: false, evidenceAgeMs: 0 }).state).toBe('needs_recovery');
    expect(taskExecutionLine(task({ state: 'waiting_for_owner_approval', parentTaskId: null }), { execution: execution(), children: [], worker: online, stale: false, evidenceAgeMs: 0, decision: 'renewal' }).state).toBe('renewal_needed');
    expect(taskExecutionLine(task({ mode: 'live', state: 'blocked' }), { execution: undefined, children: [], worker: online, stale: false, evidenceAgeMs: 0 }).state).toBe('not_connected');
    expect(taskExecutionLine(task(), { execution: execution(), children: [], worker: online, stale: true, evidenceAgeMs: 0 }).state).toBe('unknown');
    expect(taskExecutionLine(task(), { execution: undefined, children: [], worker: online, stale: false, evidenceAgeMs: 0 }).state).toBe('unknown');
  });
});

describe('live work is evidence-backed only when a provider is connected, switched on and limited', () => {
  const budget = { enabled: true, currency: 'USD' as const, monthUsedMicrounits: 120000, monthLimitMicrounits: 10_000_000, lifetimeUsedMicrounits: 120000, lifetimeLimitMicrounits: 10_000_000, familyLimitMicrounits: 1_000_000, requestLimitMicrounits: 150000 };
  const connected: OfficeExecutionCapability = { adapter: 'openai_responses', providerConfigured: true, commandExecutionEnabled: false, provider: { provider: 'openai', draftModel: 'gpt-6-luna', packageModel: 'gpt-6.1-sol', reasoningEffort: 'low' }, budget };
  const demoOnly: OfficeExecutionCapability = { adapter: 'deterministic_demo', providerConfigured: false, commandExecutionEnabled: false, provider: null, budget: { ...budget, enabled: false } };
  it('names exactly why live work cannot run', () => {
    expect(liveUnavailable(connected)).toBeNull();
    expect(liveUnavailable(demoOnly)?.label).toBe('live provider not connected');
    expect(liveUnavailable(undefined)?.label).toBe('live provider not connected');
    expect(liveUnavailable({ ...connected, budget: { ...budget, enabled: false } })?.label).toBe('live execution switched off');
    expect(liveUnavailable({ ...connected, budget: { ...budget, familyLimitMicrounits: 0 } })?.label).toBe('live spending limits not set');
    expect(liveUnavailable({ ...connected, unresolvedModelOutcome: true })?.label).toBe('live outcome reconciliation required');
  });
  it('does not label a saved configured-live task blocked or mistake persistence for execution', () => {
    expect(savedBriefExecution('live', online, null)).toEqual({ tone: 'success', text: 'The worker is online; a step shows as executing only once a run is recorded.' });
    expect(savedBriefExecution('live', online, undefined)).toMatchObject({ tone: 'warning', text: expect.stringContaining('status is being refreshed') });
    expect(savedBriefExecution('live', online, liveUnavailable(demoOnly))).toMatchObject({ tone: 'warning', text: expect.stringContaining('No live provider is connected') });
    expect(savedBriefExecution('live', offline, null)).toMatchObject({ tone: 'warning', text: expect.stringContaining('nothing is confirmed executing') });
    expect(savedBriefExecution('demo', online, liveUnavailable(demoOnly)).tone).toBe('success');
  });
  it('labels the provider and conservative usage without inventing figures', () => {
    expect(liveProviderLabel(connected)).toBe('OpenAI · gpt-6-luna for drafts and reviews; gpt-6.1-sol for the package and its review · low reasoning');
    expect(liveProviderLabel(demoOnly)).toBe('Not connected');
    expect(liveUsageLine(connected)).toContain('USD 0.1200 of USD 10.00 this month (UTC), conservative estimate');
    expect(liveUsageLine({ ...connected, budget: { ...budget, monthLimitMicrounits: 0 } })).toBe('Usage / cost: unavailable (no live spending limit set).');
  });
  it('derives live role and task status from leases once live is available, and stays not connected otherwise', () => {
    const liveRole = role({ mode: 'live', activeRun: run() });
    expect(deriveRoleStatus('sam', liveRole, { ...ctx, mode: 'live', liveUnavailable: null })).toMatchObject({ indicator: 'executing', runId: 'run-12345678' });
    expect(deriveRoleStatus('sam', liveRole, { ...ctx, mode: 'live', liveUnavailable: liveUnavailable(demoOnly) })).toMatchObject({ indicator: 'not_connected', detail: expect.stringContaining('No live provider is connected') });
    const liveTask = task({ mode: 'live', state: 'in_progress' });
    expect(taskExecutionLine(liveTask, { execution: execution({ activeRun: run() }), children: [], worker: online, stale: false, evidenceAgeMs: 0, liveUnavailable: null }).state).toBe('executing');
    expect(taskExecutionLine(liveTask, { execution: execution({ activeRun: run() }), children: [], worker: online, stale: false, evidenceAgeMs: 0, liveUnavailable: { label: 'live execution switched off', detail: '' } })).toMatchObject({ state: 'not_connected', label: 'Not executing · live execution switched off' });
  });
});

describe('owner decisions are keyed to packages awaiting the owner', () => {
  const pkg = task({ id: 'parent', parentTaskId: null, state: 'waiting_for_owner_approval', currentArtifactId: 'package-1' });
  it('distinguishes live, renewal-needed and non-decidable packages', () => {
    expect(taskDecision(pkg, [approval()], NOW)).toBe('pending');
    expect(taskDecision(pkg, [approval({ expiresAt: at(1) })], NOW)).toBe('renewal');
    expect(taskDecision(pkg, [approval({ state: 'expired' })], NOW)).toBe('renewal');
    expect(taskDecision({ ...pkg, state: 'paused' }, [approval()], NOW)).toBe('none');
    expect(taskDecision(pkg, [approval({ artifactId: 'older-package' })], NOW)).toBe('none');
  });
});

describe('authored, reviewed and owner-accepted are distinct evidence stages', () => {
  const records = (overrides: Partial<{ tasks: OfficeTask[]; artifacts: OfficeArtifact[]; reviews: OfficeReview[]; approvals: OfficeApproval[] }> = {}) => ({ tasks: [], artifacts: [], reviews: [], approvals: [], ...overrides });
  it('labels owner revisions recorded under a role separately from run-produced drafts', () => {
    const child = task({ currentArtifactId: 'artifact-1', state: 'waiting_for_review' });
    expect(evidenceStages(artifact(), child, records(), { now: NOW, producedByRun: false }).authored).toMatchObject({ state: 'owner', label: expect.stringContaining('Owner revision recorded under Sam') });
    expect(evidenceStages(artifact(), child, records(), { now: NOW, producedByRun: true }).authored.state).toBe('run');
  });
  it('reports a pending review only while it can still be performed', () => {
    const child = task({ currentArtifactId: 'artifact-1', state: 'waiting_for_review' });
    expect(evidenceStages(artifact(), child, records({ reviews: [review()] }), { now: NOW, producedByRun: true }).review.state).toBe('pending');
    expect(evidenceStages(artifact(), { ...child, state: 'cancelled' }, records({ reviews: [review()] }), { now: NOW, producedByRun: true }).review.state).toBe('not_performed');
    expect(evidenceStages(artifact(), child, records({ reviews: [review({ state: 'passed' })] }), { now: NOW, producedByRun: true }).review.state).toBe('passed');
  });
  it('derives package outcomes per revision, including held, renewal, rejection and supersession', () => {
    const pkgArtifact = artifact({ id: 'package-1', taskId: 'parent', authorAgentId: 'adrian', manifest: [{ childTaskId: 'task-1', artifactId: 'artifact-1' }] });
    const parent = task({ id: 'parent', parentTaskId: null, agentId: 'adrian', state: 'waiting_for_owner_approval', currentArtifactId: 'package-1' });
    const stage = (approvals: OfficeApproval[], parentTask = parent) => evidenceStages(pkgArtifact, parentTask, records({ approvals }), { now: NOW, producedByRun: true }).owner.state;
    expect(stage([approval()])).toBe('pending');
    expect(stage([approval({ expiresAt: at(1) })])).toBe('renewal');
    expect(stage([approval()], { ...parent, state: 'paused' })).toBe('held');
    expect(stage([approval({ state: 'rejected', reason: 'Clarify scope', decidedAt: at(2) })], { ...parent, state: 'changes_requested' })).toBe('rejected');
    expect(stage([approval({ state: 'approved', acceptanceEvidenceId: 'evidence-1', decidedAt: at(1) })], { ...parent, state: 'completed' })).toBe('accepted');
    expect(stage([], { ...parent, currentArtifactId: 'package-2' })).toBe('superseded');
  });
  it('places a child inside its parent package decision or reports inherited acceptance', () => {
    const child = task({ currentArtifactId: 'artifact-1', state: 'review_passed' });
    const parent = task({ id: 'parent', parentTaskId: null, agentId: 'adrian', state: 'waiting_for_owner_approval', currentArtifactId: 'package-1' });
    const pkgArtifact = artifact({ id: 'package-1', taskId: 'parent', manifest: [{ childTaskId: 'task-1', artifactId: 'artifact-1' }] });
    expect(evidenceStages(artifact(), child, records({ tasks: [parent], artifacts: [pkgArtifact, artifact()], approvals: [approval()] }), { now: NOW, producedByRun: true }).owner).toMatchObject({ state: 'pending', label: expect.stringContaining('In the package') });
    expect(evidenceStages(artifact(), { ...child, state: 'completed', acceptanceEvidenceId: 'evidence-1' }, records(), { now: NOW, producedByRun: true }).owner.state).toBe('accepted');
    expect(evidenceStages(artifact(), child, records({ tasks: [parent], artifacts: [artifact({ id: 'package-1', taskId: 'parent', manifest: [] })] }), { now: NOW, producedByRun: true }).owner.label).toContain('Not yet in a package decision');
  });
});

describe('evidence payload validation and family merge', () => {
  it('rejects malformed activity responses', () => {
    expect(isOfficeActivity(null)).toBe(false);
    expect(isOfficeActivity({ generatedAt: 'x', roles: [], tasks: [] })).toBe(false);
    expect(isOfficeActivity({ generatedAt: 'x', roles: [], tasks: [], provenance: [], worker: { online: false, workersSeen: 0 }, taskWindow: {} })).toBe(true);
  });
  it('merges a linked family into a bounded snapshot without duplicates, preferring the newer family rows', () => {
    const snapshot = { tasks: [task({ id: 'a', version: 1 }), task({ id: 'b' })], artifacts: [], reviews: [], approvals: [], events: [] };
    const merged = mergeFamily(snapshot, { rootTaskId: 'a', tasks: [task({ id: 'a', version: 2 }), task({ id: 'c' })], artifacts: [artifact()], reviews: [], approvals: [], events: [] });
    expect(merged.tasks.map(entry => entry.id).sort()).toEqual(['a', 'b', 'c']);
    expect(merged.tasks.find(entry => entry.id === 'a')!.version).toBe(2);
    expect(merged.artifacts).toHaveLength(1);
    expect(mergeFamily(snapshot, null)).toBe(snapshot);
  });
});

function activityOf(roles: OfficeRoleActivity[], tasks: OfficeTaskExecution[] = [], worker: Partial<OfficeActivity['worker']> = {}): OfficeActivity {
  return {
    generatedAt: at(0), scope: { workspaceId: null },
    worker: { workersSeen: 1, online: true, lastHeartbeatAt: at(5), heartbeatAgeSeconds: 5, latest: { heartbeatAt: at(5), startedAt: at(100), stopping: false, ageSeconds: 5 }, onlineThresholdSeconds: 60, ...worker },
    execution: { adapter: 'deterministic_demo', providerConfigured: false, commandExecutionEnabled: false },
    roles, tasks, provenance: [], taskWindow: { limit: 200, covered: tasks.length, total: tasks.length }, family: null,
  };
}

describe('lease evidence ages locally between polls and never outlives its lease', () => {
  // `evidenceAgeMs` is monotonic time since the status request was sent; no fetch happens inside these cases.
  const ctxAt = (evidenceAgeMs: number, overrides: Partial<typeof ctx> = {}) => ({ ...ctx, ...overrides, evidenceAgeMs });
  const lineAt = (evidenceAgeMs: number, activeRun: OfficeActiveRun, state: OfficeTask['state'] = 'in_progress') => taskExecutionLine(task({ state }), { execution: execution({ activeRun }), children: [], worker: online, stale: false, evidenceAgeMs });
  const draft = run({ leaseRemainingMs: 5000 });
  const executingRole = role({ activeRun: draft }, { open: 1, inProgress: 1, executingRuns: 1 });
  const currentClaim = /Executing|Reviewing|Being reviewed now|lease held|still holds its lease/;

  it('is executing immediately before expiry and stops at and after it, with no new fetch', () => {
    for (const [age, executing] of [[0, true], [4999, true], [5000, false], [5001, false], [60000, false]] as const) {
      const status = deriveRoleStatus('sam', executingRole, ctxAt(age));
      const line = lineAt(age, draft);
      if (executing) {
        expect(status.indicator).toBe('executing');
        expect(line.state).toBe('executing');
        continue;
      }
      expect(status).toMatchObject({ indicator: 'stalled', label: 'Lease expired', runId: draft.id });
      expect(`${status.label} ${status.detail}`).not.toMatch(currentClaim);
      expect(line.state).toBe('stalled');
      expect(line.label).not.toMatch(currentClaim);
      // Expiry alone is not a recorded failure or a completed retry.
      expect(status.detail).toContain('not a recorded failure');
      expect(`${status.detail} ${line.label}`).not.toMatch(/\bfailed\b|retried|retry (completed|succeeded)/i);
    }
  });

  it('keeps worker heartbeat separate: the worker may still be online after the lease has run out', () => {
    const activity = activityOf([executingRole]);
    expect(workerIndicator({ availability: 'available', activity, evidenceAgeMs: 6000, health, stale: false }).state).toBe('online');
    expect(deriveRoleStatus('sam', executingRole, ctxAt(6000)).indicator).toBe('stalled');
    // With no worker at all the same aged lease is still not execution.
    expect(deriveRoleStatus('sam', executingRole, ctxAt(6000, { worker: offline })).indicator).toBe('stalled');
  });

  it('counts a delayed response against the evidence: an observation expired on arrival is never current', () => {
    // Sent at monotonic 1 000 ms, the database read 5 s of lease left, and the response arrived at 9 000 ms.
    const age = evidenceAge(1000, 9000);
    expect(age).toBe(8000);
    expect(leaseNow(draft, age).state).toBe('expired_since_read');
    expect(deriveRoleStatus('sam', executingRole, ctxAt(age)).indicator).toBe('stalled');
    expect(lineAt(age, draft).state).toBe('stalled');
    // Ageing from receipt would have claimed 5 s more execution; the send time is the conservative bound.
    expect(leaseNow(draft, evidenceAge(9000, 9000)).state).toBe('live');
    // Before the first client tick (server rendering), no elapsed time is assumed beyond the server read.
    expect(evidenceAge(0, null)).toBe(0);
  });

  it('re-ages hidden-tab evidence by the elapsed time when the tab becomes visible', () => {
    // Polling stops while hidden; the expiry timer still targets the lease end, and visibility re-ages at once.
    const quietWorker = { online: false, heartbeatAgeSeconds: 300 };
    expect(nextEvidenceChangeMs(activityOf([executingRole], [], quietWorker), 1000)).toBe(4000);
    const hiddenFor = 30000;
    expect(deriveRoleStatus('sam', executingRole, ctxAt(1000 + hiddenFor)).indicator).toBe('stalled');
    expect(nextEvidenceChangeMs(activityOf([executingRole], [], quietWorker), 1000 + hiddenFor)).toBeNull();
  });

  it('is unaffected by browser clock skew: no database timestamp is compared with the wall clock', () => {
    // lease_until looks expired to a fast browser clock, yet the database read 20 s remaining.
    const looksExpired = run({ leaseUntil: at(3600), leaseRemainingMs: 20000 });
    // lease_until looks live to a slow browser clock, yet the database read it as expired.
    const looksLive = run({ leaseUntil: at(-3600), leaseLive: false, leaseRemainingMs: -1000 });
    expect(deriveRoleStatus('sam', role({ activeRun: looksExpired }), ctxAt(1000)).indicator).toBe('executing');
    expect(lineAt(1000, looksExpired).state).toBe('executing');
    expect(deriveRoleStatus('sam', role({ activeRun: looksLive }), ctxAt(0))).toMatchObject({ indicator: 'stalled', label: 'Stalled' });
    expect(lineAt(0, looksLive).state).toBe('stalled');
  });

  it('applies the same expiry to reviewing and stop-requested runs', () => {
    const review = run({ step: 'review', agentId: 'theo', leaseRemainingMs: 3000 });
    const reviewer = role({ agentId: 'theo', activeRun: review });
    expect(deriveRoleStatus('theo', reviewer, ctxAt(2999)).indicator).toBe('reviewing');
    expect(deriveRoleStatus('theo', reviewer, ctxAt(3000)).indicator).toBe('stalled');
    expect(lineAt(2999, review, 'waiting_for_review').state).toBe('reviewing');
    expect(lineAt(3000, review, 'waiting_for_review')).toMatchObject({ state: 'stalled', label: expect.not.stringMatching(currentClaim) });
    const stopping = run({ state: 'pause_requested', leaseRemainingMs: 3000 });
    const pausing = role({ activeRun: stopping }, { open: 1, stopping: 1 });
    expect(deriveRoleStatus('sam', pausing, ctxAt(2999))).toMatchObject({ indicator: 'stopping', detail: expect.stringContaining('still holds its lease') });
    expect(deriveRoleStatus('sam', pausing, ctxAt(3000))).toMatchObject({ indicator: 'stalled', detail: expect.not.stringContaining('still holds its lease') });
    expect(lineAt(2999, stopping, 'pause_requested').state).toBe('stopping');
    expect(lineAt(3000, stopping, 'pause_requested')).toMatchObject({ state: 'stalled', label: expect.not.stringMatching(currentClaim) });
  });

  it('stops claiming a review in progress once that review lease has run out', () => {
    const author = role({ agentId: 'lisa', reviewInProgress: { reviewerId: 'sam', runId: 'run-abcdefgh', taskId: 'task-9', leaseRemainingMs: 3000 } }, { open: 1, awaitingReview: 1 });
    expect(deriveRoleStatus('lisa', author, ctxAt(2000))).toMatchObject({ indicator: 'awaiting_review', activeTaskId: 'task-9', detail: expect.stringContaining('Being reviewed now by Sam') });
    expect(deriveRoleStatus('lisa', author, ctxAt(3000))).toMatchObject({ indicator: 'awaiting_review', detail: expect.not.stringContaining('Being reviewed now') });
    expect(agedRole(author, 3000).reviewInProgress).toBeNull();
  });

  it('derives lease counts and the shown run from every leased run, not only the first', () => {
    const short = run({ id: 'run-short000', leaseRemainingMs: 5000 });
    const long = run({ id: 'run-long0000', taskId: 'task-2', leaseRemainingMs: 30000 });
    const busy = role({ activeRun: short, leasedRuns: [short, long] }, { open: 2, executingRuns: 2 });
    expect(agedRole(busy, 1000)).toMatchObject({ executing: 2, stalled: 0, activeRun: { id: 'run-short000' } });
    expect(agedRole(busy, 6000)).toMatchObject({ executing: 1, stalled: 1, activeRun: { id: 'run-long0000' } });
    expect(deriveRoleStatus('sam', busy, ctxAt(6000))).toMatchObject({ indicator: 'executing', runId: 'run-long0000', activeTaskId: 'task-2' });
    expect(agedRole(busy, 31000)).toMatchObject({ executing: 0, stalled: 2 });
  });

  it('lets a newer snapshot renew or replace the evidence', () => {
    expect(deriveRoleStatus('sam', executingRole, ctxAt(6000)).indicator).toBe('stalled');
    // A later poll, sent at 6 000 ms, saw the worker's renewed lease: it is live from its own send time.
    const renewed = role({ activeRun: run({ leaseRemainingMs: 29000 }) }, { open: 1 });
    expect(deriveRoleStatus('sam', renewed, ctxAt(evidenceAge(6000, 6500))).indicator).toBe('executing');
    // A later poll without the lease (the step committed) shows the next recorded state.
    expect(deriveRoleStatus('sam', role({}, { open: 1, awaitingReview: 1 }), ctxAt(0)).indicator).toBe('awaiting_review');
    // A later poll in which the database saw the lease expired is server-confirmed stalled.
    expect(deriveRoleStatus('sam', role({ activeRun: run({ leaseLive: false, leaseRemainingMs: -2000 }) }, { open: 1 }), ctxAt(0))).toMatchObject({ indicator: 'stalled', label: 'Stalled' });
  });

  it('never presents the reviewed reproduction as executing, nor a lease that cannot be aged', () => {
    // Codex's reproduction: read at 00:00:04 with the lease until 00:00:05, shown at 00:00:10.
    const captured = run({ startedAt: '2026-11-05T00:00:00Z', leaseUntil: '2026-11-05T00:00:05Z', leaseRemainingMs: 1000 });
    expect(deriveRoleStatus('sam', role({ activeRun: captured }, { open: 1, executingRuns: 1 }), ctxAt(6000)).indicator).toBe('stalled');
    expect(lineAt(6000, captured).state).toBe('stalled');
    // A payload without server-relative remaining time (as in that reproduction) is never current execution.
    const unaged = { ...captured, leaseRemainingMs: undefined } as unknown as OfficeActiveRun;
    expect(deriveRoleStatus('sam', role({ activeRun: unaged }, { open: 1, executingRuns: 1 }), ctxAt(0)).indicator).toBe('stalled');
    expect(lineAt(0, unaged).state).toBe('stalled');
  });

  it('schedules the next re-render at the soonest lease expiry or heartbeat threshold', () => {
    const quietWorker = { online: false, heartbeatAgeSeconds: 300 };
    const reviewer = role({ agentId: 'theo', activeRun: run({ id: 'run-review00', step: 'review', agentId: 'theo', leaseRemainingMs: 9000 }) });
    const author = role({ agentId: 'lisa', reviewInProgress: { reviewerId: 'theo', runId: 'run-review00', taskId: 'task-1', leaseRemainingMs: 9000 } });
    const taskLease = execution({ activeRun: run({ leaseRemainingMs: 7000 }) });
    expect(nextEvidenceChangeMs(activityOf([reviewer, author], [taskLease], quietWorker), 1000)).toBe(6000);
    expect(nextEvidenceChangeMs(activityOf([reviewer, author], [], quietWorker), 1000)).toBe(8000);
    expect(nextEvidenceChangeMs(activityOf([], [], { online: true, heartbeatAgeSeconds: 50 }), 2000)).toBe(8000);
    expect(nextEvidenceChangeMs(activityOf([reviewer], [], quietWorker), 9000)).toBeNull();
    expect(nextEvidenceChangeMs(null, 0)).toBeNull();
  });

  it('words run details from aged evidence only', () => {
    expect(leaseWording(leaseNow(draft, 0)).before).toBe('lease held until');
    expect(leaseWording(leaseNow(draft, 5000))).toEqual({ before: 'lease ran out at', after: expect.stringContaining('awaiting fresh status') });
    expect(leaseWording(leaseNow(run({ leaseLive: false, leaseRemainingMs: -1 }), 0)).before).toBe('lease expired at');
    expect(leaseWording(null).before).not.toContain('held');
    // An open run record without a live lease is not worded as running.
    expect(leasedRunState(draft, leaseNow(draft, 0))).toBe('Running');
    expect(leasedRunState(draft, leaseNow(draft, 5000))).toBe('run record still open');
    const expiredAtRead = run({ leaseLive: false, leaseRemainingMs: -1 });
    expect(leasedRunState(expiredAtRead, leaseNow(expiredAtRead, 0))).toBe('run record still open');
    const pausing = run({ state: 'pause_requested', leaseRemainingMs: 1000 });
    expect(leasedRunState(pausing, leaseNow(pausing, 5000))).not.toMatch(/Running|run record/);
  });
});
