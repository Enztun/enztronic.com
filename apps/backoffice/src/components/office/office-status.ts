import type { OfficeApproval, OfficeArtifact, OfficeHealth, OfficeMode, OfficeReview, OfficeTask } from "@/lib/office-contracts";
import { WORKER_ONLINE_THRESHOLD_SECONDS, type OfficeActiveRun, type OfficeActivity, type OfficeAvailability, type OfficeExecutionCapability, type OfficeRoleActivity, type OfficeTaskExecution } from "@/lib/office-activity";
import { formatUsd } from "@/lib/office-runtime/live-pricing";

import { profileName, stateLabel } from "./profiles";

// Pure presentation rules for Office status. Indicators come only from
// persisted records and their timestamps: a portrait, animation, generated
// prose or a fresh page load is never treated as execution evidence.

const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8) : "unavailable");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const STEP_LABELS: Record<string, string> = { draft: "draft", review: "independent review", package: "package assembly", package_review: "package review", delegate_internal_demo: "delegation", resume_internal_dependencies: "resume check" };
export const stepLabel = (step: string) => STEP_LABELS[step] ?? step.replaceAll("_", " ");
// Activity phrasing for an actor's own recorded event (status presets describe the task, not the actor).
const ACTIVITY_LABELS: Record<string, string> = {
  task_queued: "Task queued", task_assigned: "Task assigned", work_started: "Step started", artifact_created: "Draft revision saved",
  review_requested: "Independent review requested", handoff_accepted: "Review handoff accepted", review_passed: "Review passed",
  review_changes_requested: "Changes requested", owner_approval_requested: "Owner decision requested", owner_approved: "Owner accepted the package",
  task_completed: "Task completed", work_blocked: "Work blocked", work_paused: "Work paused", task_cancelled: "Task cancelled", run_failed: "Step failed",
  pause_requested: "Pause requested", cancel_requested: "Cancellation requested", task_note_added: "Owner note recorded", task_reassigned: "Task reassigned",
  task_reprioritized: "Priority changed", tool_operation_recorded: "Tool operation recorded", tool_operation_reconciled: "Tool outcome reconciled",
};
export const activityLabel = (eventType: string) => ACTIVITY_LABELS[eventType] ?? "Office update recorded";
export function ago(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "unknown";
  const value = Math.max(0, Math.round(seconds));
  if (value < 90) return `${value} s ago`;
  if (value < 5400) return `${Math.round(value / 60)} min ago`;
  return `${Math.round(value / 3600)} h ago`;
}

// -- brief submission ---------------------------------------------------------

export type RequestFailure = { status?: number; code?: string; aborted?: boolean };

/**
 * A definitive rejection proves the request saved nothing (auth, validation,
 * scope or idempotency conflict, or Office switched off before any write).
 * Network loss, timeouts and server/storage errors may have committed.
 */
export function classifySubmitFailure(failure: RequestFailure): "rejected" | "uncertain" {
  if (failure.aborted || failure.status === undefined) return "uncertain";
  if (failure.status === 503) return failure.code === "configuration_required" ? "rejected" : "uncertain";
  if ([400, 401, 403, 404, 409, 413, 422].includes(failure.status)) return "rejected";
  return "uncertain";
}

/**
 * Only a first attempt that was definitively rejected may release its
 * submission key. Once any attempt was uncertain, the original may exist,
 * so the same payload and key stay locked until a 2xx reconciles it.
 */
export function nextSubmitLock(previouslyUncertain: boolean, outcome: "rejected" | "uncertain"): { keepLocked: boolean; uncertain: boolean } {
  if (previouslyUncertain) return { keepLocked: true, uncertain: true };
  return outcome === "rejected" ? { keepLocked: false, uncertain: false } : { keepLocked: true, uncertain: true };
}

// -- worker and page-data freshness -------------------------------------------

export type WorkerState = "online" | "offline" | "stopped" | "never_seen" | "unknown" | "not_activated";
export type WorkerIndicator = { state: WorkerState; label: string; detail: string; ageSeconds: number | null };

