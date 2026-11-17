import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createOfficeRuntime, digest } from './index';
import { canRunTransition, canTaskTransition, OFFICE_PRESETS } from '../office-contracts';

const databaseUrl = process.env.OFFICE_TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const demoWorkspace = '00000000-0000-4000-8000-000000000001';
const liveWorkspace = '00000000-0000-4000-8000-000000000002';
describe('canonical office contracts', () => {
  it('preserves requested/effective stops and prevents run-success task-completion shortcuts', () => {
    expect(canTaskTransition('in_progress', 'completed')).toBe(false);
    expect(canTaskTransition('in_progress', 'cancel_requested')).toBe(true);
    expect(canRunTransition('running', 'cancelled')).toBe(false);
    expect(OFFICE_PRESETS.approvalContract.states).not.toContain('consumed');
    expect(digest('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});
databaseDescribe('office runtime on an explicitly disposable PostgreSQL database', () => {
  let sql: ReturnType<typeof postgres>;
  let runtime: ReturnType<typeof createOfficeRuntime>;
  let ownerId: string;
  let nonOwnerId: string;
  const input = (goal: string) => ({ workspaceId: demoWorkspace, mode: 'demo' as const, goal, brief: 'Synthetic owner-supplied website request: five informational pages, contact form proposal; pricing, provider and real sources remain unknown.', idempotencyKey: randomUUID() });
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('OFFICE_TEST_DATABASE_URL must explicitly name a loopback disposable *_test database.');
    sql = postgres(databaseUrl!, { max: 8, onnotice: () => undefined });
    // Reset only this explicit loopback *_test fixture. Never reads DATABASE_URL or the real cluster.
    await sql.unsafe('DROP SCHEMA IF EXISTS backoffice CASCADE');
    for (const name of ['001_init.sql','002_users_and_ownership.sql','003_office.sql','004_office_live_provider.sql']) {
      await sql.unsafe(await readFile(fileURLToPath(new URL(`../../../database/migrations/${name}`, import.meta.url)), 'utf8'));
    }
    const [created] = await sql`INSERT INTO backoffice.users(email,name,role) VALUES(${`office-${randomUUID()}@example.test`},'Synthetic Office Owner','admin') RETURNING id`;
    const [sales] = await sql`INSERT INTO backoffice.users(email,name,role) VALUES(${`office-${randomUUID()}@example.test`},'Synthetic Nonowner','sales') RETURNING id`;
    ownerId = created.id; nonOwnerId = sales.id; runtime = createOfficeRuntime(sql);
  }, 30000);
  afterAll(async () => { await sql?.end({ timeout: 2 }); });
  async function drain(parentId: string) {
    for (let iteration = 0; iteration < 150; iteration++) {
      const lease = await runtime.claim('integration-worker');
      if (lease) await runtime.execute(lease);
      const snapshot = await runtime.snapshot(demoWorkspace);
      if (snapshot.tasks.find(task => task.id === parentId)?.state === 'waiting_for_owner_approval') return snapshot;
    }
    throw new Error('Durable demo did not reach owner decision.');
  }
  it('rejects unauthorized owners and cross-mode scopes', async () => {
    await expect(runtime.submitTask(nonOwnerId, input('Denied owner task'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(runtime.submitTask(ownerId, { ...input('Wrong workspace mode'), workspaceId: liveWorkspace })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('deduplicates concurrent submission and rejects a reused key with a changed payload', async () => {
    const request = input('Submission idempotency');
    const [one,two] = await Promise.all([runtime.submitTask(ownerId, request),runtime.submitTask(ownerId, request)]);
    expect(one.taskId).toBe(two.taskId);
    await expect(runtime.submitTask(ownerId, { ...request, goal: 'Changed idempotent payload' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const snapshot = await runtime.snapshot(demoWorkspace);
    const parent = snapshot.tasks.find(task => task.id === one.taskId)!;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId: parent.id, version: parent.version, action: 'cancel' });
  });
  it('blocks live work honestly without reserving spending or spawning demo artifacts', async () => {
    const { taskId } = await runtime.submitTask(ownerId, { ...input('Real pilot configuration required'), workspaceId: liveWorkspace, mode: 'live' });
    const snapshot = await runtime.snapshot(liveWorkspace);
    expect(snapshot.tasks.find(task => task.id === taskId)).toMatchObject({ state: 'blocked', blockedReason: expect.stringContaining('configuration_required') });
    expect(snapshot.artifacts).toHaveLength(0);
    const [budget] = await sql`SELECT * FROM backoffice.office_budget WHERE id=1`;
    expect(Number(budget.reserved_microunits)).toBe(0);
    expect(Number(budget.spent_microunits)).toBe(0);
  });
  it('races workers, fences stale leases, preserves checkpoints and retries as a new immutable run', async () => {
    const { taskId } = await runtime.submitTask(ownerId, input('Lease recovery workflow'));
    const leases = await Promise.all([runtime.claim('worker-one'),runtime.claim('worker-two')]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    const lease = leases.find(Boolean)!;
    await runtime.checkpoint(lease, { verified: 'checkpoint-before-crash' });
    await runtime.heartbeat(lease);
    await sql`UPDATE backoffice.office_dispatch SET lease_until=now()-interval '1 second' WHERE id=${lease.dispatchId}`;
    expect(await runtime.recoverExpired()).toBe(1);
    await expect(runtime.execute(lease)).rejects.toMatchObject({ code: 'LEASE_LOST' });
    await expect(runtime.heartbeat(lease)).rejects.toMatchObject({ code: 'LEASE_LOST' });
    await sql`UPDATE backoffice.office_dispatch SET available_at=now() WHERE id=${lease.dispatchId}`;
    await sql`UPDATE backoffice.office_dispatch SET available_at=now()+interval '1 hour' WHERE state='pending' AND id<>${lease.dispatchId}`;
    const replacement = await runtime.claim('worker-replacement');
    expect(replacement?.runId).not.toBe(lease.runId);
    const [checkpoint] = await sql`SELECT checkpoint FROM backoffice.office_runs WHERE id=${replacement!.runId}`;
    expect(checkpoint.checkpoint).toMatchObject({ verified: 'checkpoint-before-crash' });
    await runtime.execute(replacement!);
    await sql`UPDATE backoffice.office_dispatch SET available_at=now() WHERE state='pending'`;
    const snapshot = await drain(taskId);
    expect(snapshot.tasks.find(task => task.id === taskId)?.state).toBe('waiting_for_owner_approval');
  });
  it('generates distinct role drafts and non-author review evidence; one exact package acceptance completes covered children', async () => {
    const { taskId } = await runtime.submitTask(ownerId, input('Reviewed package workflow'));
    const snapshot = await drain(taskId);
    const children = snapshot.tasks.filter(task => task.parentTaskId === taskId);
    expect(snapshot.tasks.find(task => task.id === taskId)!.blockedReason).toBeNull();
    expect(children).toHaveLength(7);
    expect(children.every(child => child.state === 'review_passed')).toBe(true);
    for (const child of children) {
      const artifact = snapshot.artifacts.find(artifact => artifact.id === child.currentArtifactId)!;
      expect(artifact.artifactHash).toBe(digest(artifact.content));
      expect(snapshot.reviews.filter(review => review.artifactId === artifact.id && review.state === 'passed').every(review => review.reviewerId !== artifact.authorAgentId)).toBe(true);
    }
    const approval = snapshot.approvals.find(approval => approval.taskId === taskId)!;
    const decision = await runtime.decideApproval(ownerId, { workspaceId: demoWorkspace, approvalId: approval.id, version: approval.version, decision: 'approve' });
    const completed = await runtime.snapshot(demoWorkspace);
    expect(completed.tasks.filter(task => task.id === taskId || task.parentTaskId === taskId).every(task => task.state === 'completed' && task.acceptanceEvidenceId === decision.acceptanceEvidenceId)).toBe(true);
    await expect(runtime.decideApproval(ownerId, { workspaceId: demoWorkspace, approvalId: approval.id, version: approval.version, decision: 'approve' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('rejects cross-workspace artifact and approval access and bounds ordered event replay', async () => {
    const snapshot = await runtime.snapshot(demoWorkspace);
    const artifact = snapshot.artifacts[0];
    await expect(runtime.artifact(liveWorkspace, artifact.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const approval = snapshot.approvals[0];
    await expect(runtime.decideApproval(ownerId, { workspaceId: liveWorkspace, approvalId: approval.id, version: approval.version, decision: 'approve' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const first = await runtime.events(demoWorkspace, 0, 3);
    const next = await runtime.events(demoWorkspace, first.at(-1)!.sequence, 3);
    expect(first).toHaveLength(3);
    expect(next[0].sequence).toBeGreaterThan(first.at(-1)!.sequence);
    expect(first.every(event => event.simulated && event.clientId === 'internal:office-demo')).toBe(true);
  });
  it('records rejection without acceptance and expires stale decisions', async () => {
    const { taskId } = await runtime.submitTask(ownerId, input('Rejected package workflow'));
    const snapshot = await drain(taskId);
    const approval = snapshot.approvals.find(approval => approval.taskId === taskId)!;
    await runtime.decideApproval(ownerId, { workspaceId: demoWorkspace, approvalId: approval.id, version: approval.version, decision: 'reject', reason: 'Synthetic rejection: clarify supplied requirements.' });
    const [evidence] = await sql`SELECT count(*)::int AS n FROM backoffice.office_acceptance_evidence WHERE approval_id=${approval.id}`;
    expect(evidence.n).toBe(0);
    const other = snapshot.approvals.find(item => item.state === 'pending' && item.taskId !== taskId);
    if (other) {
      await sql`UPDATE backoffice.office_approvals SET expires_at=now()-interval '1 second' WHERE id=${other.id}`;
      expect(await runtime.decideApproval(ownerId, { workspaceId: demoWorkspace, approvalId: other.id, version: other.version, decision: 'approve' })).toMatchObject({ state: 'expired', acceptanceEvidenceId: null });
    }
  });
  it('does not confirm cancellation until an outstanding lease safely stops', async () => {
    const { taskId } = await runtime.submitTask(ownerId, input('Cancellation at safe checkpoint'));
    const lease = await runtime.claim('cancel-worker');
    expect(lease).not.toBeNull();
    const snapshot = await runtime.snapshot(demoWorkspace);
    const parent = snapshot.tasks.find(task => task.id === taskId)!;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId, version: parent.version, action: 'cancel' });
    const [before] = await sql`SELECT state FROM backoffice.office_tasks WHERE id=${lease!.taskId}`;
    expect(before.state).toBe('cancel_requested');
    await runtime.execute(lease!);
    const [after] = await sql`SELECT state FROM backoffice.office_tasks WHERE id=${lease!.taskId}`;
    expect(after.state).toBe('cancelled');
  });
  it('atomically reserves exact budgets under a race, rejects unset limits and settles once', async () => {
    const { taskId } = await runtime.submitTask(ownerId, input('Budget reservation race'));
    const parallel = createOfficeRuntime(sql, { concurrency: 2 });
    const first = await parallel.claim('budget-one');
    const second = await parallel.claim('budget-two');
    expect(first && second).toBeTruthy();
    await expect(parallel.reserveBudget(first!, { amountMicrounits: 60, perRunLimitMicrounits: null, runtimeLimitMs: 1000 })).rejects.toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
    await sql`UPDATE backoffice.office_budget SET limit_microunits=spent_microunits+100 WHERE id=1`;
    const reservations = await Promise.allSettled([first!,second!].map(lease => parallel.reserveBudget(lease, { amountMicrounits: 60, perRunLimitMicrounits: 60, runtimeLimitMs: 120000 })));
    expect(reservations.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const winner = reservations[0].status === 'fulfilled' ? first! : second!;
    expect(await parallel.settleBudget(winner, 40)).toMatchObject({ duplicate: false });
    expect(await parallel.settleBudget(winner, 40)).toMatchObject({ duplicate: true });
    await parallel.execute(first!); await parallel.execute(second!);
    const [budget] = await sql`SELECT * FROM backoffice.office_budget WHERE id=1`;
    expect(Number(budget.reserved_microunits)).toBe(0);
    const snapshot = await runtime.snapshot(demoWorkspace);
    const parent = snapshot.tasks.find(task => task.id === taskId)!;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId, version: parent.version, action: 'cancel' });
  });
  it('keeps unknown tool outcomes from blind retry and requires scoped owner reconciliation', async () => {
    const { taskId } = await runtime.submitTask(ownerId, input('Unknown outcome reconciliation'));
    const lease = (await runtime.claim('ledger-worker'))!;
    await expect(runtime.beginToolOperation(lease, { toolName: 'send_email', operationKey: 'external-send-denied', arguments: {} })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const operation = { toolName: 'internal_save_draft', operationKey: 'stable-internal-operation', arguments: { artifactTitle: 'Synthetic draft' } };
    const begun = await runtime.beginToolOperation(lease, operation);
    expect(begun.execute).toBe(true);
    await runtime.finishToolOperation(lease, begun.operationId, 'unknown_outcome', { evidenceReference: 'Synthetic timeout; outcome unknown' });
    await expect(runtime.beginToolOperation(lease, operation)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(runtime.reconcileToolOperation(ownerId, { workspaceId: liveWorkspace, operationId: begun.operationId, outcome: 'succeeded', evidenceReference: 'Synthetic inspected evidence' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await runtime.reconcileToolOperation(ownerId, { workspaceId: demoWorkspace, operationId: begun.operationId, outcome: 'succeeded', evidenceReference: 'Synthetic inspected evidence of saved draft' });
    expect(await runtime.beginToolOperation(lease, operation)).toMatchObject({ execute: false, state: 'succeeded' });
    await expect(runtime.beginToolOperation(lease, { ...operation, arguments: { changed: true } })).rejects.toMatchObject({ code: 'CONFLICT' });
    await runtime.execute(lease);
    const parent = (await runtime.snapshot(demoWorkspace)).tasks.find(task => task.id === taskId)!;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId, version: parent.version, action: 'cancel' });
  });
  it('dispatches duplicate schedule occurrences once and recovers the submission/advance crash window', async () => {
    const scheduleId = randomUUID();
    const template = input('Scheduled synthetic proposal');
    const occurrence = new Date(Date.now()-1000).toISOString();
    await runtime.createSchedule(ownerId, { scheduleId, template, nextAt: occurrence, cadenceSeconds: 3600 });
    const results = await Promise.all([runtime.dispatchDueSchedules(),runtime.dispatchDueSchedules()]);
    expect(results.reduce((a,b) => a+b,0)).toBe(1);
    const [count] = await sql`SELECT count(*)::int AS n FROM backoffice.office_dispatch WHERE schedule_id=${scheduleId} AND scheduled_occurrence=${new Date(occurrence)}`;
    expect(count.n).toBe(1);
    // Simulate a crash after submit committed, before the durable occurrence advanced.
    await sql`UPDATE backoffice.office_schedules SET next_at=${new Date(occurrence)} WHERE id=${scheduleId}`;
    await runtime.dispatchDueSchedules();
    const [after] = await sql`SELECT count(*)::int AS n FROM backoffice.office_tasks WHERE initiating_owner_id=${ownerId} AND idempotency_key=${`schedule:${scheduleId}:${occurrence}`}`;
    expect(after.n).toBe(1);
    await sql`UPDATE backoffice.office_schedules SET enabled=false WHERE id=${scheduleId}`;
    const [parent] = await sql`SELECT id,version FROM backoffice.office_tasks WHERE initiating_owner_id=${ownerId} AND idempotency_key=${`schedule:${scheduleId}:${occurrence}`}`;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId: parent.id, version: Number(parent.version), action: 'cancel' });
  });
  it('renews expired decisions on the same exact package while preserving expiry history', async () => {
    const { taskId } = await runtime.submitTask(ownerId, input('Renew expired package decision'));
    let snapshot = await drain(taskId);
    const approval = snapshot.approvals.find(item => item.taskId === taskId)!;
    await sql`UPDATE backoffice.office_approvals SET expires_at=now()-interval '1 second' WHERE id=${approval.id}`;
    expect(await runtime.decideApproval(ownerId, { workspaceId: demoWorkspace, approvalId: approval.id, version: approval.version, decision: 'approve' })).toMatchObject({ state: 'expired', acceptanceEvidenceId: null });
    snapshot = await runtime.snapshot(demoWorkspace);
    const parent = snapshot.tasks.find(task => task.id === taskId)!;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId, version: parent.version, action: 'renew_approval' });
    snapshot = await runtime.snapshot(demoWorkspace);
    const decisions = snapshot.approvals.filter(item => item.taskId === taskId);
    expect(decisions.filter(item => item.state === 'expired')).toHaveLength(1);
    const fresh = decisions.find(item => item.state === 'pending')!;
    expect(fresh.artifactId).toBe(approval.artifactId);
    await runtime.decideApproval(ownerId, { workspaceId: demoWorkspace, approvalId: fresh.id, version: fresh.version, decision: 'approve' });
  });
  it('pauses active child work through requested run states and resumes reviewed children without duplicate manifest rows', async () => {
    const { taskId } = await runtime.submitTask(ownerId, input('Pause resume and unique manifest'));
    const active = (await runtime.claim('pause-active'))!;
    let snapshot = await runtime.snapshot(demoWorkspace);
    let parent = snapshot.tasks.find(task => task.id === taskId)!;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId, version: parent.version, action: 'pause' });
    const [runRequested] = await sql`SELECT state FROM backoffice.office_runs WHERE id=${active.runId}`;
    expect(runRequested.state).toBe('pause_requested');
    await runtime.execute(active);
    snapshot = await runtime.snapshot(demoWorkspace);
    parent = snapshot.tasks.find(task => task.id === taskId)!;
    expect(parent.state).toBe('paused');
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId, version: parent.version, action: 'resume' });
    const repeated = (await runtime.claim('repeat-pause-active'))!;
    parent = (await runtime.snapshot(demoWorkspace)).tasks.find(task => task.id === taskId)!;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId, version: parent.version, action: 'pause' });
    await runtime.execute(repeated);
    parent = (await runtime.snapshot(demoWorkspace)).tasks.find(task => task.id === taskId)!;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId, version: parent.version, action: 'resume' });
    let child = null;
    for (let i=0;i<30;i++) {
      const lease = await runtime.claim('resume-step');
      if (lease) await runtime.execute(lease);
      snapshot = await runtime.snapshot(demoWorkspace);
      child = snapshot.tasks.find(task => task.parentTaskId === taskId && task.state === 'review_passed');
      if (child) break;
    }
    expect(child).toBeTruthy();
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId: child!.id, version: child!.version, action: 'pause' });
    child = (await runtime.snapshot(demoWorkspace)).tasks.find(task => task.id === child!.id)!;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId: child.id, version: child.version, action: 'resume' });
    snapshot = await drain(taskId);
    const packageArtifact = snapshot.artifacts.find(artifact => artifact.id === snapshot.tasks.find(task => task.id === taskId)!.currentArtifactId)!;
    expect(packageArtifact.manifest).toHaveLength(7);
    const approval = snapshot.approvals.find(approval => approval.taskId === taskId && approval.state === 'pending')!;
    await runtime.decideApproval(ownerId, { workspaceId: demoWorkspace, approvalId: approval.id, version: approval.version, decision: 'approve' });
  });
  it('allows specialist repairs after invalidating a package and supersedes stale review dispatches', async () => {
    const { taskId } = await runtime.submitTask(ownerId, input('Specialist revision and package rebuild'));
    let snapshot = await drain(taskId);
    const originalApproval = snapshot.approvals.find(item => item.taskId === taskId)!;
    const child = snapshot.tasks.find(task => task.parentTaskId === taskId)!;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId: child.id, version: child.version, action: 'request_changes', reason: 'Synthetic review: clarify the supplied requirement.' });
    snapshot = await runtime.snapshot(demoWorkspace);
    expect(snapshot.approvals.find(item => item.id === originalApproval.id)!.state).toBe('superseded');
    const changed = snapshot.tasks.find(task => task.id === child.id)!;
    await runtime.reviseArtifact(ownerId, { workspaceId: demoWorkspace, taskId: changed.id, version: changed.version, authorAgentId: changed.agentId, title: 'Revised simulated specialist draft', content: 'Simulated revised internal proposal. Source office-task brief. Requirements and real integrations remain unverified.' });
    const lease = await runtime.claim('repair-worker');
    expect(lease?.taskId).toBe(child.id);
    await runtime.execute(lease!);
    snapshot = await runtime.snapshot(demoWorkspace);
    const parent = snapshot.tasks.find(task => task.id === taskId)!;
    await runtime.reviseArtifact(ownerId, { workspaceId: demoWorkspace, taskId, version: parent.version, authorAgentId: 'adrian', title: 'Rebuilt simulated package', content: 'Simulated rebuilt internal package. Feasibility remains unverified; internal draft acceptance only.' });
    snapshot = await drain(taskId);
    const approval = snapshot.approvals.find(item => item.taskId === taskId && item.state === 'pending')!;
    await runtime.decideApproval(ownerId, { workspaceId: demoWorkspace, approvalId: approval.id, version: approval.version, decision: 'approve' });
    await expect(sql`UPDATE backoffice.office_runs SET checkpoint='{}' WHERE task_id=${taskId} AND state='succeeded'`).rejects.toThrow('Terminal office runs are immutable');
  });
  it('isolates a revoked schedule owner so unrelated queue work continues', async () => {
    const [scheduleOwner] = await sql`INSERT INTO backoffice.users(email,name,role) VALUES(${`revoked-${randomUUID()}@example.test`},'Synthetic schedule owner','admin') RETURNING id`;
    const scheduleId = randomUUID();
    await runtime.createSchedule(scheduleOwner.id, { scheduleId, template: input('Revoked scheduled owner'), nextAt: new Date(Date.now()-1000).toISOString(), cadenceSeconds: 3600 });
    await sql`UPDATE backoffice.users SET role='sales' WHERE id=${scheduleOwner.id}`;
    await expect(runtime.dispatchDueSchedules()).resolves.toBe(0);
    const [schedule] = await sql`SELECT enabled FROM backoffice.office_schedules WHERE id=${scheduleId}`;
    expect(schedule.enabled).toBe(false);
    const { taskId } = await runtime.submitTask(ownerId, input('Unrelated queue survives revoked schedule'));
    const lease = await runtime.claim('surviving-worker');
    expect(lease).not.toBeNull();
    await runtime.execute(lease!);
    const parent = (await runtime.snapshot(demoWorkspace)).tasks.find(task => task.id === taskId)!;
    await runtime.requestTaskAction(ownerId, { workspaceId: demoWorkspace, taskId, version: parent.version, action: 'cancel' });
  });
});
