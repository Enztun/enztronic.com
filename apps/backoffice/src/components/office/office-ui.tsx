import { FileText, Settings2, UserRound, Workflow } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import type { ApprovalDecisionInput, OfficeEvent, SubmitTaskInput, TaskActionInput } from "@/lib/office-contracts";
import presets from "@/lib/office-contracts/response-presets.json";

import { OfficeAgentBadge } from "./OfficeAgentBadge";
import { OFFICE_PROFILES, profileName, stateLabel } from "./profiles";
import identityStyles from "./office-agent-badge.module.css";
import styles from "./office.module.css";

export { Portrait } from "./OfficePortrait";

export type OfficeMutation =
  | { operation: "submit"; input: SubmitTaskInput }
  | { operation: "task_action"; input: TaskActionInput }
  | { operation: "decide_approval"; input: ApprovalDecisionInput }
  | { operation: "revise_artifact"; input: { workspaceId: string; taskId: string; version: number; title: string; content: string; authorAgentId: (typeof OFFICE_PROFILES)[number]["id"] } };

/** `applied: false` reports a confirmed response that did not perform the requested change. */
export type OfficeNotice = { tone: "success" | "warning"; text: string; applied?: boolean };
/** Resolves true only when the server confirmed the requested change. */
export type MutateOffice = (request: OfficeMutation, message: string | ((result: unknown) => string | OfficeNotice)) => Promise<boolean>;

