import type postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import {
  OFFICE_AGENTS, submitTaskSchema, taskActionSchema, approvalDecisionSchema, artifactRevisionSchema,
  canTaskTransition, type AgentId, type TaskState, type OfficeMode, type OfficeSnapshot, type OfficeTask,
  type OfficeArtifact, type OfficeReview, type OfficeApproval, type OfficeEvent, type JsonValue,
  type SubmitTaskInput, type TaskActionInput, type ApprovalDecisionInput, type OfficeHealth,
} from '../office-contracts';
import { OfficeError, canonicalJson, digest } from './safety';
import { createDemoDraft, createDemoPackage, reviewDemoArtifact } from './demo-adapter';
import type { CallOutcome, LiveModelCall, LiveProvider } from './openai';
import { buildDraftCall, buildPackageCall, buildReviewCall, findingMessages, interpretReview, LiveOutputError, MAX_INPUT_TOKENS, renderDraft, renderPackage, type DraftRevisionContext, type LiveSettings, type LiveStep, type PackageComponent } from './live-adapter';
import { formatUsd, reservationMicrounits, SHORT_CONTEXT_MAX_INPUT_TOKENS, usageMicrounits, type TokenUsage } from './live-pricing';
export { OfficeError, assertRegisteredPath, assertCommandExecutionAllowed, digest } from './safety';
type Connection = postgres.Sql | postgres.TransactionSql;
/** A configured live provider. Only the dedicated worker process receives one; the web app never does. */
export type LiveExecution = { provider: LiveProvider; settings: LiveSettings };
export type StepResult = { outcome: 'committed' | 'failed' | 'stopped'; code?: string; model?: string; chargedMicrounits?: number; inputTokens?: number; outputTokens?: number };
type Draft = { title: string; content: string; manifest: JsonValue; artifactHash: string };
type ReviewResult = { passed: boolean; criteria: string[]; evidence: JsonValue; findings: JsonValue };
type FailOptions = { exhausted?: boolean; retryAfterMs?: number | null; blockedReason?: string };
/** Runaway guard: nominal first attempt is 16 calls (7 drafts, 7 reviews, package, package review). */
const FAMILY_CALL_CEILING = 32;
const ATTEMPT_CALL_CEILING = 16;
const PROPOSAL_ATTEMPT_MS = 10 * 60 * 1000;
const MODEL_OPERATION = 'openai_responses';
type DbTask = { id: string; workspace_id: string; parent_task_id: string | null; initiating_owner_id: string; agent_id: AgentId; goal: string; brief: string; state: TaskState; mode: OfficeMode; version: number; stage: string; current_artifact_id: string | null; acceptance_evidence_id: string | null; blocked_reason: string | null; created_at: Date; updated_at: Date; scope_key: string; project_key: string; revision_cycles: number; priority: number };
type DbArtifact = { id: string; task_id: string; workspace_id: string; author_agent_id: AgentId; title: string; revision: number; artifact_hash: string; content: string; manifest: JsonValue; created_at: Date; scope_key: string; project_key: string };
type DbApproval = { id: string; task_id: string; workspace_id: string; artifact_id: string; artifact_hash: string; state: string; version: number; expires_at: Date; reason: string | null; decided_at: Date | null; acceptance_evidence_id: string | null };
export type OfficeLease = { dispatchId: string; taskId: string; workspaceId: string; runId: string; workerId: string; token: string; step: string; agentId: AgentId; leaseUntil: string };
const reviewers: Record<AgentId, AgentId> = { adrian: 'nadia', leo: 'nadia', nadia: 'leo', lisa: 'sam', sam: 'theo', theo: 'sam', clara: 'adrian' };
const iso = (value: Date | string) => new Date(value).toISOString();
function mapTask(row: DbTask): OfficeTask { return { id: row.id, workspaceId: row.workspace_id, clientId: row.scope_key, projectId: row.project_key, parentTaskId: row.parent_task_id, agentId: row.agent_id, goal: row.goal, brief: row.brief, priority: row.priority, state: row.state, mode: row.mode, version: Number(row.version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), blockedReason: row.blocked_reason, currentArtifactId: row.current_artifact_id, acceptanceEvidenceId: row.acceptance_evidence_id }; }
function mapArtifact(row: DbArtifact): OfficeArtifact { return { id: row.id, taskId: row.task_id, workspaceId: row.workspace_id, clientId: row.scope_key, projectId: row.project_key, authorAgentId: row.author_agent_id, title: row.title, revision: row.revision, revisionId: row.id, artifactHash: row.artifact_hash, hashAlgorithm: 'SHA-256', content: row.content, manifest: row.manifest, createdAt: iso(row.created_at) }; }
function mapApproval(row: DbApproval): OfficeApproval { return { id: row.id, taskId: row.task_id, workspaceId: row.workspace_id, artifactId: row.artifact_id, revisionId: row.artifact_id, artifactHash: row.artifact_hash, actionScope: 'accept_internal_proposal_package', state: row.state, version: Number(row.version), expiresAt: iso(row.expires_at), reason: row.reason, decidedAt: row.decided_at ? iso(row.decided_at) : null, acceptanceEvidenceId: row.acceptance_evidence_id }; }
export function emptyOfficeSnapshot(reason = 'Office is disabled until its reviewed migration and worker setup are activated.'): OfficeSnapshot {
  return { available: false, workspaces: [], agents: OFFICE_AGENTS.map(agent => ({ id: agent.agentId as AgentId, name: agent.displayName, role: agent.role, responsibility: agent.responsibility, enabled: false, profileVersion: 1 })), tasks: [], artifacts: [], reviews: [], approvals: [], events: [], latestSequence: 0, health: { workerOnline: false, lastHeartbeatAt: null, providerConfigured: false, commandExecutionEnabled: false, status: 'configuration_required', disclosure: reason }, limits: { taskLimit: 200, eventLimit: 100 }, configurationRequired: [reason] };
}