export function workerIndicator(input: { availability: OfficeAvailability; activity: OfficeActivity | null; evidenceAgeMs: number; health: OfficeHealth; stale: boolean }): WorkerIndicator {
  if (input.availability !== "available") return { state: "not_activated", label: "Worker not activated", detail: "Office is not available on this server, so no worker status is read.", ageSeconds: null };
  const worker = input.activity?.worker;
  // Age from database time at the server, advanced by local monotonic time since the request was sent; no clock-skew assumptions.
  const elapsed = Math.max(0, input.evidenceAgeMs) / 1000;
  const ageSeconds = worker?.heartbeatAgeSeconds === null || worker?.heartbeatAgeSeconds === undefined ? null : worker.heartbeatAgeSeconds + elapsed;
  const confirmed = worker ? (worker.online && ageSeconds !== null && ageSeconds < WORKER_ONLINE_THRESHOLD_SECONDS ? "online" : "offline") : input.health.workerOnline ? "online" : "offline";
  if (input.stale) return { state: "unknown", label: "Worker status unavailable", detail: `Status data is stale or failed to load. Last confirmed: worker ${confirmed}${worker?.lastHeartbeatAt ? `, heartbeat ${ago(ageSeconds)}` : ""}.`, ageSeconds };
  if (!worker) return input.health.workerOnline ? { state: "online", label: "Worker online", detail: "Heartbeat within 60 s (detailed run evidence unavailable).", ageSeconds: null } : { state: "offline", label: "Worker offline", detail: "No current heartbeat. Saved tasks wait in the queue.", ageSeconds: null };
  if (worker.workersSeen === 0) return { state: "never_seen", label: "No worker connected", detail: "No worker heartbeat has ever been recorded. Saved tasks stay queued until a worker runs.", ageSeconds: null };
  if (confirmed === "online") return { state: "online", label: "Worker online", detail: `Heartbeat ${ago(ageSeconds)} (online below ${worker.onlineThresholdSeconds} s).`, ageSeconds };
  const latest = worker.latest;
  if (latest?.stopping && (!worker.lastHeartbeatAt || Date.parse(latest.heartbeatAt) >= Date.parse(worker.lastHeartbeatAt))) return { state: "stopped", label: "Worker stopped", detail: `A graceful stop was recorded ${ago(latest.ageSeconds + elapsed)}. Saved tasks wait in the queue.`, ageSeconds };
  return { state: "offline", label: "Worker offline", detail: `Last heartbeat ${ago(ageSeconds)}; offline after ${worker.onlineThresholdSeconds} s. The process may be stopped, crashed, or the PC asleep. Saved tasks wait in the queue.`, ageSeconds };
}

export type FreshnessState = "fresh" | "stale" | "offline" | "denied" | "never";
export function dataFreshness(input: { lastConfirmedAt: string | null; now: number; offline: boolean; syncError: string | null; denied: boolean; staleAfterMs: number }): { state: FreshnessState; label: string; ageSeconds: number | null } {
  const ageSeconds = input.lastConfirmedAt ? Math.max(0, (input.now - Date.parse(input.lastConfirmedAt)) / 1000) : null;
  if (input.denied) return { state: "denied", label: "Session unavailable", ageSeconds };
  if (input.offline) return { state: "offline", label: "Browser offline", ageSeconds };
  if (ageSeconds === null) return { state: "never", label: "Not yet confirmed", ageSeconds };
  if (input.syncError || ageSeconds * 1000 > input.staleAfterMs) return { state: "stale", label: `Stale · confirmed ${ago(ageSeconds)}`, ageSeconds };
  return { state: "fresh", label: `Confirmed ${ago(ageSeconds)}`, ageSeconds };
}

// -- saving availability --------------------------------------------------------

export type PersistenceState = { canSave: boolean; tone: "blocked" | "caution" | "ready"; title: string; detail: string };

/** Saving depends only on Office storage, the session and fresh records, never on worker or run telemetry. */
export function persistenceState(input: { availability: OfficeAvailability; denied: boolean; offline: boolean; stale: boolean; mode: OfficeMode; workspaceAvailable: boolean; worker: WorkerIndicator }): PersistenceState {
  if (input.denied) return { canSave: false, tone: "blocked", title: "Saving is blocked: the owner session is unavailable", detail: "Re-enter through the private backoffice. Re-authentication reloads this page and discards text kept in tab memory, so copy or download your draft first." };
  if (input.availability === "disabled") return { canSave: false, tone: "blocked", title: "Saving is unavailable: Office is switched off on this server", detail: "OFFICE_ENABLED is not \"true\", so no Office record is read or written. Saving needs the reviewed additive migration 003 applied, a dedicated least-privilege worker, and Office enabled during an authorized activation window. You can still draft here, then copy or download the text." };
  if (input.availability === "storage_unavailable") return { canSave: false, tone: "blocked", title: "Saving is unavailable: Office storage could not be read", detail: "Office is enabled, but its records could not be read (for example, migration 003 is not applied or the database is unreachable). Nothing can be saved until storage is available." };
  if (input.offline) return { canSave: false, tone: "blocked", title: "Saving is paused: this browser is offline", detail: "Reconnect, then refresh the confirmed state before saving." };
  if (input.stale) return { canSave: false, tone: "blocked", title: "Saving is paused: Office records are unconfirmed", detail: "Refresh to reconcile the last confirmed records before saving." };
  if (!input.workspaceAvailable) return { canSave: false, tone: "blocked", title: `Saving is unavailable: no registered ${input.mode === "demo" ? "demonstration" : "internal"} workspace`, detail: "A brief can only be saved into an explicitly registered internal workspace." };
  if (input.mode === "live") return { canSave: true, tone: "caution", title: "Saving is available; live execution is not configured", detail: "The brief is stored as a durable task and recorded as blocked (configuration_required). No provider, budget or runtime limits exist, so nothing will run." };
  const worker = input.worker.state === "online" ? "The worker is online; a step shows as executing only once a run holds a lease." : input.worker.state === "unknown" ? "Worker status is currently unavailable; execution is shown only from recorded runs." : `${input.worker.label}: nothing executes until a worker runs. The saved task waits in the queue.`;
  return { canSave: true, tone: input.worker.state === "online" ? "ready" : "caution", title: "Saving creates a durable demonstration task", detail: `A saved brief survives reload and browser closure. Saving and execution are separate: ${worker}` };
}

