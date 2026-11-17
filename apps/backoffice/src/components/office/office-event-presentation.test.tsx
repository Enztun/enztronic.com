import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OfficeEvent } from "@/lib/office-contracts";

import { OfficeAgentBadge } from "./OfficeAgentBadge";
import { EventList, eventText } from "./office-ui";

function event(overrides: Partial<OfficeEvent> = {}): OfficeEvent {
  return {
    eventId: "event-1", sequence: 1, eventType: "review_requested", occurredAt: "2026-11-08T02:00:00.000Z",
    workspaceId: "workspace-1", clientId: "client-1", projectId: "project-1", taskId: "task-1", runId: "run-1",
    actorType: "agent", actorId: "adrian", mode: "visual_prototype", simulated: true,
    source: "confirmed_application_action", payload: { reviewerName: "nadia", revisionLabel: "afbd1924-e807-46f8-af09-4d78ab92c5ac" }, ...overrides,
  };
}

describe("Office event presentation", () => {
  it("describes a historical revision ID plainly while retaining the exact evidence", () => {
    const input = event();
    expect(eventText(input)).toBe("Nadia was asked to review the saved draft.");
    const html = renderToStaticMarkup(<EventList events={[input]} onTask={() => undefined} />);
    expect(html).toContain("<summary>Technical details</summary>");
    expect(html).toContain("afbd1924-e807-46f8-af09-4d78ab92c5ac");
    expect(html).toContain("confirmed_application_action");
    expect(html).toContain("Open task record");
    expect(html).toContain("2026-11-08T02:00:00.000Z");
    expect(html).toContain("Simulated example · no real work performed");
    expect(html).not.toContain("<details open");
  });

  it("does not give agent credit to an owner record stored under a role", () => {
    const input = event({ eventType: "work_started", runId: null, source: "authenticated_owner_action" });
    const html = renderToStaticMarkup(<EventList events={[input]} />);
    expect(eventText(input)).toContain("no worker step ran");
    expect(html).toContain("Owner");
    expect(html).toContain("Recorded for Adrian · no worker run");
    expect(html).not.toContain("/api/office/reference/adrian.png");
  });

  it("does not attribute unknown-source role bookkeeping to the owner or an executing agent", () => {
    const input = event({ eventType: "work_started", runId: null, source: "unverified_import" });
    const html = renderToStaticMarkup(<EventList events={[input]} compact />);
    expect(eventText(input)).toBe("A start was recorded; no worker run is linked.");
    expect(html).toContain("Recorded update");
    expect(html).toContain("Recorded for Adrian · no worker run");
    expect(html).not.toContain("Owner");
    expect(html).not.toContain("/api/office/reference/");
    expect(html).not.toContain("started the authorized task");
  });

  it("keeps scheduler bookkeeping distinct from an agent run", () => {
    const input = event({ actorType: "worker", actorId: "scheduler", eventType: "work_started" });
    expect(eventText(input)).toContain("no worker step ran");
    const html = renderToStaticMarkup(<EventList events={[input]} compact />);
    expect(html).toContain("Scheduler");
    expect(html).not.toContain("/api/office/reference/");
  });

  it("shows the authenticated portrait and textual role only for a recorded agent run", () => {
    const html = renderToStaticMarkup(<EventList events={[event({ actorId: "clara" })]} />);
    expect(html).toContain("/api/office/reference/clara.png");
    expect(html).toContain("Finance");
    expect(html).toContain('data-role-tone="gold"');
    expect(html).toContain('data-agent-id="clara"');
    expect(html).toContain('data-role-id="clara"');
  });

  it("keeps owner notes readable and safe, including compact logs", () => {
    const note = "Keep the supplied revision. <script>nothing executes</script>";
    const input = event({ actorType: "owner", actorId: "owner-1", runId: null, source: "authenticated_owner_action", eventType: "task_note_added", payload: { note } });
    const html = renderToStaticMarkup(<EventList events={[input]} compact />);
    expect(html).toContain("Owner note recorded.");
    expect(html).toContain("Keep the supplied revision. &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("does not flatten a failed step, a retry block or a change request into success", () => {
    expect(eventText(event({ eventType: "run_failed", actorType: "worker", payload: { stepName: "package_review" } }))).toBe("Package review failed. Saved work is available for recovery.");
    expect(eventText(event({ eventType: "work_blocked", payload: { dependencySummary: "Step failed; bounded retry pending" } }))).toContain("bounded retry pending");
    expect(eventText(event({ eventType: "review_changes_requested", payload: { findingCount: 2 } }))).toBe("Review identified 2 change requests.");
  });

  it("keeps a valid requested revision label and normalizes recipient IDs to names", () => {
    expect(eventText(event({ payload: { reviewerName: "nadia", revisionLabel: "R2" } }))).toBe("Nadia was asked to review R2.");
    expect(eventText(event({ eventType: "handoff_accepted", payload: { recipientName: "sam" } }))).toBe("Sam accepted the handoff.");
  });

  it("provides a noninteractive labelled fallback for unknown roles without fetching an unknown portrait", () => {
    const html = renderToStaticMarkup(<OfficeAgentBadge agentId="unknown" compact />);
    expect(html).toContain("Unassigned");
    expect(html).toContain('data-role-tone="neutral"');
    expect(html).not.toContain("/api/office/reference/");
    expect(html).not.toContain("<button");
  });
});
