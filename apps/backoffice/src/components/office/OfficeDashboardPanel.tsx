import { ArrowUpRight, Bot, CircleAlert } from "lucide-react";
import Link from "next/link";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { OfficeDashboardData, OfficeExecutionCapability, OfficeModeSummary, OfficeRoleCounts, OfficeWorkerStatus } from "@/lib/office-activity";
import { officeHref } from "@/lib/office-links";

import { activityLabel, liveProviderLabel, liveUnavailable, liveUsageLine } from "./office-status";
import { OFFICE_PROFILES, profileName } from "./profiles";

// Admin-only summary for the main dashboard. Server-rendered from aggregate,
// read-only queries; it never receives briefs, artifact bodies or note text.

type Available = Extract<OfficeDashboardData, { state: "available" }>;
const timeFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" });
function When({ value }: { value: string | null }) {
  if (!value) return <span>Unavailable</span>;
  return <time dateTime={value}>{timeFormat.format(new Date(value))} WIB</time>;
}
const count = (value: number) => value.toLocaleString("en-US");
const counted = (value: number, word: string) => `${count(value)} ${word}${value === 1 ? "" : "s"}`;
function age(seconds: number | null) {
  if (seconds === null) return "never";
  if (seconds < 90) return `${seconds} s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

function workerBadge(worker: OfficeWorkerStatus): { tone: BadgeTone; label: string; detail: string } {
  if (worker.online) return { tone: "success", label: "Worker online", detail: `Last heartbeat ${age(worker.heartbeatAgeSeconds)} (online below ${worker.onlineThresholdSeconds} s).` };
  if (!worker.workersSeen) return { tone: "neutral", label: "No worker connected", detail: "No heartbeat has been recorded. Saved tasks wait in the queue." };
  if (worker.latest?.stopping) return { tone: "neutral", label: "Worker stopped", detail: `A graceful stop was recorded ${age(worker.latest.ageSeconds)}. Saved tasks wait in the queue.` };
  return { tone: "warning", label: "Worker offline", detail: `Last heartbeat ${age(worker.heartbeatAgeSeconds)}; offline after ${worker.onlineThresholdSeconds} s. Saved tasks wait in the queue.` };
}

function ModeSummary({ summary, simulated, execution }: { summary: OfficeModeSummary; simulated: boolean; execution?: OfficeExecutionCapability }) {
  const liveBlocked = liveUnavailable(execution);
  const { tasks, decisions, steps } = summary;
  const rows: [string, number, string?][] = [
    ["Executing when loaded", tasks.executing, "Tasks with a live worker lease when this page was generated; this page does not update, so reload for current figures"],
    ["Queued", tasks.queued, "Saved, not started"],
    ["Started, not executing", tasks.startedNotExecuting, "In progress without a live lease: waiting on specialists or the worker"],
    ["Awaiting independent review", tasks.awaitingReview],
    ["Review passed", tasks.reviewPassed],
    ["Blocked", tasks.blocked + tasks.failed],
    ["Owner decisions pending", decisions.pending, "Packages awaiting you with a live decision request"],
    ["Completed", tasks.completed],
  ];
  return <Card className="p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-ink">{simulated ? "Demonstration records" : "Live internal records"}</h3>
      <Badge tone={simulated ? "warning" : liveBlocked ? "neutral" : "success"}>{simulated ? "Simulated" : liveBlocked ? "Not connected" : "Live: OpenAI"}</Badge>
    </div>
    <p className="mt-1 text-xs leading-5 text-muted">{simulated ? "Deterministic test adapter only; no real work has been performed." : (liveBlocked ? `${liveBlocked.detail} Live tasks are recorded as blocked.` : "Live AI drafts and reviews with spending limits checked before every request; nothing is sent outside the Office.")} {counted(tasks.total, "task")} ({counted(tasks.parents, "package")}) across {counted(summary.workspaces, "workspace")}.</p>
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
      {rows.map(([label, value, hint]) => <div key={label} className="min-w-0">
        <dt className="text-xs text-muted" title={hint}>{label}</dt>
        <dd className="text-lg font-semibold text-ink">{count(value)}</dd>
      </div>)}
    </dl>
    <p className="mt-3 text-xs leading-5 text-muted">Exact totals. Steps: {count(steps.runnable)} runnable, {count(steps.waitingOnDependencies)} waiting for reviews, {count(steps.retryScheduled)} retry scheduled. {decisions.renewal ? `${count(decisions.renewal)} package${decisions.renewal === 1 ? "" : "s"} need a renewed decision request. ` : ""}{steps.stalled ? `${count(steps.stalled)} expired lease${steps.stalled === 1 ? "" : "s"} awaiting recovery. ` : ""}{steps.exhausted ? `${count(steps.exhausted)} step${steps.exhausted === 1 ? "" : "s"} exhausted retries and need an owner recovery decision. ` : ""}{tasks.paused + tasks.stopping ? `${count(tasks.paused + tasks.stopping)} paused or stopping.` : ""}</p>
  </Card>;
}

function openWork(counts: OfficeRoleCounts) { return counts.open; }
export function queuedRoleSteps(demo: OfficeRoleCounts, live: OfficeRoleCounts) { return demo.runnableSteps + demo.runnableReviews + live.runnableSteps + live.runnableReviews; }

function AvailablePanel({ data }: { data: Available }) {
  const worker = workerBadge(data.worker);
  return <>
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="success">Office enabled</Badge>
        <Badge tone={worker.tone}>{worker.label}</Badge>
        <Badge>{data.execution.providerConfigured ? "Adapters: OpenAI (live) and deterministic simulation" : "Adapter: deterministic simulation"}</Badge>
        <Badge>Live provider: {liveProviderLabel(data.execution) === "Not connected" ? "not connected" : liveProviderLabel(data.execution)}</Badge>
        <Badge>Command execution: disabled</Badge>
        <Badge>{data.execution.budget?.monthLimitMicrounits ? "Usage / cost: metered" : "Usage / cost: unavailable"}</Badge>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">{worker.detail} Figures as of <When value={data.generatedAt} />; reload for newer data. {data.execution.budget?.monthLimitMicrounits ? liveUsageLine(data.execution) : "Usage and cost are not metered because no live spending limit is set."}</p>
    </Card>

    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <ModeSummary summary={data.modes.demo} simulated />
      <ModeSummary summary={data.modes.live} simulated={false} execution={data.execution} />
    </div>

    <Card className="mt-4 overflow-x-auto p-5">
      <h3 className="text-sm font-semibold text-ink">Role workload</h3>
      <p className="mt-1 text-xs leading-5 text-muted">Seven role profiles share one durable worker. Executing means a live lease when this page was generated; idle is not a failure.</p>
      <table className="mt-3 w-full min-w-[34rem] text-left text-sm">
        <thead className="text-xs text-muted">
          <tr><th scope="col" className="py-2 pr-3 font-medium">Role</th><th scope="col" className="py-2 pr-3 font-medium">Demo open</th><th scope="col" className="py-2 pr-3 font-medium">Executing when loaded</th><th scope="col" className="py-2 pr-3 font-medium">Queued steps</th><th scope="col" className="py-2 pr-3 font-medium">Live open</th><th scope="col" className="py-2 font-medium">Last confirmed activity</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {OFFICE_PROFILES.map((profile) => {
            const role = data.roles.find((entry) => entry.agentId === profile.id);
            return <tr key={profile.id} data-agent-id={profile.id}>
              <th scope="row" className="py-2 pr-3 font-semibold text-ink">{profile.name}<span className="block text-xs font-normal text-muted">{profile.role}</span></th>
              <td className="py-2 pr-3">{role ? count(openWork(role.demo)) : "—"}</td>
              <td className="py-2 pr-3">{role ? count(role.demo.executingRuns + role.live.executingRuns) : "—"}</td>
              <td className="py-2 pr-3">{role ? count(queuedRoleSteps(role.demo, role.live)) : "—"}</td>
              <td className="py-2 pr-3">{role ? `${count(openWork(role.live))}${role.live.blocked ? ` (${count(role.live.blocked)} blocked)` : ""}` : "—"}</td>
              <td className="py-2 text-xs text-muted"><When value={role?.lastActivityAt ?? null} /></td>
            </tr>;
          })}
        </tbody>
      </table>
    </Card>

    <div className="mt-4 grid gap-4 xl:grid-cols-3">
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink">Owner decisions</h3>
        <p className="mt-1 text-xs leading-5 text-muted">{count(data.decisions.pending)} pending{data.decisions.renewal ? `, ${count(data.decisions.renewal)} needing renewal` : ""} (exact). Latest {data.windows.decisions} shown.</p>
        {data.decisions.latest.length ? <ul className="mt-3 space-y-3">{data.decisions.latest.map((decision) => <li key={decision.approvalId} className="text-sm">
          <Link href={officeHref(decision.link)} className="font-semibold text-accent hover:text-ink">Review decision: {decision.goal}<ArrowUpRight aria-hidden="true" className="ml-1 inline size-3.5" /></Link>
          <p className="mt-0.5 text-xs text-muted">{decision.workspaceName} · package R{decision.revision} · {decision.link.mode === "demo" ? "simulated" : "internal"} · {decision.renewalNeeded ? "request expired, renewal needed" : <>expires <When value={decision.expiresAt} /></>}</p>
        </li>)}</ul> : <p className="mt-3 text-sm text-muted">No owner decisions waiting. Acceptance is never inferred from silence.</p>}
      </Card>
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink">Latest reviewed outputs</h3>
        <p className="mt-1 text-xs leading-5 text-muted">Latest {data.windows.outputs} passed independent reviews. Authored, reviewed and owner-accepted are separate states.</p>
        {data.outputs.length ? <ul className="mt-3 space-y-3">{data.outputs.map((output) => <li key={output.reviewId} className="text-sm">
          <Link href={officeHref(output.link)} className="font-semibold text-accent hover:text-ink">{output.title} · R{output.revision}<ArrowUpRight aria-hidden="true" className="ml-1 inline size-3.5" /></Link>
          <p className="mt-0.5 text-xs text-muted">{output.ownerPrepared ? `Owner revision recorded under ${profileName(output.authorAgentId)}` : `Authored by ${profileName(output.authorAgentId)}`} · reviewed by {profileName(output.reviewerId)} · <When value={output.decidedAt} /> · {output.link.mode === "demo" ? "simulated" : "internal"}</p>
          <Badge className="mt-1" tone={output.status === "owner_accepted" ? "success" : output.status === "superseded" ? "neutral" : "info"}>{output.status === "owner_accepted" ? "Owner accepted" : output.status === "superseded" ? "Superseded revision" : "Reviewed · not owner-accepted"}</Badge>
        </li>)}</ul> : <p className="mt-3 text-sm text-muted">No reviewed outputs yet. A saved draft is not a passed review.</p>}
      </Card>
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink">Recent confirmed activity</h3>
        <p className="mt-1 text-xs leading-5 text-muted">Latest {data.windows.events} recorded events (recent window, not a total).</p>
        {data.events.length ? <ol className="mt-3 space-y-3">{data.events.map((event) => <li key={event.eventId} className="text-sm">
          <p className="text-ink">{event.coordination ? "Scheduling recorded with the request (no worker step)" : activityLabel(event.eventType)}{event.goal ? <> · {event.link ? <Link href={officeHref(event.link)} className="text-accent hover:text-ink">{event.goal}</Link> : event.goal}</> : null}</p>
          <p className="mt-0.5 text-xs text-muted">{event.actorType === "agent" ? (event.ownerRecordedUnderRole ? `Owner · recorded under ${profileName(event.agentId)}` : profileName(event.agentId)) : event.actorType === "owner" ? "Owner" : "Workflow controller"} · <When value={event.occurredAt} /> · {event.mode === "demo" ? "simulated" : "internal"}</p>
        </li>)}</ol> : <p className="mt-3 text-sm text-muted">No recorded activity yet.</p>}
      </Card>
    </div>
  </>;
}

export function OfficeDashboardPanel({ data }: { data: OfficeDashboardData }) {
  return <section aria-labelledby="dashboard-office-title" className="mt-8">
    <div className="mb-4 flex items-center justify-between gap-4">
      <div>
        <h2 id="dashboard-office-title" className="text-base font-semibold text-ink">Office</h2>
        <p className="mt-1 text-sm text-muted">Admin only. Fictional AI roles, recorded work and owner decisions; separate from clients, invoices and commissions.</p>
      </div>
      <Link href="/team" className="rounded-lg text-sm font-semibold text-accent hover:text-ink">Open Office</Link>
    </div>
    {data.state === "disabled" ? <Card className="p-5">
      <div className="flex items-start gap-3"><Bot aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted" /><div>
        <p className="text-sm font-semibold text-ink">Office is disabled on this server</p>
        <p className="mt-1 text-sm leading-6 text-muted">OFFICE_ENABLED is not &quot;true&quot;, so no Office records were read and no counts exist. Activation needs the reviewed additive migration 003, a dedicated least-privilege worker and an authorized activation window. Profiles and the layout preview remain available in Office.</p>
      </div></div>
    </Card> : data.state === "unavailable" ? <Card className="p-5" role="status">
      <div className="flex items-start gap-3"><CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" /><div>
        <p className="text-sm font-semibold text-ink">Office data is unavailable</p>
        <p className="mt-1 text-sm leading-6 text-muted">{data.reason === "schema_missing" ? "Office is enabled, but its additive schema (migration 003) is not present in this database." : "Office is enabled, but its records could not be read."} No counts are shown rather than reporting zeros. Clients, invoices and earnings above are unaffected.</p>
      </div></div>
    </Card> : <AvailablePanel data={data} />}
  </section>;
}
