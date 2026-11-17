"use client";

import { ArrowDownToLine, ArrowLeftRight, CheckCheck, FileText, Pause, Play, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { OfficeArtifact, OfficeSnapshot, OfficeTask, TaskActionInput } from "@/lib/office-contracts";
import type { OfficeTaskExecution, OfficeTaskMetering } from "@/lib/office-activity";
import { formatUsd } from "@/lib/office-runtime/live-pricing";

import { EventList, OfficeButton, Status, Time, downloadText } from "./office-ui";
import { OfficeNoticeBanner } from "./OfficeInfo";
import { OfficeAgentBadge } from "./OfficeAgentBadge";
import type { MutateOffice } from "./office-ui";
import { agedExecution, evidenceStages, leasedRunState, leaseWording, stepLabel } from "./office-status";
import type { TaskExecutionLine, WorkerIndicator } from "./office-status";
import { OFFICE_PROFILES, profileName, stateLabel } from "./profiles";
import styles from "./office.module.css";

interface TaskDetailProps {
  task: OfficeTask;
  /** Live model requests across a package and its specialist tasks; only for a package. */
  familyMetering?: OfficeTaskMetering | null;
  snapshot: OfficeSnapshot;
  disabledReason: string | null;
  busy: boolean;
  mutate: MutateOffice;
  onClose: () => void;
  onTask: (id: string) => void;
  now: number;
  execution?: OfficeTaskExecution;
  /** Monotonic milliseconds since the execution evidence was requested. */
  evidenceAgeMs: number;
  executionLine: TaskExecutionLine;
  worker: WorkerIndicator;
  provenance: Map<string, boolean>;
  /** The explicitly selected revision; null shows the current revision. */
  artifactId: string | null;
  /** The selected revision came from a rechecked link and does not belong to this task. */
  artifactNotFound: boolean;
  onSelectArtifact: (artifactId: string | null) => void;
  /** Completion bound to the task/revision selection that originated the save. */
  onRevisionSaved: () => void;
  focusOnMount?: boolean;
}

// Charges are conservative: a request whose outcome is unknown is counted at its full reservation.
function metered(value: OfficeTaskMetering | null | undefined) {
  if (!value?.requests) return "None";
  return `${value.requests} request${value.requests === 1 ? "" : "s"} · ${formatUsd(value.chargedMicrounits)} charged${value.openReservationMicrounits ? ` · ${formatUsd(value.openReservationMicrounits)} reserved, not yet settled` : ""}`;
}

function ExecutionEvidence({ task, execution, evidenceAgeMs, line, worker, specialists, familyMetering }: { task: OfficeTask; execution?: OfficeTaskExecution; evidenceAgeMs: number; line: TaskExecutionLine; worker: WorkerIndicator; specialists: OfficeTask[]; familyMetering?: OfficeTaskMetering | null }) {
  const aged = execution ? agedExecution(execution, evidenceAgeMs) : null;
  const active = aged?.activeRun;
  const lease = leaseWording(aged?.lease ?? null);
  const latest = execution?.latestRun;
  const childStates = [...new Set(specialists.map((child) => child.state))].map((state) => `${specialists.filter((child) => child.state === state).length} ${stateLabel(state).toLowerCase()}`);
  return <div className={styles.section} aria-labelledby={`office-execution-${task.id}`}>
    <h3 id={`office-execution-${task.id}`} className={styles.sectionTitle}>Progress</h3>
    <p className={styles.copy} data-execution={line.state}><strong className={styles.execution}>{line.label}</strong>{line.at ? <> · <Time value={line.at} /></> : null}</p>
    <details className={styles.technicalDetails}><summary>Work details</summary>
    {execution ? <dl className={styles.roleFacts}>
      <div><dt>{aged?.lease?.state === "live" ? "Active run" : "Leased run"}</dt><dd>{active ? <><span className={styles.digest}>{active.id}</span><br />{profileName(active.agentId)} · {stepLabel(active.step)} · attempt {active.attempt} · {leasedRunState(active, aged?.lease ?? null)} · {lease.before} <Time value={active.leaseUntil} /> (database time){lease.after}</> : "None. Nothing is executing for this task now."}</dd></div>
      <div><dt>Latest worker run</dt><dd>{latest ? <><span className={styles.digest}>{latest.id}</span><br />{profileName(latest.agentId)} · {stepLabel(latest.step)} · Recorded state: {stateLabel(latest.state)} · <Time value={latest.finishedAt ?? latest.startedAt} />{latest.errorCode ? ` · ${latest.errorCode}` : ""}{latest.predecessorRunId ? <> · retry of <span className={styles.digest}>{latest.predecessorRunId.slice(0, 8)}</span></> : null}</> : "No worker run recorded."}</dd></div>
      <div><dt>Worker runs recorded</dt><dd>{execution.runs.total} total · {execution.runs.succeeded} succeeded · {execution.runs.interrupted} interrupted · {execution.runs.failed} failed{execution.runs.cancelled ? ` · ${execution.runs.cancelled} cancelled` : ""}</dd></div>
      <div><dt>Queued steps</dt><dd>{execution.steps.runnable} runnable · {execution.steps.waitingOnDependencies} waiting for reviews · {execution.steps.retryScheduled} retry scheduled · {execution.steps.leased} leased · {execution.steps.done} done{execution.steps.exhausted ? ` · ${execution.steps.exhausted} exhausted` : ""}</dd></div>
      {execution.coordination ? <div><dt>Recorded by the web request</dt><dd>{stepLabel(execution.coordination.step)} at <Time value={execution.coordination.recordedAt} /> · bookkeeping only, no worker execution</dd></div> : null}
      {specialists.length ? <div><dt>Specialist tasks</dt><dd>{specialists.length} total · {childStates.join(" · ")}</dd></div> : null}
      {task.mode === "live" ? <div><dt>Live model requests</dt><dd>This task: {metered(execution.metering)}{familyMetering ? <><br />Whole proposal: {metered(familyMetering)}</> : null}<br /><span className={styles.hint}>Conservative estimate; a request with an unknown outcome counts at its full reservation.</span></dd></div> : null}
    </dl> : <p className={styles.hint}>Run, lease and queue evidence is unavailable right now, so execution is not inferred.</p>}
    <p className={styles.hint}>{worker.label}: {worker.detail}</p>
    </details>
  </div>;
}

function ArtifactViewer({ artifact, previous, task, snapshot, mutate, disabledReason, busy, now, producedByRun, onRevised }: { artifact: OfficeArtifact; previous?: OfficeArtifact; task: OfficeTask; snapshot: OfficeSnapshot; mutate: MutateOffice; disabledReason: string | null; busy: boolean; now: number; producedByRun: boolean | null; onRevised: () => void }) {
  const [compare, setCompare] = useState(false);
  const [edit, setEdit] = useState<{ title: string; content: string; version: number } | null>(null);
  const reviews = snapshot.reviews.filter((review) => review.artifactId === artifact.id);
  const conflict = edit !== null && edit.version !== task.version;
  const immutable = task.state === "completed" || task.state === "cancelled";
  const canRevise = task.mode === "demo" && task.state === "changes_requested";
  const stages = evidenceStages(artifact, task, snapshot, { now, producedByRun });

  async function saveRevision() {
    if (!edit) return;
    const saved = await mutate({ operation: "revise_artifact", input: { workspaceId: task.workspaceId, taskId: task.id, version: edit.version, title: edit.title, content: edit.content, authorAgentId: artifact.authorAgentId } }, "A new internal artifact revision was saved. Earlier revisions and reviews were retained.");
    // The new revision becomes current; the view follows it rather than staying on its base revision.
    if (saved) { setEdit(null); onRevised(); }
  }

  return <>
    <div className={styles.artifactHeader}>
      <h3>{artifact.title}</h3>
      <OfficeButton onClick={() => downloadText(`${artifact.title}-r${artifact.revision}`, artifact.content)}><ArrowDownToLine className={styles.icon} aria-hidden="true" /> Download</OfficeButton>
    </div>
    <div className={styles.detailMeta}><span>Revision {artifact.revision}</span><span>{producedByRun === false ? `Recorded under: ${profileName(artifact.authorAgentId)} (owner revision)` : `Author: ${profileName(artifact.authorAgentId)}`}</span><span><Time value={artifact.createdAt} /></span></div>
    <ol className={styles.evidenceStages} aria-label={`Evidence status for revision ${artifact.revision}`}>
      <li data-stage={stages.authored.state}>{stages.authored.label}</li>
      <li data-stage={stages.review.state}>{stages.review.label}</li>
      <li data-stage={stages.owner.state}>{stages.owner.label}</li>
    </ol>
    <details className={styles.technicalDetails}><summary>Revision details</summary><p className={styles.digest}>SHA-256 · {artifact.artifactHash}<br />Revision ID · {artifact.revisionId}</p></details>
    {task.mode === "demo" ? <p className={`${styles.hint} ${styles.simulated}`}>This is a deterministic simulated draft. It does not claim model generation, professional review, or implemented software.</p> : <p className={styles.hint}>Internal draft · inspect the sources, findings, and limitations before acceptance.</p>}
    <div className={styles.buttonRow}>
      <OfficeButton disabled={!previous} title={!previous ? "A second saved revision is needed for comparison." : undefined} onClick={() => setCompare(!compare)}><ArrowLeftRight className={styles.icon} aria-hidden="true" />{compare ? "Close comparison" : "Compare previous revision"}</OfficeButton>
      <OfficeButton disabled={!!disabledReason || busy || immutable || !canRevise} title={disabledReason ?? (immutable ? "Accepted and cancelled records are immutable. Create a follow-up task." : !canRevise ? "Record specific requested changes before preparing a revision. Live drafting is not configured." : undefined)} onClick={() => setEdit({ title: artifact.title, content: artifact.content, version: task.version })}><FileText className={styles.icon} aria-hidden="true" /> Prepare a new revision</OfficeButton>
    </div>
    {!canRevise && !immutable ? <p className={styles.hint}>Record specific requested changes against this reviewable task before preparing another revision. Live drafting remains unavailable; the deterministic demo permits up to two revision cycles before owner recovery review.</p> : null}
    {compare && previous ? <div className={styles.detailGrid}>
      <div><h4 className={styles.sectionTitle}>Previous · revision {previous.revision}</h4><pre className={styles.pre}>{previous.content}</pre></div>
      <div><h4 className={styles.sectionTitle}>Selected · revision {artifact.revision}</h4><pre className={styles.pre}>{artifact.content}</pre></div>
    </div> : <pre className={styles.pre} tabIndex={0} aria-label={`Artifact ${artifact.title}, revision ${artifact.revision}`}>{artifact.content}</pre>}
    {edit ? <form className={`${styles.panel} ${styles.section}`} onSubmit={(event) => { event.preventDefault(); void saveRevision(); }}>
      <h4 className={styles.sectionTitle}>Prepare a new saved revision</h4>
      <p className={styles.hint}>This appends a revision under the recorded role. Prior approvals become superseded; a new independent review and owner decision are required.</p>
      {conflict ? <div role="alert" className={`${styles.notice} ${styles.noticeError}`}><div>The task changed while you were editing. Your text is retained. Compare the latest saved revision before continuing.<div className={styles.buttonRow}><OfficeButton onClick={() => setEdit({ ...edit, version: task.version })}>Use current task version, retain my text</OfficeButton></div></div></div> : null}
      <label className={styles.field}>Revision title<input className={styles.input} required minLength={3} maxLength={200} value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} /></label>
      <label className={`${styles.field} ${styles.section}`}>Draft content<textarea className={styles.textarea} required maxLength={100000} value={edit.content} onChange={(event) => setEdit({ ...edit, content: event.target.value })} /></label>
      <div className={styles.buttonRow} style={{ marginTop: 12 }}><OfficeButton type="submit" primary disabled={busy || !!disabledReason || conflict}>Save new revision</OfficeButton><OfficeButton onClick={() => setEdit(null)}>Discard unsaved edit</OfficeButton></div>
    </form> : null}
    {artifact.manifest ? <details className={styles.section}><summary className={styles.sectionTitle}>Immutable package manifest and acceptance criteria</summary><pre className={styles.pre}>{JSON.stringify(artifact.manifest, null, 2)}</pre></details> : null}
    <div className={styles.section}>
      <h4 className={styles.sectionTitle}>Independent reviews · this revision</h4>
      {reviews.length ? reviews.map((review) => <div className={styles.review} key={review.id}>
        <div className={styles.taskHead}><strong>{profileName(review.reviewerId)}</strong><Status state={review.state} /></div>
        <p><Time value={review.createdAt} /> · {review.revisionId}</p>
        <ul>{review.criteria.map((criterion, index) => <li key={`${index}-${criterion}`}>{criterion}</li>)}</ul>
        <p className={styles.digest}>Reviewed SHA-256 · {review.artifactHash}</p>
        <details><summary>Findings and inspected evidence</summary><pre className={styles.pre}>{JSON.stringify({ findings: review.findings, evidence: review.evidence }, null, 2)}</pre></details>
      </div>) : <p className={styles.copy}>No review records for this artifact revision. A saved draft is not a passed review.</p>}
    </div>
  </>;
}

