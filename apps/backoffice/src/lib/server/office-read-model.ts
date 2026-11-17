import 'server-only';

import type postgres from 'postgres';

import {
  OFFICE_AGENTS,
  type AgentId, type JsonValue, type OfficeApproval, type OfficeArtifact, type OfficeEvent, type OfficeMode, type OfficeReview, type OfficeTask, type OfficeWorkspace, type RunState,
} from '@/lib/office-contracts';
import {
  COORDINATION_STEPS, OFFICE_TASK_WINDOW, WORKER_ONLINE_THRESHOLD_SECONDS, WORKER_STEPS,
  type OfficeActiveRun, type OfficeActivity, type OfficeDashboardData, type OfficeExecutionCapability, type OfficeFamily, type OfficeModeSummary,
  type OfficeRoleActivity, type OfficeRoleCounts, type OfficeRunRef, type OfficeStateCounts, type OfficeStepCounts, type OfficeTaskExecution, type OfficeWorkerStatus,
} from '@/lib/office-activity';
import type { OfficeLinkRequest, OfficeLinkState } from '@/lib/office-links';

// Read-only Office evidence for the dashboard and the Office status view.
// Every query runs inside one repeatable-read, read-only transaction and uses
// database time. Dashboard queries never select briefs, artifact bodies, event
// payloads or file paths. Only `family` returns full records, in the same shape
// and to the same admin-only Office page as the runtime snapshot.

type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;
const AGENT_IDS = OFFICE_AGENTS.map(agent => agent.agentId as AgentId);
const MODES: OfficeMode[] = ['demo', 'live'];
const DASHBOARD_WINDOWS = { decisions: 5, outputs: 5, events: 8 };
const FAMILY_EVENT_LIMIT = 200;

const iso = (value: unknown) => new Date(value as string | Date).toISOString();
const isoOrNull = (value: unknown) => (value === null || value === undefined ? null : iso(value));
const text = (value: unknown) => (typeof value === 'string' ? value : String(value ?? ''));
const shorten = (value: unknown, limit = 120) => { const full = text(value); return full.length > limit ? `${full.slice(0, limit - 1)}…` : full; };

function emptyCounts(): OfficeRoleCounts {
  return { open: 0, queued: 0, inProgress: 0, awaitingReview: 0, changesRequested: 0, reviewPassed: 0, waitingForOwner: 0, blocked: 0, failed: 0, stopping: 0, paused: 0, completed: 0, cancelled: 0, decisionsPending: 0, decisionsRenewal: 0, runnableSteps: 0, runnableReviews: 0, waitingOnDependencies: 0, retryScheduled: 0, exhaustedSteps: 0, executingRuns: 0, stalledRuns: 0, stoppingRuns: 0 };
}
function emptyStateCounts(): OfficeStateCounts {
  return { total: 0, parents: 0, queued: 0, inProgress: 0, startedNotExecuting: 0, executing: 0, awaitingReview: 0, changesRequested: 0, reviewPassed: 0, waitingForOwner: 0, blocked: 0, failed: 0, stopping: 0, paused: 0, completed: 0, cancelled: 0 };
}
function emptySteps(): OfficeStepCounts {
  return { pending: 0, runnable: 0, waitingOnDependencies: 0, retryScheduled: 0, nextRetryAt: null, leased: 0, done: 0, exhausted: 0, cancelled: 0 };
}
/** Canonical task state to a count bucket. Execution is never derived from task state. */
function bucket(state: string): 'queued' | 'inProgress' | 'awaitingReview' | 'changesRequested' | 'reviewPassed' | 'waitingForOwner' | 'blocked' | 'failed' | 'stopping' | 'paused' | 'completed' | 'cancelled' | null {
  switch (state) {
    case 'queued': case 'assigned': return 'queued';
    case 'in_progress': return 'inProgress';
    case 'waiting_for_review': return 'awaitingReview';
    case 'changes_requested': return 'changesRequested';
    case 'review_passed': return 'reviewPassed';
    case 'waiting_for_owner_approval': return 'waitingForOwner';
    case 'blocked': case 'waiting_for_input': return 'blocked';
    case 'failed': return 'failed';
    case 'pause_requested': case 'cancel_requested': return 'stopping';
    case 'paused': return 'paused';
    case 'completed': return 'completed';
    case 'cancelled': return 'cancelled';
    default: return null;
  }
}
const isOpen = (state: string) => state !== 'completed' && state !== 'cancelled';

