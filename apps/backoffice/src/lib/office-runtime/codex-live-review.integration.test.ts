import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createOfficeRuntime, type LiveExecution } from './index';
import type { CallOutcome, LiveModelCall } from './openai';
import { reservationMicrounits, usageMicrounits } from './live-pricing';

// Independent adversarial review. Scripted provider only; no secrets or network.
const fixtureUrl = process.env.OFFICE_CODEX_LIVE_REVIEW_DATABASE_URL;
const fixtureDescribe = fixtureUrl ? describe : describe.skip;
const workspaceId = '00000000-0000-4000-8000-000000000002';
const settings = { draftModel: 'gpt-6-luna', packageModel: 'gpt-6.1-sol', reasoningEffort: 'low' };
const fullUsage = { inputTokens: 982, cachedTokens: 0, cacheWriteTokens: 982, cacheWrite12hTokens: 0, outputTokens: 6000, reasoningTokens: 100 };

function completed(call: LiveModelCall, usage = fullUsage): CallOutcome {
  const schema = call.schema as { properties: { sections: { required: string[] } } };
  return { kind: 'completed', requestId: 'req_review', responseId: 'resp_review', usage, serviceTier: 'default', output: { title: 'Synthetic review draft', summary: 'A concise synthetic draft.', sections: Object.fromEntries(schema.properties.sections.required.map(key => [key, 'Supplied synthetic content.'])), assumptions: [], unknowns: ['Dates and budget'], sourceReferences: ['Internal review brief'] } };
}
function provider(script: (call: LiveModelCall) => Promise<CallOutcome> | CallOutcome = completed) {
  const calls: LiveModelCall[] = [];
  const counts: LiveModelCall[] = [];
  const live: LiveExecution = { settings: { ...settings }, provider: { name: 'openai', async countInputTokens(call) { counts.push(call); return { ok: true, inputTokens: 900 }; }, async create(call) { calls.push(call); return script(call); } } };
  return { calls, counts, live };
}

