import { describe, expect, it } from "vitest";

import type { OfficeEvent, OfficeTask } from "@/lib/office-contracts";
import { parseOfficeLink } from "@/lib/office-links";

import { activitySummary, activityTaskHref, groupOfficeActivity } from "./office-activity-groups";

function task(id: string, overrides: Partial<OfficeTask> = {}): OfficeTask {
  return { id, workspaceId: "workspace-a", clientId: "internal", projectId: "demo", parentTaskId: null, agentId: "adrian", goal: `Proposal ${id}`, brief: "Synthetic internal proposal", priority: 0, state: "queued", mode: "demo", version: 1, createdAt: "2026-11-08T03:00:00.000Z", updatedAt: "2026-11-08T03:00:00.000Z", blockedReason: null, currentArtifactId: null, acceptanceEvidenceId: null, ...overrides };
}

function event(eventId: string, sequence: number, overrides: Partial<OfficeEvent> = {}): OfficeEvent {
  return { eventId, sequence, eventType: "task_queued", occurredAt: "2026-11-08T03:00:00.000Z", workspaceId: "workspace-a", clientId: "internal", projectId: "demo", taskId: "parent", runId: null, actorType: "owner", actorId: "owner", mode: "visual_prototype", simulated: true, source: "authenticated_owner_action", payload: {}, ...overrides };
}