// -- lease evidence ageing -------------------------------------------------------

// A lease read from the server stops proving execution as time passes, whether or not
// the next poll succeeds. Its server-relative remaining time is aged by the browser's
// monotonic elapsed time since the status request was SENT. The database read happened
// after that, so the estimate can only run out early, never late. The browser's wall
// clock is never compared with a database timestamp.

export type LeaseState = "live" | "expired_at_read" | "expired_since_read";
export type LeaseNow = { state: LeaseState; remainingMs: number | null };
type LeaseEvidence = { leaseLive: boolean; leaseRemainingMs?: number | null };

/** Monotonic milliseconds since the evidence was requested. Before the first client tick, 0. */
export function evidenceAge(observedAt: number, now: number | null): number {
  return now === null ? 0 : Math.max(0, now - observedAt);
}

export function leaseNow(run: LeaseEvidence, evidenceAgeMs: number): LeaseNow {
  const remaining = typeof run.leaseRemainingMs === "number" && Number.isFinite(run.leaseRemainingMs) ? run.leaseRemainingMs : null;
  if (!run.leaseLive || (remaining !== null && remaining <= 0)) return { state: "expired_at_read", remainingMs: remaining };
  // A lease without server-relative remaining time cannot be aged, so it is never shown as current.
  const left = remaining === null ? null : remaining - Math.max(0, evidenceAgeMs);
  return left !== null && left > 0 ? { state: "live", remainingMs: left } : { state: "expired_since_read", remainingMs: left };
}

/** A leased run's recorded state; an open run record without a live lease is never worded as running. */
export function leasedRunState(run: { state: string }, lease: LeaseNow | null): string {
  return lease?.state !== "live" && run.state === "running" ? "run record still open" : stateLabel(run.state);
}

/** Wording around a lease's database expiry time, from aged evidence only. */
export function leaseWording(lease: LeaseNow | null): { before: string; after: string } {
  switch (lease?.state) {
    case "live": return { before: "lease held until", after: "" };
    case "expired_at_read": return { before: "lease expired at", after: " · durable recovery pending" };
    case "expired_since_read": return { before: "lease ran out at", after: " per the last status read · awaiting fresh status" };
    default: return { before: "lease unavailable", after: "" };
  }
}

const stopRequested = (run: OfficeActiveRun) => run.state === "pause_requested" || run.state === "cancel_requested";
export type AgedLeases = { activeRun: OfficeActiveRun | null; lease: LeaseNow | null; executing: number; stalled: number; stopping: number };

const leasedOf = (source: { activeRun: OfficeActiveRun | null; leasedRuns?: OfficeActiveRun[] }) => (source.leasedRuns?.length ? source.leasedRuns : source.activeRun ? [source.activeRun] : []);

// The run shown is the newest live lease, else the newest expired one (runs arrive newest first).
function ageLeases(runs: OfficeActiveRun[], evidenceAgeMs: number): AgedLeases {
  const aged = runs.map((run) => ({ run, lease: leaseNow(run, evidenceAgeMs) }));
  const live = aged.filter((entry) => entry.lease.state === "live");
  const shown = live[0] ?? aged[0] ?? null;
  return { activeRun: shown?.run ?? null, lease: shown?.lease ?? null, executing: live.length, stalled: aged.length - live.length, stopping: live.filter((entry) => stopRequested(entry.run)).length };
}

/** A role's lease evidence as of now: the run to show, lease counts and any review in progress, aged together. */
export function agedRole(role: OfficeRoleActivity, evidenceAgeMs: number): AgedLeases & { reviewInProgress: OfficeRoleActivity["reviewInProgress"] } {
  const review = role.reviewInProgress;
  const reviewLive = !!review && leaseNow({ leaseLive: true, leaseRemainingMs: review.leaseRemainingMs }, evidenceAgeMs).state === "live";
  return { ...ageLeases(leasedOf(role), evidenceAgeMs), reviewInProgress: reviewLive ? review : null };
}

/** A task's lease evidence as of now. */
export function agedExecution(execution: OfficeTaskExecution, evidenceAgeMs: number): AgedLeases {
  return ageLeases(leasedOf(execution), evidenceAgeMs);
}