function mapRun(row: Row): OfficeRunRef {
  return { id: text(row.run_id), taskId: text(row.task_id), agentId: row.agent_id as AgentId, step: text(row.step), state: row.state as RunState, attempt: Number(row.attempt), startedAt: iso(row.started_at), finishedAt: isoOrNull(row.finished_at), errorCode: (row.error_code as string | null) ?? null, predecessorRunId: (row.predecessor_run_id as string | null) ?? null };
}
function mapActiveRun(row: Row): OfficeActiveRun {
  // Rounded down so a client never sees more lease time than the database had left.
  const remaining = row.lease_remaining_ms === null || row.lease_remaining_ms === undefined ? null : Math.floor(Number(row.lease_remaining_ms));
  return { ...mapRun(row), leaseUntil: isoOrNull(row.lease_until), leaseLive: row.lease_live === true, leaseRemainingMs: remaining };
}
// The following four mappings reproduce the runtime snapshot shapes exactly
// (office-runtime mapTask/mapArtifact and its review/approval/event mapping).
function mapTask(row: Row): OfficeTask {
  return { id: text(row.id), workspaceId: text(row.workspace_id), clientId: text(row.scope_key), projectId: text(row.project_key), parentTaskId: (row.parent_task_id as string | null) ?? null, agentId: row.agent_id as AgentId, goal: text(row.goal), brief: text(row.brief), priority: row.priority as number, state: row.state as OfficeTask['state'], mode: row.mode as OfficeMode, version: Number(row.version), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), blockedReason: (row.blocked_reason as string | null) ?? null, currentArtifactId: (row.current_artifact_id as string | null) ?? null, acceptanceEvidenceId: (row.acceptance_evidence_id as string | null) ?? null };
}
function mapArtifact(row: Row): OfficeArtifact {
  return { id: text(row.id), taskId: text(row.task_id), workspaceId: text(row.workspace_id), clientId: text(row.scope_key), projectId: text(row.project_key), authorAgentId: row.author_agent_id as AgentId, title: text(row.title), revision: row.revision as number, revisionId: text(row.id), artifactHash: text(row.artifact_hash), hashAlgorithm: 'SHA-256', content: text(row.content), manifest: row.manifest as JsonValue, createdAt: iso(row.created_at) };
}
function mapReview(row: Row): OfficeReview {
  return { id: text(row.id), taskId: text(row.task_id), workspaceId: text(row.workspace_id), artifactId: text(row.artifact_id), revisionId: text(row.artifact_id), artifactHash: text(row.artifact_hash), reviewerId: row.reviewer_id as AgentId, state: text(row.state), criteria: row.criteria as string[], evidence: row.evidence as JsonValue, findings: row.findings as JsonValue, createdAt: iso(row.created_at) };
}
function mapApproval(row: Row): OfficeApproval {
  return { id: text(row.id), taskId: text(row.task_id), workspaceId: text(row.workspace_id), artifactId: text(row.artifact_id), revisionId: text(row.artifact_id), artifactHash: text(row.artifact_hash), actionScope: 'accept_internal_proposal_package', state: text(row.state), version: Number(row.version), expiresAt: iso(row.expires_at), reason: (row.reason as string | null) ?? null, decidedAt: isoOrNull(row.decided_at), acceptanceEvidenceId: (row.acceptance_evidence_id as string | null) ?? null };
}
function mapEvent(row: Row): OfficeEvent {
  return { eventId: text(row.id), sequence: Number(row.sequence), eventType: text(row.event_type), occurredAt: iso(row.occurred_at), workspaceId: text(row.workspace_id), clientId: text(row.scope_key), projectId: text(row.project_key), taskId: (row.task_id as string | null) ?? null, runId: (row.run_id as string | null) ?? null, actorType: text(row.actor_type), actorId: text(row.actor_id), mode: row.mode === 'demo' ? 'visual_prototype' : 'connected_internal_workflow', simulated: row.simulated === true, source: text(row.source), payload: row.payload as Record<string, JsonValue> };
}