export function createOfficeRuntime(sql: postgres.Sql, options: { concurrency?: number; leaseSeconds?: number; live?: LiveExecution } = {}) {
  const concurrency = Number.isInteger(options.concurrency) ? Math.max(1, Math.min(4, options.concurrency!)) : 1;
  const leaseSeconds = Number.isInteger(options.leaseSeconds) ? Math.max(5, Math.min(120, options.leaseSeconds!)) : 30;
  // A worker claims live tasks only when it holds a provider; demo tasks never need one.
  const modes = options.live ? ['demo', 'live'] : ['demo'];
  async function owner(tx: Connection, ownerId: string) {
    const [row] = await tx`SELECT backoffice.office_authorized_owner(${ownerId}::uuid) AS allowed`;
    if (!row?.allowed) throw new OfficeError('FORBIDDEN', 'An active authenticated owner account is required.');
  }
  async function task(tx: Connection, taskId: string, workspaceId: string, lock = true): Promise<DbTask> {
    const rows = await tx<DbTask[]>`SELECT t.*,w.scope_key,w.project_key FROM backoffice.office_tasks t JOIN backoffice.office_workspaces w ON w.id=t.workspace_id WHERE t.id=${taskId} AND t.workspace_id=${workspaceId} ${lock ? tx`FOR UPDATE OF t` : tx``}`;
    if (!rows[0]) throw new OfficeError('NOT_FOUND', 'Task not found in this workspace.');
    return rows[0];
  }
  async function emit(tx: Connection, workspaceId: string, taskId: string | null, eventType: string, actorId: string, payload: Record<string, JsonValue> = {}, runId: string | null = null, actorType = 'worker') {
    // Locking the workspace row serializes the committed sequence; reconnect never skips late commits.
    const [workspace] = await tx`UPDATE backoffice.office_workspaces SET event_sequence=event_sequence+1 WHERE id=${workspaceId} RETURNING mode,event_sequence`;
    if (!workspace) throw new OfficeError('NOT_FOUND', 'Workspace not found.');
    if (Buffer.byteLength(canonicalJson(payload)) > 3500) throw new OfficeError('INVALID_STATE', 'Event payload exceeds its bounded summary size.');
    await tx`INSERT INTO backoffice.office_events(workspace_id,sequence,task_id,run_id,actor_type,actor_id,event_type,mode,simulated,source,payload) VALUES(${workspaceId},${workspace.event_sequence},${taskId},${runId},${actorType},${actorId},${eventType},${workspace.mode},${workspace.mode === 'demo'},${actorType === 'owner' ? 'authenticated_owner_action' : 'confirmed_application_action'},${tx.json(payload)})`;
  }
  async function transition(tx: Connection, row: DbTask, next: TaskState, eventType: string, actorId: string, payload: Record<string, JsonValue> = {}, runId: string | null = null, actorType = 'worker') {
    if (!canTaskTransition(row.state, next)) throw new OfficeError('INVALID_STATE', `Cannot change ${row.state} to ${next}.`);
    await tx`UPDATE backoffice.office_tasks SET state=${next},blocked_reason=CASE WHEN ${next}='blocked' THEN blocked_reason ELSE NULL END,version=version+1,updated_at=now() WHERE id=${row.id} AND workspace_id=${row.workspace_id}`;
    row.state = next;
    row.version = Number(row.version) + 1;
    await emit(tx, row.workspace_id, row.id, eventType, actorId, payload, runId, actorType);
  }
  async function enqueue(tx: Connection, row: DbTask, step: string, reviewer: AgentId | null = null, suffix = '') {
    await tx`INSERT INTO backoffice.office_dispatch(workspace_id,task_id,operation_key,step,reviewer_id) VALUES(${row.workspace_id},${row.id},${`${row.id}:${step}:${suffix || row.revision_cycles}`},${step},${reviewer}) ON CONFLICT(operation_key) DO NOTHING`;
  }
  async function startLiveAttempt(tx: Connection, current: DbTask) {
    if (current.mode !== 'live') return;
    const root = current.parent_task_id ? await task(tx, current.parent_task_id, current.workspace_id) : current;
    const attemptId = randomUUID();
    // Only an explicit authenticated owner recovery/revision starts another ten-minute window.
    await tx`INSERT INTO backoffice.office_runs(id,workspace_id,task_id,agent_id,profile_version,policy_version,attempt,state,step,usage_microunits,finished_at) VALUES(${attemptId},${root.workspace_id},${root.id},'adrian',1,1,1,'succeeded','live_owner_attempt',0,now())`;
  }
  async function markModelUncertain(tx: Connection, runId: string, reason: string) {
    await tx`UPDATE backoffice.office_tool_operations SET state='unknown_outcome',result=${tx.json({ reason })},updated_at=now() WHERE run_id=${runId} AND tool_name=${MODEL_OPERATION} AND state='reserved'`;
  }
  // Closes a run's open reservation. A model request that was dispatched but never settled may have
  // been billed, so it keeps its full reservation as spend; an undispatched reservation is released.
  async function settleOpenReservation(tx: Connection, runId: string) {
    const [run] = await tx`SELECT * FROM backoffice.office_runs WHERE id=${runId} FOR UPDATE`;
    if (!run || run.usage_microunits !== null) return;
    const reserved = Number(run.budget_reserved_microunits);
    let [modelOperation] = await tx`SELECT state FROM backoffice.office_tool_operations WHERE run_id=${runId} AND tool_name=${MODEL_OPERATION} AND state IN ('reserved','unknown_outcome')`;
    if (!modelOperation && run.provider_dispatched_at && run.model) {
      // Also quarantine a dispatched hold left by a prior implementation without operation evidence.
      const operationKey = `openai:${runId}`;
      await tx`INSERT INTO backoffice.office_tool_operations(workspace_id,task_id,run_id,operation_key,arguments_hash,tool_name,state,provider_idempotency_key,result) VALUES(${run.workspace_id},${run.task_id},${runId},${operationKey},${digest(operationKey)},${MODEL_OPERATION},'unknown_outcome',${digest(operationKey)},${tx.json({ reason: 'Recovered a dispatched model hold without confirmed billing usage.' })}) ON CONFLICT(operation_key) DO NOTHING`;
      [modelOperation] = await tx`SELECT state FROM backoffice.office_tool_operations WHERE run_id=${runId} AND tool_name=${MODEL_OPERATION} AND state IN ('reserved','unknown_outcome')`;
    }
    if (modelOperation && run.provider_dispatched_at) {
      // A dispatched unresolved request keeps an open hold until an owner reconciles provider evidence.
      await markModelUncertain(tx, runId, 'The dispatched request has no confirmed billing outcome.');
      return;
    }
    const charged = run.provider_dispatched_at ? reserved : 0;
    if (reserved) await tx`UPDATE backoffice.office_budget SET reserved_microunits=reserved_microunits-${reserved},spent_microunits=spent_microunits+${charged} WHERE id=1`;
    await tx`UPDATE backoffice.office_runs SET usage_microunits=${charged} WHERE id=${runId}`;
  }
  async function settleParentStop(tx: Connection, child: DbTask, actorId: string) {
    if (!child.parent_task_id) return;
    const parent = await task(tx, child.parent_task_id, child.workspace_id);
    if (!['pause_requested','cancel_requested'].includes(parent.state)) return;
    const [outstanding] = await tx`SELECT count(*)::int AS n FROM backoffice.office_tasks t WHERE t.parent_task_id=${parent.id} AND (t.state IN ('pause_requested','cancel_requested','in_progress') OR EXISTS(SELECT 1 FROM backoffice.office_tool_operations o WHERE o.task_id=t.id AND o.state IN ('reserved','unknown_outcome')))`;
    if (!outstanding.n) await transition(tx, parent, parent.state === 'cancel_requested' ? 'cancelled' : 'paused', parent.state === 'cancel_requested' ? 'task_cancelled' : 'work_paused', actorId);
  }
  async function invalidateParentPackage(tx: Connection, child: DbTask, actorId: string) {
    if (!child.parent_task_id) return;
    const parent = await task(tx, child.parent_task_id, child.workspace_id);
    const activePackage = await tx`SELECT 1 FROM backoffice.office_dispatch WHERE task_id=${parent.id} AND step='package' AND state='leased' AND lease_until>now() LIMIT 1`;
    if (!parent.current_artifact_id && !activePackage.length) return;
    await tx`UPDATE backoffice.office_approvals SET state='superseded',version=version+1 WHERE task_id=${parent.id} AND state IN ('proposed','pending')`;
    if (parent.state === 'in_progress') {
      await tx`UPDATE backoffice.office_tasks SET blocked_reason='A child component changed while package execution was active.' WHERE id=${parent.id}`;
      await transition(tx, parent, 'blocked', 'work_blocked', actorId, { dependencySummary: 'A component changed; revalidate dependencies and rebuild the package.' });
    }
    if (['waiting_for_review','review_passed','waiting_for_owner_approval'].includes(parent.state)) await transition(tx, parent, 'changes_requested', 'review_changes_requested', actorId, { feedback: 'A component revision changed; rebuild and review the parent package.' });
  }
  async function health(): Promise<OfficeHealth> {
    // Heartbeat age is judged in database time, the same clock that wrote it.
    const [row] = await sql`SELECT max(heartbeat_at) AS last, COALESCE(bool_or(heartbeat_at>now()-interval '60 seconds'),false) AS online,
      COALESCE(bool_or(adapter='openai_responses' AND heartbeat_at>now()-interval '60 seconds'),false) AS live_online
      FROM backoffice.office_workers WHERE NOT stopping`;
    const [budget] = await sql`SELECT live_enabled FROM backoffice.office_budget WHERE id=1`;
    const last = row?.last ? iso(row.last) : null;
    const online = !!row?.online;
    const providerConfigured = !!row?.live_online;
    const liveEnabled = !!budget?.live_enabled;
    const disclosure = providerConfigured
      ? (liveEnabled ? 'A live OpenAI provider is connected on the Office worker. Spending limits are enforced before every request.' : 'A live OpenAI provider is connected on the Office worker, but live execution is switched off.')
      : 'Deterministic demonstration adapter only. Live provider, budget and isolated command executor are not configured.';
    return { workerOnline: online, lastHeartbeatAt: last, providerConfigured, liveEnabled, commandExecutionEnabled: false, status: online ? 'worker_online' : 'worker_offline', disclosure };
  }
  async function events(workspaceId: string, after = 0, limit = 100): Promise<OfficeEvent[]> {
    if (!Number.isSafeInteger(after) || after < 0) throw new OfficeError('INVALID_STATE', 'Invalid replay cursor.');
    const rows = await sql`SELECT e.*,w.scope_key,w.project_key FROM backoffice.office_events e JOIN backoffice.office_workspaces w ON w.id=e.workspace_id WHERE e.workspace_id=${workspaceId} AND e.sequence>${after} ORDER BY e.sequence LIMIT ${Math.max(1, Math.min(200, limit))}`;
    return rows.map(row => ({ eventId: row.id, sequence: Number(row.sequence), eventType: row.event_type, occurredAt: iso(row.occurred_at), workspaceId: row.workspace_id, clientId: row.scope_key, projectId: row.project_key, taskId: row.task_id, runId: row.run_id, actorType: row.actor_type, actorId: row.actor_id, mode: row.mode === 'demo' ? 'visual_prototype' : 'connected_internal_workflow', simulated: row.simulated, source: row.source, payload: row.payload }));
  }
  async function artifact(workspaceId: string, artifactId: string): Promise<OfficeArtifact> {
    const [row] = await sql<DbArtifact[]>`SELECT a.*,w.scope_key,w.project_key FROM backoffice.office_artifacts a JOIN backoffice.office_workspaces w ON w.id=a.workspace_id WHERE a.workspace_id=${workspaceId} AND a.id=${artifactId}`;
    if (!row) throw new OfficeError('NOT_FOUND', 'Artifact not found in this workspace.');
    return mapArtifact(row);
  }
  async function snapshot(workspaceId?: string): Promise<OfficeSnapshot> {
    const currentHealth = await health();
    // Snapshot is one repeatable-read view, including its replay cursor.
    return sql.begin('isolation level repeatable read read only', async tx => {
      const workspaces = await tx`SELECT * FROM backoffice.office_workspaces ${workspaceId ? tx`WHERE id=${workspaceId}` : tx``} ORDER BY mode,name`;
      const ids = workspaces.map(row => row.id);
      const tasks = ids.length ? await tx<DbTask[]>`SELECT t.*,w.scope_key,w.project_key FROM backoffice.office_tasks t JOIN backoffice.office_workspaces w ON w.id=t.workspace_id WHERE t.workspace_id IN ${tx(ids)} ORDER BY t.created_at DESC LIMIT 200` : [];
      const taskIds = tasks.map(row => row.id);
      const artifacts = taskIds.length ? await tx<DbArtifact[]>`SELECT a.*,w.scope_key,w.project_key FROM backoffice.office_artifacts a JOIN backoffice.office_workspaces w ON w.id=a.workspace_id WHERE a.task_id IN ${tx(taskIds)} ORDER BY a.created_at DESC LIMIT 300` : [];
      const reviewRows = taskIds.length ? await tx`SELECT * FROM backoffice.office_reviews WHERE task_id IN ${tx(taskIds)} ORDER BY created_at DESC LIMIT 300` : [];
      const approvalRows = taskIds.length ? await tx<DbApproval[]>`SELECT * FROM backoffice.office_approvals WHERE task_id IN ${tx(taskIds)} ORDER BY created_at DESC LIMIT 100` : [];
      const eventRows = ids.length ? await tx`SELECT e.*,w.scope_key,w.project_key FROM backoffice.office_events e JOIN backoffice.office_workspaces w ON w.id=e.workspace_id WHERE e.workspace_id IN ${tx(ids)} ORDER BY e.occurred_at DESC,e.sequence DESC LIMIT 100` : [];
      const agentRows = await tx`SELECT * FROM backoffice.office_agents ORDER BY name`;
      const reviews: OfficeReview[] = reviewRows.map(row => ({ id: row.id, taskId: row.task_id, workspaceId: row.workspace_id, artifactId: row.artifact_id, revisionId: row.artifact_id, artifactHash: row.artifact_hash, reviewerId: row.reviewer_id, state: row.state, criteria: row.criteria, evidence: row.evidence, findings: row.findings, createdAt: iso(row.created_at) }));
      const mappedEvents: OfficeEvent[] = eventRows.map(row => ({ eventId: row.id, sequence: Number(row.sequence), eventType: row.event_type, occurredAt: iso(row.occurred_at), workspaceId: row.workspace_id, clientId: row.scope_key, projectId: row.project_key, taskId: row.task_id, runId: row.run_id, actorType: row.actor_type, actorId: row.actor_id, mode: row.mode === 'demo' ? 'visual_prototype' : 'connected_internal_workflow', simulated: row.simulated, source: row.source, payload: row.payload }));
      const liveReady = currentHealth.providerConfigured && currentHealth.liveEnabled;
      return { available: true, workspaces: workspaces.map(row => ({ id: row.id, name: row.name, clientId: row.scope_key, projectId: row.project_key, scope: row.scope, mode: row.mode })), agents: agentRows.map(row => ({ id: row.id, name: row.name, role: row.role, responsibility: OFFICE_AGENTS.find(agent => agent.agentId === row.id)?.responsibility ?? '', enabled: row.enabled, profileVersion: row.profile_version })), tasks: tasks.map(mapTask), artifacts: artifacts.map(mapArtifact), reviews, approvals: approvalRows.map(mapApproval), events: mappedEvents, health: currentHealth, latestSequence: workspaceId ? Number(workspaces[0]?.event_sequence ?? 0) : 0, limits: { taskLimit: 200, eventLimit: 100 }, configurationRequired: [...(liveReady ? [] : ['Live provider on the Office worker, live switch and explicit spending limits']), 'Approved sources and real internal pilot brief', 'Isolated executor before any coding commands'] };
    });
  }
  async function submitTask(ownerId: string, raw: SubmitTaskInput) {
    return submitTaskFrom(ownerId, raw, 'owner');
  }
  async function submitTaskFrom(ownerId: string, raw: SubmitTaskInput, source: 'owner' | 'scheduler') {
    const input = submitTaskSchema.parse(raw);
    const actorId = source === 'owner' ? ownerId : 'scheduler';
    const actorType = source === 'owner' ? 'owner' : 'worker';
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      await owner(tx, ownerId);
      const [workspace] = await tx`SELECT * FROM backoffice.office_workspaces WHERE id=${input.workspaceId} FOR UPDATE`;
      if (!workspace || workspace.mode !== input.mode || workspace.scope !== 'internal') throw new OfficeError('FORBIDDEN', 'Select a matching explicitly registered internal workspace.');
      const inputHash = digest(canonicalJson(input));
      const [existing] = await tx`SELECT id,input_hash FROM backoffice.office_tasks WHERE workspace_id=${input.workspaceId} AND initiating_owner_id=${ownerId} AND idempotency_key=${input.idempotencyKey}`;
      if (existing) { if (existing.input_hash !== inputHash) throw new OfficeError('CONFLICT', 'Idempotency key was already used for different input.'); return { taskId: existing.id, duplicate: true }; }
      const live = input.mode === 'live';
      const liveReady = live && await liveConfigured(tx);
      // Pilot boundary: one delegated live proposal at a time. Undelegated blocked records do not count.
      if (liveReady) {
        const [open] = await tx`SELECT t.id FROM backoffice.office_tasks t WHERE t.mode='live' AND t.parent_task_id IS NULL AND t.state NOT IN ('completed','cancelled') AND EXISTS(SELECT 1 FROM backoffice.office_task_dependencies d WHERE d.task_id=t.id) LIMIT 1`;
        if (open) throw new OfficeError('CONFLICT', 'One live proposal runs at a time during the pilot. Finish or cancel the open live proposal first.');
      }
      const [created] = await tx`INSERT INTO backoffice.office_tasks(workspace_id,initiating_owner_id,agent_id,goal,brief,mode,idempotency_key,input_hash,stage) VALUES(${input.workspaceId},${ownerId},'adrian',${input.goal},${input.brief},${input.mode},${input.idempotencyKey},${inputHash},'package') RETURNING id`;
      const parent = await task(tx, created.id, input.workspaceId);
      const label = live ? 'Live internal proposal' : 'Simulated example';
      await emit(tx, parent.workspace_id, parent.id, 'task_queued', actorId, { agentName: 'Adrian', displayPrefix: live && !liveReady ? 'Live configuration required' : label }, null, actorType);
      if (live && !liveReady) {
        await transition(tx, parent, 'assigned', 'task_assigned', actorId, { agentName: 'Adrian' }, null, actorType);
        await tx`UPDATE backoffice.office_tasks SET blocked_reason='configuration_required: live execution is switched off or its spending limits are not set' WHERE id=${parent.id}`;
        await transition(tx, parent, 'blocked', 'work_blocked', actorId, { dependencySummary: 'configuration_required: live switch and spending limits' }, null, actorType);
        return { taskId: parent.id, duplicate: false };
      }
      // Persist real internal delegation as a bounded coordinator step, independent of child capacity.
      const coordinationRun = randomUUID();
      await tx`INSERT INTO backoffice.office_runs(id,workspace_id,task_id,agent_id,profile_version,policy_version,attempt,state,step) VALUES(${coordinationRun},${parent.workspace_id},${parent.id},'adrian',1,1,1,'starting',${`delegate_internal_${input.mode}`})`;
      await transition(tx, parent, 'assigned', 'task_assigned', actorId, { agentName: 'Adrian' }, coordinationRun, actorType);
      await tx`UPDATE backoffice.office_runs SET state='running' WHERE id=${coordinationRun}`;
      await transition(tx, parent, 'in_progress', 'work_started', actorId, { agentName: 'Adrian', stepName: live ? 'Persist live role assignments' : 'Persist explicitly simulated child assignments' }, coordinationRun, actorType);
      for (const agent of OFFICE_AGENTS) {
        const agentId = agent.agentId as AgentId;
        const [child] = await tx`INSERT INTO backoffice.office_tasks(workspace_id,parent_task_id,initiating_owner_id,agent_id,goal,brief,mode,idempotency_key,input_hash) VALUES(${parent.workspace_id},${parent.id},${ownerId},${agentId},${`${agent.displayName}: ${input.goal}`.slice(0,240)},${input.brief},${input.mode},${`${parent.id}:${agentId}`},${inputHash}) RETURNING id`;
        await tx`INSERT INTO backoffice.office_task_dependencies(workspace_id,task_id,dependency_task_id) VALUES(${parent.workspace_id},${parent.id},${child.id})`;
        const childTask = await task(tx, child.id, parent.workspace_id);
        await enqueue(tx, childTask, 'draft');
        await emit(tx, parent.workspace_id, child.id, 'task_queued', actorId, { agentName: agent.displayName, displayPrefix: label }, null, actorType);
      }
      await enqueue(tx, parent, 'package');
      await tx`UPDATE backoffice.office_runs SET state='succeeded',usage_microunits=0,finished_at=now(),checkpoint=${tx.json({ delegated: true, simulated: !live })} WHERE id=${coordinationRun}`;
      return { taskId: parent.id, duplicate: false };
    });
  }

  async function workerHeartbeat(workerId: string, stopping = false) {
    const adapter = options.live ? 'openai_responses' : 'deterministic_demo';
    const capabilities = options.live ? { provider: options.live.provider.name, draftModel: options.live.settings.draftModel, packageModel: options.live.settings.packageModel, reasoningEffort: options.live.settings.reasoningEffort } : {};
    await sql`INSERT INTO backoffice.office_workers(id,adapter,stopping,capabilities) VALUES(${workerId},${adapter},${stopping},${sql.json(capabilities)}) ON CONFLICT(id) DO UPDATE SET heartbeat_at=now(),stopping=${stopping}`;
  }
  async function liveConfigured(tx: Connection) {
    const [budget] = await tx`SELECT * FROM backoffice.office_budget WHERE id=1`;
    return !!budget?.live_enabled && [budget.limit_microunits, budget.monthly_limit_microunits, budget.family_limit_microunits, budget.request_limit_microunits].every(value => Number(value) > 0);
  }
  async function recoverExpired() {
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      const rows = await tx`SELECT * FROM backoffice.office_dispatch WHERE state='leased' AND lease_until<now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50`;
      for (const dispatch of rows) {
        const current = await task(tx, dispatch.task_id, dispatch.workspace_id);
        await settleOpenReservation(tx,dispatch.run_id);
        const [unknownModel] = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE run_id=${dispatch.run_id} AND tool_name=${MODEL_OPERATION} AND state='unknown_outcome'`;
        await tx`UPDATE backoffice.office_runs SET state=${unknownModel ? 'waiting_for_tool' : 'interrupted'},finished_at=${unknownModel ? null : tx`now()`},error_code='lease_expired' WHERE id=${dispatch.run_id} AND state NOT IN ('succeeded','failed','interrupted','cancelled')`;
        const unresolved = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE task_id=${current.id} AND state IN ('reserved','unknown_outcome') LIMIT 1`;
        const exhausted = dispatch.attempt >= dispatch.max_attempts || unresolved.length > 0;
        await tx`UPDATE backoffice.office_dispatch SET state=${exhausted ? 'exhausted' : 'pending'},lease_token=lease_token+1,lease_until=NULL,lease_owner=NULL,available_at=now()+(${Math.min(60, 2 ** Number(dispatch.attempt))}*interval '1 second'),last_error='lease_expired' WHERE id=${dispatch.id}`;
        if (!unresolved.length && (current.state === 'cancel_requested' || current.state === 'pause_requested')) {
          await transition(tx, current, current.state === 'cancel_requested' ? 'cancelled' : 'paused', current.state === 'cancel_requested' ? 'task_cancelled' : 'work_paused', 'recovery');
          await settleParentStop(tx, current, 'recovery');
        } else if (['in_progress','waiting_for_review'].includes(current.state)) {
          await tx`UPDATE backoffice.office_tasks SET blocked_reason=${exhausted ? 'retry_exhausted: owner recovery decision required' : 'interrupted: retry scheduled with a new run'} WHERE id=${current.id}`;
          await transition(tx, current, 'blocked', 'work_blocked', 'recovery', { dependencySummary: exhausted ? 'Retries exhausted; owner recovery decision required.' : 'Expired worker lease; durable retry scheduled.' });
        }
      }
      return rows.length;
    });
  }
  async function claim(workerId: string): Promise<OfficeLease | null> {
    await workerHeartbeat(workerId);
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      // Serializes admission only, never the model/tool work; all processes obey one capacity limit.
      await tx`SELECT pg_advisory_xact_lock(68421201)`;
      const [count] = await tx`SELECT count(*)::integer AS n FROM backoffice.office_dispatch WHERE state='leased' AND lease_until>now()`;
      if (count.n >= concurrency) return null;
      const [dispatch] = await tx`SELECT d.* FROM backoffice.office_dispatch d JOIN backoffice.office_tasks t ON t.id=d.task_id JOIN backoffice.office_agents a ON a.id=t.agent_id JOIN backoffice.office_workspace_grants g ON g.workspace_id=t.workspace_id AND g.agent_id=COALESCE(d.reviewer_id,t.agent_id) WHERE d.state='pending' AND d.available_at<=now() AND d.attempt<d.max_attempts AND a.enabled AND t.mode IN ${tx(modes)} AND t.state IN ('queued','assigned','in_progress','waiting_for_review','blocked') AND (t.mode<>'live' OR (NOT EXISTS(SELECT 1 FROM backoffice.office_dispatch active JOIN backoffice.office_tasks at ON at.id=active.task_id WHERE at.mode='live' AND active.state='leased' AND active.lease_until>now()) AND NOT EXISTS(SELECT 1 FROM backoffice.office_tool_operations o WHERE o.tool_name=${MODEL_OPERATION} AND o.state IN ('reserved','unknown_outcome')))) AND NOT EXISTS(SELECT 1 FROM backoffice.office_tasks p WHERE p.id=t.parent_task_id AND p.state IN ('pause_requested','paused','cancel_requested','cancelled')) AND NOT EXISTS(SELECT 1 FROM backoffice.office_task_dependencies dep JOIN backoffice.office_tasks child ON child.id=dep.dependency_task_id WHERE dep.task_id=t.id AND child.state NOT IN ('review_passed','completed')) ORDER BY t.priority DESC,d.available_at,d.created_at FOR UPDATE OF d SKIP LOCKED LIMIT 1`;
      if (!dispatch) return null;
      const current = await task(tx, dispatch.task_id, dispatch.workspace_id);
      const agentId = (dispatch.reviewer_id ?? current.agent_id) as AgentId;
      const [profile] = await tx`SELECT * FROM backoffice.office_agents WHERE id=${agentId} AND enabled`;
      if (!profile) return null;
      const [liveAttempt] = current.mode === 'live' ? await tx`SELECT id FROM backoffice.office_runs WHERE task_id=${current.parent_task_id ?? current.id} AND step IN ('delegate_internal_live','live_owner_attempt','resume_internal_dependencies') ORDER BY started_at DESC,id DESC LIMIT 1` : [];
      if (current.mode === 'live' && !liveAttempt) throw new OfficeError('CONFIGURATION_REQUIRED', 'The proposal has no durable live attempt.');
      const runId = randomUUID();
      await tx`INSERT INTO backoffice.office_runs(id,workspace_id,task_id,agent_id,profile_version,policy_version,attempt,state,step,predecessor_run_id,checkpoint,live_attempt_id) VALUES(${runId},${current.workspace_id},${current.id},${agentId},${profile.profile_version},${profile.policy_version},${dispatch.attempt + 1},'starting',${dispatch.step},${dispatch.run_id},${tx.json(dispatch.checkpoint)},${liveAttempt?.id ?? null})`;
      const [leased] = await tx`UPDATE backoffice.office_dispatch SET state='leased',attempt=attempt+1,lease_owner=${workerId},lease_token=lease_token+1,lease_until=now()+(${leaseSeconds}*interval '1 second'),run_id=${runId} WHERE id=${dispatch.id} RETURNING lease_token,lease_until`;
      await tx`UPDATE backoffice.office_runs SET state='running' WHERE id=${runId}`;
      if (current.state === 'blocked') await transition(tx, current, 'queued', 'task_queued', workerId, {}, runId);
      if (current.state === 'queued') await transition(tx, current, 'assigned', 'task_assigned', workerId, { agentName: profile.name }, runId);
      if (current.state === 'assigned') await transition(tx, current, 'in_progress', 'work_started', workerId, { agentName: profile.name }, runId);
      if (['review','package_review'].includes(dispatch.step) && current.state === 'in_progress') await transition(tx, current, 'waiting_for_review', 'review_requested', workerId, { reviewerName: profile.name }, runId);
      return { dispatchId: dispatch.id, taskId: current.id, workspaceId: current.workspace_id, runId, workerId, token: String(leased.lease_token), step: dispatch.step, agentId, leaseUntil: iso(leased.lease_until) };
    });
  }
  async function assertLease(tx: Connection, lease: OfficeLease) {
    const [row] = await tx`SELECT * FROM backoffice.office_dispatch WHERE id=${lease.dispatchId} AND workspace_id=${lease.workspaceId} AND task_id=${lease.taskId} AND run_id=${lease.runId} AND state='leased' AND lease_owner=${lease.workerId} AND lease_token=${lease.token} AND lease_until>now() FOR UPDATE`;
    if (!row) throw new OfficeError('LEASE_LOST', 'Worker lease expired or was replaced; result was fenced.');
    return row;
  }
  async function heartbeat(lease: OfficeLease) {
    const rows = await sql`UPDATE backoffice.office_dispatch SET lease_until=now()+(${leaseSeconds}*interval '1 second') WHERE id=${lease.dispatchId} AND state='leased' AND lease_owner=${lease.workerId} AND lease_token=${lease.token} AND run_id=${lease.runId} AND lease_until>now() RETURNING id`;
    if (!rows.length) throw new OfficeError('LEASE_LOST', 'Lease heartbeat rejected.');
    await workerHeartbeat(lease.workerId);
  }
  async function checkpoint(lease: OfficeLease, value: Record<string, JsonValue>) {
    if (Buffer.byteLength(canonicalJson(value)) > 16000) throw new OfficeError('INVALID_STATE', 'Checkpoint is too large.');
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`; await assertLease(tx, lease); await tx`UPDATE backoffice.office_dispatch SET checkpoint=${tx.json(value)} WHERE id=${lease.dispatchId}`; await tx`UPDATE backoffice.office_runs SET checkpoint=${tx.json(value)} WHERE id=${lease.runId}`; });
  }
  async function saveArtifact(tx: Connection, current: DbTask, author: AgentId, draft: { title: string; content: string; manifest: JsonValue; artifactHash: string }, runId: string | null) {
    if (Buffer.byteLength(draft.content) > 200000 || digest(draft.content) !== draft.artifactHash) throw new OfficeError('INVALID_STATE', 'Invalid artifact size or digest.');
    const [revision] = await tx`SELECT COALESCE(max(revision),0)+1 AS n FROM backoffice.office_artifacts WHERE task_id=${current.id}`;
    const [artifact] = await tx`INSERT INTO backoffice.office_artifacts(workspace_id,task_id,author_agent_id,producer_run_id,title,revision,content,manifest,artifact_hash,size_bytes) VALUES(${current.workspace_id},${current.id},${author},${runId},${draft.title},${revision.n},${draft.content},${tx.json(draft.manifest)},${draft.artifactHash},${Buffer.byteLength(draft.content)}) RETURNING id,revision`;
    await tx`UPDATE backoffice.office_tasks SET current_artifact_id=${artifact.id},version=version+1,updated_at=now() WHERE id=${current.id}`;
    await tx`UPDATE backoffice.office_reviews SET state='superseded' WHERE task_id=${current.id} AND state<>'superseded'`;
    await tx`UPDATE backoffice.office_approvals SET state='superseded',version=version+1 WHERE task_id=${current.id} AND state IN ('proposed','pending')`;
    await tx`UPDATE backoffice.office_handoffs SET state='superseded' WHERE task_id=${current.id} AND state NOT IN ('cancelled','superseded')`;
    await tx`UPDATE backoffice.office_dispatch SET state='cancelled',lease_token=lease_token+1 WHERE task_id=${current.id} AND step IN ('review','package_review') AND (state='pending' OR (state='leased' AND lease_until<now()))`;
    await invalidateParentPackage(tx, current, author);
    current.current_artifact_id = artifact.id;
    await emit(tx, current.workspace_id, current.id, 'artifact_created', author, { artifactTitle: draft.title, revisionLabel: `R${artifact.revision}`, artifactId: artifact.id, artifactHash: draft.artifactHash }, runId, 'agent');
    return artifact;
  }
  async function prepareReview(tx: Connection, current: DbTask, author: AgentId, artifactId: string, hash: string, runId: string | null) {
    const reviewer = reviewers[author];
    await tx`INSERT INTO backoffice.office_reviews(workspace_id,task_id,artifact_id,artifact_hash,reviewer_id,state,criteria) VALUES(${current.workspace_id},${current.id},${artifactId},${hash},${reviewer},'pending','["current_digest_matches","independent_reviewer","limitations_visible"]'::jsonb)`;
    await tx`INSERT INTO backoffice.office_handoffs(workspace_id,task_id,artifact_id,from_agent_id,to_agent_id,artifact_hash,expected_output,state) VALUES(${current.workspace_id},${current.id},${artifactId},${author},${reviewer},${hash},'Independent structural review of exact simulated artifact; real-world checks remain unverified','awaiting_acceptance')`;
    await transition(tx, current, 'waiting_for_review', 'review_requested', author, { reviewerName: OFFICE_AGENTS.find(agent => agent.agentId === reviewer)?.displayName ?? reviewer, revisionLabel: artifactId }, runId, 'agent');
    await enqueue(tx, current, current.parent_task_id ? 'review' : 'package_review', reviewer, artifactId);
  }
  async function packageComponents(current: DbTask) {
    const components = await sql`SELECT t.id AS child_id,t.current_artifact_id,a.artifact_hash,array_agg(r.id ORDER BY r.created_at,r.id) AS review_ids FROM backoffice.office_task_dependencies dep JOIN backoffice.office_tasks t ON t.id=dep.dependency_task_id JOIN backoffice.office_artifacts a ON a.id=t.current_artifact_id JOIN backoffice.office_reviews r ON r.artifact_id=a.id AND r.state='passed' AND r.artifact_hash=a.artifact_hash WHERE dep.task_id=${current.id} AND dep.workspace_id=${current.workspace_id} AND t.state='review_passed' GROUP BY t.id,t.current_artifact_id,a.artifact_hash ORDER BY t.agent_id`;
    const manifest = components.map(row => ({ childTaskId: row.child_id, artifactId: row.current_artifact_id, revisionId: row.current_artifact_id, artifactHash: row.artifact_hash, hashAlgorithm: 'SHA-256', reviewReferences: row.review_ids }));
    return { components, manifest };
  }
  async function exactPackageComponents(inspected: OfficeArtifact): Promise<PackageComponent[]> {
    const invalid = () => new LiveOutputError('missing_package_components');
    if (!Array.isArray(inspected.manifest) || inspected.manifest.length !== OFFICE_AGENTS.length) throw invalid();
    const components: PackageComponent[] = [];
    const seen = new Set<string>();
    for (const value of inspected.manifest) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
      const item = value as Record<string, JsonValue>;
      if (typeof item.artifactId !== 'string' || typeof item.childTaskId !== 'string' || item.revisionId !== item.artifactId || item.hashAlgorithm !== 'SHA-256' || typeof item.artifactHash !== 'string' || !Array.isArray(item.reviewReferences) || !item.reviewReferences.length || !item.reviewReferences.every(id => typeof id === 'string')) throw invalid();
      const [row] = await sql`SELECT a.*,t.parent_task_id,t.agent_id,t.current_artifact_id FROM backoffice.office_artifacts a JOIN backoffice.office_tasks t ON t.id=a.task_id AND t.workspace_id=a.workspace_id WHERE a.id=${item.artifactId} AND a.task_id=${item.childTaskId} AND a.workspace_id=${inspected.workspaceId}`;
      if (!row || row.parent_task_id !== inspected.taskId || row.current_artifact_id !== row.id || row.author_agent_id !== row.agent_id || row.artifact_hash !== item.artifactHash || digest(row.content) !== item.artifactHash || seen.has(row.author_agent_id)) throw invalid();
      const reviews = await sql`SELECT id FROM backoffice.office_reviews WHERE id IN ${sql(item.reviewReferences as string[])} AND artifact_id=${row.id} AND artifact_hash=${item.artifactHash} AND state='passed' AND reviewer_id<>${row.author_agent_id}`;
      if (new Set(reviews.map(review => review.id)).size !== new Set(item.reviewReferences).size) throw invalid();
      seen.add(row.author_agent_id);
      components.push({ agentId: row.author_agent_id as AgentId, title: row.title, revision: row.revision, content: row.content });
    }
    return components;
  }
  async function currentArtifact(current: DbTask) {
    if (!current.current_artifact_id) throw new OfficeError('INVALID_STATE', 'No current artifact to review.');
    return artifact(current.workspace_id, current.current_artifact_id);
  }
  async function execute(lease: OfficeLease): Promise<StepResult> {
    // Read scoped source data then compute outside a transaction.
    const current = await task(sql, lease.taskId, lease.workspaceId, false);
    if (current.mode === 'live') return executeLive(lease, current);
    // The deterministic demo adapter has no network or external effects.
    let draft: Draft | null = null;
    let review: { inspected: OfficeArtifact; result: ReviewResult } | null = null;
    if (lease.step === 'draft') draft = createDemoDraft(current.agent_id, current.brief, current.id);
    if (lease.step === 'package') draft = createDemoPackage(current.brief, (await packageComponents(current)).manifest);
    if (lease.step === 'review' || lease.step === 'package_review') {
      const inspected = await currentArtifact(current);
      review = { inspected, result: reviewDemoArtifact(inspected.authorAgentId, lease.agentId, inspected.content, inspected.artifactHash) };
    }
    return commitStep(lease, 'demo', { draft, review });
  }
  // Commits one step's computed result under the current lease, exactly as for every adapter.
  async function commitStep(lease: OfficeLease, mode: OfficeMode, work: { draft: Draft | null; review: { inspected: OfficeArtifact; result: ReviewResult } | null }): Promise<StepResult> {
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      await assertLease(tx, lease);
      const locked = await task(tx, lease.taskId, lease.workspaceId);
      if (locked.state === 'pause_requested' || locked.state === 'cancel_requested') {
        const cancelled = locked.state === 'cancel_requested';
        await settleOpenReservation(tx,lease.runId);
        await tx`UPDATE backoffice.office_runs SET state=${cancelled ? 'cancelled' : 'paused'},finished_at=now() WHERE id=${lease.runId}`;
        await tx`UPDATE backoffice.office_dispatch SET state=${cancelled ? 'cancelled' : 'pending'},lease_until=NULL,lease_owner=NULL,lease_token=lease_token+1 WHERE id=${lease.dispatchId}`;
        await transition(tx, locked, cancelled ? 'cancelled' : 'paused', cancelled ? 'task_cancelled' : 'work_paused', lease.workerId, {}, lease.runId);
        await settleParentStop(tx, locked, lease.workerId);
        return { outcome: 'stopped' as const };
      }
      if (!work.draft && !work.review) throw new OfficeError('INVALID_STATE', 'The step produced nothing to commit.');
      const [grant] = await tx`SELECT 1 FROM backoffice.office_workspace_grants g JOIN backoffice.office_agents a ON a.id=g.agent_id WHERE g.workspace_id=${locked.workspace_id} AND g.agent_id=${lease.agentId} AND a.enabled`;
      await owner(tx, locked.initiating_owner_id);
      if (!grant || locked.mode !== mode) throw new OfficeError('FORBIDDEN', 'Run scope, agent grant or mode changed.');
      const unresolved = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE task_id=${locked.id} AND state IN ('reserved','unknown_outcome') LIMIT 1`;
      if (unresolved.length) throw new OfficeError('INVALID_STATE', 'Unresolved tool outcome must be reconciled before continuing.');
      await tx`INSERT INTO backoffice.office_run_steps(workspace_id,run_id,operation_key,arguments_hash,state) VALUES(${locked.workspace_id},${lease.runId},${`${lease.taskId}:${lease.step}`},${digest(canonicalJson({ brief: locked.brief, artifactId: locked.current_artifact_id }))},'running')`;
      if (work.draft) {
        if (locked.state !== 'in_progress') throw new OfficeError('INVALID_STATE', 'Draft task is no longer running.');
        const saved = await saveArtifact(tx, locked, locked.agent_id, work.draft, lease.runId);
        await prepareReview(tx, locked, locked.agent_id, saved.id, work.draft.artifactHash, lease.runId);
      } else if (work.review) {
        const { inspected, result } = work.review;
        if (locked.current_artifact_id !== inspected.id || locked.state !== 'waiting_for_review') throw new OfficeError('CONFLICT', 'Artifact changed while review was running.');
        await tx`UPDATE backoffice.office_handoffs SET state='accepted' WHERE task_id=${locked.id} AND artifact_id=${inspected.id} AND to_agent_id=${lease.agentId} AND state='awaiting_acceptance'`;
        await emit(tx, locked.workspace_id, locked.id, 'handoff_accepted', lease.agentId, { recipientName: lease.agentId }, lease.runId, 'agent');
        const reviewed = await tx`UPDATE backoffice.office_reviews SET state=${result.passed ? 'passed' : 'changes_requested'},criteria=${tx.json(result.criteria)},evidence=${tx.json(result.evidence)},findings=${tx.json(result.findings)},decided_at=now() WHERE task_id=${locked.id} AND artifact_id=${inspected.id} AND artifact_hash=${inspected.artifactHash} AND reviewer_id=${lease.agentId} AND state='pending' RETURNING id`;
        if (!reviewed.length) throw new OfficeError('CONFLICT', 'Current independent review was not found.');
        const findingCount = result.passed ? 0 : mode === 'live' && Array.isArray(result.findings) ? Math.max(1, result.findings.length) : 1;
        await transition(tx, locked, result.passed ? 'review_passed' : 'changes_requested', result.passed ? 'review_passed' : 'review_changes_requested', lease.agentId, { revisionLabel: `R${inspected.revision}`, findingCount }, lease.runId, 'agent');
        if (result.passed && !locked.parent_task_id) {
          await tx`INSERT INTO backoffice.office_approvals(workspace_id,task_id,artifact_id,artifact_hash,action_scope,state,expires_at) VALUES(${locked.workspace_id},${locked.id},${inspected.id},${inspected.artifactHash},'accept_internal_proposal_package','pending',now()+interval '7 days') ON CONFLICT(artifact_id,action_scope) WHERE state IN ('proposed','pending') DO NOTHING`;
          await transition(tx, locked, 'waiting_for_owner_approval', 'owner_approval_requested', lease.agentId, { revisionLabel: `R${inspected.revision}`, actionScope: 'accept_internal_proposal_package' }, lease.runId, 'agent');
        }
      }
      await tx`UPDATE backoffice.office_run_steps SET state='succeeded',result=${tx.json({ adapter: mode === 'live' ? 'openai_responses' : 'deterministic_demo', externalEffects: false })} WHERE run_id=${lease.runId}`;
      await settleOpenReservation(tx,lease.runId);
      await tx`UPDATE backoffice.office_runs SET state='succeeded',finished_at=now(),checkpoint='{"committed":true}'::jsonb WHERE id=${lease.runId}`;
      await tx`UPDATE backoffice.office_dispatch SET state='done',lease_until=NULL,lease_owner=NULL,checkpoint='{"committed":true}'::jsonb WHERE id=${lease.dispatchId}`;
      return { outcome: 'committed' as const };
    });
  }
  // The latest revision, reviewer findings and owner note when a live step redrafts existing work.
  async function revisionContext(current: DbTask): Promise<DraftRevisionContext | null> {
    if (!current.current_artifact_id) return null;
    const [previous] = await sql`SELECT title,content FROM backoffice.office_artifacts WHERE id=${current.current_artifact_id} AND workspace_id=${current.workspace_id}`;
    const [review] = await sql`SELECT findings FROM backoffice.office_reviews WHERE artifact_id=${current.current_artifact_id} AND workspace_id=${current.workspace_id} AND decided_at IS NOT NULL ORDER BY decided_at DESC LIMIT 1`;
    const [note] = await sql`SELECT payload FROM backoffice.office_events WHERE task_id=${current.id} AND workspace_id=${current.workspace_id} AND actor_type='owner' AND (payload ? 'feedback' OR payload ? 'recoveryDecision') ORDER BY sequence DESC LIMIT 1`;
    const feedback = note?.payload?.feedback ?? note?.payload?.recoveryDecision;
    return { previousTitle: previous?.title ?? '', previousContent: previous?.content ?? '', reviewerFindings: findingMessages(review?.findings ?? []), ownerFeedback: typeof feedback === 'string' ? feedback : null };
  }
  function structuralFindings(inspected: OfficeArtifact, reviewer: AgentId): JsonValue[] {
    const findings: JsonValue[] = [];
    if (inspected.authorAgentId === reviewer) findings.push({ severity: 'error', message: 'Author cannot review own artifact.' });
    if (digest(inspected.content) !== inspected.artifactHash) findings.push({ severity: 'error', message: 'Stored artifact digest does not match content.' });
    return findings;
  }
  type LiveAdmission = { status: 'ready'; current: DbTask; run: postgres.Row; budget: postgres.Row; remainingMs: number } | { status: 'stopped' } | { status: 'denied'; code: string; reason: string };
  async function liveAdmission(tx: Connection, lease: OfficeLease): Promise<LiveAdmission> {
    await assertLease(tx, lease);
    const current = await task(tx, lease.taskId, lease.workspaceId);
    await owner(tx, current.initiating_owner_id);
    if (['pause_requested','cancel_requested','paused','cancelled'].includes(current.state)) return { status: 'stopped' };
    if (current.mode !== 'live' || !['in_progress','waiting_for_review'].includes(current.state)) throw new OfficeError('FORBIDDEN', 'This task is not authorized for live execution.');
    const [grant] = await tx`SELECT 1 FROM backoffice.office_workspace_grants g JOIN backoffice.office_agents a ON a.id=g.agent_id WHERE g.workspace_id=${current.workspace_id} AND g.agent_id=${lease.agentId} AND a.enabled AND g.data_scopes ? 'internal_draft'`;
    if (!grant) throw new OfficeError('FORBIDDEN', 'The live agent is disabled or its workspace grant was revoked.');
    const [run] = await tx`SELECT r.*,extract(epoch FROM (now()-a.started_at))*1000 AS attempt_age_ms FROM backoffice.office_runs r LEFT JOIN backoffice.office_runs a ON a.id=r.live_attempt_id WHERE r.id=${lease.runId} FOR UPDATE OF r`;
    const deny = (code: string, reason: string): LiveAdmission => ({ status: 'denied', code, reason });
    if (!run?.live_attempt_id || run.attempt_age_ms === null || Number(run.attempt_age_ms) >= PROPOSAL_ATTEMPT_MS) return deny('proposal_attempt_expired', 'proposal_attempt_expired: the ten-minute live attempt ended; an explicit owner recovery decision is required');
    const [unresolved] = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE tool_name=${MODEL_OPERATION} AND state IN ('reserved','unknown_outcome') AND run_id<>${lease.runId} LIMIT 1`;
    if (unresolved) return deny('model_reconciliation_required', 'model_reconciliation_required: reconcile the outstanding OpenAI request before any further live request');
    const [budget] = await tx`SELECT * FROM backoffice.office_budget WHERE id=1 FOR UPDATE`;
    if (!budget?.live_enabled || ![budget.limit_microunits,budget.monthly_limit_microunits,budget.family_limit_microunits,budget.request_limit_microunits].every(value => Number(value) > 0)) return deny('live_disabled', 'configuration_required: live execution is switched off or its spending limits are unset');
    const [calls] = await tx`SELECT count(*)::int AS n FROM backoffice.office_runs WHERE live_attempt_id=${run.live_attempt_id} AND provider_dispatched_at IS NOT NULL`;
    if (calls.n >= ATTEMPT_CALL_CEILING) return deny('attempt_call_ceiling', 'attempt_call_ceiling: this attempt dispatched sixteen model requests; owner recovery is required');
    return { status: 'ready', current, run, budget, remainingMs: Math.max(1, Math.floor(PROPOSAL_ATTEMPT_MS - Number(run.attempt_age_ms))) };
  }
  // One live step: count input exactly, reserve the worst-case charge under every limit, make one
  // provider request without automatic retries, settle what it cost, then commit through commitStep.
  async function executeLive(lease: OfficeLease, current: DbTask): Promise<StepResult> {
    const live = options.live;
    if (!live) throw new OfficeError('CONFIGURATION_REQUIRED', 'This worker has no live provider.');
    const admission = await sql.begin(async tx => { await tx`SELECT pg_advisory_xact_lock(68421202)`; return liveAdmission(tx, lease); });
    if (admission.status === 'stopped') return commitStep(lease, 'live', { draft: null, review: null });
    if (admission.status === 'denied') return failLive(lease, admission.code, { exhausted: true, blockedReason: admission.reason });
    const step = lease.step as LiveStep;
    const [profile] = await sql`SELECT p.brief,p.version FROM backoffice.office_runs r JOIN backoffice.office_agent_profiles p ON p.agent_id=r.agent_id AND p.version=r.profile_version WHERE r.id=${lease.runId}`;
    if (!profile) throw new OfficeError('CONFIGURATION_REQUIRED', 'The reviewed role profile for this run is missing.');
    const base = { ids: { workspaceId: current.workspace_id, taskId: current.id, runId: lease.runId, step, agentId: lease.agentId }, settings: live.settings, profileBrief: profile.brief as string, profileVersion: Number(profile.version), goal: current.goal, brief: current.brief };
    let modelCall: LiveModelCall;
    let inspected: OfficeArtifact | null = null;
    let manifest: JsonValue = [];
    try {
    if (step === 'draft') modelCall = buildDraftCall({ ...base, revision: await revisionContext(current) });
    else if (step === 'package') {
      const parts = await packageComponents(current);
      manifest = parts.manifest;
      const components = await exactPackageComponents({ taskId: current.id, workspaceId: current.workspace_id, manifest } as OfficeArtifact);
      modelCall = buildPackageCall({ ...base, components, revision: await revisionContext(current) });
    } else {
      inspected = await currentArtifact(current);
      const findings = structuralFindings(inspected, lease.agentId);
      // A structurally invalid revision is rejected without spending a model request.
      if (findings.length) return commitStep(lease, 'live', { draft: null, review: { inspected, result: { passed: false, criteria: ['current_digest_matches', 'independent_reviewer'], evidence: [{ claim: 'Structural checks before any model review', observedResult: 'changes_requested', artifactHash: inspected.artifactHash }], findings } } });
      const components = step === 'package_review' ? await exactPackageComponents(inspected) : undefined;
      modelCall = buildReviewCall({ ...base, authorId: inspected.authorAgentId, artifactTitle: inspected.title, artifactContent: inspected.content, packageReview: step === 'package_review', components });
    }
    } catch (error) {
      if (error instanceof LiveOutputError) return failLive(lease, error.code, { exhausted: true, blockedReason: `source_evidence_invalid: ${error.code}; inspect the exact reviewed component records` });
      throw error;
    }
    const countAdmission = await sql.begin(async tx => { await tx`SELECT pg_advisory_xact_lock(68421202)`; return liveAdmission(tx, lease); });
    if (countAdmission.status === 'stopped') return commitStep(lease, 'live', { draft: null, review: null });
    if (countAdmission.status === 'denied') return failLive(lease, countAdmission.code, { exhausted: true, blockedReason: countAdmission.reason });
    const counted = await live.provider.countInputTokens({ ...modelCall, timeoutMs: Math.min(90000, countAdmission.remainingMs) });
    if (!counted.ok) return failLive(lease, counted.code, counted.configuration ? { exhausted: true, blockedReason: `configuration_required: OpenAI rejected the token count (${counted.code}); check the Office API key, project and billing` } : {});
    if (counted.inputTokens > Math.min(MAX_INPUT_TOKENS, SHORT_CONTEXT_MAX_INPUT_TOKENS)) return failLive(lease, 'input_too_large', { exhausted: true, blockedReason: `input_too_large: this request needs ${counted.inputTokens} input tokens, above the ${MAX_INPUT_TOKENS}-token request bound; shorten the brief` });
    // A small cushion covers formatting tokens the count may not reflect exactly.
    const reservedMicrounits = reservationMicrounits(modelCall.model, Math.ceil(counted.inputTokens * 1.02) + 64, modelCall.maxOutputTokens);
    const reservation = await reserveLive(lease, modelCall.model, reservedMicrounits);
    if (reservation.status === 'stopped') return commitStep(lease, 'live', { draft: null, review: null });
    if (reservation.status === 'denied') return failLive(lease, reservation.code, { exhausted: true, blockedReason: reservation.reason });
    const outcome = await live.provider.create({ ...modelCall, timeoutMs: Math.min(90000, reservation.remainingMs) });
    const charge = chargeFor(outcome, modelCall.model, reservedMicrounits, counted.inputTokens, modelCall.maxOutputTokens);
    await settleLive(lease, charge);
    const metered: Partial<StepResult> = { model: modelCall.model, chargedMicrounits: charge.uncertain ? undefined : charge.microunits, inputTokens: charge.usage?.inputTokens, outputTokens: charge.usage?.outputTokens };
    if (outcome.kind === 'rejected') return failLive(lease, outcome.code, outcome.configuration
      ? { exhausted: true, blockedReason: `configuration_required: OpenAI rejected the request (${outcome.code}); check the Office API key, project and billing` }
      : outcome.retryable ? { retryAfterMs: outcome.retryAfterMs } : { exhausted: true, blockedReason: `request_rejected: ${outcome.code}` }, metered);
    if (outcome.kind === 'unknown' || charge.uncertain) return failLive(lease, outcome.kind === 'unknown' ? outcome.code : 'usage_unpriceable', { exhausted: true, blockedReason: 'model_reconciliation_required: the OpenAI outcome or its price is unknown; its reservation is retained and all live requests are held for an explicit owner reconciliation' }, metered);
    if (charge.exceeded) return failLive(lease, 'usage_exceeds_reservation', { exhausted: true, blockedReason: 'usage_exceeds_reservation: the reported usage prices above the reservation; reconcile with the OpenAI usage page before retrying' }, metered);
    const [attempt] = await sql`SELECT extract(epoch FROM (now()-a.started_at))*1000 AS age_ms FROM backoffice.office_runs r JOIN backoffice.office_runs a ON a.id=r.live_attempt_id WHERE r.id=${lease.runId}`;
    if (!attempt || Number(attempt.age_ms) >= PROPOSAL_ATTEMPT_MS) return failLive(lease, 'proposal_attempt_expired', { exhausted: true, blockedReason: 'proposal_attempt_expired: the ten-minute live attempt ended; the charged late output was discarded and owner recovery is required' }, metered);
    if (outcome.kind === 'unusable') return failLive(lease, outcome.code, { exhausted: true, blockedReason: `model_output_unusable: ${outcome.code}; retry or revise after checking the brief` }, metered);
    let draft: Draft | null = null;
    let review: ReviewResult | null = null;
    try {
      if (step === 'draft') draft = renderDraft(current.agent_id, outcome.output, modelCall.model);
      else if (step === 'package') draft = renderPackage(outcome.output, manifest, modelCall.model);
      else review = interpretReview(outcome.output, step === 'package_review', inspected!.artifactHash, modelCall.model);
    } catch (error) {
      if (error instanceof LiveOutputError) return failLive(lease, error.code, { exhausted: true, blockedReason: `model_output_unusable: ${error.code}; retry or revise after checking the brief` }, metered);
      throw error;
    }
    return { ...(await commitStep(lease, 'live', { draft, review: review && inspected ? { inspected, result: review } : null })), ...metered };
  }
  // Rejected requests were not processed, so they release their reservation. A missing or
  // unreadable response may still be billed, so it keeps the whole reservation.
  function chargeFor(outcome: CallOutcome, model: string, reserved: number, inputBound: number, outputBound: number) {
    if (outcome.kind === 'rejected') return { microunits: 0, exceeded: false, uncertain: false, usage: null, providerRequestId: outcome.requestId };
    if (outcome.kind === 'unknown' || !outcome.usage) return { microunits: reserved, exceeded: false, uncertain: true, usage: null, providerRequestId: outcome.requestId };
    let priced: number;
    try { priced = usageMicrounits(model, outcome.usage, outcome.serviceTier); }
    catch { return { microunits: reserved, exceeded: false, uncertain: true, usage: null, providerRequestId: outcome.responseId ?? outcome.requestId }; }
    return { microunits: priced, exceeded: priced > reserved || outcome.usage.inputTokens > Math.min(MAX_INPUT_TOKENS, Math.ceil(inputBound * 1.02) + 64) || outcome.usage.outputTokens > outputBound, uncertain: false, usage: outcome.usage, providerRequestId: outcome.responseId ?? outcome.requestId };
  }
  async function reserveLive(lease: OfficeLease, model: string, amount: number): Promise<{ status: 'reserved'; remainingMs: number } | { status: 'stopped' } | { status: 'denied'; code: string; reason: string }> {
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      const admission = await liveAdmission(tx, lease);
      if (admission.status !== 'ready') return admission;
      const { current, run, budget } = admission;
      if (run.usage_microunits !== null || Number(run.budget_reserved_microunits) > 0 || run.provider_dispatched_at) throw new OfficeError('CONFLICT', 'This run already dispatched a model request; another attempt needs a new run.');
      const value = (column: string) => Number(budget[column]);
      const deny = (code: string, reason: string) => ({ status: 'denied' as const, code, reason });
      if (!budget.live_enabled) return deny('live_disabled', 'configuration_required: live execution is switched off');
      if (amount > value('request_limit_microunits')) return deny('request_limit', `request_limit: this request could cost up to ${formatUsd(amount)}, above the ${formatUsd(value('request_limit_microunits'))} per-request limit`);
      const root = current.parent_task_id ?? current.id;
      const [family] = await tx`SELECT COALESCE(sum(COALESCE(r.usage_microunits,r.budget_reserved_microunits)),0)::bigint AS used, count(*) FILTER (WHERE r.provider_dispatched_at IS NOT NULL)::int AS calls FROM backoffice.office_runs r JOIN backoffice.office_tasks t ON t.id=r.task_id WHERE (t.id=${root} OR t.parent_task_id=${root}) AND r.budget_reserved_microunits>0`;
      const familyUsed = Number(family.used);
      if (familyUsed + amount > value('family_limit_microunits')) return deny('family_limit', `family_limit: this proposal has used ${formatUsd(familyUsed)} and the next request could reach ${formatUsd(familyUsed + amount)}, above the ${formatUsd(value('family_limit_microunits'))} per-proposal limit`);
      if (family.calls >= FAMILY_CALL_CEILING) return deny('family_call_ceiling', `family_call_ceiling: this proposal already dispatched ${family.calls} model requests`);
      const [month] = await tx`SELECT COALESCE(sum(COALESCE(usage_microunits,budget_reserved_microunits)),0)::bigint AS used FROM backoffice.office_runs WHERE budget_reserved_microunits>0 AND (usage_microunits IS NULL OR provider_dispatched_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;
      const monthUsed = Number(month.used);
      if (monthUsed + amount > value('monthly_limit_microunits')) return deny('monthly_limit', `monthly_limit: ${formatUsd(monthUsed)} is used this month (UTC) and the next request could reach ${formatUsd(monthUsed + amount)}, above the ${formatUsd(value('monthly_limit_microunits'))} monthly limit`);
      const lifetimeUsed = value('reserved_microunits') + value('spent_microunits');
      if (lifetimeUsed + amount > value('limit_microunits')) return deny('lifetime_limit', `lifetime_limit: ${formatUsd(lifetimeUsed)} is used or reserved and the next request could reach ${formatUsd(lifetimeUsed + amount)}, above the ${formatUsd(value('limit_microunits'))} overall limit`);
      await tx`UPDATE backoffice.office_budget SET reserved_microunits=reserved_microunits+${amount} WHERE id=1`;
      await tx`UPDATE backoffice.office_runs SET budget_reserved_microunits=${amount},model=${model},provider_dispatched_at=now() WHERE id=${lease.runId}`;
      const operationKey = `openai:${lease.runId}`;
      await tx`INSERT INTO backoffice.office_tool_operations(workspace_id,task_id,run_id,operation_key,arguments_hash,tool_name,state,provider_idempotency_key) VALUES(${current.workspace_id},${current.id},${lease.runId},${operationKey},${digest(operationKey)},${MODEL_OPERATION},'reserved',${digest(operationKey)})`;
      return { status: 'reserved' as const, remainingMs: admission.remainingMs };
    });
  }
  // Recording a known charge does not need the lease: it settles only this run's own reservation,
  // once. A run already closed by lease recovery was charged its full reservation there.
  async function settleLive(lease: OfficeLease, charge: { microunits: number; usage: TokenUsage | null; providerRequestId: string | null; uncertain: boolean; exceeded: boolean }) {
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      const [run] = await tx`SELECT * FROM backoffice.office_runs WHERE id=${lease.runId} AND workspace_id=${lease.workspaceId} FOR UPDATE`;
      if (!run || run.usage_microunits !== null || ['succeeded','failed','interrupted','cancelled'].includes(run.state)) return;
      const reserved = Number(run.budget_reserved_microunits);
      if (charge.uncertain) {
        await markModelUncertain(tx, lease.runId, 'OpenAI outcome or billing usage is unknown; owner reconciliation is required.');
        return;
      }
      const charged = charge.microunits;
      await tx`UPDATE backoffice.office_budget SET reserved_microunits=reserved_microunits-${reserved},spent_microunits=spent_microunits+${charged} WHERE id=1`;
      await tx`UPDATE backoffice.office_runs SET usage_microunits=${charged},provider_request_id=${charge.providerRequestId},token_usage=${charge.usage ? tx.json(charge.usage) : null} WHERE id=${lease.runId}`;
      await tx`UPDATE backoffice.office_tool_operations SET state=${charge.exceeded ? 'unknown_outcome' : charged ? 'succeeded' : 'failed'},provider_reference=${charge.providerRequestId},result=${tx.json({ chargedMicrounits: charged, reservationMicrounits: reserved, reason: charge.exceeded ? 'Reported usage exceeded its reservation or token bounds; owner reconciliation required.' : 'Known provider usage settled.' })},updated_at=now() WHERE run_id=${lease.runId} AND tool_name=${MODEL_OPERATION} AND state='reserved'`;
    });
  }
  async function failLive(lease: OfficeLease, code: string, failOptions: FailOptions, metered: Partial<StepResult> = {}): Promise<StepResult> {
    await fail(lease, code, failOptions);
    return { outcome: 'failed', code, ...metered };
  }
  async function fail(lease: OfficeLease, code = 'adapter_error', failOptions: FailOptions = {}) {
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      const dispatch = await assertLease(tx, lease);
      const current = await task(tx, lease.taskId, lease.workspaceId);
      const safeCode = /^[a-z0-9_.-]{1,80}$/.test(code) ? code : 'adapter_error';
      await settleOpenReservation(tx,lease.runId);
      const unresolved = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE task_id=${current.id} AND state IN ('reserved','unknown_outcome') LIMIT 1`;
      const [modelUncertain] = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE run_id=${lease.runId} AND tool_name=${MODEL_OPERATION} AND state='unknown_outcome'`;
      const [run] = await tx`SELECT usage_microunits FROM backoffice.office_runs WHERE id=${lease.runId}`;
      const awaitingBilling = !!modelUncertain && run.usage_microunits === null;
      await tx`UPDATE backoffice.office_runs SET state=${awaitingBilling ? 'waiting_for_tool' : 'failed'},error_code=${safeCode},finished_at=${awaitingBilling ? null : tx`now()`} WHERE id=${lease.runId}`;
      const exhausted = failOptions.exhausted === true || dispatch.attempt >= dispatch.max_attempts || unresolved.length > 0;
      const delaySeconds = Math.max(Math.min(60, 2 ** dispatch.attempt), Math.ceil((failOptions.retryAfterMs ?? 0) / 1000));
      await tx`UPDATE backoffice.office_dispatch SET state=${exhausted ? 'exhausted' : 'pending'},lease_until=NULL,lease_owner=NULL,lease_token=lease_token+1,last_error=${safeCode},available_at=now()+(${delaySeconds}*interval '1 second') WHERE id=${lease.dispatchId}`;
      await emit(tx, current.workspace_id, current.id, 'run_failed', lease.workerId, { stepName: lease.step, errorCode: safeCode }, lease.runId);
      if (!unresolved.length && ['pause_requested','cancel_requested'].includes(current.state)) {
        const cancelling = current.state === 'cancel_requested';
        await transition(tx, current, cancelling ? 'cancelled' : 'paused', cancelling ? 'task_cancelled' : 'work_paused', lease.workerId, {}, lease.runId);
        await settleParentStop(tx, current, lease.workerId);
      }
      if (['in_progress','waiting_for_review'].includes(current.state)) {
        const reason = (failOptions.blockedReason ?? (exhausted ? 'retry_exhausted: owner recovery decision required' : 'Step failed; bounded retry pending')).slice(0, 500);
        await tx`UPDATE backoffice.office_tasks SET blocked_reason=${reason} WHERE id=${current.id}`;
        await transition(tx, current, 'blocked', 'work_blocked', lease.workerId, { dependencySummary: failOptions.blockedReason ? reason.slice(0, 300) : exhausted ? 'Retries exhausted.' : 'Retry pending.' }, lease.runId);
      }
      if (modelUncertain && current.parent_task_id) {
        const parent = await task(tx, current.parent_task_id, current.workspace_id);
        if (['in_progress','waiting_for_review'].includes(parent.state)) {
          await tx`UPDATE backoffice.office_tasks SET blocked_reason='model_reconciliation_required: reconcile the outstanding OpenAI request before any further live work' WHERE id=${parent.id}`;
          await transition(tx, parent, 'blocked', 'work_blocked', lease.workerId, { dependencySummary: 'OpenAI billing outcome requires explicit owner reconciliation.' });
        }
      }
    });
  }
  async function requestTaskAction(ownerId: string, raw: TaskActionInput) {
    const input = taskActionSchema.parse(raw);
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      await owner(tx, ownerId);
      const current = await task(tx, input.taskId, input.workspaceId);
      if (Number(current.version) !== input.version) throw new OfficeError('CONFLICT', 'Task changed; refresh before applying this action.');
      const related = await tx<DbTask[]>`SELECT t.*,w.scope_key,w.project_key FROM backoffice.office_tasks t JOIN backoffice.office_workspaces w ON w.id=t.workspace_id WHERE t.workspace_id=${input.workspaceId} AND (t.id=${input.taskId} OR t.parent_task_id=${input.taskId}) ORDER BY t.id FOR UPDATE OF t`;
      if (input.action === 'note') {
        if (!input.reason) throw new OfficeError('INVALID_STATE', 'An owner note must contain bounded text.');
        // Accepted task records stay immutable. Later owner notes are separate
        // append-only events; they cannot alter acceptance or the frozen version.
        if (current.state !== 'completed') await tx`UPDATE backoffice.office_tasks SET version=version+1,updated_at=now() WHERE id=${current.id}`;
        await emit(tx, current.workspace_id, current.id, 'task_note_added', ownerId, { note: input.reason }, null, 'owner');
      } else if (input.action === 'renew_approval') {
        if (current.state !== 'waiting_for_owner_approval' || !current.current_artifact_id) throw new OfficeError('INVALID_STATE', 'Only the current package awaiting owner decision can renew an expired approval.');
        const [saved] = await tx<DbArtifact[]>`SELECT * FROM backoffice.office_artifacts WHERE id=${current.current_artifact_id} AND workspace_id=${current.workspace_id}`;
        if (digest(saved.content) !== saved.artifact_hash) throw new OfficeError('CONFLICT', 'Current package digest differs.');
        await tx`UPDATE backoffice.office_approvals SET state='expired',version=version+1 WHERE task_id=${current.id} AND state='pending' AND expires_at<=now()`;
        const pending = await tx`SELECT id FROM backoffice.office_approvals WHERE task_id=${current.id} AND state IN ('proposed','pending')`;
        const expired = await tx`SELECT id FROM backoffice.office_approvals WHERE task_id=${current.id} AND artifact_id=${saved.id} AND state='expired'`;
        const reviews = await tx`SELECT id FROM backoffice.office_reviews WHERE artifact_id=${saved.id} AND state='passed' AND artifact_hash=${saved.artifact_hash} AND reviewer_id<>${saved.author_agent_id}`;
        const incomplete = await tx`SELECT 1 FROM backoffice.office_reviews WHERE artifact_id=${saved.id} AND state NOT IN ('passed','superseded')`;
        if (pending.length || !expired.length || !reviews.length || incomplete.length) throw new OfficeError('INVALID_STATE', 'Renewal requires a reviewed current package, expired request and no outstanding decision.');
        await tx`INSERT INTO backoffice.office_approvals(workspace_id,task_id,artifact_id,artifact_hash,action_scope,state,expires_at) VALUES(${current.workspace_id},${current.id},${saved.id},${saved.artifact_hash},'accept_internal_proposal_package','pending',now()+interval '7 days')`;
        await tx`UPDATE backoffice.office_tasks SET version=version+1,updated_at=now() WHERE id=${current.id}`;
        await emit(tx, current.workspace_id, current.id, 'owner_approval_requested', ownerId, { revisionLabel: `R${saved.revision}`, reason: 'Explicitly renewed expired internal decision; same exact current package.' }, null, 'owner');
      } else if (input.action === 'reassign' || input.action === 'reprioritize') {
        if (['completed','cancelled','pause_requested','cancel_requested','in_progress'].includes(current.state)) throw new OfficeError('INVALID_STATE', 'Pause current execution before changing assignment or priority.');
        if (input.action === 'reprioritize') {
          if (input.priority === undefined) throw new OfficeError('INVALID_STATE', 'An explicit priority is required.');
          await tx`UPDATE backoffice.office_tasks SET priority=${input.priority},version=version+1,updated_at=now() WHERE id=${current.id}`;
          await emit(tx, current.workspace_id, current.id, 'task_reprioritized', ownerId, { priority: input.priority }, null, 'owner');
        } else {
          if (!input.agentId || !['queued','assigned','paused'].includes(current.state) || current.current_artifact_id) throw new OfficeError('INVALID_STATE', 'Only an unstarted task can be reassigned; reviewed artifacts retain their author and handoff history.');
          const [grant] = await tx`SELECT 1 FROM backoffice.office_workspace_grants g JOIN backoffice.office_agents a ON a.id=g.agent_id WHERE g.workspace_id=${current.workspace_id} AND g.agent_id=${input.agentId} AND a.enabled`;
          if (!grant) throw new OfficeError('FORBIDDEN', 'Agent has no workspace grant.');
          await tx`UPDATE backoffice.office_tasks SET agent_id=${input.agentId},version=version+1,updated_at=now() WHERE id=${current.id}`;
          await emit(tx, current.workspace_id, current.id, 'task_reassigned', ownerId, { agentId: input.agentId }, null, 'owner');
        }
      } else if (input.action === 'redraft') {
        // A model revision of the current work, using its latest review findings and this owner note.
        if (current.mode !== 'live') throw new OfficeError('INVALID_STATE', 'Model revisions apply to live tasks; revise a demonstration draft directly.');
        if (!await liveConfigured(tx)) throw new OfficeError('CONFIGURATION_REQUIRED', 'Live execution is switched off or its spending limits are not set.');
        if (current.state !== 'changes_requested' || !current.current_artifact_id) throw new OfficeError('INVALID_STATE', 'Only work with requested changes can be redrafted.');
        if (current.revision_cycles >= 2) throw new OfficeError('INVALID_STATE', 'A task may be revised at most twice before an owner recovery review.');
        const active = await tx`SELECT 1 FROM backoffice.office_dispatch WHERE task_id=${current.id} AND state='leased' AND lease_until>now()`;
        if (active.length) throw new OfficeError('CONFLICT', 'Wait for active execution to stop before requesting a revision.');
        const [unresolvedModel] = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE tool_name=${MODEL_OPERATION} AND state IN ('reserved','unknown_outcome') LIMIT 1`;
        if (unresolvedModel) throw new OfficeError('INVALID_STATE', 'Reconcile the outstanding OpenAI outcome before starting another live attempt.');
        await startLiveAttempt(tx, current);
        await tx`UPDATE backoffice.office_tasks SET revision_cycles=revision_cycles+1 WHERE id=${current.id}`;
        await transition(tx, current, 'queued', 'task_queued', ownerId, { recoveryDecision: input.reason ?? 'Revise using the latest review findings.' }, null, 'owner');
        await enqueue(tx, current, current.parent_task_id ? 'draft' : 'package', null, `redraft:${current.revision_cycles + 1}`);
      } else if (input.action === 'resume' || input.action === 'retry') {
        if (current.mode === 'live') {
          if (!await liveConfigured(tx)) throw new OfficeError('CONFIGURATION_REQUIRED', 'Live execution is switched off or its spending limits are not set.');
          const [delegated] = await tx`SELECT 1 FROM backoffice.office_task_dependencies WHERE task_id=${current.parent_task_id ?? current.id} LIMIT 1`;
          if (!delegated) throw new OfficeError('INVALID_STATE', 'This live request was recorded before live execution was available. Cancel it and submit a new one.');
          const [unresolvedModel] = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE tool_name=${MODEL_OPERATION} AND state IN ('reserved','unknown_outcome') LIMIT 1`;
          if (unresolvedModel) throw new OfficeError('INVALID_STATE', 'Reconcile the outstanding OpenAI outcome before starting another live attempt.');
        }
        if (!['paused','blocked','failed'].includes(current.state)) throw new OfficeError('INVALID_STATE', 'Only paused or failed/blocked tasks can resume.');
        if (input.action === 'retry' && !input.reason) throw new OfficeError('INVALID_STATE', 'Retry requires a recovery decision and duplicate-effect check.');
        const effects = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE task_id IN ${tx(related.map(row => row.id))} AND state IN ('reserved','unknown_outcome') LIMIT 1`;
        if (effects.length) throw new OfficeError('INVALID_STATE', 'Reconcile unknown external outcomes before retry.');
        await startLiveAttempt(tx, current);
        for (const row of related) if (['paused','blocked','failed'].includes(row.state)) {
          await transition(tx, row, 'queued', 'task_queued', ownerId, { recoveryDecision: input.reason ?? 'Resume after scope and effect checks.' }, null, 'owner');
          await tx`UPDATE backoffice.office_tasks SET blocked_reason=NULL WHERE id=${row.id}`;
          await tx`UPDATE backoffice.office_dispatch SET state='pending',attempt=0,lease_owner=NULL,lease_until=NULL,lease_token=lease_token+1,available_at=now() WHERE task_id=${row.id} AND state IN ('exhausted','pending')`;
          if (row.current_artifact_id) {
            const [saved] = await tx<DbArtifact[]>`SELECT * FROM backoffice.office_artifacts WHERE id=${row.current_artifact_id} AND workspace_id=${row.workspace_id}`;
            const reviewer = reviewers[saved.author_agent_id];
            const pendingReview = await tx`SELECT id FROM backoffice.office_reviews WHERE task_id=${row.id} AND artifact_id=${saved.id} AND reviewer_id=${reviewer} AND state='pending'`;
            if (!pendingReview.length) await tx`INSERT INTO backoffice.office_reviews(workspace_id,task_id,artifact_id,artifact_hash,reviewer_id,state,criteria) VALUES(${row.workspace_id},${row.id},${saved.id},${saved.artifact_hash},${reviewer},'pending','["resume_scope_check","current_digest_matches","independent_reviewer"]'::jsonb)`;
            const pendingDispatch = await tx`SELECT id FROM backoffice.office_dispatch WHERE task_id=${row.id} AND step IN ('review','package_review') AND state IN ('pending','leased')`;
            if (!pendingDispatch.length) await enqueue(tx, row, row.parent_task_id ? 'review' : 'package_review', reviewer, `${saved.id}:resume:${row.version}`);
          }
        }
        const resumed = await task(tx, current.id, current.workspace_id);
        if (!resumed.parent_task_id && resumed.state === 'queued') {
          const resumeRun = randomUUID();
          await tx`INSERT INTO backoffice.office_runs(id,workspace_id,task_id,agent_id,profile_version,policy_version,attempt,state,step) VALUES(${resumeRun},${current.workspace_id},${current.id},${current.agent_id},1,1,1,'starting','resume_internal_dependencies')`;
          await transition(tx, resumed, 'assigned', 'task_assigned', ownerId, { agentName: current.agent_id }, resumeRun, 'owner');
          await tx`UPDATE backoffice.office_runs SET state='running' WHERE id=${resumeRun}`;
          await transition(tx, resumed, 'in_progress', 'work_started', ownerId, { agentName: current.agent_id, stepName: 'Revalidated dependent internal scheduling' }, resumeRun, 'owner');
          await tx`UPDATE backoffice.office_runs SET state='succeeded',usage_microunits=0,finished_at=now(),checkpoint=${tx.json({ resumed: true, simulated: current.mode === 'demo' })} WHERE id=${resumeRun}`;
        }
      } else if (input.action === 'request_changes') {
        if (!input.reason) throw new OfficeError('INVALID_STATE', 'Changes require specific feedback.');
        if (!['waiting_for_review','review_passed','waiting_for_owner_approval'].includes(current.state)) throw new OfficeError('INVALID_STATE', 'Only a current reviewable revision can receive changes.');
        await transition(tx, current, 'changes_requested', 'review_changes_requested', ownerId, { feedback: input.reason }, null, 'owner');
        await tx`UPDATE backoffice.office_approvals SET state='superseded',version=version+1 WHERE task_id=${current.id} AND state='pending'`;
        await tx`UPDATE backoffice.office_dispatch SET state='cancelled',lease_token=lease_token+1 WHERE task_id=${current.id} AND step IN ('review','package_review') AND state='pending'`;
        await invalidateParentPackage(tx, current, ownerId);
      } else {
        const cancelling = input.action === 'cancel';
        const descendantActive = await tx`SELECT 1 FROM backoffice.office_tasks t WHERE t.parent_task_id=${current.id} AND (EXISTS(SELECT 1 FROM backoffice.office_dispatch d WHERE d.task_id=t.id AND d.state='leased' AND d.lease_until>now()) OR EXISTS(SELECT 1 FROM backoffice.office_tool_operations o WHERE o.task_id=t.id AND o.state IN ('reserved','unknown_outcome'))) LIMIT 1`;
        for (const row of related) {
          if (['completed','cancelled'].includes(row.state)) continue;
          const active = await tx`SELECT 1 FROM backoffice.office_dispatch WHERE task_id=${row.id} AND state='leased' AND lease_until>now()`;
          const effects = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE task_id=${row.id} AND state IN ('reserved','unknown_outcome')`;
          const outstanding = active.length || effects.length || (row.id === current.id && descendantActive.length);
          const next = cancelling ? (outstanding ? 'cancel_requested' : 'cancelled') : (outstanding ? 'pause_requested' : 'paused');
          const requested = cancelling ? 'cancel_requested' : 'pause_requested';
          if (!canTaskTransition(row.state,next) && canTaskTransition(row.state,requested)) await transition(tx, row, requested, requested, ownerId, {}, null, 'owner');
          await transition(tx, row, next, next === 'cancelled' ? 'task_cancelled' : next === 'paused' ? 'work_paused' : next, ownerId, {}, null, 'owner');
          await tx`UPDATE backoffice.office_runs SET state=${requested} WHERE task_id=${row.id} AND state IN ('starting','running','waiting_for_tool',${cancelling ? 'pause_requested' : 'running'})`;
          if (cancelling) await tx`UPDATE backoffice.office_dispatch SET state='cancelled',lease_token=lease_token+1 WHERE task_id=${row.id} AND state='pending'`;
          if (cancelling) await tx`UPDATE backoffice.office_approvals SET state='cancelled',version=version+1 WHERE task_id=${row.id} AND state='pending'`;
        }
      }
      return { taskId: current.id };
    });
  }
  async function decideApproval(ownerId: string, raw: ApprovalDecisionInput) {
    const input = approvalDecisionSchema.parse(raw);
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      await owner(tx, ownerId);
      const [approval] = await tx<DbApproval[]>`SELECT * FROM backoffice.office_approvals WHERE id=${input.approvalId} AND workspace_id=${input.workspaceId} FOR UPDATE`;
      if (!approval) throw new OfficeError('NOT_FOUND', 'Approval not found in this workspace.');
      if (Number(approval.version) !== input.version || approval.state !== 'pending') throw new OfficeError('CONFLICT', 'Approval was already decided or changed.');
      const current = await task(tx, approval.task_id, approval.workspace_id);
      const [saved] = await tx<DbArtifact[]>`SELECT * FROM backoffice.office_artifacts WHERE id=${approval.artifact_id} AND workspace_id=${input.workspaceId}`;
      const expire = new Date(approval.expires_at).getTime() <= Date.now();
      if (expire || current.current_artifact_id !== approval.artifact_id || saved.artifact_hash !== approval.artifact_hash || digest(saved.content) !== approval.artifact_hash) {
        await tx`UPDATE backoffice.office_approvals SET state=${expire ? 'expired' : 'superseded'},version=version+1 WHERE id=${approval.id}`;
        await emit(tx, current.workspace_id, current.id, 'work_blocked', ownerId, { dependencySummary: expire ? 'Approval expired; a new decision is required.' : 'Artifact changed; approval superseded.' }, null, 'owner');
        return { approvalId: approval.id, state: expire ? 'expired' : 'superseded', acceptanceEvidenceId: null };
      }
      if (current.state !== 'waiting_for_owner_approval') throw new OfficeError('INVALID_STATE', 'Task is no longer awaiting owner acceptance.');
      if (input.decision !== 'approve') {
        await tx`UPDATE backoffice.office_approvals SET state='rejected',deciding_owner_id=${ownerId},decided_at=now(),reason=${input.reason!},version=version+1 WHERE id=${approval.id}`;
        await transition(tx, current, 'changes_requested', 'review_changes_requested', ownerId, { feedback: input.reason! }, null, 'owner');
        return { approvalId: approval.id, state: 'rejected', acceptanceEvidenceId: null };
      }
      const reviews = await tx`SELECT * FROM backoffice.office_reviews WHERE artifact_id=${saved.id} AND workspace_id=${current.workspace_id} AND state='passed' AND artifact_hash=${saved.artifact_hash} AND reviewer_id<>${saved.author_agent_id}`;
      if (!reviews.length) throw new OfficeError('INVALID_STATE', 'The exact package revision needs a passed independent review.');
      const incompleteReviews = await tx`SELECT 1 FROM backoffice.office_reviews r JOIN backoffice.office_tasks t ON t.id=r.task_id WHERE (t.id=${current.id} OR t.parent_task_id=${current.id}) AND r.artifact_id=t.current_artifact_id AND r.state NOT IN ('passed','superseded') LIMIT 1`;
      if (incompleteReviews.length) throw new OfficeError('INVALID_STATE', 'Every required current-revision review must finish and pass before acceptance.');
      if (!Array.isArray(saved.manifest)) throw new OfficeError('INVALID_STATE', 'Package manifest is invalid.');
      const dependencies = await tx`SELECT dependency_task_id FROM backoffice.office_task_dependencies WHERE task_id=${current.id} AND workspace_id=${current.workspace_id}`;
      const manifest = saved.manifest as Array<Record<string, JsonValue>>;
      if (manifest.length !== dependencies.length || new Set(manifest.map(item => item.childTaskId)).size !== manifest.length || dependencies.some(dep => !manifest.some(item => item.childTaskId === dep.dependency_task_id))) throw new OfficeError('CONFLICT', 'Package must cover every required child exactly once.');
      const covered: DbTask[] = [];
      const reviewIds: string[] = reviews.map(row => row.id);
      for (const entry of [...manifest].sort((a,b) => String(a.childTaskId).localeCompare(String(b.childTaskId)))) {
        const child = await task(tx, String(entry.childTaskId), current.workspace_id);
        if (child.parent_task_id !== current.id || child.state !== 'review_passed' || child.current_artifact_id !== entry.artifactId || entry.revisionId !== entry.artifactId || entry.hashAlgorithm !== 'SHA-256') throw new OfficeError('CONFLICT', 'A covered child revision changed; refresh the package.');
        const [childArtifact] = await tx<DbArtifact[]>`SELECT * FROM backoffice.office_artifacts WHERE id=${child.current_artifact_id} AND workspace_id=${current.workspace_id}`;
        if (childArtifact.artifact_hash !== entry.artifactHash || digest(childArtifact.content) !== entry.artifactHash) throw new OfficeError('CONFLICT', 'A covered child digest changed.');
        const childReviews = await tx`SELECT id FROM backoffice.office_reviews WHERE artifact_id=${childArtifact.id} AND workspace_id=${current.workspace_id} AND artifact_hash=${childArtifact.artifact_hash} AND state='passed' AND reviewer_id<>${childArtifact.author_agent_id}`;
        if (!childReviews.length || !Array.isArray(entry.reviewReferences) || !entry.reviewReferences.length || entry.reviewReferences.some(id => !childReviews.some(review => review.id === id))) throw new OfficeError('CONFLICT', 'Covered child review evidence changed.');
        reviewIds.push(...childReviews.map(row => row.id)); covered.push(child);
      }
      const evidenceId = randomUUID();
      await tx`INSERT INTO backoffice.office_acceptance_evidence(id,workspace_id,approval_id,owner_id,artifact_id,artifact_hash,action_scope,component_manifest,review_references) VALUES(${evidenceId},${current.workspace_id},${approval.id},${ownerId},${saved.id},${saved.artifact_hash},'accept_internal_proposal_package',${tx.json(saved.manifest)},${tx.json(reviewIds)})`;
      await tx`UPDATE backoffice.office_approvals SET state='approved',deciding_owner_id=${ownerId},decided_at=now(),consumed_at=now(),acceptance_evidence_id=${evidenceId},version=version+1 WHERE id=${approval.id} AND state='pending'`;
      for (const child of covered) {
        await tx`UPDATE backoffice.office_tasks SET acceptance_evidence_id=${evidenceId} WHERE id=${child.id}`;
        await transition(tx, child, 'completed', 'task_completed', ownerId, { acceptanceEvidenceId: evidenceId, inheritedFromParent: current.id }, null, 'owner');
      }
      await tx`UPDATE backoffice.office_tasks SET acceptance_evidence_id=${evidenceId} WHERE id=${current.id}`;
      await emit(tx, current.workspace_id, current.id, 'owner_approved', ownerId, { revisionLabel: `R${saved.revision}`, acceptanceEvidenceId: evidenceId, actionScope: 'accept_internal_proposal_package' }, null, 'owner');
      await transition(tx, current, 'completed', 'task_completed', ownerId, { acceptanceEvidenceId: evidenceId }, null, 'owner');
      return { approvalId: approval.id, state: 'approved', acceptanceEvidenceId: evidenceId };
    });
  }
  async function reviseArtifact(ownerId: string, raw: unknown) {
    const input = artifactRevisionSchema.parse(raw);
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      await owner(tx, ownerId);
      const current = await task(tx, input.taskId, input.workspaceId);
      if (Number(current.version) !== input.version) throw new OfficeError('CONFLICT', 'Task revision changed.');
      // Owner-written revisions need no model request; their live review is metered like any other.
      if (current.state !== 'changes_requested' || current.revision_cycles >= 2) throw new OfficeError('INVALID_STATE', 'A changes-requested task may be revised at most twice before owner recovery review.');
      const active = await tx`SELECT 1 FROM backoffice.office_dispatch WHERE task_id=${current.id} AND state='leased' AND lease_until>now()`;
      if (active.length) throw new OfficeError('CONFLICT', 'Wait for active execution to stop before revising.');
      if (current.mode === 'live') {
        const [unresolvedModel] = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE tool_name=${MODEL_OPERATION} AND state IN ('reserved','unknown_outcome') LIMIT 1`;
        if (unresolvedModel) throw new OfficeError('INVALID_STATE', 'Reconcile the outstanding OpenAI outcome before starting another live attempt.');
        await startLiveAttempt(tx, current);
      }
      await transition(tx, current, 'in_progress', 'work_started', ownerId, { agentName: input.authorAgentId }, null, 'owner');
      await tx`UPDATE backoffice.office_tasks SET revision_cycles=revision_cycles+1 WHERE id=${current.id}`;
      let content = input.content;
      let manifest: JsonValue = [];
      if (!current.parent_task_id) {
        const components = await tx`SELECT t.id AS child_id,t.current_artifact_id,a.artifact_hash,r.id AS review_id FROM backoffice.office_task_dependencies dep JOIN backoffice.office_tasks t ON t.id=dep.dependency_task_id JOIN backoffice.office_artifacts a ON a.id=t.current_artifact_id JOIN backoffice.office_reviews r ON r.artifact_id=a.id AND r.state='passed' AND r.artifact_hash=a.artifact_hash WHERE dep.task_id=${current.id} AND dep.workspace_id=${current.workspace_id} AND t.state='review_passed' ORDER BY t.agent_id`;
        const unique = new Map<string, { childTaskId: string; artifactId: string; revisionId: string; artifactHash: string; hashAlgorithm: string; reviewReferences: string[] }>();
        for (const row of components) {
          const item = unique.get(row.child_id) ?? { childTaskId: row.child_id, artifactId: row.current_artifact_id, revisionId: row.current_artifact_id, artifactHash: row.artifact_hash, hashAlgorithm: 'SHA-256', reviewReferences: [] as string[] };
          item.reviewReferences.push(row.review_id); unique.set(row.child_id,item);
        }
        manifest = [...unique.values()];
        const [required] = await tx`SELECT count(*)::int AS n FROM backoffice.office_task_dependencies WHERE task_id=${current.id}`;
        if (unique.size !== required.n) throw new OfficeError('INVALID_STATE', 'Every required child needs its current independent review before rebuilding the package.');
        content += `\n\n## Immutable component manifest\n\n${canonicalJson(manifest)}\n`;
      }
      const saved = await saveArtifact(tx, current, input.authorAgentId, { title: input.title, content, manifest, artifactHash: digest(content) }, null);
      await prepareReview(tx, current, input.authorAgentId, saved.id, digest(content), null);
      return { artifactId: saved.id };
    });
  }
  async function reserveBudget(lease: OfficeLease, limits: { amountMicrounits: number; perRunLimitMicrounits: number | null; runtimeLimitMs: number | null }) {
    if (!limits.perRunLimitMicrounits || !limits.runtimeLimitMs || !Number.isSafeInteger(limits.perRunLimitMicrounits) || !Number.isInteger(limits.runtimeLimitMs) || !Number.isSafeInteger(limits.amountMicrounits) || limits.amountMicrounits <= 0 || limits.amountMicrounits > limits.perRunLimitMicrounits || limits.runtimeLimitMs < 1000 || limits.runtimeLimitMs > 300000) throw new OfficeError('CONFIGURATION_REQUIRED', 'Explicit exact per-run spend and runtime limits are required before reservations.');
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      await assertLease(tx, lease);
      const current = await task(tx, lease.taskId, lease.workspaceId);
      await owner(tx, current.initiating_owner_id);
      if (['pause_requested','cancel_requested','paused','cancelled'].includes(current.state)) throw new OfficeError('INVALID_STATE', 'Budget reservation stopped by owner request.');
      const [run] = await tx`SELECT * FROM backoffice.office_runs WHERE id=${lease.runId} FOR UPDATE`;
      if (run.usage_microunits !== null) throw new OfficeError('INVALID_STATE', 'Run budget was already settled.');
      if (Number(run.budget_reserved_microunits) > 0) {
        if (Number(run.budget_reserved_microunits) !== limits.amountMicrounits) throw new OfficeError('CONFLICT', 'Run already owns a different reservation.');
        return { reservedMicrounits: limits.amountMicrounits, duplicate: true };
      }
      const allowed = await tx`UPDATE backoffice.office_budget SET reserved_microunits=reserved_microunits+${limits.amountMicrounits} WHERE id=1 AND reserved_microunits+spent_microunits+${limits.amountMicrounits}<=limit_microunits RETURNING id`;
      if (!allowed.length) throw new OfficeError('CONFIGURATION_REQUIRED', 'Global budget is unset or exhausted; no provider request is permitted.');
      await tx`UPDATE backoffice.office_runs SET budget_reserved_microunits=${limits.amountMicrounits},runtime_limit_ms=${limits.runtimeLimitMs} WHERE id=${lease.runId}`;
      return { reservedMicrounits: limits.amountMicrounits, duplicate: false };
    });
  }
  async function settleBudget(lease: OfficeLease, actualMicrounits: number) {
    if (!Number.isSafeInteger(actualMicrounits) || actualMicrounits < 0) throw new OfficeError('INVALID_STATE', 'Usage must be nonnegative exact microunits.');
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      await assertLease(tx, lease);
      const [run] = await tx`SELECT * FROM backoffice.office_runs WHERE id=${lease.runId} FOR UPDATE`;
      if (run.usage_microunits !== null) {
        if (Number(run.usage_microunits) !== actualMicrounits) throw new OfficeError('CONFLICT', 'Run usage was already settled to another value.');
        return { chargedMicrounits: actualMicrounits, duplicate: true };
      }
      if (actualMicrounits > Number(run.budget_reserved_microunits)) throw new OfficeError('INVALID_STATE', 'Actual usage exceeds the reserved cap; reconcile before further work.');
      await tx`UPDATE backoffice.office_budget SET reserved_microunits=reserved_microunits-${run.budget_reserved_microunits},spent_microunits=spent_microunits+${actualMicrounits} WHERE id=1`;
      await tx`UPDATE backoffice.office_runs SET usage_microunits=${actualMicrounits} WHERE id=${lease.runId}`;
      return { chargedMicrounits: actualMicrounits, duplicate: false };
    });
  }
  async function beginToolOperation(lease: OfficeLease, input: { toolName: string; operationKey: string; arguments: Record<string, JsonValue> }) {
    // Only a local draft effect exists. Adding a tool name requires a reviewed capability adapter.
    if (input.toolName !== 'internal_save_draft') throw new OfficeError('FORBIDDEN', 'External communication, financial actions, deployment and command execution are disabled in this pilot.');
    if (input.operationKey.length < 8 || input.operationKey.length > 150 || Buffer.byteLength(canonicalJson(input.arguments)) > 16000) throw new OfficeError('INVALID_STATE', 'Invalid bounded operation input.');
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      await assertLease(tx, lease);
      const current = await task(tx, lease.taskId, lease.workspaceId);
      await owner(tx, current.initiating_owner_id);
      if (!['in_progress','waiting_for_review'].includes(current.state)) throw new OfficeError('INVALID_STATE', 'Task is not authorized for a tool step.');
      const [grant] = await tx`SELECT 1 FROM backoffice.office_workspace_grants WHERE workspace_id=${current.workspace_id} AND agent_id=${lease.agentId} AND data_scopes ? 'internal_draft'`;
      if (!grant) throw new OfficeError('FORBIDDEN', 'No scoped internal drafting permission.');
      const argumentsHash = digest(canonicalJson(input.arguments));
      const key = `${current.workspace_id}:${current.id}:${input.operationKey}`;
      const [existing] = await tx`SELECT * FROM backoffice.office_tool_operations WHERE operation_key=${key} FOR UPDATE`;
      if (existing) {
        if (existing.arguments_hash !== argumentsHash || existing.tool_name !== input.toolName) throw new OfficeError('CONFLICT', 'Operation key was already bound to another payload.');
        if (['reserved','unknown_outcome'].includes(existing.state)) throw new OfficeError('INVALID_STATE', 'Operation outcome needs reconciliation; a blind retry is forbidden.');
        return { operationId: existing.id, execute: false, state: existing.state, result: existing.result as JsonValue };
      }
      const [created] = await tx`INSERT INTO backoffice.office_tool_operations(workspace_id,task_id,run_id,operation_key,arguments_hash,tool_name,state,provider_idempotency_key) VALUES(${current.workspace_id},${current.id},${lease.runId},${key},${argumentsHash},${input.toolName},'reserved',${digest(key)}) RETURNING id`;
      return { operationId: created.id, execute: true, state: 'reserved', result: null };
    });
  }
  async function finishToolOperation(lease: OfficeLease, operationId: string, outcome: 'succeeded' | 'failed' | 'unknown_outcome', result: Record<string, JsonValue>) {
    if (Buffer.byteLength(canonicalJson(result)) > 16000) throw new OfficeError('INVALID_STATE', 'Bounded tool result exceeded.');
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      await assertLease(tx, lease);
      const rows = await tx`UPDATE backoffice.office_tool_operations SET state=${outcome},result=${tx.json(result)},updated_at=now() WHERE id=${operationId} AND workspace_id=${lease.workspaceId} AND task_id=${lease.taskId} AND run_id=${lease.runId} AND state='reserved' RETURNING id`;
      if (!rows.length) throw new OfficeError('CONFLICT', 'Tool operation is no longer reserved by this run.');
      await emit(tx, lease.workspaceId, lease.taskId, outcome === 'unknown_outcome' ? 'work_blocked' : 'tool_operation_recorded', lease.workerId, { operationId, outcome }, lease.runId);
    });
  }
  async function reconcileToolOperation(ownerId: string, input: { workspaceId: string; operationId: string; outcome: 'succeeded' | 'failed'; evidenceReference: string; actualMicrounits?: number }) {
    if (input.evidenceReference.length < 5 || input.evidenceReference.length > 2000) throw new OfficeError('INVALID_STATE', 'Reconciliation requires an inspected evidence reference.');
    await sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      await owner(tx, ownerId);
      const [operation] = await tx`SELECT * FROM backoffice.office_tool_operations WHERE id=${input.operationId} AND workspace_id=${input.workspaceId} AND state IN ('unknown_outcome','reserved') FOR UPDATE`;
      if (!operation) throw new OfficeError('NOT_FOUND', 'No unresolved operation in this workspace.');
      if (operation.tool_name === MODEL_OPERATION) {
        const [active] = await tx`SELECT 1 FROM backoffice.office_dispatch WHERE run_id=${operation.run_id} AND state='leased' AND lease_until>now()`;
        if (active) throw new OfficeError('INVALID_STATE', 'Wait for the active request to stop before reconciling it.');
        const actual = input.outcome === 'failed' ? (input.actualMicrounits ?? 0) : input.actualMicrounits;
        if (!Number.isSafeInteger(actual) || actual! < 0 || (input.outcome === 'failed' && actual !== 0)) throw new OfficeError('INVALID_STATE', 'Model reconciliation requires the exact confirmed charge in microunits; a confirmed unprocessed failure costs zero.');
        const [run] = await tx`SELECT * FROM backoffice.office_runs WHERE id=${operation.run_id} FOR UPDATE`;
        if (run.usage_microunits !== null && Number(run.usage_microunits) !== actual) throw new OfficeError('CONFLICT', 'The observed charge is immutable; reconcile the recorded amount without removing known spend.');
        if (run.usage_microunits === null) {
          await tx`UPDATE backoffice.office_budget SET reserved_microunits=reserved_microunits-${run.budget_reserved_microunits},spent_microunits=spent_microunits+${actual!} WHERE id=1`;
          await tx`UPDATE backoffice.office_runs SET usage_microunits=${actual!},state='failed',finished_at=now() WHERE id=${run.id}`;
        } else if (run.state === 'waiting_for_tool') {
          await tx`UPDATE backoffice.office_runs SET state='failed',finished_at=now() WHERE id=${run.id}`;
        }
      }
      const rows = await tx`UPDATE backoffice.office_tool_operations SET state=${input.outcome},result=${tx.json({ reconciledBy: ownerId, evidenceReference: input.evidenceReference, ...(input.actualMicrounits === undefined ? {} : { actualMicrounits: input.actualMicrounits }) })},updated_at=now() WHERE id=${input.operationId} RETURNING task_id`;
      if (!rows.length) throw new OfficeError('NOT_FOUND', 'No unresolved operation in this workspace.');
      await emit(tx, input.workspaceId, rows[0].task_id, 'tool_operation_reconciled', ownerId, { operationId: input.operationId, outcome: input.outcome }, null, 'owner');
      const current = await task(tx, rows[0].task_id, input.workspaceId);
      const unresolved = await tx`SELECT 1 FROM backoffice.office_tool_operations WHERE task_id=${current.id} AND state IN ('reserved','unknown_outcome')`;
      const active = await tx`SELECT 1 FROM backoffice.office_dispatch WHERE task_id=${current.id} AND state='leased' AND lease_until>now()`;
      if (!unresolved.length && !active.length && ['pause_requested','cancel_requested'].includes(current.state)) {
        const cancelling = current.state === 'cancel_requested';
        await transition(tx, current, cancelling ? 'cancelled' : 'paused', cancelling ? 'task_cancelled' : 'work_paused', ownerId, {}, null, 'owner');
        await settleParentStop(tx, current, ownerId);
      }
    });
  }
  async function createSchedule(ownerId: string, input: { scheduleId: string; template: SubmitTaskInput; nextAt: string; cadenceSeconds: number }) {
    const template = submitTaskSchema.parse(input.template);
    if (!/^[a-f0-9-]{36}$/i.test(input.scheduleId) || !Number.isFinite(new Date(input.nextAt).getTime()) || !Number.isInteger(input.cadenceSeconds) || input.cadenceSeconds < 300 || input.cadenceSeconds > 31536000) throw new OfficeError('INVALID_STATE', 'Invalid explicit schedule.');
    if (template.mode !== 'demo') throw new OfficeError('CONFIGURATION_REQUIRED', 'Live schedules require the unconfigured provider/budget adapter.');
    return sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(68421202)`;
      await owner(tx, ownerId);
      const [workspace] = await tx`SELECT id FROM backoffice.office_workspaces WHERE id=${template.workspaceId} AND mode='demo' AND scope='internal'`;
      if (!workspace) throw new OfficeError('FORBIDDEN', 'No authorized demonstration workspace.');
      const [existing] = await tx`SELECT * FROM backoffice.office_schedules WHERE id=${input.scheduleId}`;
      if (existing) {
        if (existing.owner_id !== ownerId || existing.workspace_id !== template.workspaceId || canonicalJson(existing.template) !== canonicalJson(template) || existing.cadence_seconds !== input.cadenceSeconds) throw new OfficeError('CONFLICT', 'Schedule ID is already bound to different input.');
        return { scheduleId: existing.id, duplicate: true };
      }
      await tx`INSERT INTO backoffice.office_schedules(id,workspace_id,enabled,next_at,cadence_seconds,owner_id,template) VALUES(${input.scheduleId},${template.workspaceId},true,${new Date(input.nextAt)},${input.cadenceSeconds},${ownerId},${tx.json(template)})`;
      return { scheduleId: input.scheduleId, duplicate: false };
    });
  }
  async function dispatchDueSchedules() {
    const due = await sql`SELECT * FROM backoffice.office_schedules WHERE enabled AND next_at<=now() ORDER BY next_at LIMIT 10`;
    let dispatched = 0;
    for (const schedule of due) {
      try {
      const occurrence = iso(schedule.next_at);
      const template = submitTaskSchema.parse(schedule.template);
      // Submission commits before next_at advances. Crash between them safely replays the same stable occurrence key.
      const result = await submitTaskFrom(schedule.owner_id, { ...template, idempotencyKey: `schedule:${schedule.id}:${occurrence}` }, 'scheduler');
      await sql.begin(async tx => {
        await tx`SELECT pg_advisory_xact_lock(68421202)`;
        const [current] = await tx`SELECT * FROM backoffice.office_schedules WHERE id=${schedule.id} AND enabled AND next_at=${new Date(occurrence)} FOR UPDATE`;
        if (!current) return;
        await tx`UPDATE backoffice.office_dispatch SET schedule_id=${schedule.id},scheduled_occurrence=${new Date(occurrence)} WHERE task_id=${result.taskId} AND step='package'`;
        await tx`UPDATE backoffice.office_schedules SET next_at=next_at+(${schedule.cadence_seconds}*interval '1 second') WHERE id=${schedule.id}`;
        dispatched++;
      });
      } catch (error) {
        // A revoked owner or invalid template disables only that schedule, never unrelated queue work.
        if (error instanceof OfficeError || (error instanceof Error && error.name === 'ZodError')) {
          await sql.begin(async tx => {
            await tx`SELECT pg_advisory_xact_lock(68421202)`;
            const disabled = await tx`UPDATE backoffice.office_schedules SET enabled=false WHERE id=${schedule.id} AND enabled RETURNING id`;
            if (disabled.length) await emit(tx, schedule.workspace_id, null, 'work_blocked', 'scheduler', { dependencySummary: 'Schedule disabled: its owner, scope or configuration requires review.', scheduleId: schedule.id });
          });
          continue;
        }
        throw error;
      }
    }
    return dispatched;
  }
  return { snapshot, submitTask, requestTaskAction, decideApproval, reviseArtifact, events, artifact, health, claim, heartbeat, checkpoint, execute, fail, recoverExpired, workerHeartbeat, reserveBudget, settleBudget, beginToolOperation, finishToolOperation, reconcileToolOperation, createSchedule, dispatchDueSchedules };
}
