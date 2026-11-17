"use client";

import { CheckCheck, MessageSquare, X } from "lucide-react";
import { useState } from "react";

import type { OfficeApproval, OfficeSnapshot } from "@/lib/office-contracts";

import { EmptyState, OfficeButton, Status, Time } from "./office-ui";
import { OfficeInfo } from "./OfficeInfo";
import type { MutateOffice, OfficeNotice } from "./office-ui";
import styles from "./office.module.css";

/** A 200 response can still report an expired or superseded request; only a recorded decision is success. */
function decisionNotice(decision: "approve" | "reject" | "request_changes", result: unknown, reason: string): OfficeNotice {
  const record = result && typeof result === "object" ? result as Record<string, unknown> : {};
  if (decision === "approve" && record.state === "approved") return { tone: "success", text: `Accepted. Acceptance evidence ${typeof record.acceptanceEvidenceId === "string" ? record.acceptanceEvidenceId : "(identifier unavailable)"} binds this exact package revision and its covered component revisions.` };
  if (decision !== "approve" && record.state === "rejected") return { tone: "success", text: "Your decision and reason were recorded. The package returned to changes requested; existing revisions remain available." };
  const kept = reason ? " Your typed reason is kept on this page." : "";
  if (record.state === "expired") return { tone: "warning", applied: false, text: `Not recorded: this decision request had expired. Renew it for the same package, then decide again.${kept}` };
  if (record.state === "superseded") return { tone: "warning", applied: false, text: `Not recorded: the package revision changed, so this request was superseded. Inspect the current revision before deciding.${kept}` };
  return { tone: "warning", applied: false, text: `The server did not confirm this decision. Refresh and inspect the package before trying again.${kept}` };
}

function ApprovalCard({ approval, snapshot, mutate, disabledReason, busy, onTask, selected, reason, setReason }: { approval: OfficeApproval; snapshot: OfficeSnapshot; mutate: MutateOffice; disabledReason: string | null; busy: boolean; onTask: (id: string) => void; selected: boolean; reason: string; setReason: (value: string) => void }) {
  const [decision, setDecision] = useState<"reject" | "request_changes" | null>(null);
  const task = snapshot.tasks.find((entry) => entry.id === approval.taskId);
  const artifact = snapshot.artifacts.find((entry) => entry.id === approval.artifactId);
  const workspace = snapshot.workspaces.find((entry) => entry.id === approval.workspaceId);
  const reviews = snapshot.reviews.filter((entry) => entry.artifactId === approval.artifactId);
  const digestMatches = !!artifact && artifact.artifactHash === approval.artifactHash && artifact.revisionId === approval.revisionId;
  const reasonDisabled = disabledReason ?? (!digestMatches ? "The current artifact revision is unavailable or changed. Refresh before deciding." : null);

  async function decide(value: "approve" | "reject" | "request_changes") {
    const typed = value === "approve" ? "" : reason.trim();
    const saved = await mutate({ operation: "decide_approval", input: { workspaceId: approval.workspaceId, approvalId: approval.id, version: approval.version, decision: value, ...(value === "approve" ? {} : { reason: typed }) } }, (result) => decisionNotice(value, result, typed));
    if (saved) { setDecision(null); setReason(""); }
  }

  return <article className={styles.inboxCard} aria-current={selected ? "true" : undefined}>
    <div className={styles.taskHead}><span className={styles.eyebrow}>{workspace?.name ?? "Authorized workspace"}</span><Status state={approval.state} /></div>
    <h2>{task?.goal ?? "Internal proposal package"}</h2>
    {task?.mode === "demo" ? <p className={styles.simulated}>Simulated example. This decision is recorded in the demonstration workspace only.</p> : null}
    <div className={styles.acceptanceScope}><strong>Accept this internal proposal package</strong><p>Accepts this exact revision and the covered component manifest. It does not authorize sending to clients, building a website, issuing invoices, payments, filings, or deployment.</p></div>
    <p>Package: {artifact?.title ?? "Artifact unavailable"}<br />Revision: {approval.revisionId}<br />Expires: <Time value={approval.expiresAt} /></p>
    <p className={styles.digest}>SHA-256 · {approval.artifactHash}<br />Action · {approval.actionScope}</p>
    <p>{reviews.length} review record{reviews.length === 1 ? "" : "s"} for this package revision. Inspect the artifact, component manifest, findings, and uncertainty before deciding.</p>
    <div className={styles.buttonRow}><OfficeButton onClick={() => onTask(approval.taskId)}>View work and review findings</OfficeButton></div>
    <div className={styles.section}>
      <div className={styles.buttonRow}>
        <OfficeButton primary disabled={busy || !!reasonDisabled} title={reasonDisabled ?? undefined} onClick={() => void decide("approve")}><CheckCheck className={styles.icon} aria-hidden="true" />Accept this internal package</OfficeButton>
        <OfficeButton disabled={busy || !!reasonDisabled} title={reasonDisabled ?? undefined} onClick={() => setDecision("request_changes")}><MessageSquare className={styles.icon} aria-hidden="true" />Request changes</OfficeButton>
        <OfficeButton danger disabled={busy || !!reasonDisabled} title={reasonDisabled ?? undefined} onClick={() => setDecision("reject")}><X className={styles.icon} aria-hidden="true" />Reject</OfficeButton>
      </div>
      {reasonDisabled ? <p className={styles.hint}>{reasonDisabled}</p> : null}
      {decision ? <form onSubmit={(event) => { event.preventDefault(); void decide(decision); }}>
        <label className={`${styles.field} ${styles.section}`}>{decision === "reject" ? "Reason for rejection" : "Specific changes needed"}<textarea className={styles.textarea} value={reason} minLength={3} maxLength={2000} required onChange={(event) => setReason(event.target.value)} placeholder="State the unresolved issue or the change required" /></label>
        <div className={styles.buttonRow} style={{ marginTop: 10 }}><OfficeButton type="submit" primary={decision === "request_changes"} danger={decision === "reject"} disabled={busy || !!reasonDisabled || reason.trim().length < 3}>Record {decision === "reject" ? "rejection" : "requested changes"}</OfficeButton><OfficeButton onClick={() => setDecision(null)}>Close decision form</OfficeButton></div>
      </form> : null}
    </div>
  </article>;
}