/** Milliseconds until aged evidence next changes: a lease running out or the heartbeat passing the online threshold. */
export function nextEvidenceChangeMs(activity: OfficeActivity | null, evidenceAgeMs: number): number | null {
  if (!activity) return null;
  const waits: number[] = [];
  const add = (run: LeaseEvidence) => { const lease = leaseNow(run, evidenceAgeMs); if (lease.state === "live" && lease.remainingMs !== null) waits.push(lease.remainingMs); };
  for (const role of activity.roles) {
    for (const run of leasedOf(role)) add(run);
    if (role.reviewInProgress) add({ leaseLive: true, leaseRemainingMs: role.reviewInProgress.leaseRemainingMs });
  }
  for (const task of activity.tasks) for (const run of leasedOf(task)) add(run);
  const { worker } = activity;
  if (worker.online && worker.heartbeatAgeSeconds !== null) {
    const left = (worker.onlineThresholdSeconds - worker.heartbeatAgeSeconds) * 1000 - Math.max(0, evidenceAgeMs);
    if (left > 0) waits.push(left);
  }
  return waits.length ? Math.min(...waits) : null;
}

// -- per-role status ------------------------------------------------------------

export type RoleIndicator =
  | "not_activated" | "unknown" | "not_connected" | "executing" | "reviewing" | "stopping" | "stalled"
  | "waiting_for_owner" | "renewal_needed" | "revision_needed" | "paused" | "needs_recovery" | "retry_scheduled" | "blocked"
  | "review_queued" | "queued" | "waiting_on_dependencies" | "awaiting_review" | "reviewed" | "waiting" | "idle";
export type RoleStatus = { agentId: string; indicator: RoleIndicator; label: string; detail: string; activeTaskId: string | null; runId: string | null; since: string | null; stale: boolean };
type LiveStatus = Omit<RoleStatus, "agentId" | "stale">;

function liveRoleStatus(role: OfficeRoleActivity, worker: WorkerIndicator, evidenceAgeMs: number): LiveStatus {
  const { counts } = role;
  const aged = agedRole(role, evidenceAgeMs);
  const activeRun = aged.activeRun;
  const workerNote = worker.state === "online" ? "waiting for the worker to claim it" : `not executing — ${worker.label.toLowerCase()}`;
  const status = (indicator: RoleIndicator, label: string, detail: string, extra: Partial<LiveStatus> = {}): LiveStatus => ({ indicator, label, detail, activeTaskId: role.focusTaskId, runId: null, since: null, ...extra });
  if (activeRun && aged.lease?.state === "live") {
    const run = { activeTaskId: activeRun.taskId, runId: activeRun.id, since: activeRun.startedAt };
    if (stopRequested(activeRun)) return status("stopping", "Stop requested", `Run ${shortId(activeRun.id)} (${stepLabel(activeRun.step)}) still holds its lease; the ${activeRun.state === "pause_requested" ? "pause" : "cancellation"} takes effect at its next safe point.`, run);
    const reviewing = activeRun.step === "review" || activeRun.step === "package_review";
    return status(reviewing ? "reviewing" : "executing", reviewing ? "Reviewing" : "Executing", `Run ${shortId(activeRun.id)} · ${stepLabel(activeRun.step)} · attempt ${activeRun.attempt} · lease held.`, run);
  }
  const stalled = activeRun ? { activeTaskId: activeRun.taskId, runId: activeRun.id, since: activeRun.leaseUntil } : {};
  // Running out locally is not proof of a failure or a retry: the worker may have renewed the lease since.
  if (activeRun && aged.lease?.state === "expired_since_read") return status("stalled", "Lease expired", `Run ${shortId(activeRun.id)} (${stepLabel(activeRun.step)}) held a lease when status was last read, but that lease has run out since and no newer status confirms a renewal, so it is not shown as executing. If it was not renewed, durable recovery retries it with a new run; this is not a recorded failure.`, stalled);
  if (activeRun) return status("stalled", "Stalled", `Run ${shortId(activeRun.id)} lost its lease (${stepLabel(activeRun.step)}). Durable recovery retries it with a new run; this is not a recorded failure.`, stalled);
  if (counts.decisionsPending) return status("waiting_for_owner", "Owner decision needed", `${plural(counts.decisionsPending, "reviewed package")} awaiting your decision.`);
  if (counts.decisionsRenewal) return status("renewal_needed", "Decision renewal needed", "The decision request expired. Renew it for the same package before deciding.");
  if (counts.changesRequested) return status("revision_needed", "Owner revision required", `${plural(counts.changesRequested, "task")} with requested changes. The demonstration adapter never revises on its own; prepare a revision in the task record.`);
  if (counts.stopping) return status("stopping", "Stop requested", "Waiting for a confirmed safe stop.");
  if (counts.paused) return status("paused", "Paused", "The owner paused this work; it resumes only by owner action.");
  if (counts.exhaustedSteps) return status("needs_recovery", "Recovery decision needed", `Retries are exhausted${role.blocked?.reason ? ` (${role.blocked.reason})` : ""}. Record a retry decision in the task record.`, { activeTaskId: role.blocked?.taskId ?? role.focusTaskId, since: role.blocked?.since ?? null });
  if ((counts.blocked || counts.failed) && counts.retryScheduled) return status("retry_scheduled", "Retry scheduled", "Durable recovery will retry with a new run after its backoff; nothing is executing now.", { activeTaskId: role.blocked?.taskId ?? role.focusTaskId, since: role.nextRetryAt });
  if (counts.blocked || counts.failed) return status("blocked", "Blocked", role.blocked?.reason ? `Blocked: ${role.blocked.reason}` : "A named dependency or recovery decision prevents progress.", { activeTaskId: role.blocked?.taskId ?? role.focusTaskId, since: role.blocked?.since ?? null });
  if (counts.runnableReviews) return status("review_queued", "Review queued", `${plural(counts.runnableReviews, "independent review")} ready to run · ${workerNote}.`);
  if (counts.runnableSteps) return status("queued", "Queued", `${plural(counts.runnableSteps, "step")} ready to run · ${workerNote}.`);
  if (counts.waitingOnDependencies) return status("waiting_on_dependencies", "Waiting on specialists", "The package step waits until every specialist draft passes independent review.");
  if (counts.awaitingReview) {
    const live = aged.reviewInProgress;
    const review = role.latestArtifact?.review;
    return status("awaiting_review", "Awaiting review", live ? `Being reviewed now by ${profileName(live.reviewerId)} (run ${shortId(live.runId)}).` : review?.state === "pending" ? `Revision ${role.latestArtifact?.revision} awaits independent review by ${profileName(review.reviewerId)}.` : "A saved draft awaits independent review.", live ? { activeTaskId: live.taskId } : {});
  }
  if (counts.reviewPassed) return status("reviewed", "Review passed", `${plural(counts.reviewPassed, "draft")} passed independent review; owner acceptance applies only to the parent package.`);
  if (counts.open) return status("waiting", "Waiting", `${plural(counts.open, "open task")}; no step can run now.`);
  return status("idle", "Idle", counts.completed || counts.cancelled ? `No open work here (${counts.completed} completed, ${counts.cancelled} cancelled). Idle is not a failure.` : "No assigned work here. Idle is not a failure.", { activeTaskId: null, since: role.lastEvent?.occurredAt ?? null });
}