export function OfficeButton({ children, primary, danger, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; primary?: boolean; danger?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return <button type="button" {...props} className={`${styles.button} ${primary ? styles.primary : ""} ${danger ? styles.danger : ""} ${className}`}>{children}</button>;
}

export function Status({ state }: { state: string }) {
  return <span className={styles.status} data-state={state}>{stateLabel(state)}</span>;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" });
export function Time({ value }: { value: string | null | undefined }) {
  if (!value || !Number.isFinite(Date.parse(value))) return <span>Unavailable</span>;
  return <time dateTime={value} title={`${new Date(value).toISOString()} · Asia/Jakarta`}>{dateFormat.format(new Date(value))} WIB</time>;
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className={styles.empty}><FileText size={25} aria-hidden="true" /><h2>{title}</h2><p>{children}</p>{action}</div>;
}

const eventIdentifier = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\bDEMO-(?:EVENT|TASK|BRIEF|PROPOSAL|PACKAGE|R)\S*/i;
const stepLabels: Record<string, string> = { draft: "Drafting", review: "Review", package: "Package preparation", package_review: "Package review" };

export function eventText(event: OfficeEvent): string {
  // Scheduling recorded inside the owner's or scheduler's request is bookkeeping, not a worker step.
  if (event.eventType === "work_started" && (event.actorType === "owner" || event.actorId === "scheduler" || event.actorType === "agent" && !event.runId && event.source === "authenticated_owner_action")) return "Scheduling recorded with the request; no worker step ran.";
  if (event.eventType === "work_started" && event.actorType === "agent" && !event.runId) return "A start was recorded; no worker run is linked.";
  if (event.actorType === "owner" && event.source === "authenticated_owner_action") {
    if (event.eventType === "task_note_added") return "Owner note recorded.";
    if (event.eventType === "task_reassigned" && typeof event.payload.agentId === "string" && OFFICE_PROFILES.some((entry) => entry.id === event.payload.agentId)) return `Task reassigned to ${profileName(event.payload.agentId)}.`;
    if (event.eventType === "task_reprioritized" && typeof event.payload.priority === "number" && Number.isInteger(event.payload.priority)) return `Queue priority set to ${event.payload.priority}.`;
    if (event.eventType === "review_changes_requested") return "The owner requested changes. The saved feedback is in the task record.";
  }
  const preset = presets.statusPresets.find((entry) => entry.eventType === event.eventType);
  if (!preset) {
    if (event.eventType === "tool_operation_recorded") return "An operation result was recorded.";
    if (event.eventType === "tool_operation_reconciled") return "The owner recorded an operation recovery decision.";
    return `${stateLabel(event.eventType)} recorded.`;
  }
  const allowed = new Set(["agentName", "inputSummary", "artifactTitle", "revisionLabel", "recipientName", "reviewerName", "findingCount", "dependencySummary", "stepName"]);
  let complete = true;
  const message = preset.template.replace(/\{([A-Za-z]+)\}/g, (_, key: string) => {
    if (!allowed.has(key)) { complete = false; return ""; }
    let value = event.payload[key];
    if (typeof value !== "string" && typeof value !== "number") {
      const idKey = { agentName: "agentId", recipientName: "recipientId", reviewerName: "reviewerId" }[key];
      const id = idKey ? event.payload[idKey] : undefined;
      if (typeof id === "string" && OFFICE_PROFILES.some((entry) => entry.id === id)) value = profileName(id);
    }
    // Older events stored an artifact UUID as revisionLabel. Keep it inspectable
    // in the evidence, while the primary line describes the actual action.
    if (key === "revisionLabel" && (typeof value !== "string" || eventIdentifier.test(value))) value = "the saved draft";
    if (["agentName", "recipientName", "reviewerName"].includes(key) && typeof value === "string") {
      const profile = OFFICE_PROFILES.find((entry) => entry.id === value || entry.name === value);
      if (profile) value = profile.name;
    }
    if (key === "stepName" && typeof value === "string") value = stepLabels[value] ?? value.replaceAll("_", " ");
    if (key === "artifactTitle" && typeof value === "string" && eventIdentifier.test(value)) value = "Draft";
    if (typeof value !== "string" && typeof value !== "number") { complete = false; return ""; }
    if (typeof value === "string" && eventIdentifier.test(value)) { complete = false; return ""; }
    return String(value).slice(0, 220);
  });
  return complete ? message : `${preset.label}.`;
}

export function EventList({ events, onTask, compact = false }: { events: OfficeEvent[]; onTask?: (id: string) => void; compact?: boolean }) {
  if (!events.length) return <p className={styles.copy}>No confirmed actions in this view.</p>;
  return <ol className={styles.timeline}>{events.map((event) => {
    const roleBookkeeping = event.actorType === "agent" && !event.runId;
    const ownerRecorded = event.actorType === "owner" || roleBookkeeping && event.source === "authenticated_owner_action";
    return <li className={styles.event} key={event.eventId} data-event-id={event.eventId}>
    <div className={identityStyles.eventHeader}>
      {event.actorType === "agent" && event.runId && OFFICE_PROFILES.some((entry) => entry.id === event.actorId) ? <OfficeAgentBadge agentId={event.actorId} compact /> : <span className={identityStyles.actor}>
        {ownerRecorded ? <UserRound size={15} aria-hidden="true" /> : event.actorId === "scheduler" ? <Settings2 size={15} aria-hidden="true" /> : <Workflow size={15} aria-hidden="true" />}
        <span className={identityStyles.actorText}>{ownerRecorded ? "Owner" : roleBookkeeping ? "Recorded update" : event.actorId === "scheduler" ? "Scheduler" : "Workflow controller"}
          {roleBookkeeping ? <span className={identityStyles.actorContext}>Recorded for {profileName(event.actorId)} · no worker run</span> : null}
        </span>
      </span>}
      <span className={identityStyles.time}><Time value={event.occurredAt} /></span>
    </div>
    <p>{eventText(event)}</p>
    {event.eventType === "task_note_added" && event.actorType === "owner" && event.source === "authenticated_owner_action" && typeof event.payload.note === "string" ? <p className={styles.prose} style={{ marginTop: 7 }}>{event.payload.note.slice(0, 2000)}</p> : null}
    {event.simulated ? <small className={styles.simulated}>Simulated example · no real work performed</small> : null}
    {!compact ? <details className={identityStyles.technical}><summary>Technical details</summary><dl>
      <dt>Event</dt><dd>{event.eventType} · {event.eventId}</dd>
      <dt>Actor</dt><dd>{event.actorType} / {event.actorId}</dd>
      <dt>Source</dt><dd>{event.source}</dd>
      <dt>Workspace</dt><dd>{event.workspaceId}</dd>
      <dt>Client / project</dt><dd>{event.clientId} / {event.projectId}</dd>
      {event.taskId ? <><dt>Task</dt><dd>{event.taskId}</dd></> : null}
      {event.runId ? <><dt>Run</dt><dd>{event.runId}</dd></> : null}
      <dt>Recorded at</dt><dd>{event.occurredAt}</dd>
      <dt>Evidence</dt><dd>{JSON.stringify(event.payload, null, 2)}</dd>
    </dl></details> : null}
    {onTask && event.taskId ? <button className={styles.eventTask} type="button" onClick={() => onTask(event.taskId!)}>Open task record →</button> : null}
  </li>; })}</ol>;
}

export function downloadText(title: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[^a-zA-Z0-9 _.-]/g, "").slice(0, 90) || "office-artifact"}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
