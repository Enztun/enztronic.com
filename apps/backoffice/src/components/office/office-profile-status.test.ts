import { describe, expect, it } from "vitest";
import type { OfficeActiveRun } from "@/lib/office-activity";
import type { RoleStatus } from "./office-status";
import { formatWorkDuration, profileStatusDisplay } from "./office-profile-status";

const generatedAt = "2026-11-08T06:00:00.000Z";
const status: RoleStatus = { agentId: "sam", indicator: "executing", label: "Executing", detail: "", activeTaskId: "task", runId: "run", since: "2026-11-08T05:58:40.000Z", stale: false };
const run: OfficeActiveRun = { id: "run", taskId: "task", agentId: "sam", step: "draft", state: "running", attempt: 1, startedAt: status.since!, finishedAt: null, errorCode: null, predecessorRunId: null, leaseUntil: "2026-11-08T06:00:10.000Z", leaseLive: true, leaseRemainingMs: 10000 };

describe("compact profile work clock", () => {
  it("ages elapsed work using database timestamp differences and a monotonic age", () => {
    expect(profileStatusDisplay(status, run, generatedAt, 0)).toMatchObject({ label: "Working", tone: "green", elapsed: "1M 20S", ticking: true });
    expect(profileStatusDisplay(status, run, generatedAt, 3000)).toMatchObject({ elapsed: "1M 23S", ticking: true });
    expect(profileStatusDisplay({ ...status, indicator: "reviewing" }, { ...run, step: "review" }, generatedAt, 3000).label).toBe("Reviewing");
  });
  it("stops showing working or a timer at exact lease expiry, including delayed evidence", () => {
    expect(profileStatusDisplay(status, run, generatedAt, 9999).ticking).toBe(true);
    expect(profileStatusDisplay(status, run, generatedAt, 10000)).toMatchObject({ indicator: "stalled", elapsed: null, ticking: false, tone: "orange" });
    expect(profileStatusDisplay(status, { ...run, leaseRemainingMs: 2000 }, generatedAt, 3000).ticking).toBe(false);
    expect(profileStatusDisplay(status, { ...run, leaseRemainingMs: null }, generatedAt, 0).ticking).toBe(false);
  });
  it("never ticks for idle, queued, stopped, unknown or stale evidence", () => {
    for (const indicator of ["idle", "queued", "stopping", "unknown"] as const) expect(profileStatusDisplay({ ...status, indicator }, run, generatedAt, 0)).toMatchObject({ elapsed: null, ticking: false });
    expect(profileStatusDisplay({ ...status, stale: true }, run, generatedAt, 0).indicator).toBe("unknown");
    expect(profileStatusDisplay(status, { ...run, leaseRemainingMs: 60000 }, generatedAt, 45000)).toMatchObject({ indicator: "unknown", ticking: false });
    expect(profileStatusDisplay(status, { ...run, state: "succeeded" }, generatedAt, 0).ticking).toBe(false);
    expect(profileStatusDisplay(status, { ...run, id: "another-run" }, generatedAt, 0).ticking).toBe(false);
  });
  it("omits an elapsed value when database timestamps are unavailable", () => {
    expect(profileStatusDisplay(status, run, null, 0)).toMatchObject({ ticking: true, elapsed: null });
    expect(profileStatusDisplay(status, { ...run, startedAt: "invalid" }, generatedAt, 0).elapsed).toBeNull();
  });
  it("uses compact minute and hour units", () => {
    expect(formatWorkDuration(0)).toBe("0M 0S");
    expect(formatWorkDuration(80)).toBe("1M 20S");
    expect(formatWorkDuration(5401)).toBe("1H 30M");
    expect(formatWorkDuration(-10)).toBe("0M 0S");
  });
});