// -- live provider ---------------------------------------------------------------

export type LiveUnavailable = { label: string; detail: string };

/** Saving proves persistence. Provider readiness and a recorded run are separate evidence. */
export function savedBriefExecution(mode: OfficeMode, worker: WorkerIndicator, liveBlocked: LiveUnavailable | null | undefined): { tone: 'success' | 'warning'; text: string } {
  if (mode === 'live' && liveBlocked === undefined) return { tone: 'warning', text: 'Live execution status is being refreshed. Saving a task does not confirm that it is executing.' };
  if (mode === 'live' && liveBlocked) return { tone: 'warning', text: `${liveBlocked.detail} The saved task status will refresh shortly.` };
  if (worker.state === 'online') return { tone: 'success', text: 'The worker is online; a step shows as executing only once a run is recorded.' };
  return { tone: 'warning', text: `${worker.label}: nothing is confirmed executing. The specialist steps stay queued until a worker runs.` };
}

/**
 * Why live work cannot run now, or null when a worker holding a live provider has a fresh
 * heartbeat, the owner's live switch is on and every spending limit is set.
 */
export function liveUnavailable(execution: OfficeExecutionCapability | null | undefined): LiveUnavailable | null {
  if (execution?.unresolvedModelOutcome) return { label: "live outcome reconciliation required", detail: "A model request has an unresolved billed outcome. Live work is on hold until the owner reconciles it; do not retry blindly." };
  if (!execution?.providerConfigured) return { label: "live provider not connected", detail: "No live provider is connected on the Office worker, so nothing runs." };
  const budget = execution.budget;
  if (!budget?.enabled) return { label: "live execution switched off", detail: "A live provider is connected, but the owner's live switch is off, so nothing runs." };
  if (![budget.lifetimeLimitMicrounits, budget.monthLimitMicrounits, budget.familyLimitMicrounits, budget.requestLimitMicrounits].every((value) => value > 0)) return { label: "live spending limits not set", detail: "Live spending limits are not all set, so nothing runs." };
  return null;
}
export function liveProviderLabel(execution: OfficeExecutionCapability | null | undefined): string {
  const provider = execution?.providerConfigured ? execution.provider : null;
  if (!provider) return "Not connected";
  const models = [provider.draftModel && `${provider.draftModel} for drafts and reviews`, provider.packageModel && `${provider.packageModel} for the package and its review`].filter(Boolean).join("; ");
  return `OpenAI${models ? ` · ${models}` : ""}${provider.reasoningEffort ? ` · ${provider.reasoningEffort} reasoning` : ""}`;
}
/** Conservative: open reservations count at their full maximum until settled. */
export function liveUsageLine(execution: OfficeExecutionCapability | null | undefined): string {
  const budget = execution?.budget;
  if (!budget || !budget.monthLimitMicrounits) return "Usage / cost: unavailable (no live spending limit set).";
  return `Usage / cost: ${formatUsd(budget.monthUsedMicrounits)} of ${formatUsd(budget.monthLimitMicrounits)} this month (UTC), conservative estimate. Limits: ${formatUsd(budget.requestLimitMicrounits)} per request, ${formatUsd(budget.familyLimitMicrounits)} per proposal, ${formatUsd(budget.lifetimeLimitMicrounits)} overall (${formatUsd(budget.lifetimeUsedMicrounits)} used).`;
}

