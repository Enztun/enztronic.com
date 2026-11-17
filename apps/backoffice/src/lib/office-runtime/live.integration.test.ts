import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';

vi.mock('server-only', () => ({}));

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createOfficeRuntime, type LiveExecution } from './index';
import type { CallOutcome, CountResult, LiveModelCall, LiveProvider } from './openai';
import { createOfficeReadModel } from '../server/office-read-model';

// Live-provider workflow on an explicitly disposable database with a scripted provider: no network.
const databaseUrl = process.env.OFFICE_LIVE_TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const liveWorkspace = '00000000-0000-4000-8000-000000000002';
const settings = { draftModel: 'gpt-6-luna', packageModel: 'gpt-6.1-sol', reasoningEffort: 'low' };
const usage = { inputTokens: 900, cachedTokens: 0, cacheWriteTokens: 0, cacheWrite12hTokens: 0, outputTokens: 400, reasoningTokens: 100 };
// Proposal caps in microunits: USD 10 lifetime and monthly, USD 1 per proposal, USD 0.15 per request.
const PROPOSAL_CAPS = { lifetime: 10_000_000, monthly: 10_000_000, family: 1_000_000, request: 150_000 };

type SchemaShape = { properties: { sections: { required: string[] }; checks: { items: { properties: { criterion: { enum: string[] } } } } } };
const shapeOf = (call: LiveModelCall) => call.schema as unknown as SchemaShape;
function outputFor(call: LiveModelCall): unknown {
  const schema = shapeOf(call);
  if (call.schemaName === 'office_role_draft') return { title: 'Workshop website', summary: 'A focused proposal.', sections: Object.fromEntries(schema.properties.sections.required.map((section: string) => [section, `${section}: proposal text`])), assumptions: ['Content supplied by the owner'], unknowns: ['Budget'], sourceReferences: ['five informational pages'] };
  if (call.schemaName === 'office_proposal_package') return { title: 'Workshop website proposal', sections: Object.fromEntries(schema.properties.sections.required.map((section: string) => [section, `${section}: package text`])) };
  return { outcome: 'passed', summary: 'Meets the criteria.', checks: schema.properties.checks.items.properties.criterion.enum.map((criterion: string) => ({ criterion, result: 'met', note: 'Checked.' })), findings: [] };
}
const completed = (call: LiveModelCall, n: number): CallOutcome => ({ kind: 'completed', requestId: `req_${n}`, responseId: `resp_${n}`, output: outputFor(call), usage, serviceTier: 'default' });
type Script = (call: LiveModelCall, n: number) => CallOutcome | Promise<CallOutcome>;
function fakeProvider(script: Script = completed, count: (call: LiveModelCall) => CountResult = () => ({ ok: true, inputTokens: 900 })) {
  const calls: LiveModelCall[] = [];
  const counts: LiveModelCall[] = [];
  const provider: LiveProvider = {
    name: 'openai',
    async countInputTokens(call) { counts.push(call); return count(call); },
    async create(call) { calls.push(call); return script(call, calls.length); },
  };
  return { provider, calls, counts, live: { provider, settings } satisfies LiveExecution };
}
async function waitFor(check: () => Promise<unknown>, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw new Error('Condition not reached.');
}