fixtureDescribe('independent live budget boundary review on an owned disposable database', () => {
  let sql: ReturnType<typeof postgres>;
  let ownerId: string;
  const taskOf = async (id: string) => (await sql`SELECT * FROM backoffice.office_tasks WHERE id=${id}`)[0];
  const budget = async () => (await sql`SELECT * FROM backoffice.office_budget WHERE id=1`)[0];
  const submit = (runtime: ReturnType<typeof createOfficeRuntime>) => runtime.submitTask(ownerId, { workspaceId, mode: 'live', goal: 'Independent budget boundary review', brief: 'Internal review brief. Supply no invented dates or prices, and perform no external effect.', idempotencyKey: randomUUID() });
  const setCaps = (month = 10_000_000) => sql`UPDATE backoffice.office_budget SET live_enabled=true,limit_microunits=10000000,monthly_limit_microunits=${month},family_limit_microunits=1000000,request_limit_microunits=150000 WHERE id=1`;
  async function ageAttempt(runId: string, seconds: number) {
    // Controlled fixture clock: real terminal production evidence is never altered.
    await sql.begin(async tx => {
      await tx`ALTER TABLE backoffice.office_runs DISABLE TRIGGER office_run_terminal_immutable`;
      await tx`UPDATE backoffice.office_runs SET started_at=now()-(${seconds}*interval '1 second') WHERE id=(SELECT live_attempt_id FROM backoffice.office_runs WHERE id=${runId})`;
      await tx`ALTER TABLE backoffice.office_runs ENABLE TRIGGER office_run_terminal_immutable`;
    });
  }
  async function seedDispatched(lease: { runId: string; taskId: string }, count: number) {
    const [run] = await sql`SELECT live_attempt_id,agent_id FROM backoffice.office_runs WHERE id=${lease.runId}`;
    for (let n = 0; n < count; n++) await sql`INSERT INTO backoffice.office_runs(workspace_id,task_id,agent_id,profile_version,policy_version,attempt,state,step,budget_reserved_microunits,usage_microunits,provider_dispatched_at,finished_at,live_attempt_id) VALUES(${workspaceId},${lease.taskId},${run.agent_id},1,1,1,'failed','draft',1,0,now(),now(),${run.live_attempt_id})`;
  }
  beforeEach(async () => {
    const url = new URL(fixtureUrl!);
    if (url.hostname !== '127.0.0.1' || !['55439','55609','55649'].includes(url.port) || !url.pathname.endsWith('_test')) throw new Error('Requires an explicitly owned loopback review *_test fixture.');
    sql ??= postgres(fixtureUrl!, { max: 6, onnotice: () => undefined });
    await sql.unsafe('DROP SCHEMA IF EXISTS backoffice CASCADE');
    for (const name of ['001_init.sql', '002_users_and_ownership.sql', '003_office.sql', '004_office_live_provider.sql']) await sql.unsafe(await readFile(fileURLToPath(new URL(`../../../database/migrations/${name}`, import.meta.url)), 'utf8'));
    const [owner] = await sql`INSERT INTO backoffice.users(email,name,role) VALUES(${`codex-live-review-${randomUUID()}@example.test`},'Synthetic review owner','admin') RETURNING id`;
    ownerId = owner.id;
    await setCaps();
  }, 30000);
  afterAll(async () => { await sql?.end({ timeout: 2 }); });

  it('counts the dispatch month when claim precedes that month', async () => {
    await setCaps(5000);
    const fake = provider();
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const first = (await runtime.claim('review-midnight'))!;
    // Models a claim/token count crossing midnight without changing the host/database clock.
    await sql`UPDATE backoffice.office_runs SET started_at=(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 second' WHERE id=${first.runId}`;
    await runtime.execute(first);
    const second = (await runtime.claim('review-midnight'))!;
    await runtime.execute(second);
    const [actual] = await sql`SELECT sum(usage_microunits)::int AS charged FROM backoffice.office_runs WHERE provider_dispatched_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
    expect(fake.calls).toHaveLength(1);
    expect(actual.charged).toBeLessThanOrEqual(5000);
  });

  it('admits only one live model request under supported concurrency=2', async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    let active = 0; let maximumActive = 0;
    const fake = provider(async call => { active++; maximumActive = Math.max(active, maximumActive); await gate; active--; return completed(call); });
    const runtime = createOfficeRuntime(sql, { concurrency: 2, live: fake.live });
    await submit(runtime);
    const [first, second] = await Promise.all([runtime.claim('review-concurrent-1'), runtime.claim('review-concurrent-2')]);
    const admitted = [first,second].filter(value => value !== null);
    expect(admitted).toHaveLength(1);
    const running = runtime.execute(admitted[0]!);
    for (let i = 0; i < 100 && fake.calls.length < 1; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(await runtime.claim('review-concurrent-3')).toBeNull();
    finish();
    await running;
    expect(maximumActive).toBe(1);
  });

  it('records known excess beyond the lifetime ceiling and blocks globally until explicit reconciliation', async () => {
    await sql`UPDATE backoffice.office_budget SET limit_microunits=4000 WHERE id=1`;
    const expensiveUsage = { ...fullUsage, outputTokens: 10000 };
    const fake = provider(call => completed(call, expensiveUsage));
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const first = (await runtime.claim('review-excess'))!;
    expect(await runtime.execute(first)).toMatchObject({ code: 'usage_exceeds_reservation' });
    const row = await taskOf(first.taskId);
    expect(row.blocked_reason).toContain('reconcile');
    const [run] = await sql`SELECT * FROM backoffice.office_runs WHERE id=${first.runId}`;
    const actual = usageMicrounits('gpt-6-luna', expensiveUsage, 'default');
    expect(Number(run.usage_microunits)).toBe(actual);
    expect(run.token_usage.outputTokens).toBe(10000);
    expect(await runtime.claim('review-excess')).toBeNull();
    expect(fake.calls).toHaveLength(1);
    expect(Number((await budget()).spent_microunits)).toBe(actual);
    const [operation] = await sql`SELECT id FROM backoffice.office_tool_operations WHERE run_id=${first.runId}`;
    await expect(runtime.reconcileToolOperation(ownerId, { workspaceId, operationId: operation.id, outcome: 'failed', evidenceReference: 'Cannot erase an observed provider charge.' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await runtime.reconcileToolOperation(ownerId, { workspaceId, operationId: operation.id, outcome: 'succeeded', actualMicrounits: actual, evidenceReference: 'Synthetic provider confirms the exact observed charge.' });
    const sibling = (await runtime.claim('review-excess'))!;
    expect(await runtime.execute(sibling)).toMatchObject({ code: 'lifetime_limit' });
    expect(fake.calls).toHaveLength(1);
  });

  it('checks the current workspace grant before counting or spending', async () => {
    const fake = provider();
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const lease = (await runtime.claim('review-grant-revocation'))!;
    await sql`DELETE FROM backoffice.office_workspace_grants WHERE workspace_id=${workspaceId} AND agent_id=${lease.agentId}`;
    await expect(runtime.execute(lease)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.calls).toHaveLength(0);
    expect(fake.counts).toHaveLength(0);
    expect(Number((await budget()).spent_microunits)).toBe(0);
  });

  it('rechecks grant revocation during input counting before a paid create', async () => {
    const fake = provider();
    fake.live.provider.countInputTokens = async () => {
      await sql`DELETE FROM backoffice.office_workspace_grants WHERE workspace_id=${workspaceId}`;
      return { ok: true, inputTokens: 900 };
    };
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const lease = (await runtime.claim('review-revoke-during-count'))!;
    await expect(runtime.execute(lease)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.calls).toHaveLength(0);
    expect((await budget()).reserved_microunits).toBe('0');
  });

  it('checks the internal draft data scope before sending any brief', async () => {
    const fake = provider();
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const lease = (await runtime.claim('review-data-scope'))!;
    await sql`UPDATE backoffice.office_workspace_grants SET data_scopes='[]'::jsonb WHERE workspace_id=${workspaceId} AND agent_id=${lease.agentId}`;
    await expect(runtime.execute(lease)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(fake.counts).toHaveLength(0); expect(fake.calls).toHaveLength(0);
  });

  it('retains an unpriceable usage outcome without creating an unsafe ledger amount', async () => {
    const fake = provider(call => completed(call, { ...fullUsage, outputTokens: Number.MAX_SAFE_INTEGER }));
    fake.live.settings.draftModel = 'gpt-6.1-sol';
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const lease = (await runtime.claim('review-unsafe-price'))!;
    expect(await runtime.execute(lease)).toMatchObject({ code: 'usage_unpriceable' });
    expect(await budget()).toMatchObject({ spent_microunits: '0', reserved_microunits: String(reservationMicrounits('gpt-6.1-sol',982,6000)) });
    expect(await runtime.claim('review-unsafe-price-blocked')).toBeNull();
  });

  it('expires a ten-minute attempt before counting and requires explicit owner recovery', async () => {
    const fake = provider();
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const lease = (await runtime.claim('review-deadline'))!;
    await ageAttempt(lease.runId, 601);
    expect(await runtime.execute(lease)).toMatchObject({ code: 'proposal_attempt_expired' });
    expect(fake.counts).toHaveLength(0);
    const current = await taskOf(lease.taskId);
    await runtime.requestTaskAction(ownerId, { workspaceId, taskId: current.id, version: Number(current.version), action: 'retry', reason: 'Owner explicitly starts another bounded attempt.' });
    const next = (await runtime.claim('review-deadline-recovered'))!;
    expect(await runtime.execute(next)).toMatchObject({ outcome: 'committed' });
    expect(fake.calls).toHaveLength(1);
  });

  it('bounds the transport by the remaining attempt and charges but discards a late known response', async () => {
    const fake = provider(async call => {
      expect(call.timeoutMs).toBeGreaterThan(0);
      expect(call.timeoutMs).toBeLessThanOrEqual(2000);
      await ageAttempt(lease.runId, 601);
      return completed(call);
    });
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const lease = (await runtime.claim('review-late-response'))!;
    await ageAttempt(lease.runId, 598);
    expect(await runtime.execute(lease)).toMatchObject({ code: 'proposal_attempt_expired' });
    expect(Number((await budget()).spent_microunits)).toBe(reservationMicrounits('gpt-6-luna', 982, 6000));
    expect((await sql`SELECT count(*)::int AS n FROM backoffice.office_artifacts`)[0].n).toBe(0);
  });

  it('stops at sixteen dispatched calls per attempt before counting', async () => {
    const fake = provider();
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const lease = (await runtime.claim('review-attempt-ceiling'))!;
    await seedDispatched(lease, 16);
    expect(await runtime.execute(lease)).toMatchObject({ code: 'attempt_call_ceiling' });
    expect(fake.calls).toHaveLength(0);
    expect(fake.counts).toHaveLength(0);
  });

  it('does not reset the thirty-two family-call ceiling on an owner recovery attempt', async () => {
    const fake = provider();
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const lease = (await runtime.claim('review-family-ceiling'))!;
    await seedDispatched(lease, 32);
    expect(await runtime.execute(lease)).toMatchObject({ code: 'attempt_call_ceiling' });
    const current = await taskOf(lease.taskId);
    await runtime.requestTaskAction(ownerId, { workspaceId, taskId: current.id, version: Number(current.version), action: 'retry', reason: 'Recovery keeps the family ceiling.' });
    const recovered = (await runtime.claim('review-family-ceiling-recovered'))!;
    expect(await runtime.execute(recovered)).toMatchObject({ code: 'family_call_ceiling' });
    expect(fake.calls).toHaveLength(0);
  });

  it('keeps unknown holds across process restart and month rollover while allowing demo work', async () => {
    const fake = provider(() => ({ kind: 'unknown', code: 'timeout', requestId: null, retryAfterMs: null }));
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    const parent = await submit(runtime);
    const lease = (await runtime.claim('review-unknown'))!;
    expect(await runtime.execute(lease)).toMatchObject({ code: 'timeout' });
    await sql`UPDATE backoffice.office_runs SET provider_dispatched_at=(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')-interval '1 second' WHERE id=${lease.runId}`;
    const restarted = createOfficeRuntime(sql, { live: fake.live });
    expect(await restarted.claim('review-restarted')).toBeNull();
    expect((await budget()).reserved_microunits).toBe(String(reservationMicrounits('gpt-6-luna',982,6000)));
    const row = await taskOf(parent.taskId);
    await expect(restarted.requestTaskAction(ownerId, { workspaceId, taskId: row.id, version: Number(row.version), action: 'resume' })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await restarted.submitTask(ownerId, { workspaceId: '00000000-0000-4000-8000-000000000001', mode: 'demo', goal: 'Demonstration remains available', brief: 'Synthetic internal demonstration only; no external effects.', idempotencyKey: randomUUID() });
    const demo = (await restarted.claim('review-demo-unaffected'))!;
    expect(await restarted.execute(demo)).toMatchObject({ outcome: 'committed' });
    expect(fake.calls).toHaveLength(1);
  });

  it('preserves a dispatched hold during lease recovery by a corrected demo-only worker', async () => {
    let finish!: (outcome: CallOutcome) => void;
    const gate = new Promise<CallOutcome>(resolve => { finish = resolve; });
    const fake = provider(() => gate);
    const runtime = createOfficeRuntime(sql, { live: fake.live });
    await submit(runtime);
    const lease = (await runtime.claim('review-old-live-worker'))!;
    const running = runtime.execute(lease);
    for (let i=0;i<100 && fake.calls.length<1;i++) await new Promise(resolve => setTimeout(resolve,10));
    expect(fake.calls).toHaveLength(1);
    await sql`UPDATE backoffice.office_dispatch SET lease_until=now()-interval '1 second' WHERE id=${lease.dispatchId}`;
    const demoOnly = createOfficeRuntime(sql);
    await demoOnly.recoverExpired();
    expect(await budget()).toMatchObject({ spent_microunits: '0', reserved_microunits: String(reservationMicrounits('gpt-6-luna',982,6000)) });
    expect((await sql`SELECT state,usage_microunits FROM backoffice.office_runs WHERE id=${lease.runId}`)[0]).toMatchObject({ state: 'waiting_for_tool', usage_microunits: null });
    finish({ kind: 'unknown', code: 'timeout', requestId: null, retryAfterMs: null });
    await expect(running).rejects.toMatchObject({ code: 'LEASE_LOST' });
    expect(await demoOnly.claim('review-demo-only-recovered')).toBeNull();
  });
});

describe('independent live pricing defensive arithmetic', () => {
  it('rejects inconsistent or incomplete token categories and long-context pricing', () => {
    expect(() => usageMicrounits('gpt-6-luna',{...fullUsage, cachedTokens: 1},'default')).toThrow('invalid_token_usage');
    expect(() => usageMicrounits('gpt-6-luna',{...fullUsage, reasoningTokens: 6001},'default')).toThrow('invalid_token_usage');
    expect(() => usageMicrounits('gpt-6-luna',{...fullUsage, inputTokens: 272001},'default')).toThrow('unpriced_long_context');
    expect(() => usageMicrounits('gpt-6.1-sol',{...fullUsage, outputTokens: Number.MAX_SAFE_INTEGER},'default')).toThrow('unrepresentable_charge');
  });
});