/**
 * `evidenceAgeMs` is required: lease evidence is only ever presented after ageing.
 * `liveUnavailable` comes from `liveUnavailable(execution)`; when omitted, live work is treated as not connected.
 */
export function deriveRoleStatus(agentId: string, role: OfficeRoleActivity | undefined, ctx: { availability: OfficeAvailability; stale: boolean; mode: OfficeMode; worker: WorkerIndicator; evidenceAgeMs: number; liveUnavailable?: LiveUnavailable | null }): RoleStatus {
  if (ctx.availability !== "available") return { agentId, indicator: "not_activated", label: "Not activated", detail: "Office is not available on this server; no work can be assigned or run.", activeTaskId: null, runId: null, since: null, stale: false };
  if (!role) return { agentId, indicator: "unknown", label: "Status unavailable", detail: "Role evidence has not loaded.", activeTaskId: null, runId: null, since: null, stale: true };
  const unavailable = ctx.liveUnavailable === undefined ? { label: "live provider not connected", detail: "No live provider adapter is configured, so nothing runs." } : ctx.liveUnavailable;
  if (ctx.mode === "live" && unavailable) {
    const blocked = role.counts.blocked;
    return { agentId, indicator: "not_connected", label: "Not connected", detail: `${unavailable.detail}${blocked ? ` ${plural(blocked, "task")} blocked: configuration required.` : ""}`, activeTaskId: role.blocked?.taskId ?? null, runId: null, since: null, stale: ctx.stale };
  }
  const live = liveRoleStatus(role, ctx.worker, ctx.evidenceAgeMs);
  if (ctx.stale) return { agentId, ...live, indicator: "unknown", label: "Status unavailable", detail: `Status data is stale or failed to load. Last confirmed: ${live.label.toLowerCase()}.`, stale: true };
  return { agentId, ...live, stale: false };
}

// -- per-task execution truth ---------------------------------------------------

export type TaskExecutionState = "executing" | "reviewing" | "stopping" | "stalled" | "queued" | "delegated" | "waiting_on_dependencies" | "awaiting_review" | "reviewed" | "waiting_for_owner" | "renewal_needed" | "changes" | "retry_scheduled" | "needs_recovery" | "blocked" | "paused" | "done" | "not_connected" | "unknown";
export type TaskExecutionLine = { state: TaskExecutionState; label: string; at: string | null };
export type TaskDecision = "pending" | "renewal" | "none";

/** Package decision state keyed to the task's current revision, as the inbox and dashboard use it. */
export function taskDecision(task: OfficeTask, approvals: OfficeApproval[], now: number): TaskDecision {
  if (task.state !== "waiting_for_owner_approval" || !task.currentArtifactId) return "none";
  const current = approvals.filter((approval) => approval.taskId === task.id && approval.artifactId === task.currentArtifactId);
  if (current.some((approval) => approval.state === "pending" && Date.parse(approval.expiresAt) > now)) return "pending";
  return current.some((approval) => approval.state === "expired" || approval.state === "pending") ? "renewal" : "none";
}

