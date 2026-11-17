import { SNAPSHOT_STALE_AFTER_MS, type OfficeActiveRun } from "@/lib/office-activity";

import { leaseNow, type RoleStatus } from "./office-status";

export type ProfileStatusDisplay = {
  label: string;
  tone: "green" | "orange" | "red";
  elapsed: string | null;
  ticking: boolean;
  indicator: RoleStatus["indicator"];
};

export function formatWorkDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total >= 3600) return `${Math.floor(total / 3600)}H ${Math.floor(total % 3600 / 60)}M`;
  return `${Math.floor(total / 60)}M ${total % 60}S`;
}

/** Both timestamps originate at the database. Only their difference is aged by monotonic time. */
export function profileStatusDisplay(status: RoleStatus, run: OfficeActiveRun | undefined, generatedAt: string | null | undefined, evidenceAgeMs: number): ProfileStatusDisplay {
  const active = status.indicator === "executing" || status.indicator === "reviewing";
  const unavailable = (): ProfileStatusDisplay => ({ label: "Status unavailable", tone: "red", elapsed: null, ticking: false, indicator: "unknown" });
  if (status.stale || (active && evidenceAgeMs >= SNAPSHOT_STALE_AFTER_MS)) return unavailable();
  if (active) {
    if (!run || run.id !== status.runId || run.agentId !== status.agentId || run.state !== "running" || run.finishedAt) return unavailable();
    if (leaseNow(run, evidenceAgeMs).state !== "live") return { label: "Awaiting fresh status", tone: "orange", elapsed: null, ticking: false, indicator: "stalled" };
    const startedAt = Date.parse(run.startedAt);
    const readAt = generatedAt ? Date.parse(generatedAt) : NaN;
    const elapsed = Number.isFinite(startedAt) && Number.isFinite(readAt) ? formatWorkDuration((Math.max(0, readAt - startedAt) + Math.max(0, evidenceAgeMs)) / 1000) : null;
    return { label: status.indicator === "reviewing" ? "Reviewing" : "Working", tone: "green", elapsed, ticking: true, indicator: status.indicator };
  }
  const red = ["unknown", "not_activated", "not_connected", "stalled", "needs_recovery", "blocked"].includes(status.indicator);
  return { label: status.indicator === "idle" ? "Available" : status.label, tone: red ? "red" : "orange", elapsed: null, ticking: false, indicator: status.indicator };
}