export function OfficeTaskDetail({ task, familyMetering, snapshot, disabledReason, busy, mutate, onClose, onTask, now, execution, evidenceAgeMs, executionLine, worker, provenance, artifactId, artifactNotFound, onSelectArtifact, onRevisionSaved, focusOnMount }: TaskDetailProps) {
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => { if (focusOnMount) sectionRef.current?.focus(); }, [focusOnMount]);
  const [pendingAction, setPendingAction] = useState<TaskActionInput["action"] | null>(null);
  const [reason, setReason] = useState("");
  const [nextAgent, setNextAgent] = useState(task.agentId);
  const [nextPriority, setNextPriority] = useState(task.priority);
  const [note, setNote] = useState("");
  const artifacts = snapshot.artifacts.filter((artifact) => artifact.taskId === task.id).sort((a, b) => b.revision - a.revision);
  const current = artifacts.find((entry) => entry.id === task.currentArtifactId) ?? artifacts[0];
  // An explicitly requested revision is shown only when it is loaded for this task; another
  // revision is never substituted for it. The owner chooses explicitly instead.
  const requested = artifactId ? artifacts.find((entry) => entry.id === artifactId) : undefined;
  const artifact = artifactId ? requested : current;
  const revisionUnavailable = !!artifactId && !requested;
  const historical = !!requested && !!current && requested.id !== current.id;
  const previous = artifact ? artifacts.find((entry) => entry.revision < artifact.revision) : undefined;
  const children = snapshot.tasks.filter((entry) => entry.parentTaskId === task.id);
  const parent = task.parentTaskId ? snapshot.tasks.find((entry) => entry.id === task.parentTaskId) : null;
  const workspace = snapshot.workspaces.find((entry) => entry.id === task.workspaceId);
  const terminal = task.state === "completed" || task.state === "cancelled";
  const cannotPause = terminal || ["paused", "pause_requested", "cancel_requested", "draft"].includes(task.state);
  const canRequestChanges = ["waiting_for_review", "review_passed", "waiting_for_owner_approval"].includes(task.state);
  const recoveryUnavailable = task.mode === "live" && !(snapshot.health.providerConfigured && snapshot.health.liveEnabled);
  const canReassign = ["queued", "assigned", "paused"].includes(task.state) && !task.currentArtifactId;
  const canReprioritize = !terminal && !["in_progress", "pause_requested", "cancel_requested"].includes(task.state);
  const taskEvents = snapshot.events.filter((event) => event.taskId === task.id).sort((a, b) => b.sequence - a.sequence);
  const approvals = snapshot.approvals.filter((approval) => approval.taskId === task.id);
  const renewableApproval = task.state === "waiting_for_owner_approval" && approvals.some((approval) => approval.artifactId === task.currentArtifactId && (approval.state === "expired" || (approval.state === "pending" && Date.parse(approval.expiresAt) <= now))) && !approvals.some((approval) => approval.state === "pending" && Date.parse(approval.expiresAt) > now);

  async function addNote() {
    if (note.trim().length < 3) return;
    const saved = await mutate({ operation: "task_action", input: { workspaceId: task.workspaceId, taskId: task.id, version: task.version, action: "note", reason: note.trim() } }, "Your owner note was recorded in this task's scoped history. No agent reply or execution was implied.");
    if (saved) setNote("");
  }

  async function act(action: TaskActionInput["action"]) {
    const input: TaskActionInput = { workspaceId: task.workspaceId, taskId: task.id, version: task.version, action };
    if (reason.trim().length >= 3) input.reason = reason.trim();
    if (action === "reassign") input.agentId = nextAgent;
    if (action === "reprioritize") input.priority = nextPriority;
    const saved = await mutate({ operation: "task_action", input }, action === "pause" ? "Pause requested. The record will confirm when active execution has stopped." : action === "cancel" ? "Cancellation requested. Existing artifacts and history are retained." : "The task action was recorded. Inspect its confirmed state below.");
    if (saved) { setPendingAction(null); setReason(""); }
  }

  return <section ref={sectionRef} id="office-task-detail" tabIndex={-1} aria-labelledby="office-task-title" className={`${styles.panel} ${styles.detail} ${styles.scrollAnchor}`}>
    <div className={styles.detailHeader}>
      <div><p className={styles.eyebrow}>Task record · {task.mode === "demo" ? "Simulated" : "Recorded internal work"}</p><h2 id="office-task-title">{task.goal}</h2><Status state={task.state} /></div>
      <button type="button" onClick={onClose} className={styles.close} aria-label="Close task detail"><X className={styles.icon} /></button>
    </div>
    <div className={styles.detailMeta}><OfficeAgentBadge agentId={task.agentId} compact /><span>{workspace?.name ?? "Authorized workspace"}</span><span>Priority {task.priority}</span><span>Version {task.version}</span><span>Updated <Time value={task.updatedAt} /></span></div>
    <details className={styles.technicalDetails}><summary>Record details</summary><p className={styles.digest}>Scope · {task.clientId} / {task.projectId}<br />Task · {task.id}</p></details>
    {task.blockedReason ? <div className={styles.notice} role="status"><p><strong>Dependency:</strong> {task.blockedReason}</p></div> : null}
    {task.state === "pause_requested" || task.state === "cancel_requested" ? <div className={styles.notice}><p>Future scheduling is suspended. An effective stop remains unconfirmed until outstanding execution is reconciled.</p></div> : null}
    {terminal ? <OfficeNoticeBanner key={`${task.id}-${task.state}-${task.acceptanceEvidenceId}`} tone={task.state === "completed" ? "success" : undefined} label="Dismiss completed task notification"><p><CheckCheck className={styles.icon} aria-hidden="true" /> {task.state === "completed" ? "Task completed. Its saved work and decision history are below." : "Task cancelled. Its work and history are kept below."}</p></OfficeNoticeBanner> : null}
    <ExecutionEvidence task={task} execution={execution} evidenceAgeMs={evidenceAgeMs} line={executionLine} worker={worker} specialists={children} familyMetering={familyMetering} />
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Brief and source context</h3><p className={styles.prose}>{task.brief}</p>
      {parent ? <button className={styles.miniTask} type="button" onClick={() => onTask(parent.id)}>Parent package · {parent.goal}<span>{parent.state.replaceAll("_", " ")}</span></button> : null}
      {children.length ? <div className={styles.section}><h3 className={styles.sectionTitle}>Specialist tasks and dependencies</h3>{children.map((child) => <button className={styles.miniTask} key={child.id} type="button" onClick={() => onTask(child.id)}>{profileName(child.agentId)} · {child.goal}<span>{child.state.replaceAll("_", " ")}</span></button>)}</div> : null}
    </div>
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Task controls</h3>
      <div className={styles.taskControls}>
        <OfficeButton disabled={busy || !!disabledReason || cannotPause} title={disabledReason ?? (cannotPause ? "Pause is unavailable in the current confirmed state." : undefined)} onClick={() => void act("pause")}><Pause className={styles.icon} aria-hidden="true" />Pause</OfficeButton>
        <OfficeButton disabled={busy || !!disabledReason || recoveryUnavailable || task.state !== "paused"} title={disabledReason ?? (task.state !== "paused" ? "Resume requires an effective paused state." : undefined)} onClick={() => void act("resume")}><Play className={styles.icon} aria-hidden="true" />Resume</OfficeButton>
        <OfficeButton disabled={busy || !!disabledReason || recoveryUnavailable || !["failed", "blocked"].includes(task.state)} title={disabledReason ?? "Retry preserves the failed attempt and checks the prior outcome before scheduling."} onClick={() => setPendingAction("retry")}><RotateCcw className={styles.icon} aria-hidden="true" />Retry failed step</OfficeButton>
        <OfficeButton disabled={busy || !!disabledReason || terminal || task.state === "cancel_requested"} title={disabledReason ?? undefined} danger onClick={() => setPendingAction("cancel")}>Cancel task</OfficeButton>
        <OfficeButton disabled={busy || !!disabledReason || !canRequestChanges} title={disabledReason ?? (!canRequestChanges ? "A current reviewable artifact revision is required before requesting changes." : undefined)} onClick={() => setPendingAction("request_changes")}>Request changes</OfficeButton>
        {task.mode === "live" ? <OfficeButton disabled={busy || !!disabledReason || recoveryUnavailable || task.state !== "changes_requested"} title={disabledReason ?? (task.state !== "changes_requested" ? "An AI revision needs requested changes on the current work." : undefined)} onClick={() => setPendingAction("redraft")}><Sparkles className={styles.icon} aria-hidden="true" />Revise with AI</OfficeButton> : null}
      </div>
      <p className={styles.hint}>Resume requires an effective paused state. Retry requires a failed or blocked step. Request changes requires a current reviewable revision. An active pause or cancellation remains a request until the worker confirms a safe stop.</p>
      {recoveryUnavailable ? <p className={styles.hint}>Live resume, retry and AI revision are unavailable until a live provider is connected on the Office worker, live execution is switched on and its spending limits are set.</p> : null}
      {disabledReason ? <p className={styles.hint}>{disabledReason}</p> : null}
      {pendingAction ? <form onSubmit={(event) => { event.preventDefault(); void act(pendingAction); }}>
        <p className={styles.hint}>{pendingAction === "cancel" ? "Stop future scheduling and retain all existing records. An active step may still need reconciliation." : pendingAction === "retry" ? "Create a linked recovery attempt after checking the previous outcome." : pendingAction === "redraft" ? `Ask ${profileName(task.agentId)} to revise using the latest reviewer findings and your note. The revision and its fresh review are metered model requests that count against this proposal's limit; at most two revisions per task.` : "Record the required changes against this task; a changed artifact needs fresh review."}</p>
        <label className={styles.field}>Reason / specific changes<input className={styles.input} value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={2000} required placeholder="Describe the reason for this action" /></label>
        <div className={styles.buttonRow} style={{ marginTop: 10 }}><OfficeButton type="submit" primary={pendingAction !== "cancel"} danger={pendingAction === "cancel"} disabled={busy || !!disabledReason || reason.trim().length < 3}>{pendingAction === "cancel" ? "Cancel task and retain records" : pendingAction === "retry" ? "Record retry decision" : pendingAction === "redraft" ? "Request AI revision" : "Record requested changes"}</OfficeButton><OfficeButton onClick={() => setPendingAction(null)}>Keep current state</OfficeButton></div>
      </form> : null}
      <div className={styles.formGrid} style={{ marginTop: 16 }}>
        <form onSubmit={(event) => { event.preventDefault(); void act("reassign"); }}><label className={styles.field}>Reassign accountable profile<select className={styles.select} value={nextAgent} disabled={busy || !!disabledReason || !canReassign} onChange={(event) => setNextAgent(event.target.value as typeof nextAgent)}>{OFFICE_PROFILES.map((agent) => <option value={agent.id} key={agent.id}>{agent.name} · {agent.role}</option>)}</select></label><OfficeButton type="submit" disabled={busy || !!disabledReason || !canReassign || nextAgent === task.agentId} style={{ marginTop: 8 }}>Reassign</OfficeButton><p className={styles.hint}>{canReassign ? "Applies within this workspace before work or artifacts have started." : "Reassignment requires an unstarted queued, assigned, or paused task with no artifact."}</p></form>
        <form onSubmit={(event) => { event.preventDefault(); void act("reprioritize"); }}><label className={styles.field}>Queue priority · higher runs first<input className={styles.input} type="number" min={-10} max={10} step={1} value={nextPriority} disabled={busy || !!disabledReason || !canReprioritize} onChange={(event) => setNextPriority(Number(event.target.value))} required /></label><OfficeButton type="submit" disabled={busy || !!disabledReason || !canReprioritize || nextPriority === task.priority} style={{ marginTop: 8 }}>Set priority</OfficeButton><p className={styles.hint}>Range −10 to 10. Dependency order and workspace limits still apply.</p></form>
      </div>
    </div>
    <div className={styles.section}>
      <div className={styles.artifactHeader}><h3 className={styles.sectionTitle}>Artifacts and revision history</h3>{artifacts.length ? <label className={styles.field}><span className={styles.srOnly}>Artifact revision</span><select className={styles.select} value={artifact?.id ?? artifactId ?? ""} onChange={(event) => onSelectArtifact(event.target.value === current?.id ? null : event.target.value)}>{revisionUnavailable ? <option value={artifactId!} disabled>Requested revision unavailable</option> : null}{artifacts.map((entry) => <option key={entry.id} value={entry.id}>Revision {entry.revision} · {entry.title}{entry.id === current?.id ? " (current)" : ""}</option>)}</select></label> : null}</div>
      {historical ? <div className={styles.notice} role="status" data-revision="historical"><div><p>Viewing revision {requested!.revision}, an earlier revision. The current revision is {current!.revision}. This selection is kept in the page address, so reloading shows the same revision.</p><OfficeButton onClick={() => onSelectArtifact(null)} style={{ marginTop: 8 }}>Show the current revision</OfficeButton></div></div> : null}
      {revisionUnavailable ? <div className={styles.notice} role="status" data-revision="unavailable"><div><p>{artifactNotFound ? "The linked revision was not found for this task. It may not exist or may belong to another record." : "The requested revision is not loaded in this view. Refresh to try again."} No other revision is shown in its place.</p>{current ? <OfficeButton onClick={() => onSelectArtifact(null)} style={{ marginTop: 8 }}>Show the current revision ({current.revision})</OfficeButton> : null}</div></div> : null}
      {artifact ? <ArtifactViewer key={artifact.id} artifact={artifact} previous={previous} task={task} snapshot={snapshot} mutate={mutate} disabledReason={disabledReason} busy={busy} now={now} producedByRun={provenance.get(artifact.id) ?? null} onRevised={onRevisionSaved} /> : revisionUnavailable ? null : <p className={styles.copy}>No saved artifacts. This task has no completed output to inspect.</p>}
    </div>
    {approvals.length ? <div className={styles.section}><h3 className={styles.sectionTitle}>Owner decision history</h3>{approvals.map((approval) => <div className={styles.review} key={approval.id}><Status state={approval.state === "pending" && Date.parse(approval.expiresAt) <= now ? "expired" : approval.state} /><p>Accept internal proposal package · revision {approval.revisionId}</p><p className={styles.digest}>{approval.artifactHash}</p><p>{approval.reason || "No reason recorded."} · <Time value={approval.decidedAt} /></p>{approval.acceptanceEvidenceId ? <p className={styles.digest}>Acceptance evidence · {approval.acceptanceEvidenceId}</p> : null}</div>)}{renewableApproval ? <div className={styles.notice}><div><p>The decision request expired. Renewing checks the same current package digest and independent reviews, retains the expired record, and creates a fresh request. It does not accept the package.</p><OfficeButton disabled={busy || !!disabledReason} onClick={() => void act("renew_approval")} style={{ marginTop: 9 }}>Renew decision request for this package</OfficeButton></div></div> : null}</div> : null}
    <div className={styles.section}><h3 className={styles.sectionTitle}>Conversation, handoffs, and confirmed activity</h3><p className={styles.hint}>Record owner notes in the workspace for this task. Notes do not change scope, grant permissions, or trigger an AI reply. Live agent conversation needs a configured provider.</p><form onSubmit={(event) => { event.preventDefault(); void addNote(); }}><label className={styles.field}>Owner note<textarea className={styles.textarea} minLength={3} maxLength={2000} required value={note} disabled={busy || !!disabledReason} onChange={(event) => setNote(event.target.value)} placeholder="Source context, a question, or a decision summary for this task" /></label><OfficeButton type="submit" disabled={busy || !!disabledReason || note.trim().length < 3} style={{ marginTop: 9 }}>Record owner note</OfficeButton></form><p className={styles.hint}>The event record contains confirmed actions and decision summaries. Generated text never changes task state.</p><EventList events={taskEvents} compact /></div>
  </section>;
}