/** `evidenceAgeMs` is required: lease evidence is only ever presented after ageing. */
export function taskExecutionLine(task: OfficeTask, ctx: { execution: OfficeTaskExecution | undefined; children: OfficeTask[]; worker: WorkerIndicator; stale: boolean; evidenceAgeMs: number; pendingReviewerId?: string | null; decision?: TaskDecision; liveUnavailable?: LiveUnavailable | null }): TaskExecutionLine {
  const line = (state: TaskExecutionState, label: string, at: string | null = null): TaskExecutionLine => ({ state, label, at });
  if (task.state === "completed") return line("done", task.acceptanceEvidenceId ? "Completed · owner-accepted package revision" : "Completed");
  if (task.state === "cancelled") return line("done", "Cancelled · records retained");
  const liveBlocked = ctx.liveUnavailable === undefined ? { label: "live provider not connected" } : ctx.liveUnavailable;
  if (task.mode === "live" && liveBlocked) return line("not_connected", `Not executing · ${liveBlocked.label}`);
  if (ctx.stale) return line("unknown", "Execution status unavailable · status data stale");
  if (!ctx.execution) return line("unknown", "Execution status unavailable for this task");
  const { steps } = ctx.execution;
  const aged = agedExecution(ctx.execution, ctx.evidenceAgeMs);
  const active = aged.activeRun;
  if (active && aged.lease?.state === "live") {
    if (stopRequested(active)) return line("stopping", `Stop requested · run ${shortId(active.id)} still holds its lease`);
    if (active.step === "review" || active.step === "package_review") return line("reviewing", `Being reviewed now · ${profileName(active.agentId)} · run ${shortId(active.id)}`);
    return line("executing", `Executing now · ${profileName(active.agentId)} · ${stepLabel(active.step)} · run ${shortId(active.id)}`);
  }
  if (active && aged.lease?.state === "expired_since_read") return line("stalled", `Lease ran out since the last status read · run ${shortId(active.id)} not confirmed executing · awaiting fresh status`, active.leaseUntil);
  if (active) return line("stalled", `Run ${shortId(active.id)} lost its lease · durable recovery pending`, active.leaseUntil);
  const workerNote = ctx.worker.state === "online" ? "waiting for the worker to claim it" : "not executing — no worker online";
  const held = (fallback: TaskExecutionLine): TaskExecutionLine => steps.exhausted ? line("needs_recovery", "Retries exhausted · record a recovery decision") : steps.retryScheduled ? line("retry_scheduled", "Retry scheduled with a new run after backoff", steps.nextRetryAt) : fallback;
  switch (task.state) {
    case "pause_requested": case "cancel_requested": return line("stopping", "Stop requested · waiting for a confirmed safe stop");
    case "paused": return line("paused", "Paused by the owner · not scheduled");
    case "blocked": case "failed": case "waiting_for_input": return held(line("blocked", `Blocked${task.blockedReason ? ` · ${task.blockedReason}` : ""}`));
    case "waiting_for_owner_approval": return ctx.decision === "renewal" ? line("renewal_needed", "Reviewed package · decision request expired, renewal needed") : line("waiting_for_owner", "Reviewed package · awaiting your decision");
    case "changes_requested": return line("changes", "Changes requested · owner revision required");
    case "review_passed": return line("reviewed", "Independent review passed · owner acceptance applies to the parent package");
    case "waiting_for_review": return held(line("awaiting_review", `Awaiting independent review${ctx.pendingReviewerId ? ` by ${profileName(ctx.pendingReviewerId)}` : ""} · ${steps.runnable ? workerNote : "review not runnable now"}`));
    case "queued": case "assigned": case "draft": return held(steps.runnable ? line("queued", `Queued · ${workerNote}`) : steps.waitingOnDependencies ? line("waiting_on_dependencies", "Waiting for required reviews") : line("queued", "Queued · no step runnable now"));
    case "in_progress": {
      if (ctx.children.length) {
        const ready = ctx.children.filter((child) => child.state === "review_passed" || child.state === "completed").length;
        return held(line(steps.waitingOnDependencies ? "delegated" : "queued", `Delegated · ${ready} of ${ctx.children.length} specialist tasks reviewed · package step ${steps.waitingOnDependencies ? "waits for every review" : steps.runnable ? workerNote : "not runnable now"}`));
      }
      return held(line("queued", `Started · no step executing now · ${steps.runnable ? workerNote : "no step runnable"}`));
    }
    default: return line("unknown", "Execution status unavailable");
  }
}

// -- authored / reviewed / owner-accepted ---------------------------------------

export type EvidenceStages = {
  authored: { state: "run" | "owner" | "unknown"; label: string };
  review: { state: "passed" | "pending" | "not_performed" | "changes_requested" | "superseded" | "none"; label: string };
  owner: { state: "accepted" | "pending" | "renewal" | "held" | "rejected" | "expired" | "superseded" | "cancelled" | "not_requested"; label: string };
};

function approvalStage(decisions: OfficeApproval[], pkg: OfficeTask, now: number, prefix: string): EvidenceStages["owner"] | null {
  const approved = decisions.find((approval) => approval.state === "approved");
  if (approved) return { state: "accepted", label: `${prefix}accepted by the owner · evidence ${shortId(approved.acceptanceEvidenceId)}` };
  const pending = decisions.find((approval) => approval.state === "pending");
  if (pending && pkg.state === "waiting_for_owner_approval") return Date.parse(pending.expiresAt) > now ? { state: "pending", label: `${prefix}owner decision pending` } : { state: "renewal", label: `${prefix}decision request expired · renewal needed` };
  if (pending) return { state: "held", label: `${prefix}decision request held while the package is ${stateLabel(pkg.state).toLowerCase()}` };
  const latest = [...decisions].sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))[0];
  if (!latest) return null;
  if (latest.state === "rejected") return { state: "rejected", label: `${prefix}owner rejected or requested changes${latest.reason ? `: ${latest.reason.slice(0, 160)}` : ""}` };
  if (latest.state === "expired") return { state: pkg.state === "waiting_for_owner_approval" ? "renewal" : "expired", label: `${prefix}decision request expired${pkg.state === "waiting_for_owner_approval" ? " · renewal needed" : ""}` };
  if (latest.state === "superseded") return { state: "superseded", label: `${prefix}decision request superseded by a change` };
  if (latest.state === "cancelled") return { state: "cancelled", label: `${prefix}decision request cancelled` };
  return null;
}