databaseDescribe('live provider workflow on an explicitly disposable PostgreSQL database', () => {
  let sql: ReturnType<typeof postgres>;
  let ownerId: string;
  const brief = 'Synthetic owner brief: a five-page informational website for a community workshop with a contact form. Budget, dates and hosting are unknown.';
  const submit = (runtime: ReturnType<typeof createOfficeRuntime>, goal = 'Live workshop website proposal') => runtime.submitTask(ownerId, { workspaceId: liveWorkspace, mode: 'live', goal, brief, idempotencyKey: randomUUID() });
  async function setCaps(caps: Partial<typeof PROPOSAL_CAPS> & { enabled?: boolean } = {}) {
    const value = { ...PROPOSAL_CAPS, ...caps };
    await sql`UPDATE backoffice.office_budget SET live_enabled=${caps.enabled ?? true},limit_microunits=${value.lifetime},monthly_limit_microunits=${value.monthly},family_limit_microunits=${value.family},request_limit_microunits=${value.request} WHERE id=1`;
  }
  async function drain(runtime: ReturnType<typeof createOfficeRuntime>, parentId: string, max = 200) {
    for (let iteration = 0; iteration < max; iteration++) {
      const lease = await runtime.claim('live-integration-worker');
      if (lease) { await runtime.execute(lease); continue; }
      const [parent] = await sql`SELECT state FROM backoffice.office_tasks WHERE id=${parentId}`;
      if (parent.state === 'waiting_for_owner_approval') return;
      // Bounded retry backoff is real; advance only pending availability so the test stays fast.
      const advanced = await sql`UPDATE backoffice.office_dispatch SET available_at=now() WHERE state='pending' AND available_at>now() RETURNING id`;
      if (!advanced.length) return;
    }
    throw new Error('Live workflow did not settle.');
  }
  const taskOf = async (id: string) => (await sql`SELECT * FROM backoffice.office_tasks WHERE id=${id}`)[0];
  const childOf = async (parentId: string, agentId: string) => (await sql`SELECT * FROM backoffice.office_tasks WHERE parent_task_id=${parentId} AND agent_id=${agentId}`)[0];
  const budget = async () => (await sql`SELECT * FROM backoffice.office_budget WHERE id=1`)[0];
  const meteredRuns = () => sql`SELECT r.*,t.parent_task_id FROM backoffice.office_runs r JOIN backoffice.office_tasks t ON t.id=r.task_id WHERE r.budget_reserved_microunits>0 ORDER BY r.started_at`;

  beforeEach(async () => {
    const url = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw new Error('OFFICE_LIVE_TEST_DATABASE_URL must explicitly name a loopback disposable *_test database.');
    sql ??= postgres(databaseUrl!, { max: 6, onnotice: () => undefined });
    // Reset only this explicit loopback *_test fixture. Never reads DATABASE_URL or the real cluster.
    await sql.unsafe('DROP SCHEMA IF EXISTS backoffice CASCADE');
    for (const name of ['001_init.sql', '002_users_and_ownership.sql', '003_office.sql', '004_office_live_provider.sql']) {
      await sql.unsafe(await readFile(fileURLToPath(new URL(`../../../database/migrations/${name}`, import.meta.url)), 'utf8'));
    }
    const [owner] = await sql`INSERT INTO backoffice.users(email,name,role) VALUES(${`office-live-${randomUUID()}@example.test`},'Synthetic Live Owner','admin') RETURNING id`;
    ownerId = owner.id;
  }, 30000);
  afterAll(async () => { await sql?.end({ timeout: 2 }); });

  it('keeps live requests blocked until the owner switches live on with every limit set', async () => {
    const fake = fakeProvider();
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    const blocked = await submit(runtime);
    expect(await taskOf(blocked.taskId)).toMatchObject({ state: 'blocked', blocked_reason: expect.stringContaining('configuration_required') });
    await setCaps({ family: 0 });
    expect((await taskOf((await submit(runtime, 'Still missing a family limit')).taskId)).state).toBe('blocked');
    expect(await runtime.claim('live-integration-worker')).toBeNull();
    expect(fake.counts).toHaveLength(0);
    // A record from before live was available cannot be resumed into a delegation it never had.
    await setCaps();
    const row = await taskOf(blocked.taskId);
    await expect(runtime.requestTaskAction(ownerId, { workspaceId: liveWorkspace, taskId: blocked.taskId, version: Number(row.version), action: 'resume' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('runs a complete live proposal with 16 metered requests, settles every charge and stays owner-gated', async () => {
    await setCaps();
    const fake = fakeProvider();
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    const demoOnly = createOfficeRuntime(sql);
    const { taskId } = await submit(runtime);
    expect(await demoOnly.claim('demo-only-worker')).toBeNull();
    await drain(runtime, taskId);
    expect((await taskOf(taskId)).state).toBe('waiting_for_owner_approval');
    expect(fake.calls).toHaveLength(16);
    expect(fake.counts).toHaveLength(16);
    expect(fake.calls.filter(call => call.model === 'gpt-6.1-sol').map(call => call.schemaName).sort()).toEqual(['office_independent_review', 'office_proposal_package']);
    expect(fake.calls.filter(call => call.model === 'gpt-6-luna')).toHaveLength(14);
    expect(new Set(fake.calls.map(call => call.clientRequestId)).size).toBe(16);
    const runs = await meteredRuns();
    expect(runs).toHaveLength(16);
    for (const run of runs) {
      expect(run.state).toBe('succeeded');
      expect(Number(run.usage_microunits)).toBeGreaterThan(0);
      expect(Number(run.usage_microunits)).toBeLessThanOrEqual(Number(run.budget_reserved_microunits));
      expect(run.provider_request_id).toMatch(/^resp_/);
      expect(run.token_usage).toMatchObject({ inputTokens: 900, outputTokens: 400 });
      expect(run.provider_dispatched_at).not.toBeNull();
    }
    // 14 Luna requests at 319 µ and 2 Sol requests at 6,380 µ.
    const spent = runs.reduce((sum, run) => sum + Number(run.usage_microunits), 0);
    expect(spent).toBe(14 * 319 + 2 * 6380);
    expect(await budget()).toMatchObject({ reserved_microunits: '0', spent_microunits: String(spent) });
    const artifacts = await sql`SELECT a.content FROM backoffice.office_artifacts a JOIN backoffice.office_tasks t ON t.id=a.task_id WHERE t.id=${taskId} OR t.parent_task_id=${taskId}`;
    expect(artifacts).toHaveLength(8);
    for (const artifact of artifacts) { expect(artifact.content).toMatch(/Live internal proposal (draft|package)/); expect(artifact.content).not.toContain('Simulated'); }
    expect((await sql`SELECT count(*)::int AS n FROM backoffice.office_events WHERE workspace_id=${liveWorkspace} AND simulated`)[0].n).toBe(0);
    const health = await runtime.health();
    expect(health).toMatchObject({ providerConfigured: true, liveEnabled: true, workerOnline: true });
    await expect(submit(runtime, 'Second live proposal while one is open')).rejects.toMatchObject({ code: 'CONFLICT' });
    // The model never decides: only the owner's exact-package acceptance completes the work.
    const [approval] = await sql`SELECT * FROM backoffice.office_approvals WHERE task_id=${taskId} AND state='pending'`;
    const decided = await runtime.decideApproval(ownerId, { workspaceId: liveWorkspace, approvalId: approval.id, version: Number(approval.version), decision: 'approve' });
    expect(decided.state).toBe('approved');
    expect((await taskOf(taskId)).state).toBe('completed');
  });

  it('reports the connected provider, owner limits and per-task metering through the read model', async () => {
    await setCaps();
    const fake = fakeProvider();
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    const readModel = createOfficeReadModel(sql);
    expect((await readModel.activity({ workspaceId: liveWorkspace })).execution).toMatchObject({ adapter: 'deterministic_demo', providerConfigured: false, provider: null, budget: { enabled: true, monthLimitMicrounits: 10_000_000, requestLimitMicrounits: 150_000 } });
    const { taskId } = await submit(runtime);
    await drain(runtime, taskId);
    const after = await readModel.activity({ workspaceId: liveWorkspace });
    const spent = 14 * 319 + 2 * 6380;
    expect(after.execution).toMatchObject({ adapter: 'openai_responses', providerConfigured: true, provider: { provider: 'openai', draftModel: 'gpt-6-luna', packageModel: 'gpt-6.1-sol', reasoningEffort: 'low' }, budget: { monthUsedMicrounits: spent, lifetimeUsedMicrounits: spent } });
    const parent = after.tasks.find(entry => entry.taskId === taskId);
    expect(parent?.metering).toEqual({ requests: 2, chargedMicrounits: 2 * 6380, openReservationMicrounits: 0 });
    // Delegation by the owner's request is bookkeeping, never worker execution.
    expect(parent?.coordination?.step).toBe('delegate_internal_live');
    const dashboard = await readModel.dashboard();
    expect(dashboard.execution.providerConfigured).toBe(true);
    expect(dashboard.modes.live.tasks.waitingForOwner).toBe(1);
  });

  it('denies a request above the per-request limit before any spend', async () => {
    await setCaps({ request: 3000 });
    const fake = fakeProvider();
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    const { taskId } = await submit(runtime);
    await drain(runtime, taskId);
    expect(fake.calls).toHaveLength(0);
    const child = await childOf(taskId, 'leo');
    expect(child).toMatchObject({ state: 'blocked', blocked_reason: expect.stringContaining('request_limit') });
    expect(await budget()).toMatchObject({ reserved_microunits: '0', spent_microunits: '0' });
  });

  it('stops a proposal at its family limit and a month at its monthly limit', async () => {
    await setCaps({ family: 20000 });
    const fake = fakeProvider();
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    const { taskId } = await submit(runtime);
    await drain(runtime, taskId);
    expect(fake.calls).toHaveLength(14);
    expect(await taskOf(taskId)).toMatchObject({ state: 'blocked', blocked_reason: expect.stringContaining('family_limit') });
    expect(Number((await budget()).spent_microunits)).toBeLessThanOrEqual(20000);

    await sql`UPDATE backoffice.office_tasks SET state='cancelled' WHERE id=${taskId} OR parent_task_id=${taskId}`;
    const before = Number((await budget()).spent_microunits);
    await setCaps({ monthly: before + 3500 });
    const second = fakeProvider();
    const monthly = createOfficeRuntime(sql, { live: second.live });
    const next = await submit(monthly, 'Monthly limit proposal');
    await drain(monthly, next.taskId);
    // The first draft fits; every other draft's reservation would cross the month, but its cheaper review still fits.
    expect(second.calls.map(call => call.schemaName)).toEqual(['office_role_draft', 'office_independent_review']);
    const reasons = (await sql`SELECT blocked_reason FROM backoffice.office_tasks WHERE parent_task_id=${next.taskId} AND state='blocked'`).map(row => row.blocked_reason);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every(reason => reason.startsWith('monthly_limit'))).toBe(true);
  });

  it('retains unknown charges until explicit owner reconciliation and releases configuration rejections', async () => {
    await setCaps();
    let first = true;
    const fake = fakeProvider((call, n) => {
      if (first) { first = false; return { kind: 'unknown', code: 'timeout', retryAfterMs: null, requestId: null }; }
      return completed(call, n);
    });
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    const { taskId } = await submit(runtime);
    await drain(runtime, taskId);
    expect((await taskOf(taskId)).state).toBe('blocked');
    expect(fake.calls).toHaveLength(1);
    const [held] = await meteredRuns();
    expect(held).toMatchObject({ state: 'waiting_for_tool', usage_microunits: null, error_code: 'timeout' });
    expect((await budget()).reserved_microunits).toBe(held.budget_reserved_microunits);
    const parent = await taskOf(taskId);
    await expect(runtime.requestTaskAction(ownerId, { workspaceId: liveWorkspace, taskId, version: Number(parent.version), action: 'retry', reason: 'A note alone must not release an unknown request.' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    const [operation] = await sql`SELECT id FROM backoffice.office_tool_operations WHERE run_id=${held.id}`;
    await runtime.reconcileToolOperation(ownerId, { workspaceId: liveWorkspace, operationId: operation.id, outcome: 'failed', actualMicrounits: 0, evidenceReference: 'Synthetic provider evidence: definitely unprocessed.' });
    await runtime.requestTaskAction(ownerId, { workspaceId: liveWorkspace, taskId, version: Number(parent.version), action: 'retry', reason: 'Verified the provider evidence; begin another bounded attempt.' });
    await drain(runtime, taskId);
    expect((await taskOf(taskId)).state).toBe('waiting_for_owner_approval');
    expect(fake.calls).toHaveLength(17);
    expect((await budget()).reserved_microunits).toBe('0');

    await sql`UPDATE backoffice.office_tasks SET state='cancelled' WHERE (id=${taskId} OR parent_task_id=${taskId}) AND state<>'waiting_for_owner_approval'`;
    await sql`UPDATE backoffice.office_approvals SET state='cancelled' WHERE task_id=${taskId}`;
    await sql`UPDATE backoffice.office_tasks SET state='cancelled' WHERE id=${taskId}`;
    const denied = fakeProvider(() => ({ kind: 'rejected', code: 'rejected_401_invalid_api_key', status: 401, retryable: false, configuration: true, retryAfterMs: null, requestId: 'req_401' }));
    const keyless = createOfficeRuntime(sql, { live: denied.live });
    const next = await submit(keyless, 'Rejected key proposal');
    const lease = await keyless.claim('live-integration-worker');
    await expect(keyless.execute(lease!)).resolves.toMatchObject({ outcome: 'failed', code: 'rejected_401_invalid_api_key', chargedMicrounits: 0 });
    expect(await taskOf(lease!.taskId)).toMatchObject({ state: 'blocked', blocked_reason: expect.stringContaining('configuration_required') });
    expect((await sql`SELECT state FROM backoffice.office_dispatch WHERE id=${lease!.dispatchId}`)[0].state).toBe('exhausted');
    expect(next.taskId).toBeTruthy();
  });

  it('blocks unusable or oversized output without retrying, and charges what was used', async () => {
    await setCaps();
    const fake = fakeProvider((call, n) => call.schemaName === 'office_role_draft' && n === 1 ? { ...completed(call, n), output: { title: 'Missing sections' } } as CallOutcome : completed(call, n), call => ({ ok: true, inputTokens: call.schemaName === 'office_proposal_package' ? 20000 : 900 }));
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    const { taskId } = await submit(runtime);
    await drain(runtime, taskId);
    const unusable = (await sql`SELECT * FROM backoffice.office_tasks WHERE parent_task_id=${taskId} AND state='blocked'`);
    expect(unusable).toHaveLength(1);
    expect(unusable[0].blocked_reason).toContain('model_output_unusable: invalid_output_shape');
    const [run] = await sql`SELECT * FROM backoffice.office_runs WHERE task_id=${unusable[0].id} AND state='failed'`;
    expect(Number(run.usage_microunits)).toBe(319);
    expect((await sql`SELECT state FROM backoffice.office_dispatch WHERE task_id=${unusable[0].id} AND step='draft'`)[0].state).toBe('exhausted');
    // The owner can retry that one task; the oversized package input is then refused before any spend.
    const version = Number(unusable[0].version);
    await runtime.requestTaskAction(ownerId, { workspaceId: liveWorkspace, taskId: unusable[0].id, version, action: 'retry', reason: 'Checked the brief; retry once.' });
    await drain(runtime, taskId);
    expect(await taskOf(taskId)).toMatchObject({ state: 'blocked', blocked_reason: expect.stringContaining('input_too_large') });
    expect(fake.calls.filter(call => call.schemaName === 'office_proposal_package')).toHaveLength(0);
  });

  it('holds a lease-expired request, records a late known charge and fences its result until reconciliation', async () => {
    await setCaps();
    let release!: (outcome: CallOutcome) => void;
    const gate = new Promise<CallOutcome>(resolve => { release = resolve; });
    const fake = fakeProvider((call, n) => n === 1 ? gate : completed(call, n));
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const lease = (await runtime.claim('live-integration-worker'))!;
    const running = runtime.execute(lease);
    await waitFor(async () => (await sql`SELECT provider_dispatched_at FROM backoffice.office_runs WHERE id=${lease.runId}`)[0].provider_dispatched_at);
    const [reserved] = await sql`SELECT budget_reserved_microunits FROM backoffice.office_runs WHERE id=${lease.runId}`;
    await sql`UPDATE backoffice.office_dispatch SET lease_until=now()-interval '1 second' WHERE id=${lease.dispatchId}`;
    await runtime.recoverExpired();
    expect(await sql`SELECT state,usage_microunits FROM backoffice.office_runs WHERE id=${lease.runId}`).toEqual([{ state: 'waiting_for_tool', usage_microunits: null }]);
    expect(await budget()).toMatchObject({ reserved_microunits: reserved.budget_reserved_microunits, spent_microunits: '0' });
    expect(await runtime.claim('another-worker')).toBeNull();
    release(completed(fake.calls[0], 1));
    await expect(running).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(await budget()).toMatchObject({ reserved_microunits: '0', spent_microunits: '319' });
    expect(await runtime.claim('another-worker')).toBeNull();
    const [operation] = await sql`SELECT id FROM backoffice.office_tool_operations WHERE run_id=${lease.runId}`;
    await runtime.reconcileToolOperation(ownerId, { workspaceId: liveWorkspace, operationId: operation.id, outcome: 'succeeded', actualMicrounits: 319, evidenceReference: 'Synthetic provider evidence confirms the late response charge.' });
    expect((await sql`SELECT count(*)::int AS n FROM backoffice.office_artifacts WHERE task_id=${lease.taskId}`)[0].n).toBe(0);
  });

  it('honours a pause requested during a model call and still records its cost', async () => {
    await setCaps();
    let release!: (outcome: CallOutcome) => void;
    const gate = new Promise<CallOutcome>(resolve => { release = resolve; });
    const fake = fakeProvider((call, n) => n === 1 ? gate : completed(call, n));
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const lease = (await runtime.claim('live-integration-worker'))!;
    const running = runtime.execute(lease);
    await waitFor(async () => (await sql`SELECT provider_dispatched_at FROM backoffice.office_runs WHERE id=${lease.runId}`)[0].provider_dispatched_at);
    const child = await taskOf(lease.taskId);
    await runtime.requestTaskAction(ownerId, { workspaceId: liveWorkspace, taskId: lease.taskId, version: Number(child.version), action: 'pause' });
    expect((await taskOf(lease.taskId)).state).toBe('pause_requested');
    release(completed(fake.calls[0], 1));
    await expect(running).resolves.toMatchObject({ outcome: 'stopped', chargedMicrounits: 319 });
    expect((await taskOf(lease.taskId)).state).toBe('paused');
    expect((await sql`SELECT usage_microunits,state FROM backoffice.office_runs WHERE id=${lease.runId}`)[0]).toEqual({ usage_microunits: '319', state: 'paused' });
  });

  it('redrafts with the reviewer findings and owner note when the owner asks, and counts it against the proposal', async () => {
    await setCaps();
    let leoReviews = 0;
    const fake = fakeProvider((call, n) => {
      if (call.schemaName === 'office_independent_review' && call.instructions.includes("review Leo's") && leoReviews++ === 0) {
        const schema = shapeOf(call);
        return { ...completed(call, n), output: { outcome: 'changes_requested', summary: 'An invented launch date.', checks: schema.properties.checks.items.properties.criterion.enum.map((criterion: string) => ({ criterion, result: criterion === 'no_invented_facts' ? 'not_met' : 'met', note: 'Checked.' })), findings: [{ severity: 'error', message: 'Remove the invented launch date.' }] } } as CallOutcome;
      }
      return completed(call, n);
    });
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    const { taskId } = await submit(runtime);
    await drain(runtime, taskId);
    const leo = await childOf(taskId, 'leo');
    expect(leo.state).toBe('changes_requested');
    await runtime.requestTaskAction(ownerId, { workspaceId: liveWorkspace, taskId: leo.id, version: Number(leo.version), action: 'redraft', reason: 'Keep dates as unknowns.' });
    await expect(runtime.requestTaskAction(ownerId, { workspaceId: liveWorkspace, taskId: leo.id, version: Number(leo.version), action: 'redraft' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await drain(runtime, taskId);
    const redraft = fake.calls.filter(call => call.schemaName === 'office_role_draft' && call.metadata.office_agent === 'leo');
    expect(redraft).toHaveLength(2);
    expect(redraft[1].input).toContain('<reviewer_findings>\n- error: Remove the invented launch date.');
    expect(redraft[1].input).toContain('<owner_feedback>\nKeep dates as unknowns.');
    expect(redraft[1].input).toContain('<previous_revision>');
    expect(await childOf(taskId, 'leo')).toMatchObject({ state: 'review_passed', revision_cycles: 1 });
    expect((await taskOf(taskId)).state).toBe('waiting_for_owner_approval');
    expect(fake.calls).toHaveLength(18);
  });
});