describe("readable Office activity histories", () => {
  it("keeps every event and every repeated failure while grouping a proven package family", () => {
    const input = [
      event("draft-one", 1, { taskId: "child", eventType: "artifact_created", runId: "first-run", actorType: "agent", actorId: "lisa" }),
      event("failed-first", 2, { taskId: "child", eventType: "run_failed", runId: "first-run" }),
      event("retry-queued", 3, { taskId: "child", payload: { recoveryDecision: "Retry after check" } }),
      event("failed-retry", 4, { taskId: "child", eventType: "run_failed", runId: "second-run" }),
      event("future-event", 5, { eventType: "future_event_type", payload: { opaque: "retained" } }),
      event("owner-note", 6, { eventType: "task_note_added", payload: { note: "Keep previous work" } }),
      event("workspace-change", 7, { taskId: null, eventType: "schedule_changed" }),
    ];
    const originalIds = input.map((item) => item.eventId);
    const groups = groupOfficeActivity(input, [task("parent"), task("child", { parentTaskId: "parent", agentId: "lisa" })]);

    expect(groups).toHaveLength(2);
    const family = groups.find((group) => group.taskId === "parent")!;
    expect(family.events.map((item) => item.eventId)).toEqual(["owner-note", "future-event", "failed-retry", "retry-queued", "failed-first", "draft-one"]);
    expect(family.events.filter((item) => item.eventType === "run_failed")).toHaveLength(2);
    expect(family.events.find((item) => item.eventId === "future-event")?.payload).toEqual({ opaque: "retained" });
    expect(family.milestones.reduce((sum, item) => sum + item.count, 0)).toBe(family.events.length);
    expect(groups.flatMap((group) => group.events).map((item) => item.eventId).sort()).toEqual([...originalIds].sort());
    expect(input.map((item) => item.eventId)).toEqual(originalIds);
  });

  it("does not merge equal task IDs across workspaces, modes or inconsistent mode evidence", () => {
    const tasks = [
      task("parent"), task("child", { parentTaskId: "parent" }),
      task("parent", { workspaceId: "workspace-b" }), task("child", { workspaceId: "workspace-b", parentTaskId: "parent" }),
      task("parent", { mode: "live" }), task("child", { mode: "live", parentTaskId: "parent" }),
    ];
    const groups = groupOfficeActivity([
      event("a-demo", 1, { taskId: "child" }),
      event("b-demo", 1, { taskId: "child", workspaceId: "workspace-b" }),
      event("a-live", 1, { taskId: "child", mode: "connected_internal_workflow", simulated: false }),
      event("conflicting-mode", 1, { taskId: "child", mode: "connected_internal_workflow", simulated: true }),
    ], tasks);

    expect(groups).toHaveLength(4);
    expect(new Set(groups.map((group) => group.key)).size).toBe(4);
    expect(groups.every((group) => group.events.length === 1)).toBe(true);
    expect(groups.find((group) => group.events[0].eventId === "conflicting-mode")).toMatchObject({ task: null, taskId: "child", familyIncomplete: true });
  });

  it("follows loaded ancestry but keeps missing, cross-scope and cyclic ancestry as separate task histories", () => {
    const tasks = [
      task("parent"), task("child", { parentTaskId: "parent" }), task("grandchild", { parentTaskId: "child" }),
      task("orphan-one", { parentTaskId: "missing" }), task("orphan-two", { parentTaskId: "missing" }),
      task("cross-scope", { parentTaskId: "foreign-parent" }), task("foreign-parent", { workspaceId: "workspace-b" }),
      task("cycle-one", { parentTaskId: "cycle-two" }), task("cycle-two", { parentTaskId: "cycle-one" }),
    ];
    const ids = ["parent", "grandchild", "orphan-one", "orphan-two", "cross-scope", "cycle-one", "cycle-two"];
    const groups = groupOfficeActivity(ids.map((id, index) => event(`event-${id}`, index, { taskId: id })), tasks);

    expect(groups).toHaveLength(6);
    expect(groups.find((group) => group.taskId === "parent")?.events.map((item) => item.taskId)).toEqual(["grandchild", "parent"]);
    for (const id of ids.slice(2)) expect(groups.find((group) => group.taskId === id)).toMatchObject({ familyIncomplete: true, events: [expect.objectContaining({ taskId: id })] });
  });

  it("retains unknown tasks and non-task events without inventing relationships from payload IDs", () => {
    const groups = groupOfficeActivity([
      event("known", 1),
      event("unknown-one", 2, { taskId: "unknown-one", payload: { parentTaskId: "parent" } }),
      event("unknown-two", 3, { taskId: "unknown-two", payload: { taskId: "parent" } }),
      event("workspace-a", 4, { taskId: null }),
      event("workspace-b", 5, { taskId: null, workspaceId: "workspace-b" }),
      event("workspace-live", 6, { taskId: null, mode: "connected_internal_workflow", simulated: false }),
    ], [task("parent")]);

    expect(groups).toHaveLength(6);
    expect(groups.filter((group) => !group.task && group.kind === "task").map((group) => group.title)).toEqual(["Task outside the loaded list", "Task outside the loaded list"]);
    expect(groups.filter((group) => group.kind === "workspace")).toHaveLength(3);
    expect(groups.flatMap((group) => group.events)).toHaveLength(6);
  });

  it("sorts by real time then sequence, with a deterministic tie break, and puts the newest history first", () => {
    const input = [
      event("same-b", 3),
      event("same-a", 3),
      event("sequence-one", 1),
      event("older-zone", 99, { occurredAt: "2026-11-08T09:00:00+07:00" }),
      event("newest-other", 1, { taskId: "other", occurredAt: "2026-11-08T04:00:00.000Z" }),
    ];
    const first = groupOfficeActivity(input, [task("parent"), task("other")]);
    const reversed = groupOfficeActivity([...input].reverse(), [task("other"), task("parent")]);

    expect(first.map((group) => group.taskId)).toEqual(["other", "parent"]);
    expect(first[1].events.map((item) => item.eventId)).toEqual(["same-a", "same-b", "sequence-one", "older-zone"]);
    expect(reversed.map((group) => group.events.map((item) => item.eventId))).toEqual(first.map((group) => group.events.map((item) => item.eventId)));
  });

  it("never promotes request bookkeeping into worker execution or an agent event into owner acceptance", () => {
    expect(activitySummary(event("owner-start", 1, { eventType: "work_started", runId: "coordination-run" }))).toBe("Scheduling was recorded with the request.");
    expect(activitySummary(event("schedule-start", 1, { eventType: "work_started", actorType: "worker", actorId: "scheduler", runId: "coordination-run" }))).toBe("Scheduling was recorded with the request.");
    expect(activitySummary(event("no-run", 1, { eventType: "work_started", actorType: "agent", actorId: "sam" }))).toContain("without a worker run");
    expect(activitySummary(event("fake-acceptance", 1, { eventType: "owner_approved", actorType: "agent", actorId: "adrian", runId: "run" }))).not.toBe("Owner accepted the internal package.");
    expect(activitySummary(event("real-acceptance", 1, { eventType: "owner_approved" }))).toBe("Owner accepted the internal package.");
    expect(activitySummary(event("completed-child", 1, { eventType: "task_completed", payload: { inheritedFromParent: "parent" } }))).toContain("package’s owner acceptance");
  });

  it("carries an unloaded task's actual workspace and record mode into its canonical link", () => {
    const workspaceId = "00000000-0000-4000-8000-000000000002";
    const taskId = "6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5";
    const [unknown] = groupOfficeActivity([event("unloaded", 1, { workspaceId, taskId, mode: "connected_internal_workflow", simulated: false })], []);
    const href = activityTaskHref(unknown)!;

    expect(unknown.task).toBeNull();
    expect(parseOfficeLink(new URL(href, "https://office.example").searchParams)).toEqual({ kind: "link", mode: "live", workspaceId, taskId, artifactId: null, view: "tasks" });
    expect(activityTaskHref({ ...unknown, taskId: null })).toBeNull();
  });
});