export function evidenceStages(artifact: OfficeArtifact, task: OfficeTask, records: { tasks: OfficeTask[]; artifacts: OfficeArtifact[]; reviews: OfficeReview[]; approvals: OfficeApproval[] }, ctx: { now: number; producedByRun: boolean | null }): EvidenceStages {
  const role = profileName(artifact.authorAgentId);
  const authored: EvidenceStages["authored"] = ctx.producedByRun === false ? { state: "owner", label: `Owner revision recorded under ${role} · revision ${artifact.revision} (no run)` } : ctx.producedByRun ? { state: "run", label: `Authored by ${role} in a recorded run · revision ${artifact.revision}` } : { state: "unknown", label: `Revision ${artifact.revision} recorded under ${role}` };
  const current = task.currentArtifactId === artifact.id;
  const latestReview = records.reviews.filter((review) => review.artifactId === artifact.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const review: EvidenceStages["review"] = !latestReview ? { state: "none", label: "No independent review recorded for this revision" }
    : latestReview.state === "passed" ? { state: "passed", label: `Independent review passed · ${profileName(latestReview.reviewerId)}` }
    : latestReview.state === "changes_requested" ? { state: "changes_requested", label: `Changes requested by ${profileName(latestReview.reviewerId)}` }
    : latestReview.state === "superseded" ? { state: "superseded", label: "Review superseded by a later revision" }
    : current && task.state === "waiting_for_review" ? { state: "pending", label: `Independent review pending · ${profileName(latestReview.reviewerId)}` }
    : { state: "not_performed", label: `Review not performed · task ${stateLabel(task.state).toLowerCase()}` };
  const latestRevision = Math.max(...records.artifacts.filter((entry) => entry.taskId === task.id).map((entry) => entry.revision), artifact.revision);
  const superseded: EvidenceStages["owner"] = { state: "superseded", label: `Superseded by revision ${latestRevision}` };
  let owner: EvidenceStages["owner"];
  if (!task.parentTaskId) {
    owner = approvalStage(records.approvals.filter((approval) => approval.artifactId === artifact.id), task, ctx.now, "") ?? (current ? { state: "not_requested", label: "Owner decision not requested yet" } : superseded);
  } else if (task.acceptanceEvidenceId && current) {
    owner = { state: "accepted", label: `Accepted through the parent package · evidence ${shortId(task.acceptanceEvidenceId)}` };
  } else {
    // A child is decided only as a component of its parent's exact package manifest.
    const parent = records.tasks.find((entry) => entry.id === task.parentTaskId);
    const pkg = parent?.currentArtifactId ? records.artifacts.find((entry) => entry.id === parent.currentArtifactId) : undefined;
    const covered = !!pkg && Array.isArray(pkg.manifest) && pkg.manifest.some((item) => !!item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).artifactId === artifact.id);
    owner = (covered && parent ? approvalStage(records.approvals.filter((approval) => approval.artifactId === pkg!.id), parent, ctx.now, "In the package: ") : null) ?? (!current ? superseded : covered ? { state: "not_requested", label: "In the package; owner decision not requested yet" } : { state: "not_requested", label: "Not yet in a package decision" });
  }
  return { authored, review, owner };
}

// -- runtime response validation --------------------------------------------------

export function isOfficeActivity(value: unknown): value is OfficeActivity {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const worker = record.worker as Record<string, unknown> | undefined;
  return typeof record.generatedAt === "string" && Array.isArray(record.roles) && Array.isArray(record.tasks) && Array.isArray(record.provenance) && !!worker && typeof worker.online === "boolean" && typeof worker.workersSeen === "number" && !!record.taskWindow && typeof record.taskWindow === "object";
}

/** Merge a linked family into a bounded snapshot. Family rows are newer for the same id. */
export function mergeFamily<T extends { tasks: OfficeTask[]; artifacts: OfficeArtifact[]; reviews: OfficeReview[]; approvals: OfficeApproval[]; events: { eventId: string }[] }>(snapshot: T, family: OfficeActivity["family"]): T {
  if (!family) return snapshot;
  const merge = <R,>(base: R[], extra: R[], key: (row: R) => string) => { const ids = new Set(extra.map(key)); return [...extra, ...base.filter((row) => !ids.has(key(row)))]; };
  return { ...snapshot, tasks: merge(snapshot.tasks, family.tasks, (row) => row.id), artifacts: merge(snapshot.artifacts, family.artifacts, (row) => row.id), reviews: merge(snapshot.reviews, family.reviews, (row) => row.id), approvals: merge(snapshot.approvals, family.approvals, (row) => row.id), events: merge(snapshot.events, family.events as T["events"], (row) => row.eventId) };
}
