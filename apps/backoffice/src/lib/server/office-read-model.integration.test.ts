import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOfficeRuntime } from '@/lib/office-runtime';
import type { OfficeRoleActivity } from '@/lib/office-activity';
import { deriveRoleStatus, type WorkerIndicator } from '@/components/office/office-status';
import { closeDbForTests } from './db';
import { loadOfficeDashboard } from './office-dashboard';
import { createOfficeReadModel } from './office-read-model';

// Dedicated disposable database only; never falls back to DATABASE_URL.
const databaseUrl = process.env.OFFICE_DASHBOARD_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const demo = '00000000-0000-4000-8000-000000000001';
const live = '00000000-0000-4000-8000-000000000002';
const BRIEF_MARKER = 'BRIEF-MARKER-7d41-synthetic';
const NOTE_MARKER = 'NOTE-MARKER-93ab-synthetic';
const CONTENT_MARKER = 'Deterministic demonstration. No model was called';
const online: WorkerIndicator = { state: 'online', label: 'Worker online', detail: '', ageSeconds: 1 };
const migration = (name: string) => readFile(fileURLToPath(new URL(`../../../database/migrations/${name}`, import.meta.url)), 'utf8');

suite('Office dashboard read model on an explicitly disposable PostgreSQL database', () => {
  let sql: ReturnType<typeof postgres>;
  let runtime: ReturnType<typeof createOfficeRuntime>;
  let readModel: ReturnType<typeof createOfficeReadModel>;
  const owner = { id: '', email: `dashboard-owner-${randomUUID()}@example.test`, name: 'Owner fixture', role: 'admin' as const, commissionRateBps: 0 };
  const input = (goal: string, workspaceId = demo, mode: 'demo' | 'live' = 'demo') => ({ workspaceId, mode, goal, brief: `Synthetic owner brief ${BRIEF_MARKER}: five informational pages and a contact form proposal; prices, provider and sources remain unknown.`, idempotencyKey: randomUUID() });
  const state = async (id: string) => (await sql`SELECT state FROM backoffice.office_tasks WHERE id=${id}`)[0].state as string;
  async function drain(parentId: string, until = 'waiting_for_owner_approval') {
    for (let iteration = 0; iteration < 250; iteration++) {
      const lease = await runtime.claim('dashboard-test-worker');
      if (lease) await runtime.execute(lease);
      if (await state(parentId) === until) return;
      if (!lease) await sql`UPDATE backoffice.office_dispatch SET available_at=now() WHERE state='pending' AND available_at>now()`;
    }
    throw new Error(`Family did not reach ${until}.`);
  }
  const roles = async (workspaceId: string | null = demo) => (await readModel.activity({ workspaceId })).roles;
  const roleOf = (list: OfficeRoleActivity[], agentId: string, mode = 'demo') => list.find(entry => entry.agentId === agentId && entry.mode === mode)!;

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '55439' || !target.pathname.endsWith('_dashboard_test')) throw new Error('OFFICE_DASHBOARD_TEST_DATABASE_URL must name the loopback 55439 *_dashboard_test database.');
    sql = postgres(databaseUrl!, { max: 6, onnotice: () => undefined });
    // Reset only this explicitly named disposable fixture, then apply 001/002 WITHOUT the Office migration.
    await sql.unsafe('DROP SCHEMA IF EXISTS backoffice CASCADE');
    for (const name of ['001_init.sql', '002_users_and_ownership.sql']) await sql.unsafe(await migration(name));
    const [created] = await sql`INSERT INTO backoffice.users(email,name,role) VALUES(${owner.email},'Owner fixture','admin') RETURNING id`;
    owner.id = created.id;
    readModel = createOfficeReadModel(sql);
    runtime = createOfficeRuntime(sql);
  }, 60000);
  afterAll(async () => { await closeDbForTests(); await sql?.end({ timeout: 2 }); delete process.env.OFFICE_ENABLED; });

  it('keeps the dashboard truthful before migration 003 exists: unavailable when enabled, no query when disabled', async () => {
    await expect(readModel.dashboard()).rejects.toMatchObject({ code: '42P01' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.env.DATABASE_URL = databaseUrl!; process.env.OFFICE_ENABLED = 'true';
    expect(await loadOfficeDashboard(owner)).toEqual({ state: 'unavailable', reason: 'schema_missing' });
    // An unreachable application database proves the disabled path never opens a connection.
    await closeDbForTests();
    process.env.DATABASE_URL = 'postgresql://office_test@127.0.0.1:1/unreachable_dashboard_test';
    process.env.OFFICE_ENABLED = 'false';
    expect(await loadOfficeDashboard(owner)).toEqual({ state: 'disabled' });
    process.env.OFFICE_ENABLED = 'true';
    expect(await loadOfficeDashboard(owner)).toEqual({ state: 'unavailable', reason: 'storage_error' });
    await closeDbForTests();
    log.mockRestore();
    await sql.unsafe(await migration('003_office.sql'));
    await sql.unsafe(await migration('004_office_live_provider.sql'));
  }, 60000);

  let parent = '';
  let children: { id: string; agent_id: string }[] = [];
  it('separates saved, delegated and executing work and never credits request bookkeeping to a role', async () => {
    parent = (await runtime.submitTask(owner.id, input('Dashboard family A'))).taskId;
    await runtime.submitTask(owner.id, input('Live configuration family', live, 'live'));
    children = await sql`SELECT id, agent_id FROM backoffice.office_tasks WHERE parent_task_id=${parent}`;
    const board = await readModel.dashboard();
    expect(board.modes.demo.tasks).toMatchObject({ total: 8, parents: 1, queued: 7, inProgress: 1, startedNotExecuting: 1, executing: 0 });
    expect(board.modes.demo.steps).toMatchObject({ runnable: 7, waitingOnDependencies: 1, leasedLive: 0 });
    expect(board.modes.live.tasks).toMatchObject({ total: 1, blocked: 1, executing: 0 });
    expect(board.worker).toMatchObject({ workersSeen: 0, online: false });
    const activity = await readModel.activity({ workspaceId: demo });
    const parentExecution = activity.tasks.find(entry => entry.taskId === parent)!;
    expect(parentExecution.runs.total).toBe(0);
    expect(parentExecution.coordination?.step).toBe('delegate_internal_demo');
    const adrian = roleOf(activity.roles, 'adrian');
    expect(adrian.latestRun).toBeNull();
    expect(adrian.counts).toMatchObject({ runnableSteps: 1, waitingOnDependencies: 1, executingRuns: 0 });
    const offline: WorkerIndicator = { state: 'never_seen', label: 'No worker connected', detail: '', ageSeconds: null };
    for (const entry of activity.roles.filter(item => item.mode === 'demo')) expect(deriveRoleStatus(entry.agentId, entry, { availability: 'available', stale: false, mode: 'demo', worker: offline, evidenceAgeMs: 0 }).indicator).toBe('queued');
  });

  it('attributes a live lease to the run agent and the review queue to the reviewer', async () => {
    const lease = (await runtime.claim('dashboard-test-worker'))!;
    let activity = await readModel.activity({ workspaceId: demo });
    expect(roleOf(activity.roles, lease.agentId).activeRun).toMatchObject({ id: lease.runId, leaseLive: true });
    expect(activity.tasks.find(entry => entry.taskId === lease.taskId)!.activeRun?.id).toBe(lease.runId);
    // Remaining lease time is measured against database now(); this later query can only see less of it.
    const [{ remaining }] = await sql`SELECT (EXTRACT(EPOCH FROM (lease_until-now()))*1000)::float8 AS remaining FROM backoffice.office_dispatch WHERE id=${lease.dispatchId}`;
    const held = roleOf(activity.roles, lease.agentId);
    expect(held.leasedRuns.map(run => run.id)).toEqual([lease.runId]);
    expect(held.activeRun!.leaseRemainingMs).toBeGreaterThanOrEqual(Math.floor(remaining) - 1);
    expect(held.activeRun!.leaseRemainingMs).toBeLessThanOrEqual(30000);
    expect(activity.tasks.find(entry => entry.taskId === lease.taskId)!.leasedRuns.map(run => run.id)).toEqual([lease.runId]);
    expect((await readModel.dashboard()).modes.demo.tasks.executing).toBe(1);
    expect(activity.worker.online).toBe(true);
    const ctx = { availability: 'available' as const, stale: false, mode: 'demo' as const, worker: online };
    // The same live read stops counting as execution once its own remaining time has elapsed locally.
    expect(deriveRoleStatus(lease.agentId, held, { ...ctx, evidenceAgeMs: 0 }).indicator).toBe('executing');
    expect(deriveRoleStatus(lease.agentId, held, { ...ctx, evidenceAgeMs: held.activeRun!.leaseRemainingMs! })).toMatchObject({ indicator: 'stalled', label: 'Lease expired' });
    // A lease already expired at read time has no remaining time; restoring it lets this worker commit normally.
    await sql`UPDATE backoffice.office_dispatch SET lease_until=now()-interval '1 second' WHERE id=${lease.dispatchId}`;
    const expired = roleOf((await readModel.activity({ workspaceId: demo })).roles, lease.agentId);
    expect(expired.activeRun).toMatchObject({ id: lease.runId, leaseLive: false });
    expect(expired.activeRun!.leaseRemainingMs).toBeLessThanOrEqual(-1000);
    expect(expired.counts).toMatchObject({ executingRuns: 0, stalledRuns: 1 });
    expect(deriveRoleStatus(lease.agentId, expired, { ...ctx, evidenceAgeMs: 0 })).toMatchObject({ indicator: 'stalled', label: 'Stalled' });
    await sql`UPDATE backoffice.office_dispatch SET lease_until=now()+interval '30 seconds' WHERE id=${lease.dispatchId}`;
    await runtime.execute(lease);
    activity = await readModel.activity({ workspaceId: demo });
    const [pendingReview] = await sql`SELECT reviewer_id FROM backoffice.office_dispatch WHERE task_id=${lease.taskId} AND step='review' AND state='pending'`;
    expect(roleOf(activity.roles, pendingReview.reviewer_id).counts.runnableReviews).toBe(1);
    expect(roleOf(activity.roles, lease.agentId).counts.awaitingReview).toBe(1);
    expect(roleOf(activity.roles, lease.agentId).activeRun).toBeNull();
  });

  it('shows a drained family as reviewed and awaiting the owner, with exact counts and decision links', async () => {
    await drain(parent);
    const board = await readModel.dashboard();
    const [counts] = await sql`SELECT count(*) FILTER (WHERE mode='demo')::int AS demo, count(*) FILTER (WHERE mode='live')::int AS live FROM backoffice.office_tasks`;
    expect(board.modes.demo.tasks.total).toBe(counts.demo);
    expect(board.modes.live.tasks.total).toBe(counts.live);
    expect(board.modes.demo.tasks).toMatchObject({ waitingForOwner: 1, reviewPassed: 7, executing: 0 });
    expect(board.decisions).toMatchObject({ pending: 1, renewal: 0 });
    expect(board.decisions.latest[0].link).toEqual({ mode: 'demo', workspaceId: demo, taskId: parent, view: 'inbox' });
    expect(board.outputs).toHaveLength(5);
    expect(board.outputs.every(output => output.status === 'review_passed' && !output.ownerPrepared)).toBe(true);
    const list = await roles();
    for (const entry of list.filter(item => item.mode === 'demo')) expect(deriveRoleStatus(entry.agentId, entry, { availability: 'available', stale: false, mode: 'demo', worker: online, evidenceAgeMs: 0 }).indicator).not.toBe('idle');
    expect(deriveRoleStatus('adrian', roleOf(list, 'adrian'), { availability: 'available', stale: false, mode: 'demo', worker: online, evidenceAgeMs: 0 }).indicator).toBe('waiting_for_owner');
    const sam = roleOf(list, 'sam');
    const [decided] = await sql`SELECT decided_at FROM backoffice.office_reviews WHERE id=${sam.latestReviewGiven!.id}`;
    expect(sam.latestReviewGiven!.decidedAt).toBe(new Date(decided.decided_at).toISOString());
    expect(roleOf(list, 'adrian').latestRun?.step).toMatch(/^(draft|package|review|package_review)$/);
  });

  it('keys decisions to the package: expiry needs renewal and renewal restores a pending decision', async () => {
    await sql`UPDATE backoffice.office_approvals SET expires_at=now()-interval '1 second' WHERE task_id=${parent} AND state='pending'`;
    expect((await readModel.dashboard()).decisions).toMatchObject({ pending: 0, renewal: 1 });
    expect(roleOf(await roles(), 'adrian').counts).toMatchObject({ decisionsPending: 0, decisionsRenewal: 1 });
    const [row] = await sql`SELECT version FROM backoffice.office_tasks WHERE id=${parent}`;
    await runtime.requestTaskAction(owner.id, { workspaceId: demo, taskId: parent, version: Number(row.version), action: 'renew_approval' });
    expect((await readModel.dashboard()).decisions).toMatchObject({ pending: 1, renewal: 0 });
  });

  it('rechecks deep links against mode, workspace and task without revealing other scopes', async () => {
    const [artifact] = await sql`SELECT id FROM backoffice.office_artifacts WHERE task_id=${children[0].id} ORDER BY revision LIMIT 1`;
    const [otherArtifact] = await sql`SELECT id FROM backoffice.office_artifacts WHERE task_id=${children[1].id} ORDER BY revision LIMIT 1`;
    const link = (overrides: Record<string, unknown>) => readModel.resolveLink({ kind: 'link', mode: 'demo', workspaceId: demo, taskId: parent, artifactId: null, view: null, ...overrides } as Parameters<typeof readModel.resolveLink>[0]);
    expect(await link({})).toMatchObject({ status: 'ok', taskId: parent, artifact: 'none' });
    expect(await link({ taskId: children[0].id, artifactId: artifact.id })).toMatchObject({ status: 'ok', artifactId: artifact.id, artifact: 'found' });
    // An unavailable revision stays requested (never replaced by another); nothing about other records is returned.
    expect(await link({ taskId: children[0].id, artifactId: otherArtifact.id })).toEqual({ status: 'ok', mode: 'demo', workspaceId: demo, taskId: children[0].id, artifactId: otherArtifact.id, artifact: 'not_found', view: null });
    const unknownArtifact = randomUUID();
    expect(await link({ taskId: children[0].id, artifactId: unknownArtifact })).toMatchObject({ status: 'ok', artifactId: unknownArtifact, artifact: 'not_found' });
    expect(await link({ workspaceId: live })).toEqual({ status: 'not_found', mode: 'demo' });
    expect(await link({ mode: 'live' })).toEqual({ status: 'not_found', mode: 'live' });
    expect(await link({ taskId: randomUUID() })).toEqual({ status: 'not_found', mode: 'demo' });
    expect((await readModel.activity({ task: { workspaceId: live, taskId: parent } })).family).toBeNull();
  });

  it('returns a linked family in exactly the runtime snapshot shapes', async () => {
    const snapshot = await runtime.snapshot(demo);
    const { family } = await readModel.activity({ workspaceId: demo, task: { workspaceId: demo, taskId: children[0].id } });
    expect(family!.rootTaskId).toBe(parent);
    expect(family!.tasks.map(entry => entry.id).sort()).toEqual([parent, ...children.map(child => child.id)].sort());
    for (const entry of family!.tasks) expect(entry).toEqual(snapshot.tasks.find(item => item.id === entry.id));
    for (const entry of family!.artifacts) expect(entry).toEqual(snapshot.artifacts.find(item => item.id === entry.id));
    for (const entry of family!.reviews) expect(entry).toEqual(snapshot.reviews.find(item => item.id === entry.id));
    for (const entry of family!.approvals) expect(entry).toEqual(snapshot.approvals.find(item => item.id === entry.id));
    for (const entry of family!.events.filter(item => snapshot.events.some(event => event.eventId === item.eventId))) expect(entry).toEqual(snapshot.events.find(item => item.eventId === entry.eventId));
  });

  it('does not credit an owner-prepared revision to the role it is recorded under', async () => {
    const child = children.find(entry => entry.agent_id === 'lisa')!;
    const before = roleOf(await roles(), 'lisa');
    let [row] = await sql`SELECT version FROM backoffice.office_tasks WHERE id=${child.id}`;
    await runtime.requestTaskAction(owner.id, { workspaceId: demo, taskId: child.id, version: Number(row.version), action: 'request_changes', reason: 'Synthetic owner request: clarify assets.' });
    [row] = await sql`SELECT version FROM backoffice.office_tasks WHERE id=${child.id}`;
    const { artifactId } = await runtime.reviseArtifact(owner.id, { workspaceId: demo, taskId: child.id, version: Number(row.version), authorAgentId: 'lisa', title: 'Owner-prepared synthetic revision', content: 'Simulated owner revision. Real feasibility and assets remain unverified.' });
    const activity = await readModel.activity({ workspaceId: demo });
    const lisa = roleOf(activity.roles, 'lisa');
    expect(lisa.latestArtifact?.id).toBe(before.latestArtifact?.id);
    expect(lisa.latestOwnerRevision).toMatchObject({ id: artifactId, revision: 2 });
    expect(lisa.lastEvent?.runId).not.toBeNull();
    expect(activity.provenance.find(entry => entry.artifactId === artifactId)?.producedByRun).toBe(false);
    for (let iteration = 0; iteration < 20 && await state(child.id) !== 'review_passed'; iteration++) { const lease = await runtime.claim('dashboard-test-worker'); if (lease) await runtime.execute(lease); }
    expect((await readModel.dashboard()).outputs.find(output => output.artifactId === artifactId)).toMatchObject({ ownerPrepared: true, authorAgentId: 'lisa' });
  });

  it('never exposes briefs, artifact bodies or owner notes in summaries; only the Office family read carries them', async () => {
    const [row] = await sql`SELECT version FROM backoffice.office_tasks WHERE id=${parent}`;
    await runtime.requestTaskAction(owner.id, { workspaceId: demo, taskId: parent, version: Number(row.version), action: 'note', reason: `Owner note ${NOTE_MARKER}` });
    const board = JSON.stringify(await readModel.dashboard());
    const scoped = JSON.stringify(await readModel.activity({ workspaceId: demo }));
    for (const payload of [board, scoped]) for (const marker of [BRIEF_MARKER, NOTE_MARKER, CONTENT_MARKER]) expect(payload).not.toContain(marker);
    expect(JSON.stringify((await readModel.activity({ workspaceId: demo, task: { workspaceId: demo, taskId: parent } })).family)).toContain(BRIEF_MARKER);
  });

  it('never offers a paused package as decidable', async () => {
    const familyB = (await runtime.submitTask(owner.id, input('Dashboard family B'))).taskId;
    await drain(familyB);
    const pendingBefore = (await readModel.dashboard()).decisions.pending;
    const [row] = await sql`SELECT version FROM backoffice.office_tasks WHERE id=${familyB}`;
    await runtime.requestTaskAction(owner.id, { workspaceId: demo, taskId: familyB, version: Number(row.version), action: 'pause' });
    expect(await state(familyB)).toBe('paused');
    const board = await readModel.dashboard();
    expect(board.decisions.pending).toBe(pendingBefore - 1);
    expect(board.decisions.latest.some(decision => decision.link.taskId === familyB)).toBe(false);
    expect(board.modes.demo.tasks.paused).toBeGreaterThanOrEqual(1);
  });

  it('reports exact totals beyond the bounded snapshot and still opens an older linked family', async () => {
    for (let index = 0; index < 26; index++) await runtime.submitTask(owner.id, input(`Bulk synthetic family ${index}`));
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM backoffice.office_tasks WHERE workspace_id=${demo}`;
    expect(n).toBeGreaterThan(200);
    const snapshot = await runtime.snapshot(demo);
    expect(snapshot.tasks).toHaveLength(200);
    expect(snapshot.tasks.some(entry => entry.id === parent)).toBe(false);
    expect((await readModel.dashboard()).modes.demo.tasks.total).toBe(n);
    const activity = await readModel.activity({ workspaceId: demo, task: { workspaceId: demo, taskId: parent } });
    expect(activity.taskWindow).toMatchObject({ limit: 200, total: n });
    expect(activity.taskWindow.covered).toBeGreaterThanOrEqual(200);
    expect(activity.family!.tasks).toHaveLength(8);
    expect(activity.tasks.some(entry => entry.taskId === parent)).toBe(true);
  }, 60000);

  it('counts ready live drafts and reviews only with a fresh provider, enabled limits and no unresolved outcome', async () => {
    await sql`UPDATE backoffice.office_budget SET live_enabled=true,limit_microunits=10000000,monthly_limit_microunits=10000000,family_limit_microunits=1000000,request_limit_microunits=150000 WHERE id=1`;
    const liveParent = (await runtime.submitTask(owner.id, input('Configured live queue', live, 'live'))).taskId;
    expect((await readModel.dashboard()).modes.live.steps.runnable).toBe(0);
    await sql`INSERT INTO backoffice.office_workers(id,adapter,capabilities) VALUES('read-model-live-fixture','openai_responses','{"provider":"openai","draftModel":"gpt-6-luna","packageModel":"gpt-6.1-sol","reasoningEffort":"low"}')`;
    const ready = await readModel.activity({ workspaceId: live });
    expect(ready.roles.filter(entry => entry.mode === 'live').reduce((sum, entry) => sum + entry.counts.runnableSteps, 0)).toBe(7);
    expect(ready.tasks.reduce((sum, entry) => sum + entry.steps.runnable, 0)).toBe(7);
    expect((await readModel.dashboard()).modes.live.steps).toMatchObject({ runnable: 7, waitingOnDependencies: 1 });
    // A queued review is credited to its independent reviewer, not only to the author.
    const [child] = await sql`SELECT id,agent_id FROM backoffice.office_tasks WHERE parent_task_id=${liveParent} ORDER BY agent_id LIMIT 1`;
    await sql`UPDATE backoffice.office_dispatch SET step='review',reviewer_id='nadia' WHERE task_id=${child.id}`;
    const reviewQueue = await readModel.activity({ workspaceId: live });
    expect(roleOf(reviewQueue.roles, 'nadia', 'live').counts.runnableReviews).toBe(1);
    await sql`UPDATE backoffice.office_budget SET live_enabled=false WHERE id=1`;
    expect((await readModel.dashboard()).modes.live.steps.runnable).toBe(0);
    await sql`UPDATE backoffice.office_budget SET live_enabled=true WHERE id=1`;
    await sql`UPDATE backoffice.office_workers SET heartbeat_at=now()-interval '61 seconds' WHERE id='read-model-live-fixture'`;
    expect((await readModel.dashboard()).modes.live.steps.runnable).toBe(0);
    await sql`UPDATE backoffice.office_workers SET heartbeat_at=now() WHERE id='read-model-live-fixture'`;
    const [coordinator] = await sql`SELECT id FROM backoffice.office_runs WHERE task_id=${liveParent} ORDER BY started_at LIMIT 1`;
    const operationId = randomUUID();
    await sql`INSERT INTO backoffice.office_tool_operations(id,workspace_id,task_id,run_id,operation_key,arguments_hash,tool_name,state,provider_idempotency_key) VALUES(${operationId},${live},${liveParent},${coordinator.id},${randomUUID()},${'a'.repeat(64)},'openai_responses','unknown_outcome',${randomUUID()})`;
    expect((await readModel.dashboard()).modes.live.steps.runnable).toBe(0);
    expect((await readModel.activity({ workspaceId: live })).execution.unresolvedModelOutcome).toBe(true);
    await sql`UPDATE backoffice.office_tool_operations SET state='reconciled' WHERE id=${operationId}`;
    expect((await readModel.dashboard()).modes.live.steps.runnable).toBe(7);
    await sql`UPDATE backoffice.office_workspace_grants SET data_scopes='[]' WHERE workspace_id=${live} AND agent_id='nadia'`;
    expect((await readModel.dashboard()).modes.live.steps.runnable).toBe(5);
    await sql`UPDATE backoffice.office_workspace_grants SET data_scopes='["internal_draft"]' WHERE workspace_id=${live} AND agent_id='nadia'`;
    // Controlled clock in this suite's guarded disposable fixture only. Transactional DDL
    // restores the immutable trigger even if ageing fails and the transaction rolls back.
    const ageFixtureAttempt = async (seconds: number) => sql.begin(async tx => {
      await tx`ALTER TABLE backoffice.office_runs DISABLE TRIGGER office_run_terminal_immutable`;
      await tx`UPDATE backoffice.office_runs SET started_at=now()-(${seconds}*interval '1 second') WHERE id=${coordinator.id}`;
      await tx`ALTER TABLE backoffice.office_runs ENABLE TRIGGER office_run_terminal_immutable`;
    });
    await ageFixtureAttempt(660);
    expect((await readModel.dashboard()).modes.live.steps.runnable).toBe(0);
    await ageFixtureAttempt(0);
    expect((await readModel.dashboard()).modes.live.steps.runnable).toBe(7);
  });

  it('meters by dispatch month and carries unresolved reservations from earlier months', async () => {
    const [child] = await sql`SELECT id,agent_id FROM backoffice.office_tasks WHERE mode='live' AND parent_task_id IS NOT NULL LIMIT 1`;
    // A previous-month claim can dispatch this month; a previous-month unresolved request
    // still reserves its whole charge this month. Settled previous-month spend stays separate.
    for (const item of [{ reserved: 100, usage: 10, dispatchedThisMonth: true }, { reserved: 20, usage: null, dispatchedThisMonth: false }, { reserved: 100, usage: 30, dispatchedThisMonth: false }]) {
      await sql`INSERT INTO backoffice.office_runs(workspace_id,task_id,agent_id,profile_version,policy_version,attempt,state,step,started_at,provider_dispatched_at,budget_reserved_microunits,usage_microunits) VALUES(${live},${child.id},${child.agent_id},1,1,1,'interrupted','draft',date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'-interval '1 day',CASE WHEN ${item.dispatchedThisMonth} THEN now() ELSE date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'-interval '1 day' END,${item.reserved},${item.usage})`;
    }
    await sql`UPDATE backoffice.office_budget SET reserved_microunits=20,spent_microunits=40 WHERE id=1`;
    const activity = await readModel.activity({ workspaceId: live });
    expect(activity.execution.budget).toMatchObject({ monthUsedMicrounits: 30, lifetimeUsedMicrounits: 60 });
    const board = await readModel.dashboard();
    expect(board.execution.budget?.monthUsedMicrounits).toBe(30);
  });
});
