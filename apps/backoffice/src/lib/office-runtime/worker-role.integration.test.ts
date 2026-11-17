import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createOfficeRuntime } from './index';

// This suite never borrows DATABASE_URL or a preview/access-test database.
const databaseUrl = process.env.OFFICE_ROLE_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const workspaceId = '00000000-0000-4000-8000-000000000001';
const liveWorkspaceId = '00000000-0000-4000-8000-000000000002';
suite('dedicated Office worker database capability boundary', () => {
  let admin: ReturnType<typeof postgres>;
  let worker: ReturnType<typeof postgres>;
  let appRuntime: ReturnType<typeof createOfficeRuntime>;
  let workerRuntime: ReturnType<typeof createOfficeRuntime>;
  let ownerId: string;
  let taskId: string;
  let approvalId: string;
  let acceptanceId: string;
  const role = `office_role_verify_${randomUUID().replaceAll('-', '')}`;
  const input = (goal: string) => ({ workspaceId, mode: 'demo' as const, goal, brief: 'Synthetic supplied request for an informational website. Prices, provider and actual integrations remain unverified.', idempotencyKey: randomUUID() });
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '55439' || target.pathname !== '/enztronic_office_role_test') throw new Error('Dedicated loopback enztronic_office_role_test on port 55439 required.');
    admin = postgres(databaseUrl!, { max: 4, onnotice: () => undefined });
    // Only this explicitly named role fixture is reset. The access-test preview is untouched.
    await admin.unsafe('DROP SCHEMA IF EXISTS backoffice CASCADE');
    for (const name of ['001_init.sql', '002_users_and_ownership.sql', '003_office.sql', '004_office_live_provider.sql']) await admin.unsafe(await readFile(fileURLToPath(new URL(`../../../database/migrations/${name}`, import.meta.url)), 'utf8'));
    const [owner] = await admin`INSERT INTO backoffice.users(email,name,role) VALUES(${`owner-${randomUUID()}@example.test`},'Synthetic capability owner','admin') RETURNING id`;
    ownerId = owner.id;
    await admin.unsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);
    const grants = await readFile(fileURLToPath(new URL('../../../../office-worker/office-role.example.sql', import.meta.url)), 'utf8');
    await admin.unsafe(grants.replaceAll('enztronic_office_runtime', role));
    target.username = role;
    target.password = '';
    worker = postgres(target.toString(), { max: 3, onnotice: () => undefined });
    appRuntime = createOfficeRuntime(admin);
    workerRuntime = createOfficeRuntime(worker);
  }, 30000);
  afterAll(async () => {
    await worker?.end({ timeout: 2 });
    if (admin) {
      // This generated role owns no objects; revoke its fixture-only grants before removal.
      await admin.unsafe(`DROP OWNED BY ${role}`).catch(() => undefined);
      await admin.unsafe(`DROP ROLE IF EXISTS ${role}`);
      await admin.end({ timeout: 2 });
    }
  });

  it('denies all non-Office business reads/writes and cannot elevate its identity', async () => {
    const [identity] = await worker`SELECT current_user AS name, backoffice.office_authorized_owner(${ownerId}::uuid) AS allowed`;
    expect(identity).toMatchObject({ name: role, allowed: true });
    const business = await admin`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='backoffice' AND tablename NOT LIKE 'office_%' ORDER BY tablename`;
    expect(business.length).toBeGreaterThan(10);
    for (const row of business) {
      const table = `backoffice.${row.tablename}`;
      const [privileges] = await worker`SELECT has_table_privilege(current_user,${table},'SELECT') AS read, has_table_privilege(current_user,${table},'INSERT') AS insert, has_table_privilege(current_user,${table},'UPDATE') AS update, has_table_privilege(current_user,${table},'DELETE') AS delete`;
      expect(privileges, table).toEqual({ read: false, insert: false, update: false, delete: false });
      await expect(worker.unsafe(`SELECT * FROM ${table} LIMIT 1`)).rejects.toMatchObject({ code: '42501' });
    }
    await expect(worker`UPDATE backoffice.users SET role='admin' WHERE id=${ownerId}`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`INSERT INTO backoffice.invoice_payments DEFAULT VALUES`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`DELETE FROM backoffice.clients`).rejects.toMatchObject({ code: '42501' });
    await expect(worker.unsafe('SET ROLE office_test')).rejects.toMatchObject({ code: '42501' });
    await expect(worker.unsafe('CREATE TABLE backoffice.worker_escape(id integer)')).rejects.toMatchObject({ code: '42501' });
  });

  it('runs the complete persisted demonstration pipeline with only the limited role', async () => {
    ({ taskId } = await appRuntime.submitTask(ownerId, input('Limited role demonstration pipeline')));
    let executed = 0;
    for (let index = 0; index < 100; index++) {
      const lease = await workerRuntime.claim('limited-role-worker');
      if (lease) {
        await workerRuntime.heartbeat(lease);
        await workerRuntime.checkpoint(lease, { fixture: true });
        await workerRuntime.execute(lease);
        executed++;
      }
      const snapshot = await appRuntime.snapshot(workspaceId);
      const pending = snapshot.approvals.find(item => item.taskId === taskId && item.state === 'pending');
      if (pending) { approvalId = pending.id; break; }
    }
    expect(executed).toBe(16);
    expect(approvalId).toBeTruthy();
    const snapshot = await appRuntime.snapshot(workspaceId);
    expect(snapshot.tasks.find(item => item.id === taskId)?.state).toBe('waiting_for_owner_approval');
    expect(snapshot.tasks.filter(item => item.parentTaskId === taskId && item.state === 'review_passed')).toHaveLength(7);
    expect(await workerRuntime.health()).toMatchObject({ workerOnline: true, providerConfigured: false });
  }, 30000);

  it('rejects owner acceptance, rejection, evidence insertion and completion shortcuts', async () => {
    const approval = (await appRuntime.snapshot(workspaceId)).approvals.find(item => item.id === approvalId)!;
    await expect(workerRuntime.decideApproval(ownerId, { workspaceId, approvalId, version: approval.version, decision: 'approve' })).rejects.toMatchObject({ code: '42501' });
    await expect(workerRuntime.decideApproval(ownerId, { workspaceId, approvalId, version: approval.version, decision: 'reject', reason: 'Worker must not decide for the owner.' })).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_approvals SET state='approved' WHERE id=${approvalId}`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_approvals SET state='rejected' WHERE id=${approvalId}`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_approvals SET deciding_owner_id=${ownerId},decided_at=now(),consumed_at=now() WHERE id=${approvalId}`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_tasks SET acceptance_evidence_id=${randomUUID()} WHERE id=${taskId}`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_tasks SET state='completed' WHERE id=${taskId}`).rejects.toThrow('Office completion requires owner acceptance evidence');
    await expect(worker`INSERT INTO backoffice.office_acceptance_evidence(workspace_id,approval_id,owner_id,artifact_id,artifact_hash,action_scope,component_manifest,review_references) SELECT workspace_id,id,${ownerId},artifact_id,artifact_hash,action_scope,'[]'::jsonb,'[]'::jsonb FROM backoffice.office_approvals WHERE id=${approvalId}`).rejects.toMatchObject({ code: '42501' });
    const [unchanged] = await admin`SELECT state,deciding_owner_id,acceptance_evidence_id FROM backoffice.office_approvals WHERE id=${approvalId}`;
    expect(unchanged).toEqual({ state: 'pending', deciding_owner_id: null, acceptance_evidence_id: null });
  });

  it('cannot impersonate owner events or change policy, registration and spend limits', async () => {
    for (const denied of [
      { actor: 'owner', source: 'confirmed_application_action', event: 'task_queued' },
      { actor: 'worker', source: 'authenticated_owner_action', event: 'task_queued' },
      { actor: 'worker', source: 'confirmed_application_action', event: 'owner_approved' },
      { actor: 'worker', source: 'confirmed_application_action', event: 'task_completed' },
    ]) await expect(worker`INSERT INTO backoffice.office_events(workspace_id,sequence,task_id,actor_type,actor_id,event_type,mode,simulated,source,payload) VALUES(${workspaceId},1000000,${taskId},${denied.actor},${ownerId},${denied.event},'demo',true,${denied.source},'{}'::jsonb)`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_workspaces SET execution_isolation_verified=true WHERE id=${workspaceId}`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_workspace_grants SET tool_scopes='["send_email"]'::jsonb`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_agents SET enabled=false`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_budget SET limit_microunits=1000000 WHERE id=1`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_tasks SET initiating_owner_id=${randomUUID()} WHERE id=${taskId}`).rejects.toMatchObject({ code: '42501' });
  });

  it('preserves app-owner decisions and makes accepted tasks and decisions immutable', async () => {
    const approval = (await appRuntime.snapshot(workspaceId)).approvals.find(item => item.id === approvalId)!;
    const accepted = await appRuntime.decideApproval(ownerId, { workspaceId, approvalId, version: approval.version, decision: 'approve' });
    acceptanceId = accepted.acceptanceEvidenceId!;
    expect(accepted.state).toBe('approved');
    const snapshot = await appRuntime.snapshot(workspaceId);
    expect(snapshot.tasks.filter(item => item.id === taskId || item.parentTaskId === taskId).every(item => item.state === 'completed' && item.acceptanceEvidenceId === acceptanceId)).toBe(true);
    await expect(worker`UPDATE backoffice.office_approvals SET state='superseded' WHERE id=${approvalId}`).rejects.toThrow('Final office owner decisions are immutable');
    await expect(worker`UPDATE backoffice.office_tasks SET state='queued' WHERE id=${taskId}`).rejects.toThrow('Completed office tasks are immutable');
    await expect(worker`UPDATE backoffice.office_acceptance_evidence SET owner_id=${ownerId} WHERE id=${acceptanceId}`).rejects.toMatchObject({ code: '42501' });
  });

  it('appends authenticated owner notes after completion without changing accepted records', async () => {
    const [before] = await admin`SELECT to_jsonb(t) AS task FROM backoffice.office_tasks t WHERE id=${taskId}`;
    const [evidenceBefore] = await admin`SELECT to_jsonb(e) AS evidence FROM backoffice.office_acceptance_evidence e WHERE id=${acceptanceId}`;
    expect(before.task.state).toBe('completed');
    const snapshot = await appRuntime.snapshot(workspaceId);
    const note = { workspaceId, taskId, version: Number(before.task.version), action: 'note' as const, reason: 'Synthetic owner follow-up: retain this exact accepted package for the next planning review.' };
    await expect(workerRuntime.requestTaskAction(ownerId, note)).rejects.toMatchObject({ code: '42501' });
    await appRuntime.requestTaskAction(ownerId, note);
    const [after] = await admin`SELECT to_jsonb(t) AS task FROM backoffice.office_tasks t WHERE id=${taskId}`;
    const [evidenceAfter] = await admin`SELECT to_jsonb(e) AS evidence FROM backoffice.office_acceptance_evidence e WHERE id=${acceptanceId}`;
    expect(after).toEqual(before);
    expect(evidenceAfter).toEqual(evidenceBefore);
    const notes = (await appRuntime.events(workspaceId, snapshot.latestSequence)).filter(event => event.taskId === taskId && event.eventType === 'task_note_added');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ actorType: 'owner', actorId: ownerId, source: 'authenticated_owner_action', payload: { note: note.reason } });
    await expect(admin`UPDATE backoffice.office_events SET payload='{}'::jsonb WHERE id=${notes[0].eventId}`).rejects.toThrow('Office evidence and revisions are append-only');
  });

  it('rejects cross-workspace and cross-approval evidence references even for privileged callers', async () => {
    const { taskId: otherTask } = await appRuntime.submitTask(ownerId, { ...input('Another workspace acceptance boundary'), workspaceId: liveWorkspaceId, mode: 'live' });
    await expect(admin`UPDATE backoffice.office_tasks SET acceptance_evidence_id=${acceptanceId} WHERE id=${otherTask}`).rejects.toThrow('same workspace');
    const [artifact] = await admin`INSERT INTO backoffice.office_artifacts(workspace_id,task_id,author_agent_id,title,revision,content,artifact_hash,size_bytes) VALUES(${liveWorkspaceId},${otherTask},'adrian','Synthetic live artifact',1,'fixture',${'a'.repeat(64)},7) RETURNING id`;
    const [otherApproval] = await admin`INSERT INTO backoffice.office_approvals(workspace_id,task_id,artifact_id,artifact_hash,action_scope,state,expires_at) VALUES(${liveWorkspaceId},${otherTask},${artifact.id},${'a'.repeat(64)},'accept_internal_proposal_package','pending',now()+interval '1 day') RETURNING id`;
    await expect(admin`UPDATE backoffice.office_approvals SET acceptance_evidence_id=${acceptanceId} WHERE id=${otherApproval.id}`).rejects.toMatchObject({ code: '23503' });
    const { taskId: unrelated } = await appRuntime.submitTask(ownerId, input('Unrelated package in same workspace'));
    await expect(admin`UPDATE backoffice.office_tasks SET acceptance_evidence_id=${acceptanceId} WHERE id=${unrelated}`).rejects.toThrow('its own package');
    const [constraints] = await admin`SELECT count(*)::int AS n FROM pg_catalog.pg_constraint WHERE conname IN ('office_tasks_acceptance_evidence_id_workspace_id_fkey','office_approvals_acceptance_evidence_id_workspace_id_id_fkey')`;
    expect(constraints.n).toBe(2);
  });

  it('dispatches existing owner-approved schedules truthfully and cannot create or re-enable them', async () => {
    const scheduleId = randomUUID();
    await appRuntime.createSchedule(ownerId, { scheduleId, template: input('Owner-approved limited-role schedule'), nextAt: new Date(Date.now() - 1000).toISOString(), cadenceSeconds: 3600 });
    expect(await workerRuntime.dispatchDueSchedules()).toBe(1);
    const scheduleKey = `schedule:${scheduleId}:%`;
    const rows = await admin`SELECT e.actor_type,e.actor_id,e.source FROM backoffice.office_events e JOIN backoffice.office_tasks t ON t.id=e.task_id WHERE t.idempotency_key LIKE ${scheduleKey}`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.actor_type === 'worker' && row.actor_id === 'scheduler' && row.source === 'confirmed_application_action')).toBe(true);
    await expect(workerRuntime.createSchedule(ownerId, { scheduleId: randomUUID(), template: input('Denied worker schedule'), nextAt: new Date().toISOString(), cadenceSeconds: 3600 })).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_schedules SET template='{}'::jsonb WHERE id=${scheduleId}`).rejects.toMatchObject({ code: '42501' });
    await expect(worker`UPDATE backoffice.office_schedules SET next_at=now()-interval '1 hour' WHERE id=${scheduleId}`).rejects.toMatchObject({ code: '42501' });
    await worker`UPDATE backoffice.office_schedules SET enabled=false WHERE id=${scheduleId}`;
    await expect(worker`UPDATE backoffice.office_schedules SET enabled=true WHERE id=${scheduleId}`).rejects.toMatchObject({ code: '42501' });
  });
});
