"use client";

import type { OfficeMode } from "@/lib/office-contracts";
import type { OfficeActivity, OfficeRoleActivity } from "@/lib/office-activity";

import { OfficeButton, Time } from "./office-ui";
import { OfficeAgentBadge } from "./OfficeAgentBadge";
import { roleIdentityStyle } from "./role-identity";
import { activityLabel, agedRole, leasedRunState, leaseWording, liveProviderLabel, liveUnavailable, liveUsageLine, stepLabel, type AgedLeases, type RoleStatus, type WorkerIndicator } from "./office-status";
import { OFFICE_PROFILES, profileName, stateLabel } from "./profiles";
import styles from "./office.module.css";

const shortId = (id: string) => id.slice(0, 8);

// Lease counts come from aged evidence, so a lease that has run out since the last read is not "executing".
function workload(role: OfficeRoleActivity | undefined, leases: AgedLeases | null) {
  if (!role || !leases) return "Unavailable";
  const { counts } = role;
  const parts = [
    leases.executing ? `${leases.executing} executing` : null,
    leases.stalled ? `${leases.stalled} expired lease${leases.stalled === 1 ? "" : "s"}` : null,
    counts.runnableSteps ? `${counts.runnableSteps} step${counts.runnableSteps === 1 ? "" : "s"} queued` : null,
    counts.runnableReviews ? `${counts.runnableReviews} review${counts.runnableReviews === 1 ? "" : "s"} queued` : null,
    counts.waitingOnDependencies ? `${counts.waitingOnDependencies} waiting for reviews` : null,
    counts.retryScheduled ? `${counts.retryScheduled} retry scheduled` : null,
    counts.exhaustedSteps ? `${counts.exhaustedSteps} retries exhausted` : null,
    counts.awaitingReview ? `${counts.awaitingReview} awaiting review` : null,
    counts.reviewPassed ? `${counts.reviewPassed} review passed` : null,
    counts.decisionsPending ? `${counts.decisionsPending} awaiting owner decision` : null,
    counts.decisionsRenewal ? `${counts.decisionsRenewal} decision renewal needed` : null,
    counts.changesRequested ? `${counts.changesRequested} changes requested` : null,
    counts.blocked + counts.failed ? `${counts.blocked + counts.failed} blocked` : null,
    counts.paused + counts.stopping ? `${counts.paused + counts.stopping} paused or stopping` : null,
    counts.completed ? `${counts.completed} completed` : null,
    counts.cancelled ? `${counts.cancelled} cancelled` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No assigned work";
}

export function OfficeRoleStatus({ statuses, activity, evidenceAgeMs, worker, freshness, mode, workspaceName, selectedAgent, onProfile, onTask }: {
  statuses: RoleStatus[];
  activity: OfficeActivity | null;
  /** Monotonic milliseconds since `activity` was requested. */
  evidenceAgeMs: number;
  worker: WorkerIndicator;
  freshness: { state: string; label: string };
  mode: OfficeMode;
  workspaceName: string | null;
  selectedAgent: string;
  onProfile: (id: string) => void;
  onTask: (id: string, artifactId?: string) => void;
}) {
  const roles = activity?.roles.filter((role) => role.mode === mode) ?? [];
  const liveBlocked = liveUnavailable(activity?.execution);
  const totals = activity?.taskWindow;
  return <section className={styles.panel} aria-labelledby="office-status-title">
    <h2 id="office-status-title" className={styles.sectionTitle}>Worker, roles and recorded runs · {mode === "demo" ? "demonstration records" : "internal records"}{workspaceName ? ` · ${workspaceName}` : " · all authorized workspaces"}</h2>
    <p className={styles.hint}>Each indicator is derived from persisted tasks, runs, leases, artifacts, reviews and heartbeats. A portrait, scene marker, animation or page refresh is never evidence of work. Seven role profiles share one durable worker; they are not seven running processes.</p>
    <dl className={styles.statusGrid}>
      <div><dt>Worker availability</dt><dd><span className={styles.status} data-state={`worker_${worker.state}`}>{worker.label}</span></dd><dd className={styles.copy}>{worker.detail}</dd></div>
      <div><dt>Page data</dt><dd><span className={styles.status} data-state={`data_${freshness.state}`}>{freshness.label}</span></dd><dd className={styles.copy}>Refreshes every 15 s and is shown as unavailable after 45 s. This is separate from the worker heartbeat.</dd></div>
      <div><dt>Execution mode</dt><dd>{mode === "demo" ? "Deterministic simulation adapter" : liveBlocked ? "Live: not running" : "Live: OpenAI"}</dd><dd className={styles.copy}>{mode === "demo" ? "No model or provider is called. Outputs are simulated drafts with structural checks." : liveBlocked ? `${liveBlocked.detail} Live tasks are recorded as blocked.` : "Each request's input is counted and its maximum cost reserved against every limit before it is sent. Nothing is sent outside the Office."}</dd></div>
      <div><dt>Live provider</dt><dd>{liveProviderLabel(activity?.execution)}</dd><dd className={styles.copy}>Command execution: disabled. {liveUsageLine(activity?.execution)}</dd></div>
      {totals ? <div><dt>Tasks in scope (exact)</dt><dd>{totals.total.toLocaleString("en-US")}</dd><dd className={styles.copy}>Run detail covers the {totals.covered.toLocaleString("en-US")} most recent; the task list shows at most {totals.limit}.</dd></div> : null}
    </dl>
    <ul className={styles.roleList} aria-label="Role status">
      {OFFICE_PROFILES.map((profile) => {
        const status = statuses.find((entry) => entry.agentId === profile.id);
        const role = roles.find((entry) => entry.agentId === profile.id);
        const leases = role ? agedRole(role, evidenceAgeMs) : null;
        const lease = leaseWording(leases?.lease ?? null);
        const artifact = role?.latestArtifact;
        const given = role?.latestReviewGiven;
        const run = leases?.activeRun ?? role?.latestRun;
        return <li key={profile.id} className={styles.roleCard} style={roleIdentityStyle(profile.id)} data-agent-id={profile.id} data-indicator={status?.indicator ?? "unknown"} aria-current={selectedAgent === profile.id ? "true" : undefined}>
          <div className={styles.roleHead}>
            <OfficeAgentBadge agentId={profile.id} compact />
            <span className={styles.status} data-state={status?.indicator ?? "unknown"}>{status?.label ?? "Status unavailable"}</span>
          </div>
          <p className={styles.copy}>{status?.detail ?? "Role evidence has not loaded."}</p>
          <dl className={styles.roleFacts}>
            <div><dt>Workload</dt><dd>{workload(role, leases)}</dd></div>
            <div><dt>Last confirmed activity</dt><dd>{role?.lastEvent ? <>{activityLabel(role.lastEvent.eventType)}{role.lastEvent.runId ? "" : " (recorded without a run)"} · <Time value={role.lastEvent.occurredAt} /></> : "None recorded"}</dd></div>
            <div><dt>{leases?.activeRun ? (leases.lease?.state === "live" ? "Active run" : "Leased run") : "Latest run"}</dt><dd>{run ? <><span className={styles.digest}>{shortId(run.id)}</span> · {stepLabel(run.step)} · {leases?.activeRun ? leasedRunState(run, leases.lease) : stateLabel(run.state)}{leases?.activeRun ? <> · {lease.before} <Time value={leases.activeRun.leaseUntil} />{lease.after}</> : <> · <Time value={run.finishedAt ?? run.startedAt} /></>}{run.predecessorRunId ? <> · retry of <span className={styles.digest}>{shortId(run.predecessorRunId)}</span></> : null}</> : "No run recorded"}</dd></div>
            <div><dt>Latest output (from a run)</dt><dd>{artifact ? <><button type="button" className={styles.eventTask} onClick={() => onTask(artifact.taskId, artifact.id)}>R{artifact.revision} · {artifact.title}</button><br /><span className={styles.digest}>SHA-256 {artifact.artifactHash.slice(0, 16)}…</span> · {artifact.current ? "current revision" : "superseded"}{artifact.review ? ` · review ${stateLabel(artifact.review.state).toLowerCase()} (${profileName(artifact.review.reviewerId)})` : " · no review yet"}</> : "No run-produced output"}{role?.latestOwnerRevision ? <><br /><button type="button" className={styles.eventTask} onClick={() => onTask(role.latestOwnerRevision!.taskId, role.latestOwnerRevision!.id)}>Newer owner revision R{role.latestOwnerRevision.revision} recorded under {profileName(profile.id)}</button> (not produced by this role)</> : null}</dd></div>
            <div><dt>Latest review given</dt><dd>{given ? <>{stateLabel(given.state)} · {profileName(given.authorAgentId)}&apos;s draft · <Time value={given.decidedAt} /> <button type="button" className={styles.eventTask} onClick={() => onTask(given.taskId, given.artifactId)}>Open reviewed revision</button></> : "None recorded"}</dd></div>
            {role?.blocked ? <div><dt>Blocked reason</dt><dd>{role.blocked.reason ?? "Not recorded"} · since <Time value={role.blocked.since} /></dd></div> : null}
          </dl>
          <div className={styles.buttonRow}>
            {status?.activeTaskId ? <OfficeButton onClick={() => onTask(status.activeTaskId!)}>Open {leases?.lease?.state === "live" ? "active" : "current"} task</OfficeButton> : null}
            <OfficeButton aria-haspopup="dialog" onClick={() => onProfile(profile.id)}>Show {profile.name}&apos;s profile</OfficeButton>
          </div>
        </li>;
      })}
    </ul>
  </section>;
}