export function createOfficeReadModel(sql: postgres.Sql) {
  async function readOnly<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return (await sql.begin('isolation level repeatable read read only', work)) as T;
  }
  const scoped = (tx: Tx, alias: string, workspaceId: string | null) => (workspaceId ? tx`AND ${tx(alias)}.workspace_id=${workspaceId}` : tx``);
  // Dependency gate used by the worker's claim(): every required child must have passed review.
  const unmetDependencies = (tx: Tx) => tx`EXISTS (SELECT 1 FROM backoffice.office_task_dependencies dep JOIN backoffice.office_tasks c ON c.id=dep.dependency_task_id WHERE dep.task_id=t.id AND c.state NOT IN ('review_passed','completed'))`;
  // Mirrors the claim() admission filter for a pending dispatch `d` of task `t`, except the
  // global capacity check. Read-only; it never claims, and the worker remains authoritative.
  const runnable = (tx: Tx) => tx`(d.state='pending' AND d.available_at<=now() AND d.attempt<d.max_attempts
    AND (t.mode='demo' OR (t.mode='live'
      AND EXISTS (SELECT 1 FROM backoffice.office_workers ow WHERE NOT ow.stopping AND ow.adapter='openai_responses' AND ow.heartbeat_at>now()-(${WORKER_ONLINE_THRESHOLD_SECONDS}*interval '1 second'))
      AND EXISTS (SELECT 1 FROM backoffice.office_budget ob WHERE ob.id=1 AND ob.live_enabled AND ob.limit_microunits>0 AND ob.monthly_limit_microunits>0 AND ob.family_limit_microunits>0 AND ob.request_limit_microunits>0)
      AND (SELECT attempt.started_at FROM backoffice.office_runs attempt WHERE attempt.task_id=COALESCE(t.parent_task_id,t.id) AND attempt.step IN ('delegate_internal_live','live_owner_attempt','resume_internal_dependencies') ORDER BY attempt.started_at DESC,attempt.id DESC LIMIT 1)>now()-interval '10 minutes'
      AND NOT EXISTS (SELECT 1 FROM backoffice.office_tool_operations op WHERE op.tool_name='openai_responses' AND op.state='unknown_outcome')))
    AND t.state IN ('queued','assigned','in_progress','waiting_for_review','blocked')
    AND EXISTS (SELECT 1 FROM backoffice.office_agents ta WHERE ta.id=t.agent_id AND ta.enabled)
    AND EXISTS (SELECT 1 FROM backoffice.office_workspace_grants g JOIN backoffice.office_agents ra ON ra.id=g.agent_id WHERE g.workspace_id=t.workspace_id AND g.agent_id=COALESCE(d.reviewer_id,t.agent_id) AND ra.enabled AND (t.mode<>'live' OR g.data_scopes ? 'internal_draft'))
    AND NOT EXISTS (SELECT 1 FROM backoffice.office_tasks p WHERE p.id=t.parent_task_id AND p.state IN ('pause_requested','paused','cancel_requested','cancelled'))
    AND NOT ${unmetDependencies(tx)})`;
  const liveDecision = (tx: Tx) => tx`EXISTS (SELECT 1 FROM backoffice.office_approvals a WHERE a.task_id=t.id AND a.artifact_id=t.current_artifact_id AND a.state='pending' AND a.expires_at>now())`;
  const expiredDecision = (tx: Tx) => tx`EXISTS (SELECT 1 FROM backoffice.office_approvals a WHERE a.task_id=t.id AND a.artifact_id=t.current_artifact_id AND (a.state='expired' OR (a.state='pending' AND a.expires_at<=now())))`;

  async function worker(tx: Tx): Promise<OfficeWorkerStatus> {
    const [summary] = await tx`SELECT count(*)::int AS seen, max(heartbeat_at) FILTER (WHERE NOT stopping) AS last_live, EXTRACT(EPOCH FROM now()-max(heartbeat_at) FILTER (WHERE NOT stopping))::float8 AS live_age FROM backoffice.office_workers`;
    const [latest] = await tx`SELECT heartbeat_at, started_at, stopping, EXTRACT(EPOCH FROM now()-heartbeat_at)::float8 AS age FROM backoffice.office_workers ORDER BY heartbeat_at DESC LIMIT 1`;
    const age = summary?.live_age === null || summary?.live_age === undefined ? null : Math.max(0, Number(summary.live_age));
    return {
      workersSeen: Number(summary?.seen ?? 0),
      online: age !== null && age < WORKER_ONLINE_THRESHOLD_SECONDS,
      lastHeartbeatAt: isoOrNull(summary?.last_live),
      heartbeatAgeSeconds: age === null ? null : Math.round(age),
      latest: latest ? { heartbeatAt: iso(latest.heartbeat_at), startedAt: iso(latest.started_at), stopping: latest.stopping === true, ageSeconds: Math.max(0, Math.round(Number(latest.age))) } : null,
      onlineThresholdSeconds: WORKER_ONLINE_THRESHOLD_SECONDS,
    };
  }

  /**
   * Leased dispatches and their runs. A live lease is the only execution evidence; run state is never used to infer it.
   * Remaining lease time is measured against database now(), so clients never compare their clock with lease_until.
   */
  async function leases(tx: Tx, workspaceId: string | null) {
    const rows = await tx`SELECT d.task_id, t.mode, t.agent_id AS task_agent_id, d.lease_until, (d.lease_until IS NOT NULL AND d.lease_until>now()) AS lease_live, (EXTRACT(EPOCH FROM (d.lease_until-now()))*1000)::float8 AS lease_remaining_ms, r.id AS run_id, r.agent_id, r.step, r.state, r.attempt, r.started_at, r.finished_at, r.error_code, r.predecessor_run_id FROM backoffice.office_dispatch d JOIN backoffice.office_tasks t ON t.id=d.task_id JOIN backoffice.office_runs r ON r.id=d.run_id WHERE d.state='leased' ${scoped(tx, 'd', workspaceId)} ORDER BY r.started_at DESC, r.id DESC`;
    return rows.map(row => ({ mode: row.mode as OfficeMode, taskAgentId: row.task_agent_id as AgentId, run: mapActiveRun(row) }));
  }

  async function roleActivity(tx: Tx, workspaceId: string | null, leased: Awaited<ReturnType<typeof leases>>): Promise<OfficeRoleActivity[]> {
    const agents = new Map((await tx`SELECT id, enabled FROM backoffice.office_agents`).map(row => [row.id as AgentId, row.enabled === true]));
    const roles = new Map<string, OfficeRoleActivity>();
    for (const agentId of AGENT_IDS) for (const mode of MODES) roles.set(`${agentId}:${mode}`, { agentId, mode, enabled: agents.get(agentId) ?? false, counts: emptyCounts(), activeRun: null, leasedRuns: [], latestRun: null, lastEvent: null, latestArtifact: null, latestOwnerRevision: null, latestReviewGiven: null, reviewInProgress: null, blocked: null, nextRetryAt: null, focusTaskId: null });
    const role = (agentId: unknown, mode: unknown) => roles.get(`${text(agentId)}:${text(mode)}`);

    for (const row of await tx`SELECT t.agent_id, t.mode, t.state, count(*)::int AS n FROM backoffice.office_tasks t WHERE true ${scoped(tx, 't', workspaceId)} GROUP BY 1,2,3`) {
      const target = role(row.agent_id, row.mode); const key = bucket(text(row.state));
      if (!target || !key) continue;
      target.counts[key] += row.n as number;
      if (isOpen(text(row.state))) target.counts.open += row.n as number;
    }
    for (const row of await tx`SELECT t.agent_id, t.mode, count(*) FILTER (WHERE ${liveDecision(tx)})::int AS pending, count(*) FILTER (WHERE NOT ${liveDecision(tx)} AND ${expiredDecision(tx)})::int AS renewal FROM backoffice.office_tasks t WHERE t.state='waiting_for_owner_approval' ${scoped(tx, 't', workspaceId)} GROUP BY 1,2`) {
      const target = role(row.agent_id, row.mode); if (target) { target.counts.decisionsPending = row.pending as number; target.counts.decisionsRenewal = row.renewal as number; }
    }
    // Dispatch work is attributed to the role that would run it: the reviewer for review steps.
    for (const row of await tx`SELECT COALESCE(d.reviewer_id,t.agent_id) AS agent_id, t.mode,
        count(*) FILTER (WHERE ${runnable(tx)} AND d.step IN ('draft','package'))::int AS runnable_steps,
        count(*) FILTER (WHERE ${runnable(tx)} AND d.step IN ('review','package_review'))::int AS runnable_reviews,
        count(*) FILTER (WHERE d.state='pending' AND ${unmetDependencies(tx)})::int AS waiting_dependencies,
        count(*) FILTER (WHERE d.state='pending' AND d.available_at>now() AND t.state NOT IN ('completed','cancelled'))::int AS retry_scheduled,
        min(d.available_at) FILTER (WHERE d.state='pending' AND d.available_at>now() AND t.state NOT IN ('completed','cancelled')) AS next_retry_at,
        count(*) FILTER (WHERE d.state='exhausted' AND t.state NOT IN ('completed','cancelled'))::int AS exhausted
      FROM backoffice.office_dispatch d JOIN backoffice.office_tasks t ON t.id=d.task_id WHERE true ${scoped(tx, 'd', workspaceId)} GROUP BY 1,2`) {
      const target = role(row.agent_id, row.mode); if (!target) continue;
      Object.assign(target.counts, { runnableSteps: row.runnable_steps, runnableReviews: row.runnable_reviews, waitingOnDependencies: row.waiting_dependencies, retryScheduled: row.retry_scheduled, exhaustedSteps: row.exhausted });
      target.nextRetryAt = isoOrNull(row.next_retry_at);
    }
    for (const { mode, taskAgentId, run } of leased) {
      const target = role(run.agentId, mode); if (!target) continue;
      target.leasedRuns.push(run);
      if (run.leaseLive) target.counts.executingRuns += 1; else target.counts.stalledRuns += 1;
      if (run.leaseLive && (run.state === 'pause_requested' || run.state === 'cancel_requested')) target.counts.stoppingRuns += 1;
      // A live lease wins over an expired one; newest first otherwise.
      if (!target.activeRun || (!target.activeRun.leaseLive && run.leaseLive)) target.activeRun = run;
      const author = role(taskAgentId, mode);
      if (author && run.leaseLive && (run.step === 'review' || run.step === 'package_review') && run.agentId !== taskAgentId && !author.reviewInProgress) author.reviewInProgress = { reviewerId: run.agentId, runId: run.id, taskId: run.taskId, leaseRemainingMs: run.leaseRemainingMs };
    }
    for (const row of await tx`SELECT DISTINCT ON (r.agent_id, t.mode) r.agent_id, t.mode, r.id AS run_id, r.task_id, r.step, r.state, r.attempt, r.started_at, r.finished_at, r.error_code, r.predecessor_run_id FROM backoffice.office_runs r JOIN backoffice.office_tasks t ON t.id=r.task_id WHERE r.step IN ${tx([...WORKER_STEPS])} ${scoped(tx, 'r', workspaceId)} ORDER BY r.agent_id, t.mode, r.started_at DESC, r.id DESC`) {
      const target = role(row.agent_id, row.mode); if (target) target.latestRun = mapRun(row);
    }
    // Agent-typed events without a run are owner revisions recorded under a role, not the role's work.
    for (const row of await tx`SELECT DISTINCT ON (e.actor_id, e.mode) e.actor_id, e.mode, e.event_type, e.occurred_at, e.task_id, e.run_id FROM backoffice.office_events e WHERE e.actor_type='agent' AND e.run_id IS NOT NULL ${scoped(tx, 'e', workspaceId)} ORDER BY e.actor_id, e.mode, e.occurred_at DESC, e.sequence DESC`) {
      const target = role(row.actor_id, row.mode);
      if (target) target.lastEvent = { eventType: text(row.event_type), occurredAt: iso(row.occurred_at), taskId: (row.task_id as string | null) ?? null, runId: text(row.run_id) };
    }
    const artifacts = await tx`SELECT DISTINCT ON (a.author_agent_id, t.mode) a.author_agent_id, t.mode, a.id, a.task_id, a.title, a.revision, a.artifact_hash, a.created_at, (t.current_artifact_id=a.id) AS current FROM backoffice.office_artifacts a JOIN backoffice.office_tasks t ON t.id=a.task_id WHERE a.producer_run_id IS NOT NULL ${scoped(tx, 'a', workspaceId)} ORDER BY a.author_agent_id, t.mode, a.created_at DESC, a.revision DESC`;
    const artifactReviews = artifacts.length ? new Map((await tx`SELECT DISTINCT ON (r.artifact_id) r.artifact_id, r.reviewer_id, r.state, r.decided_at FROM backoffice.office_reviews r WHERE r.artifact_id IN ${tx(artifacts.map(row => row.id as string))} ORDER BY r.artifact_id, r.created_at DESC, r.id DESC`).map(row => [row.artifact_id as string, { reviewerId: row.reviewer_id as AgentId, state: text(row.state), decidedAt: isoOrNull(row.decided_at) }])) : new Map();
    for (const row of artifacts) {
      const target = role(row.author_agent_id, row.mode);
      if (target) target.latestArtifact = { id: text(row.id), taskId: text(row.task_id), title: shorten(row.title, 200), revision: Number(row.revision), artifactHash: text(row.artifact_hash), createdAt: iso(row.created_at), current: row.current === true, review: artifactReviews.get(text(row.id)) ?? null };
    }
    for (const row of await tx`SELECT DISTINCT ON (a.author_agent_id, t.mode) a.author_agent_id, t.mode, a.id, a.task_id, a.revision, a.created_at FROM backoffice.office_artifacts a JOIN backoffice.office_tasks t ON t.id=a.task_id WHERE a.producer_run_id IS NULL ${scoped(tx, 'a', workspaceId)} ORDER BY a.author_agent_id, t.mode, a.created_at DESC, a.revision DESC`) {
      const target = role(row.author_agent_id, row.mode);
      if (target && (!target.latestArtifact || iso(row.created_at) > target.latestArtifact.createdAt)) target.latestOwnerRevision = { id: text(row.id), taskId: text(row.task_id), revision: Number(row.revision), createdAt: iso(row.created_at) };
    }
    // Reviews are timed by their decision, not by when the author's draft created the pending row.
    for (const row of await tx`SELECT DISTINCT ON (r.reviewer_id, t.mode) r.reviewer_id, t.mode, r.id, r.task_id, r.artifact_id, a.author_agent_id, r.state, r.decided_at FROM backoffice.office_reviews r JOIN backoffice.office_tasks t ON t.id=r.task_id JOIN backoffice.office_artifacts a ON a.id=r.artifact_id WHERE r.decided_at IS NOT NULL ${scoped(tx, 'r', workspaceId)} ORDER BY r.reviewer_id, t.mode, r.decided_at DESC, r.id DESC`) {
      const target = role(row.reviewer_id, row.mode);
      if (target) target.latestReviewGiven = { id: text(row.id), taskId: text(row.task_id), artifactId: text(row.artifact_id), authorAgentId: row.author_agent_id as AgentId, state: text(row.state), decidedAt: isoOrNull(row.decided_at) };
    }
    for (const row of await tx`SELECT DISTINCT ON (t.agent_id, t.mode) t.agent_id, t.mode, t.id, t.blocked_reason, t.updated_at FROM backoffice.office_tasks t WHERE t.state='blocked' ${scoped(tx, 't', workspaceId)} ORDER BY t.agent_id, t.mode, t.updated_at DESC, t.id`) {
      const target = role(row.agent_id, row.mode);
      if (target) target.blocked = { taskId: text(row.id), reason: row.blocked_reason === null ? null : shorten(row.blocked_reason, 240), since: iso(row.updated_at) };
    }
    for (const row of await tx`SELECT DISTINCT ON (t.agent_id, t.mode) t.agent_id, t.mode, t.id FROM backoffice.office_tasks t WHERE t.state NOT IN ('completed','cancelled') ${scoped(tx, 't', workspaceId)} ORDER BY t.agent_id, t.mode, t.updated_at DESC, t.id`) {
      const target = role(row.agent_id, row.mode); if (target) target.focusTaskId = text(row.id);
    }
    for (const target of roles.values()) if (target.activeRun) target.focusTaskId = target.activeRun.taskId;
    return [...roles.values()];
  }

  async function family(tx: Tx, workspaceId: string, taskId: string): Promise<OfficeFamily | null> {
    const [anchor] = await tx`SELECT COALESCE(t.parent_task_id, t.id) AS root FROM backoffice.office_tasks t WHERE t.id=${taskId} AND t.workspace_id=${workspaceId}`;
    if (!anchor) return null;
    const root = text(anchor.root);
    const tasks = await tx`SELECT t.*, w.scope_key, w.project_key FROM backoffice.office_tasks t JOIN backoffice.office_workspaces w ON w.id=t.workspace_id WHERE t.workspace_id=${workspaceId} AND (t.id=${root} OR t.parent_task_id=${root}) ORDER BY t.created_at DESC, t.id`;
    const ids = tasks.map(row => row.id as string);
    const [artifacts, reviews, approvals, events] = await Promise.all([
      tx`SELECT a.*, w.scope_key, w.project_key FROM backoffice.office_artifacts a JOIN backoffice.office_workspaces w ON w.id=a.workspace_id WHERE a.workspace_id=${workspaceId} AND a.task_id IN ${tx(ids)} ORDER BY a.created_at DESC`,
      tx`SELECT * FROM backoffice.office_reviews WHERE workspace_id=${workspaceId} AND task_id IN ${tx(ids)} ORDER BY created_at DESC`,
      tx`SELECT * FROM backoffice.office_approvals WHERE workspace_id=${workspaceId} AND task_id IN ${tx(ids)} ORDER BY created_at DESC`,
      tx`SELECT e.*, w.scope_key, w.project_key FROM backoffice.office_events e JOIN backoffice.office_workspaces w ON w.id=e.workspace_id WHERE e.workspace_id=${workspaceId} AND e.task_id IN ${tx(ids)} ORDER BY e.occurred_at DESC, e.sequence DESC LIMIT ${FAMILY_EVENT_LIMIT}`,
    ]);
    return { rootTaskId: root, tasks: tasks.map(mapTask), artifacts: artifacts.map(mapArtifact), reviews: reviews.map(mapReview), approvals: approvals.map(mapApproval), events: events.map(mapEvent) };
  }

  // A live provider counts only while its worker heartbeat is fresh, judged in database time.
  async function executionCapability(tx: Tx): Promise<OfficeExecutionCapability> {
    const [liveWorker] = await tx`SELECT capabilities FROM backoffice.office_workers WHERE NOT stopping AND adapter='openai_responses' AND heartbeat_at>now()-(${WORKER_ONLINE_THRESHOLD_SECONDS}*interval '1 second') ORDER BY heartbeat_at DESC LIMIT 1`;
    const [budget] = await tx`SELECT b.*, (SELECT COALESCE(sum(COALESCE(r.usage_microunits,r.budget_reserved_microunits)),0)::bigint FROM backoffice.office_runs r WHERE r.budget_reserved_microunits>0 AND (r.usage_microunits IS NULL OR r.provider_dispatched_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')) AS month_used FROM backoffice.office_budget b WHERE b.id=1`;
    const [uncertain] = await tx`SELECT EXISTS(SELECT 1 FROM backoffice.office_tool_operations WHERE tool_name='openai_responses' AND state='unknown_outcome') AS held`;
    const advertised = (liveWorker?.capabilities ?? {}) as Record<string, unknown>;
    const label = (value: unknown) => typeof value === 'string' && value ? value.slice(0, 64) : null;
    return {
      adapter: liveWorker ? 'openai_responses' : 'deterministic_demo',
      providerConfigured: !!liveWorker,
      unresolvedModelOutcome: uncertain.held === true,
      commandExecutionEnabled: false,
      provider: liveWorker ? { provider: label(advertised.provider) ?? 'openai', draftModel: label(advertised.draftModel), packageModel: label(advertised.packageModel), reasoningEffort: label(advertised.reasoningEffort) } : null,
      budget: budget ? {
        enabled: budget.live_enabled === true, currency: 'USD',
        monthUsedMicrounits: Number(budget.month_used), monthLimitMicrounits: Number(budget.monthly_limit_microunits),
        lifetimeUsedMicrounits: Number(budget.reserved_microunits) + Number(budget.spent_microunits), lifetimeLimitMicrounits: Number(budget.limit_microunits),
        familyLimitMicrounits: Number(budget.family_limit_microunits), requestLimitMicrounits: Number(budget.request_limit_microunits),
      } : null,
    };
  }

  async function taskExecution(tx: Tx, workspaceId: string | null, extraTaskIds: string[], leased: Awaited<ReturnType<typeof leases>>) {
    const [{ total }] = await tx`SELECT count(*)::int AS total FROM backoffice.office_tasks t WHERE true ${scoped(tx, 't', workspaceId)}`;
    // Cover the runtime snapshot's newest-task window, including created_at ties at its boundary.
    const window = await tx`WITH newest AS (SELECT t.created_at FROM backoffice.office_tasks t WHERE true ${scoped(tx, 't', workspaceId)} ORDER BY t.created_at DESC LIMIT ${OFFICE_TASK_WINDOW}) SELECT t.id FROM backoffice.office_tasks t WHERE t.created_at>=(SELECT min(created_at) FROM newest) ${scoped(tx, 't', workspaceId)}`;
    const ids = [...new Set([...window.map(row => row.id as string), ...extraTaskIds])];
    const tasks = new Map<string, OfficeTaskExecution>(ids.map(id => [id, { taskId: id, activeRun: null, leasedRuns: [], latestRun: null, runs: { total: 0, succeeded: 0, failed: 0, interrupted: 0, cancelled: 0 }, steps: emptySteps(), coordination: null }]));
    let provenance: { artifactId: string; producedByRun: boolean }[] = [];
    if (ids.length) {
      for (const row of await tx`SELECT DISTINCT ON (r.task_id) r.task_id, r.id AS run_id, r.agent_id, r.step, r.state, r.attempt, r.started_at, r.finished_at, r.error_code, r.predecessor_run_id FROM backoffice.office_runs r WHERE r.task_id IN ${tx(ids)} AND r.step IN ${tx([...WORKER_STEPS])} ORDER BY r.task_id, r.started_at DESC, r.id DESC`) tasks.get(text(row.task_id))!.latestRun = mapRun(row);
      for (const row of await tx`SELECT r.task_id, count(*)::int AS total, count(*) FILTER (WHERE r.state='succeeded')::int AS succeeded, count(*) FILTER (WHERE r.state='failed')::int AS failed, count(*) FILTER (WHERE r.state='interrupted')::int AS interrupted, count(*) FILTER (WHERE r.state='cancelled')::int AS cancelled FROM backoffice.office_runs r WHERE r.task_id IN ${tx(ids)} AND r.step IN ${tx([...WORKER_STEPS])} GROUP BY r.task_id`) tasks.get(text(row.task_id))!.runs = { total: row.total as number, succeeded: row.succeeded as number, failed: row.failed as number, interrupted: row.interrupted as number, cancelled: row.cancelled as number };
      for (const row of await tx`SELECT DISTINCT ON (r.task_id) r.task_id, r.id, r.step, r.started_at FROM backoffice.office_runs r WHERE r.task_id IN ${tx(ids)} AND r.step IN ${tx([...COORDINATION_STEPS])} ORDER BY r.task_id, r.started_at DESC, r.id DESC`) tasks.get(text(row.task_id))!.coordination = { runId: text(row.id), step: text(row.step), recordedAt: iso(row.started_at) };
      for (const row of await tx`SELECT r.task_id, count(*) FILTER (WHERE r.provider_dispatched_at IS NOT NULL)::int AS requests, COALESCE(sum(r.usage_microunits),0)::bigint AS charged, COALESCE(sum(r.budget_reserved_microunits) FILTER (WHERE r.usage_microunits IS NULL),0)::bigint AS open FROM backoffice.office_runs r WHERE r.task_id IN ${tx(ids)} AND r.budget_reserved_microunits>0 GROUP BY r.task_id`) tasks.get(text(row.task_id))!.metering = { requests: row.requests as number, chargedMicrounits: Number(row.charged), openReservationMicrounits: Number(row.open) };
      for (const row of await tx`SELECT d.task_id,
          count(*) FILTER (WHERE d.state='pending')::int AS pending,
          count(*) FILTER (WHERE ${runnable(tx)})::int AS runnable,
          count(*) FILTER (WHERE d.state='pending' AND ${unmetDependencies(tx)})::int AS waiting_dependencies,
          count(*) FILTER (WHERE d.state='pending' AND d.available_at>now())::int AS retry_scheduled,
          min(d.available_at) FILTER (WHERE d.state='pending' AND d.available_at>now()) AS next_retry_at,
          count(*) FILTER (WHERE d.state='leased')::int AS leased, count(*) FILTER (WHERE d.state='done')::int AS done,
          count(*) FILTER (WHERE d.state='exhausted')::int AS exhausted, count(*) FILTER (WHERE d.state='cancelled')::int AS cancelled
        FROM backoffice.office_dispatch d JOIN backoffice.office_tasks t ON t.id=d.task_id WHERE d.task_id IN ${tx(ids)} GROUP BY d.task_id`) {
        tasks.get(text(row.task_id))!.steps = { pending: row.pending as number, runnable: row.runnable as number, waitingOnDependencies: row.waiting_dependencies as number, retryScheduled: row.retry_scheduled as number, nextRetryAt: isoOrNull(row.next_retry_at), leased: row.leased as number, done: row.done as number, exhausted: row.exhausted as number, cancelled: row.cancelled as number };
      }
      for (const { run } of leased) {
        const target = tasks.get(run.taskId);
        if (!target || target.leasedRuns.some(entry => entry.id === run.id)) continue;
        target.leasedRuns.push(run);
        if (!target.activeRun || (!target.activeRun.leaseLive && run.leaseLive)) target.activeRun = run;
      }
      provenance = (await tx`SELECT a.id, a.producer_run_id FROM backoffice.office_artifacts a WHERE a.task_id IN ${tx(ids)}`).map(row => ({ artifactId: text(row.id), producedByRun: row.producer_run_id !== null }));
    }
    return { tasks: [...tasks.values()], provenance, taskWindow: { limit: OFFICE_TASK_WINDOW, covered: window.length, total: total as number } };
  }

  /**
   * Role and run evidence for a workspace scope. `task` additionally returns that
   * task's whole package family, rechecked against its own workspace.
   */
  async function activity({ workspaceId = null, task = null }: { workspaceId?: string | null; task?: { workspaceId: string; taskId: string } | null } = {}): Promise<OfficeActivity> {
    return readOnly(async tx => {
      const [{ now }] = await tx`SELECT now() AS now`;
      const linkedFamily = task ? await family(tx, task.workspaceId, task.taskId) : null;
      const leased = await leases(tx, workspaceId);
      const familyLeases = task && workspaceId && task.workspaceId !== workspaceId ? await leases(tx, task.workspaceId) : [];
      const execution = await taskExecution(tx, workspaceId, linkedFamily?.tasks.map(entry => entry.id) ?? [], [...leased, ...familyLeases]);
      return { generatedAt: iso(now), scope: { workspaceId }, worker: await worker(tx), execution: await executionCapability(tx), roles: await roleActivity(tx, workspaceId, leased), ...execution, family: linkedFamily };
    });
  }

  async function dashboard(): Promise<Extract<OfficeDashboardData, { state: 'available' }>> {
    return readOnly(async tx => {
      const [{ now }] = await tx`SELECT now() AS now`;
      const modes = Object.fromEntries(MODES.map(mode => [mode, { mode, workspaces: 0, tasks: emptyStateCounts(), steps: { runnable: 0, waitingOnDependencies: 0, retryScheduled: 0, leasedLive: 0, stalled: 0, exhausted: 0 }, decisions: { pending: 0, renewal: 0, approved: 0, rejected: 0 } } satisfies OfficeModeSummary])) as Record<OfficeMode, OfficeModeSummary>;
      const summary = (mode: unknown) => modes[mode as OfficeMode];
      for (const row of await tx`SELECT mode, count(*)::int AS n FROM backoffice.office_workspaces GROUP BY mode`) if (summary(row.mode)) summary(row.mode).workspaces = row.n as number;
      for (const row of await tx`SELECT t.mode, t.state, (t.parent_task_id IS NULL) AS parent, count(*)::int AS n, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM backoffice.office_dispatch d WHERE d.task_id=t.id AND d.state='leased' AND d.lease_until>now()))::int AS idle FROM backoffice.office_tasks t GROUP BY 1,2,3`) {
        const target = summary(row.mode); const key = bucket(text(row.state));
        if (!target) continue;
        target.tasks.total += row.n as number;
        if (row.parent === true) target.tasks.parents += row.n as number;
        if (key) target.tasks[key] += row.n as number;
        if (row.state === 'in_progress') target.tasks.startedNotExecuting += row.idle as number;
      }
      for (const row of await tx`SELECT t.mode,
          count(*) FILTER (WHERE ${runnable(tx)})::int AS runnable,
          count(*) FILTER (WHERE d.state='pending' AND ${unmetDependencies(tx)})::int AS waiting_dependencies,
          count(*) FILTER (WHERE d.state='pending' AND d.available_at>now() AND t.state NOT IN ('completed','cancelled'))::int AS retry_scheduled,
          count(*) FILTER (WHERE d.state='leased' AND d.lease_until>now())::int AS live,
          count(*) FILTER (WHERE d.state='leased' AND (d.lease_until IS NULL OR d.lease_until<=now()))::int AS stalled,
          count(*) FILTER (WHERE d.state='exhausted' AND t.state NOT IN ('completed','cancelled'))::int AS exhausted,
          count(DISTINCT d.task_id) FILTER (WHERE d.state='leased' AND d.lease_until>now())::int AS executing
        FROM backoffice.office_dispatch d JOIN backoffice.office_tasks t ON t.id=d.task_id GROUP BY t.mode`) {
        const target = summary(row.mode); if (!target) continue;
        target.steps = { runnable: row.runnable as number, waitingOnDependencies: row.waiting_dependencies as number, retryScheduled: row.retry_scheduled as number, leasedLive: row.live as number, stalled: row.stalled as number, exhausted: row.exhausted as number };
        target.tasks.executing = row.executing as number;
      }
      // Decisions are keyed to packages awaiting the owner, so a paused package is never shown as decidable.
      for (const row of await tx`SELECT t.mode, count(*) FILTER (WHERE ${liveDecision(tx)})::int AS pending, count(*) FILTER (WHERE NOT ${liveDecision(tx)} AND ${expiredDecision(tx)})::int AS renewal FROM backoffice.office_tasks t WHERE t.state='waiting_for_owner_approval' GROUP BY t.mode`) {
        const target = summary(row.mode); if (target) Object.assign(target.decisions, { pending: row.pending, renewal: row.renewal });
      }
      for (const row of await tx`SELECT t.mode, count(*) FILTER (WHERE a.state='approved')::int AS approved, count(*) FILTER (WHERE a.state='rejected')::int AS rejected FROM backoffice.office_approvals a JOIN backoffice.office_tasks t ON t.id=a.task_id GROUP BY t.mode`) {
        const target = summary(row.mode); if (target) Object.assign(target.decisions, { approved: row.approved, rejected: row.rejected });
      }
      const roles = await roleActivity(tx, null, await leases(tx, null));
      const dashboardRoles = AGENT_IDS.map(agentId => {
        const demo = roles.find(entry => entry.agentId === agentId && entry.mode === 'demo')!;
        const live = roles.find(entry => entry.agentId === agentId && entry.mode === 'live')!;
        const times = [demo, live].flatMap(entry => [entry.lastEvent?.occurredAt, entry.latestRun?.finishedAt ?? entry.latestRun?.startedAt]).filter((value): value is string => !!value).sort();
        return { agentId, demo: demo.counts, live: live.counts, lastActivityAt: times.at(-1) ?? null };
      });
      const latestDecisions = await tx`SELECT t.id AS task_id, t.workspace_id, t.mode, t.goal, w.name AS workspace_name, ar.revision, a.id AS approval_id, a.created_at, a.expires_at, NOT ${liveDecision(tx)} AS renewal FROM backoffice.office_tasks t JOIN backoffice.office_workspaces w ON w.id=t.workspace_id JOIN backoffice.office_artifacts ar ON ar.id=t.current_artifact_id
        JOIN LATERAL (SELECT a.* FROM backoffice.office_approvals a WHERE a.task_id=t.id AND a.artifact_id=t.current_artifact_id AND a.state IN ('pending','expired') ORDER BY (a.state='pending' AND a.expires_at>now()) DESC, a.created_at DESC LIMIT 1) a ON true
        WHERE t.state='waiting_for_owner_approval' ORDER BY a.created_at DESC, t.id LIMIT ${DASHBOARD_WINDOWS.decisions}`;
      const outputs = await tx`SELECT r.id AS review_id, r.reviewer_id, r.decided_at, a.id AS artifact_id, a.title, a.revision, a.author_agent_id, (a.producer_run_id IS NULL) AS owner_prepared, t.id AS task_id, t.workspace_id, t.mode, t.state AS task_state, t.current_artifact_id, t.acceptance_evidence_id FROM backoffice.office_reviews r JOIN backoffice.office_artifacts a ON a.id=r.artifact_id JOIN backoffice.office_tasks t ON t.id=r.task_id WHERE r.state='passed' ORDER BY r.decided_at DESC NULLS LAST, r.id DESC LIMIT ${DASHBOARD_WINDOWS.outputs}`;
      const events = await tx`SELECT e.id, e.event_type, e.occurred_at, e.actor_type, e.actor_id, e.run_id, e.mode, e.task_id, e.workspace_id, t.goal, r.step AS run_step FROM backoffice.office_events e LEFT JOIN backoffice.office_tasks t ON t.id=e.task_id AND t.workspace_id=e.workspace_id LEFT JOIN backoffice.office_runs r ON r.id=e.run_id ORDER BY e.occurred_at DESC, e.sequence DESC, e.id DESC LIMIT ${DASHBOARD_WINDOWS.events}`;
      return {
        state: 'available' as const,
        generatedAt: iso(now),
        worker: await worker(tx),
        execution: await executionCapability(tx),
        modes,
        roles: dashboardRoles,
        decisions: {
          pending: modes.demo.decisions.pending + modes.live.decisions.pending,
          renewal: modes.demo.decisions.renewal + modes.live.decisions.renewal,
          latest: latestDecisions.map(row => ({ approvalId: text(row.approval_id), link: { mode: row.mode as OfficeMode, workspaceId: text(row.workspace_id), taskId: text(row.task_id), view: 'inbox' as const }, goal: shorten(row.goal), workspaceName: shorten(row.workspace_name, 80), revision: Number(row.revision), createdAt: iso(row.created_at), expiresAt: iso(row.expires_at), renewalNeeded: row.renewal === true })),
        },
        outputs: outputs.map(row => ({
          reviewId: text(row.review_id), artifactId: text(row.artifact_id),
          link: { mode: row.mode as OfficeMode, workspaceId: text(row.workspace_id), taskId: text(row.task_id), artifactId: text(row.artifact_id), view: 'tasks' as const },
          title: shorten(row.title, 160), revision: Number(row.revision), authorAgentId: row.author_agent_id as AgentId, ownerPrepared: row.owner_prepared === true, reviewerId: row.reviewer_id as AgentId, decidedAt: isoOrNull(row.decided_at),
          status: row.current_artifact_id !== row.artifact_id ? 'superseded' as const : row.task_state === 'completed' && row.acceptance_evidence_id ? 'owner_accepted' as const : 'review_passed' as const,
        })),
        events: events.map(row => ({
          eventId: text(row.id), eventType: text(row.event_type), occurredAt: iso(row.occurred_at), actorType: row.actor_type as 'owner' | 'agent' | 'worker',
          agentId: row.actor_type === 'agent' && AGENT_IDS.includes(row.actor_id as AgentId) ? row.actor_id as AgentId : null,
          ownerRecordedUnderRole: row.actor_type === 'agent' && row.run_id === null,
          coordination: (COORDINATION_STEPS as readonly string[]).includes(text(row.run_step)) || (row.event_type === 'work_started' && (row.actor_type === 'owner' || row.actor_id === 'scheduler')),
          mode: row.mode as OfficeMode,
          link: row.task_id ? { mode: row.mode as OfficeMode, workspaceId: text(row.workspace_id), taskId: text(row.task_id), view: 'tasks' as const } : null,
          goal: row.goal === null || row.goal === undefined ? null : shorten(row.goal),
        })),
        windows: DASHBOARD_WINDOWS,
      };
    });
  }

  /** Recheck a deep link's mode, workspace and task scope. Mismatches look identical to absence. */
  async function resolveLink(request: Extract<OfficeLinkRequest, { kind: 'link' }>): Promise<OfficeLinkState> {
    return readOnly(async tx => {
      const notFound: OfficeLinkState = { status: 'not_found', mode: request.mode };
      if (request.workspaceId) {
        const [workspace] = await tx`SELECT mode FROM backoffice.office_workspaces WHERE id=${request.workspaceId}`;
        if (!workspace || workspace.mode !== request.mode) return notFound;
      }
      if (request.taskId) {
        const [task] = await tx`SELECT 1 FROM backoffice.office_tasks WHERE id=${request.taskId} AND workspace_id=${request.workspaceId} AND mode=${request.mode}`;
        if (!task) return notFound;
      }
      let artifact: 'none' | 'found' | 'not_found' = 'none';
      if (request.artifactId) {
        const [row] = await tx`SELECT 1 FROM backoffice.office_artifacts WHERE id=${request.artifactId} AND task_id=${request.taskId} AND workspace_id=${request.workspaceId}`;
        artifact = row ? 'found' : 'not_found';
      }
      // The requested revision id is kept even when it is not found, so the page can keep saying
      // so instead of substituting another revision; nothing about other records is returned.
      return { status: 'ok', mode: request.mode, workspaceId: request.workspaceId, taskId: request.taskId, artifactId: request.artifactId, artifact, view: request.view };
    });
  }

  async function workspaces(): Promise<OfficeWorkspace[]> {
    const rows = await sql`SELECT id, name, scope, scope_key, project_key, mode FROM backoffice.office_workspaces ORDER BY mode, name`;
    return rows.map(row => ({ id: text(row.id), name: text(row.name), clientId: text(row.scope_key), projectId: text(row.project_key), scope: row.scope as OfficeWorkspace['scope'], mode: row.mode as OfficeMode }));
  }

  return { activity, dashboard, resolveLink, workspaces };
}

export type OfficeReadModel = ReturnType<typeof createOfficeReadModel>;