export function OfficeInbox({ approvals, snapshot, mutate, disabledReason, busy, onTask, now, selectedTaskId }: { approvals: OfficeApproval[]; snapshot: OfficeSnapshot; mutate: MutateOffice; disabledReason: string | null; busy: boolean; onTask: (id: string) => void; now: number; selectedTaskId?: string | null }) {
  // Unsent reasons survive a refresh that replaces an expired request with a renewed one.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const taskFor = (approval: OfficeApproval) => snapshot.tasks.find((task) => task.id === approval.taskId);
  // Decidable only for a package awaiting the owner, on its current revision, before expiry.
  const pending = approvals.filter((approval) => { const task = taskFor(approval); return approval.state === "pending" && Date.parse(approval.expiresAt) > now && task?.state === "waiting_for_owner_approval" && task.currentArtifactId === approval.artifactId; });
  const held = approvals.filter((approval) => { const task = taskFor(approval); return approval.state === "pending" && !!task && task.state !== "waiting_for_owner_approval" && !["completed", "cancelled"].includes(task.state); });
  const renewableTasks = snapshot.tasks.filter((task) => task.state === "waiting_for_owner_approval" && approvals.some((approval) => approval.taskId === task.id && approval.artifactId === task.currentArtifactId && (approval.state === "expired" || (approval.state === "pending" && Date.parse(approval.expiresAt) <= now))) && !pending.some((approval) => approval.taskId === task.id));
  return <div aria-label="Owner inbox" className={styles.inbox}>
    <div className={styles.inboxIntro}><p>Packages ready for your decision</p><OfficeInfo label="About owner decisions"><strong>Your decision applies to this package</strong><p>Decisions are grouped by the selected workspace. Acceptance binds the saved manifest, exact revision, SHA-256 digest and required independent reviews. Accepting a proposal does not authorize implementation or external actions.</p></OfficeInfo></div>
    {pending.map((approval) => <ApprovalCard key={`${approval.id}-${approval.version}`} approval={approval} snapshot={snapshot} mutate={mutate} disabledReason={disabledReason} busy={busy} onTask={onTask} selected={approval.taskId === selectedTaskId} reason={reasons[approval.taskId] ?? ""} setReason={(value) => setReasons((current) => ({ ...current, [approval.taskId]: value }))} />)}
    {renewableTasks.map((task) => <article className={styles.inboxCard} key={task.id} aria-current={task.id === selectedTaskId ? "true" : undefined}><Status state="expired" /><h2>{task.goal}</h2><p>The decision request for this package expired. Renewing retains its history and rechecks the current digest and independent reviews. Renewal does not accept the package.{reasons[task.id]?.trim() ? " Your unsent reason is kept for the renewed request." : ""}</p><div className={styles.buttonRow}><OfficeButton onClick={() => onTask(task.id)}>Inspect work and history</OfficeButton><OfficeButton disabled={busy || !!disabledReason} onClick={() => void mutate({ operation: "task_action", input: { workspaceId: task.workspaceId, taskId: task.id, version: task.version, action: "renew_approval" } }, "A fresh decision request was recorded for the same verified package. The expired request is retained.")}>Renew decision request</OfficeButton></div>{disabledReason ? <p className={styles.hint}>{disabledReason}</p> : null}</article>)}
    {held.map((approval) => { const task = taskFor(approval)!; return <article className={styles.inboxCard} key={`held-${approval.id}`} aria-current={task.id === selectedTaskId ? "true" : undefined}><Status state={task.state} /><h2>{task.goal}</h2><p>This package has a decision request, but it is {task.state.replaceAll("_", " ")}, so it cannot be decided now. Resume or reconcile it first; nothing is accepted meanwhile.</p><div className={styles.buttonRow}><OfficeButton onClick={() => onTask(task.id)}>Inspect work and history</OfficeButton></div></article>; })}
    {!pending.length && !renewableTasks.length && !held.length ? <EmptyState title="No owner decisions waiting">The inbox will show an internal package when its required reviews and immutable manifest are ready. No acceptance is inferred from silence.</EmptyState> : null}
  </div>;
}
