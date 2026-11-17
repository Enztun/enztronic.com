import type { OfficeEvent, OfficeTask } from "@/lib/office-contracts";
import { officeHref } from "@/lib/office-links";

export type ActivityMilestone = {
  kind: "drafts" | "reviews" | "decisions" | "attention" | "updates";
  label: string;
  count: number;
};

export type OfficeActivityGroup = {
  key: string;
  workspaceId: string;
  mode: OfficeEvent["mode"];
  simulated: boolean;
  kind: "task" | "workspace";
  taskId: string | null;
  task: OfficeTask | null;
  /** A missing or cyclic parent is not evidence of a shared task family. */
  familyIncomplete: boolean;
  title: string;
  events: OfficeEvent[];
  latestEvent: OfficeEvent;
  milestones: ActivityMilestone[];
};

const taskKey = (workspaceId: string, mode: OfficeTask["mode"], id: string) => JSON.stringify([workspaceId, mode, id]);
const modeForEvent = (event: OfficeEvent): OfficeTask["mode"] => event.mode === "visual_prototype" ? "demo" : "live";

/** Time first, then the workspace's committed sequence, then a stable tie-break. */
export function compareActivityEvents(a: OfficeEvent, b: OfficeEvent): number {
  const aTime = Date.parse(a.occurredAt);
  const bTime = Date.parse(b.occurredAt);
  const time = (Number.isFinite(bTime) ? bTime : -Infinity) - (Number.isFinite(aTime) ? aTime : -Infinity);
  return (Number.isNaN(time) ? 0 : time) || b.sequence - a.sequence || a.eventId.localeCompare(b.eventId);
}

function familyTask(task: OfficeTask, tasks: Map<string, OfficeTask>): { task: OfficeTask; incomplete: boolean } {
  const visited = new Set<string>([task.id]);
  let current = task;
  while (current.parentTaskId) {
    const parent = tasks.get(taskKey(task.workspaceId, task.mode, current.parentTaskId));
    if (!parent || visited.has(parent.id)) return { task, incomplete: true };
    visited.add(parent.id);
    current = parent;
  }
  return { task: current, incomplete: false };
}

function milestoneKind(event: OfficeEvent): ActivityMilestone["kind"] {
  if (event.eventType === "artifact_created") return "drafts";
  if (["review_requested", "review_changes_requested", "review_passed", "handoff_prepared", "handoff_accepted"].includes(event.eventType)) return "reviews";
  if (["owner_approval_requested", "owner_approved", "task_completed"].includes(event.eventType)) return "decisions";
  if (["input_requested", "work_blocked", "run_failed", "pause_requested", "work_paused", "cancel_requested", "task_cancelled"].includes(event.eventType)) return "attention";
  return "updates";
}

export function activityMilestones(events: OfficeEvent[]): ActivityMilestone[] {
  const counts: Record<ActivityMilestone["kind"], number> = { drafts: 0, reviews: 0, decisions: 0, attention: 0, updates: 0 };
  for (const event of events) counts[milestoneKind(event)] += 1;
  return [
    { kind: "drafts", label: "draft saves", count: counts.drafts },
    { kind: "reviews", label: "review updates", count: counts.reviews },
    { kind: "decisions", label: "approval/completion updates", count: counts.decisions },
    { kind: "attention", label: "issues & stops", count: counts.attention },
    { kind: "updates", label: "other updates", count: counts.updates },
  ].filter((item): item is ActivityMilestone => item.count > 0);
}

/** A task missing from the loaded list must carry its explicit scope to server resolution. */
export function activityTaskHref(group: Pick<OfficeActivityGroup, "workspaceId" | "mode" | "taskId">): string | null {
  return group.taskId ? officeHref({ mode: group.mode === "visual_prototype" ? "demo" : "live", workspaceId: group.workspaceId, taskId: group.taskId, view: "tasks" }) : null;
}

/** A historical description of one event; never a claim that a task is executing now. */
export function activitySummary(event: OfficeEvent): string {
  const ownerAction = event.actorType === "owner" && event.source === "authenticated_owner_action";
  if (event.eventType === "work_started") {
    if (event.actorType === "owner" || event.actorId === "scheduler") return "Scheduling was recorded with the request.";
    return event.runId ? "A worker step started." : "A start was recorded without a worker run.";
  }
  if (event.eventType === "owner_approved") return ownerAction ? "Owner accepted the internal package." : "An acceptance event was recorded; see its actor details below.";
  if (event.eventType === "task_completed") return ownerAction ? "Completion was recorded under the package’s owner acceptance." : "A task completion event was recorded.";
  if (event.eventType === "review_changes_requested") return ownerAction ? "Owner requested changes." : "A review recorded requested changes.";
  if (event.eventType === "artifact_created") return ownerAction ? "Owner saved a draft revision." : "A draft revision was saved.";
  const summaries: Record<string, string> = {
    task_queued: "A task entered the queue.",
    task_assigned: "A task assignment was recorded.",
    input_requested: "Additional information was requested.",
    handoff_prepared: "A handoff was prepared.",
    handoff_accepted: "A review handoff was accepted.",
    review_requested: "An independent review was requested.",
    review_passed: "A review passed.",
    owner_approval_requested: "An owner decision was requested.",
    pause_requested: "A pause was requested.",
    work_paused: "Work was paused at a confirmed safe point.",
    work_blocked: "Work was recorded as blocked.",
    run_failed: "A step failed; its recorded details are retained below.",
    cancel_requested: "Cancellation was requested.",
    task_cancelled: "A task was cancelled; its records were retained.",
    task_note_added: ownerAction ? "Owner added a note." : "A note event was recorded.",
    task_reassigned: "The task assignment was changed.",
    task_reprioritized: "The queue priority was changed.",
    tool_operation_recorded: "A tool outcome was recorded.",
    tool_operation_reconciled: "A tool outcome was reconciled.",
  };
  return summaries[event.eventType] ?? "An Office update was recorded.";
}

/**
 * Every supplied event appears exactly once. Only loaded, same-scope parent
 * records establish a family; payload IDs and missing parents cannot join it.
 */
export function groupOfficeActivity(events: OfficeEvent[], tasks: OfficeTask[]): OfficeActivityGroup[] {
  const taskMap = new Map(tasks.map((task) => [taskKey(task.workspaceId, task.mode, task.id), task]));
  const groups = new Map<string, OfficeActivityGroup>();
  for (const event of [...events].sort(compareActivityEvents)) {
    const eventMode = modeForEvent(event);
    // Conflicting mode evidence is kept visible in its own scope, never attached to a task family.
    const modeConsistent = event.simulated === (eventMode === "demo");
    const knownTask = event.taskId && modeConsistent ? taskMap.get(taskKey(event.workspaceId, eventMode, event.taskId)) : undefined;
    const family = knownTask ? familyTask(knownTask, taskMap) : null;
    const task = family?.task ?? null;
    const taskId = task?.id ?? event.taskId;
    const key = JSON.stringify([event.workspaceId, event.mode, event.simulated, event.taskId ? "task" : "workspace", taskId]);
    const existing = groups.get(key);
    if (existing) {
      existing.events.push(event);
      continue;
    }
    groups.set(key, {
      key, workspaceId: event.workspaceId, mode: event.mode, simulated: event.simulated,
      kind: event.taskId ? "task" : "workspace", taskId, task,
      familyIncomplete: family?.incomplete ?? Boolean(event.taskId),
      title: task?.goal || (event.taskId ? "Task outside the loaded list" : "Workspace updates"),
      events: [event], latestEvent: event, milestones: [],
    });
  }
  return [...groups.values()].map((group) => ({ ...group, milestones: activityMilestones(group.events) }));
}
