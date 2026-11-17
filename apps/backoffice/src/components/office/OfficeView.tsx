"use client";

import { Activity, AlertCircle, ArrowUpRight, CheckCheck, ClipboardList, Copy, Download, FilePlus2, History, Inbox, LayoutGrid, Link2Off, RefreshCw, ShieldCheck, SlidersHorizontal, WifiOff, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { FormEvent } from "react";

import type { OfficeMode, OfficeSnapshot, OfficeTask, OfficeWorkspace, SubmitTaskInput } from "@/lib/office-contracts";
import { SNAPSHOT_STALE_AFTER_MS, type OfficeActivity, type OfficeAvailability } from "@/lib/office-activity";
import { officeHref, type OfficeLinkState, type OfficeLinkView } from "@/lib/office-links";

import { OfficeInbox } from "./OfficeInbox";
import { OfficeInfo, OfficeNoticeBanner } from "./OfficeInfo";
import { OfficeProfilePanel } from "./OfficeProfilePanel";
import { OfficeActivityFeed } from "./OfficeActivityFeed";
import { OfficeAgentBadge } from "./OfficeAgentBadge";
import { OfficeRoleStatus } from "./OfficeRoleStatus";
import { OfficeTaskDetail } from "./OfficeTaskDetail";
import { EmptyState, OfficeButton, Portrait, Status, Time, downloadText } from "./office-ui";
import type { MutateOffice, OfficeMutation, OfficeNotice } from "./office-ui";
import { classifySubmitFailure, dataFreshness, deriveRoleStatus, evidenceAge, isOfficeActivity, liveUnavailable, liveUsageLine, mergeFamily, nextEvidenceChangeMs, nextSubmitLock, persistenceState, savedBriefExecution, taskDecision, taskExecutionLine, workerIndicator } from "./office-status";
import type { WorkerIndicator } from "./office-status";
import { OFFICE_PROFILES, stateLabel } from "./profiles";
import { getRoleIdentity, roleIdentityStyle } from "./role-identity";
import { createRevisionSavedHandler, type TaskSelection } from "./office-selection";
import styles from "./office.module.css";

const OfficeScene = dynamic(() => import("./OfficeScene"), { ssr: false, loading: () => <div className={styles.sceneLoading} role="status">Opening the office…</div> });

const EMPTY_SNAPSHOT: OfficeSnapshot = {
  available: false, workspaces: [], agents: [], tasks: [], artifacts: [], reviews: [], approvals: [], events: [], latestSequence: 0,
  health: { workerOnline: false, lastHeartbeatAt: null, providerConfigured: false, commandExecutionEnabled: false, status: "configuration_required", disclosure: "Office storage and worker activation have not been verified." },
  limits: { taskLimit: 100, eventLimit: 100 }, configurationRequired: ["Enable the office after reviewing the migration and worker activation plan."],
};
type OfficeViewMode = OfficeLinkView;
type RequestError = Error & { status?: number; code?: string; aborted?: boolean };
type SendResult = { ok: true; body: unknown } | { ok: false; failure: RequestError };
// One immutable payload and key per unconfirmed submission. `uncertain` means it may already be saved.
type SubmissionAttempt = { input: SubmitTaskInput; uncertain: boolean };
type BriefDraft = { goal: string; brief: string; idempotencyKey: string; attempt: SubmissionAttempt | null };
function sessionFailure(failure: RequestError) {
  return failure.status === 401 || (failure.status === 403 && failure.code !== "FORBIDDEN" && failure.code !== "SCOPE_DENIED");
}

function isOfficeSnapshot(value: unknown): value is OfficeSnapshot {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.available !== "boolean" || !["workspaces", "agents", "tasks", "artifacts", "reviews", "approvals", "events", "configurationRequired"].every((key) => Array.isArray(record[key]))) return false;
  if (!record.health || typeof record.health !== "object" || !record.limits || typeof record.limits !== "object") return false;
  const health = record.health as Record<string, unknown>;
  const limits = record.limits as Record<string, unknown>;
  return typeof health.workerOnline === "boolean" && typeof health.providerConfigured === "boolean" && typeof limits.taskLimit === "number" && typeof limits.eventLimit === "number" && typeof record.latestSequence === "number";
}

async function readResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const error = new Error(typeof raw.error === "string" ? raw.error : typeof raw.message === "string" ? raw.message : `Office request failed (${response.status}).`) as RequestError;
    error.status = response.status;
    error.code = typeof raw.code === "string" ? raw.code : undefined;
    throw error;
  }
  return body;
}

function savedTask(body: unknown): { taskId: string; duplicate: boolean } | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  return typeof record.taskId === "string" && typeof record.duplicate === "boolean" ? { taskId: record.taskId, duplicate: record.duplicate } : null;
}

function linkNoticeText(link: OfficeLinkState | undefined): string | null {
  switch (link?.status) {
    case "invalid": return "This Office link is malformed or ambiguous, so it was ignored. The overview is shown instead.";
    case "not_found": return `No ${link.mode === "demo" ? "demonstration" : "internal"} record matches this link in the workspace it names. It may not exist, may belong elsewhere, or the link is incomplete. Nothing else was opened.`;
    case "office_disabled": return "Office is switched off on this server, so links to Office records cannot be opened.";
    case "unavailable": return "Office storage is unavailable, so this link could not be checked.";
    case "ok": return link.artifact === "not_found" ? "The task opened, but the linked revision was not found for it. No other revision is shown in its place; choose one explicitly in the task record." : null;
    default: return null;
  }
}

/** The canonical URL a link resolves to, including its revision, so echoes compare exactly. */
function linkHref(link: OfficeLinkState | undefined): string | null {
  if (!link || link.status === "none") return "/team";
  return link.status === "ok" ? officeHref({ mode: link.mode, workspaceId: link.workspaceId, taskId: link.taskId, artifactId: link.artifactId, view: link.view }) : null;
}

function linkSelection(link: OfficeLinkState | undefined): TaskSelection | null {
  if (link?.status !== "ok" || !link.taskId || !link.workspaceId) return null;
  return { taskId: link.taskId, workspaceId: link.workspaceId, artifactId: link.artifactId, artifactNotFound: link.artifact === "not_found" };
}

function TaskList({ tasks, snapshot, selectedId, onTask, onNew, filtered, execution }: { tasks: OfficeTask[]; snapshot: OfficeSnapshot; selectedId: string | null; onTask: (id: string) => void; onNew: () => void; filtered: boolean; execution: (task: OfficeTask) => { state: string; label: string } }) {
  if (!tasks.length) return <EmptyState title={filtered ? "No tasks match these filters" : "No tasks assigned"} action={<OfficeButton onClick={onNew}><FilePlus2 className={styles.icon} aria-hidden="true" />Prepare an internal brief</OfficeButton>}>{filtered ? "Change the workspace, person, status, or search filter to see other authorized records." : "Start with a website request. The office prepares a source-linked internal proposal; implementation and external actions require separate authorization."}</EmptyState>;
  return <div className={styles.taskList} aria-label="Office task list">{tasks.map((task) => { const line = execution(task); return <button key={task.id} type="button" className={styles.task} style={roleIdentityStyle(task.agentId)} data-agent-id={task.agentId} data-role-tone={getRoleIdentity(task.agentId).tone} aria-pressed={selectedId === task.id} onClick={() => onTask(task.id)}>
    <div className={styles.taskHead}><OfficeAgentBadge agentId={task.agentId} compact /><Status state={task.state} /></div>
    <h3 className={styles.taskTitle}>{task.goal}</h3>
    <div className={styles.taskMeta}><span>{snapshot.workspaces.find((workspace) => workspace.id === task.workspaceId)?.name ?? "Authorized workspace"}</span>{task.parentTaskId ? <span>Specialist task</span> : <span>Proposal package</span>}<span>Updated <Time value={task.updatedAt} /></span>{task.mode === "demo" ? <span className={styles.simulated}>Simulated</span> : null}</div>
    <div className={styles.taskMeta} data-execution={line.state}><span className={styles.execution}>{line.label}</span></div>
    {task.blockedReason ? <p className={styles.taskBrief}>Blocked by: {task.blockedReason}</p> : null}
  </button>; })}</div>;
}

export function OfficeView({ initialSnapshot, initialAvailability, initialLink, initialCatalog, initialActivity }: { initialSnapshot?: OfficeSnapshot; initialAvailability?: OfficeAvailability; initialLink?: OfficeLinkState; initialCatalog?: OfficeWorkspace[]; initialActivity?: OfficeActivity | null }) {
  const linked = initialLink?.status === "ok" ? initialLink : null;
  // A linked task's family is merged in, so exact links also work beyond the bounded snapshot window.
  const [snapshot, setSnapshot] = useState<OfficeSnapshot>(() => mergeFamily(initialSnapshot ?? EMPTY_SNAPSHOT, initialActivity?.family ?? null));
  const [workspaceCatalog, setWorkspaceCatalog] = useState<OfficeWorkspace[]>(initialCatalog ?? initialSnapshot?.workspaces ?? []);
  const [availability, setAvailability] = useState<OfficeAvailability>(initialAvailability ?? (initialSnapshot?.available ? "available" : "disabled"));
  const [activity, setActivity] = useState<OfficeActivity | null>(initialActivity ?? null);
  // Monotonic (performance.now()) time the evidence was requested. Server-rendered evidence was read
  // after this document's navigation started, so 0 never understates its age.
  const [observedAt, setObservedAt] = useState(0);
  const [monoNow, setMonoNow] = useState<number | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [view, setView] = useState<OfficeViewMode>(linked?.view ?? (linked?.taskId ? "tasks" : "scene"));
  const [mode, setMode] = useState<OfficeMode>(linked?.mode ?? (initialLink?.status === "not_found" ? initialLink.mode : "demo"));
  const [workspaceId, setWorkspaceId] = useState(linked?.workspaceId ?? "");
  const [selectedAgent, setSelectedAgent] = useState("adrian");
  const [profileOpen, setProfileOpen] = useState(false);
  const [selection, setSelection] = useState<TaskSelection | null>(() => linkSelection(initialLink));
  const [focusTaskId, setFocusTaskId] = useState<string | null>(linked?.taskId ?? null);
  const [linkNotice, setLinkNotice] = useState<string | null>(linkNoticeText(initialLink));
  const [personFilter, setPersonFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(!!initialSnapshot);
  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<OfficeNotice | null>(null);
  const [denied, setDenied] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastConfirmedAt, setLastConfirmedAt] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [goal, setGoal] = useState("");
  const [brief, setBrief] = useState("");
  const [formWorkspaceId, setFormWorkspaceId] = useState("");
  const [submissionAttempt, setSubmissionAttempt] = useState<SubmissionAttempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitProblem, setSubmitProblem] = useState<{ kind: "rejected" | "uncertain"; message: string } | null>(null);
  const [retainedDrafts, setRetainedDrafts] = useState(0);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const [sceneFailure, setSceneFailure] = useState<string | null>(null);
  const [sceneQuality, setSceneQuality] = useState<"normal" | "low">("normal");
  const [reducedMotion, setReducedMotion] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  // Page-memory only: never localStorage, IndexedDB, URLs, analytics or logs.
  const briefDrafts = useRef(new Map<string, BriefDraft>());
  const fetchSequence = useRef(0);
  const activeFetch = useRef<AbortController | null>(null);
  const requestLock = useRef(false);
  const appliedLink = useRef(initialLink);
  const writtenHref = useRef<string | null>(null);
  const selectionRef = useRef(selection);
  const newHeading = useRef<HTMLHeadingElement>(null);
  const newBriefButton = useRef<HTMLButtonElement>(null);
  const taskReturnFocus = useRef<HTMLElement | null>(null);
  const briefReturnFocus = useRef<HTMLElement | null>(null);

  // Wall time for page-data freshness; monotonic time for ageing server evidence.
  const tick = useCallback(() => { setClock(Date.now()); setMonoNow(performance.now()); }, []);

  const refresh = useCallback(async () => {
    const sequence = ++fetchSequence.current;
    activeFetch.current?.abort();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 12000);
    activeFetch.current = controller;
    setRefreshing(true);
    try {
      const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
      const result = await readResponse(await fetch(`/api/office${query}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal }));
      if (sequence !== fetchSequence.current) return;
      if (!isOfficeSnapshot(result)) throw new Error("The office returned an invalid snapshot. The last confirmed state is retained.");
      const confirmed = result;
      // Run evidence is read separately; its failure never hides confirmed task records.
      let evidence: OfficeActivity | null = null;
      let evidenceSentAt = 0;
      let evidenceError: string | null = null;
      if (confirmed.available) {
        try {
          const statusQuery = new URLSearchParams(workspaceId ? { workspaceId } : {});
          const selected = selectionRef.current;
          if (selected?.workspaceId) { statusQuery.set("taskId", selected.taskId); statusQuery.set("taskWorkspaceId", selected.workspaceId); }
          const statusSearch = statusQuery.toString();
          // Taken before sending: any request or response delay then counts against the evidence.
          const sentAt = performance.now();
          const body = await readResponse(await fetch(`/api/office/status${statusSearch ? `?${statusSearch}` : ""}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal }));
          if (!isOfficeActivity(body)) throw new Error("invalid");
          evidence = body;
          evidenceSentAt = sentAt;
        } catch (error) {
          if (sessionFailure(error as RequestError)) throw error;
          if (controller.signal.aborted && !timedOut) return;
          evidenceError = "Worker, run and lease evidence is unavailable. Task records above are confirmed; execution is shown as unavailable rather than guessed.";
        }
      }
      if (sequence !== fetchSequence.current) return;
      setSnapshot(mergeFamily(confirmed, evidence?.family ?? null));
      if (!workspaceId) setWorkspaceCatalog(confirmed.workspaces);
      setAvailability(confirmed.available ? "available" : "disabled");
      if (evidence) { setActivity(evidence); setObservedAt(evidenceSentAt); }
      if (!confirmed.available) setActivity(null);
      setActivityError(evidenceError);
      setLastConfirmedAt(new Date().toISOString());
      tick();
      setDenied(false);
      setSyncError(null);
    } catch (error) {
      if ((controller.signal.aborted && !timedOut) || sequence !== fetchSequence.current) return;
      const failure = timedOut ? new Error("Office snapshot timed out. The last confirmed state is retained; refresh to reconcile.") as RequestError : error as RequestError;
      if (sessionFailure(failure)) setDenied(true);
      if (failure.status === 503 && failure.code === "storage_unavailable") setAvailability("storage_unavailable");
      setSyncError(sessionFailure(failure) ? "Access denied or the session expired. Re-enter through the private backoffice before continuing." : failure.message || "Office connection unavailable. The last confirmed state is retained.");
    } finally {
      clearTimeout(timeout);
      if (sequence === fetchSequence.current) { setRefreshing(false); setLoaded(true); }
    }
  }, [workspaceId, tick]);

  useEffect(() => {
    const interval = setInterval(() => { tick(); if (!document.hidden && navigator.onLine) void refresh(); }, 15000);
    const online = () => { setOffline(false); tick(); void refresh(); };
    const offlineHandler = () => { setOffline(true); tick(); };
    // A hidden tab stops polling and may throttle timers, so becoming visible re-ages evidence at once, then reconciles.
    const visible = () => { tick(); if (!document.hidden && navigator.onLine) void refresh(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) { tick(); void refresh(); } };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const setMotion = () => setReducedMotion(motion.matches);
    const startup = setTimeout(() => { setMotion(); setOffline(!navigator.onLine); tick(); void refresh(); }, 0);
    window.addEventListener("online", online);
    window.addEventListener("offline", offlineHandler);
    window.addEventListener("pageshow", restored);
    document.addEventListener("visibilitychange", visible);
    motion.addEventListener("change", setMotion);
    return () => { clearTimeout(startup); clearInterval(interval); activeFetch.current?.abort(); window.removeEventListener("online", online); window.removeEventListener("offline", offlineHandler); window.removeEventListener("pageshow", restored); document.removeEventListener("visibilitychange", visible); motion.removeEventListener("change", setMotion); };
  }, [refresh, tick]);

  useEffect(() => { if (showNew) newHeading.current?.focus(); }, [showNew]);
  useEffect(() => { selectionRef.current = selection; }, [selection]);

  const visibleSnapshot = denied ? EMPTY_SNAPSHOT : snapshot;
  const workspaces = (denied || !visibleSnapshot.available ? [] : workspaceCatalog).filter((workspace) => workspace.mode === mode);
  const scopedTasks = visibleSnapshot.tasks.filter((task) => task.mode === mode && (!workspaceId || task.workspaceId === workspaceId));
  const visibleTasks = scopedTasks.filter((task) => (!personFilter || task.agentId === personFilter) && (!stateFilter || task.state === stateFilter) && (!search.trim() || `${task.goal} ${task.brief}`.toLowerCase().includes(search.trim().toLowerCase()))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const selectedTaskId = selection?.taskId ?? null;
  const selectedTask = scopedTasks.find((task) => task.id === selectedTaskId);
  const profile = OFFICE_PROFILES.find((agent) => agent.id === selectedAgent) ?? OFFICE_PROFILES[0];
  const assignedTasks = scopedTasks.filter((task) => task.agentId === profile.id && task.state !== "completed" && task.state !== "cancelled");
  const scopedTaskIds = new Set(visibleTasks.map((task) => task.id));
  const scopedApprovals = visibleSnapshot.approvals.filter((approval) => scopedTaskIds.has(approval.taskId));
  const pendingCount = visibleTasks.filter((task) => taskDecision(task, scopedApprovals, clock) === "pending").length;
  const scopedEvents = visibleSnapshot.events.filter((event) => (mode === "demo" ? event.simulated : !event.simulated) && (!workspaceId || event.workspaceId === workspaceId)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.sequence - a.sequence);
  const events = scopedEvents.filter((event) => (!personFilter || event.actorId === personFilter) && (!eventFilter || event.eventType === eventFilter) && (!dateFilter || new Date(event.occurredAt).toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }) === dateFilter));
  const eventTypes = [...new Set(scopedEvents.map((event) => event.eventType))].sort();
  const states = [...new Set(scopedTasks.map((task) => task.state))].sort();
  const stale = !!syncError || (!!lastConfirmedAt && clock - Date.parse(lastConfirmedAt) > SNAPSHOT_STALE_AFTER_MS);
  // Worker/role evidence must describe the same workspace scope as the view.
  const scopedActivity = activity && activity.scope.workspaceId === (workspaceId || null) ? activity : null;
  // A failed status read makes worker, role and run indicators unknown; it never affects saving.
  const evidenceStale = stale || offline || denied || !!activityError;
  // Leases and heartbeats were measured at the server; they age by local elapsed time, never by wall-clock comparison.
  const evidenceAgeMs = evidenceAge(observedAt, monoNow);
  const nextEvidenceChange = denied ? null : nextEvidenceChangeMs(activity, evidenceAgeMs);
  const worker: WorkerIndicator = workerIndicator({ availability, activity, evidenceAgeMs, health: visibleSnapshot.health, stale: evidenceStale });
  const provenance = new Map((activity?.provenance ?? []).map((entry) => [entry.artifactId, entry.producedByRun]));
  const freshness = dataFreshness({ lastConfirmedAt, now: clock, offline, syncError, denied, staleAfterMs: SNAPSHOT_STALE_AFTER_MS });
  const executionByTask = new Map((activity?.tasks ?? []).map((entry) => [entry.taskId, entry]));
  // Live work is evidence-backed like demo work once a provider is connected, switched on and limited.
  const liveBlocked = activity ? liveUnavailable(activity.execution) : undefined;
  const roleStatuses = OFFICE_PROFILES.map((agent) => deriveRoleStatus(agent.id, scopedActivity?.roles.find((role) => role.agentId === agent.id && role.mode === mode), { availability, stale: evidenceStale, mode, worker, evidenceAgeMs, liveUnavailable: liveBlocked }));
  const profileStatus = roleStatuses.find((entry) => entry.agentId === profile.id)!;
  const effectiveFormWorkspaceId = formWorkspaceId || (workspaces.some((workspace) => workspace.id === workspaceId) ? workspaceId : workspaces[0]?.id ?? "");
  const formScopeAvailable = workspaces.some((workspace) => workspace.id === effectiveFormWorkspaceId);
  const formWorkspaceName = workspaces.find((workspace) => workspace.id === effectiveFormWorkspaceId)?.name ?? "no registered workspace";
  const persistence = persistenceState({ availability, denied, offline, stale, mode, workspaceAvailable: formScopeAvailable, worker });
  const disabledReason = denied ? "The authenticated owner session is unavailable." : offline ? "Offline. Reconnect and refresh before changing records." : stale ? "Status unavailable. Refresh the last confirmed state before making changes." : availability !== "available" ? persistence.title : null;
  const sceneProfiles = OFFICE_PROFILES.map((agent) => ({ id: agent.id, name: agent.name, role: agent.role, state: roleStatuses.find((entry) => entry.agentId === agent.id)?.label ?? "Status unavailable" }));
  const linkedOutsideWindow = !!linked?.taskId && selectedTaskId === linked.taskId && loaded && visibleSnapshot.available && !visibleSnapshot.tasks.some((task) => task.id === linked.taskId);
  const draftHasText = !!(goal.trim() || brief.trim());
  const unsavedWork = draftHasText || !!submissionAttempt || retainedDrafts > 0;
  const onSceneFailure = useCallback((reason: string) => setSceneFailure(reason), []);
  const openProfile = (id: string) => { setSelectedAgent(id); setProfileOpen(true); };
  // A package's whole live cost: its own requests plus every specialist task it delegated.
  const familyMetering = (task: OfficeTask) => {
    if (task.mode !== "live" || task.parentTaskId) return null;
    const members = [task.id, ...visibleSnapshot.tasks.filter((entry) => entry.parentTaskId === task.id).map((entry) => entry.id)];
    return members.reduce((sum, id) => { const own = executionByTask.get(id)?.metering; return own ? { requests: sum.requests + own.requests, chargedMicrounits: sum.chargedMicrounits + own.chargedMicrounits, openReservationMicrounits: sum.openReservationMicrounits + own.openReservationMicrounits } : sum; }, { requests: 0, chargedMicrounits: 0, openReservationMicrounits: 0 });
  };
  const executionLine = (task: OfficeTask) => taskExecutionLine(task, { execution: executionByTask.get(task.id), children: visibleSnapshot.tasks.filter((entry) => entry.parentTaskId === task.id), worker, stale: evidenceStale, evidenceAgeMs, liveUnavailable: liveBlocked, pendingReviewerId: visibleSnapshot.reviews.find((review) => review.artifactId === task.currentArtifactId && review.state === "pending")?.reviewerId ?? null, decision: taskDecision(task, visibleSnapshot.approvals, clock) });

  // The next lease expiry or heartbeat threshold re-renders the page even when no poll succeeds.
  useEffect(() => {
    if (nextEvidenceChange === null) return;
    const timer = setTimeout(tick, Math.ceil(nextEvidenceChange) + 25);
    return () => clearTimeout(timer);
  }, [nextEvidenceChange, tick]);

  // Reloading restores the exact mode, workspace, task, revision and view. Identifiers only.
  const urlWorkspace = selection?.workspaceId || workspaceId || null;
  const urlTask = selection?.workspaceId ? selection.taskId : null;
  const urlArtifact = urlTask ? selection?.artifactId ?? null : null;
  useEffect(() => {
    const href = officeHref({ mode, workspaceId: urlWorkspace, taskId: urlTask, artifactId: urlArtifact, view: view === "scene" ? null : view });
    writtenHref.current = href;
    if (`${window.location.pathname}${window.location.search}` !== href) window.history.replaceState(null, "", href);
  }, [mode, urlWorkspace, urlTask, urlArtifact, view]);

  // Unsaved text is never persisted, so leaving warns instead of storing it.
  useEffect(() => {
    if (!unsavedWork) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsavedWork]);

  function countRetained() {
    let count = 0;
    for (const draft of briefDrafts.current.values()) if (draft.goal.trim() || draft.brief.trim() || draft.attempt) count++;
    return count;
  }

  async function sendMutation(request: OfficeMutation): Promise<SendResult> {
    requestLock.current = true;
    setBusy(true); setMutationError(null); setNotice(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      return { ok: true, body: await readResponse(await fetch("/api/office", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: controller.signal })) };
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, failure: Object.assign(new Error("The request timed out before its result could be confirmed."), { aborted: true }) };
      return { ok: false, failure: error instanceof Error ? error as RequestError : new Error("The request failed before a response was confirmed.") };
    } finally { clearTimeout(timeout); requestLock.current = false; setBusy(false); }
  }

  const mutate: MutateOffice = async (request, message) => {
    if (requestLock.current || disabledReason) return false;
    const result = await sendMutation(request);
    if (result.ok) {
      const resolved = typeof message === "function" ? message(result.body) : message;
      const confirmed: OfficeNotice = typeof resolved === "string" ? { tone: "success", text: resolved } : resolved;
      setNotice(confirmed);
      await refresh();
      return confirmed.applied !== false;
    }
    const failure = result.failure;
    setMutationError(failure.status === 409 ? "This record changed or the approval no longer matches the current revision. Refresh and compare the saved versions. Your unsaved input is retained." : failure.aborted ? "The action timed out before its result could be confirmed. Your unsaved input is retained." : failure.message || "The action could not be confirmed. Your input is retained; refresh before retrying.");
    if (!failure.status) setSyncError("The action's result is unconfirmed. Refresh to reconcile the saved record before making another change.");
    if (sessionFailure(failure)) setDenied(true);
    if (failure.status === 409) await refresh();
    return false;
  };

  function openTask(id: string, artifactId?: string) {
    const trigger = document.activeElement;
    if (trigger instanceof HTMLElement && !trigger.closest("#office-task-detail")) taskReturnFocus.current = trigger;
    const task = visibleSnapshot.tasks.find((entry) => entry.id === id);
    // Opening a task without a revision shows its current one; no earlier selection carries over.
    setSelection({ taskId: id, workspaceId: task?.workspaceId ?? workspaceId, artifactId: artifactId ?? null, artifactNotFound: false });
    setFocusTaskId(id);
    requestAnimationFrame(() => document.getElementById("office-task-detail")?.focus());
  }

  /** null returns to following the current revision. */
  function selectArtifact(artifactId: string | null) {
    setSelection((current) => (current ? { ...current, artifactId, artifactNotFound: false } : current));
  }

  function closeTask() {
    setSelection(null);
    requestAnimationFrame(() => { const target = taskReturnFocus.current; if (target?.isConnected) target.focus(); else newBriefButton.current?.focus(); });
  }

  function retainBriefDraft() {
    if (!showNew) return;
    idempotencyKey.current ??= crypto.randomUUID();
    briefDrafts.current.set(`${mode}:${effectiveFormWorkspaceId}`, { goal, brief, idempotencyKey: idempotencyKey.current, attempt: submissionAttempt });
    setRetainedDrafts(countRetained());
  }

  function loadBriefDraft(targetWorkspaceId: string, targetMode: OfficeMode) {
    const saved = briefDrafts.current.get(`${targetMode}:${targetWorkspaceId}`);
    setFormWorkspaceId(targetWorkspaceId); setGoal(saved?.goal ?? ""); setBrief(saved?.brief ?? ""); setSubmissionAttempt(saved?.attempt ?? null); setSubmitProblem(null); setDraftNotice(null); idempotencyKey.current = saved?.idempotencyKey ?? crypto.randomUUID();
  }

  function prepareBrief() {
    if (document.activeElement instanceof HTMLElement) briefReturnFocus.current = document.activeElement;
    const target = workspaceId || workspaces[0]?.id || "";
    if (!showNew || target !== effectiveFormWorkspaceId) { retainBriefDraft(); loadBriefDraft(target, mode); }
    setShowNew(true); setMutationError(null);
  }

  function closeBrief() { retainBriefDraft(); setShowNew(false); requestAnimationFrame(() => { const target = briefReturnFocus.current; if (target?.isConnected) target.focus(); else newBriefButton.current?.focus(); }); }

  function changeMode(nextMode: OfficeMode) {
    retainBriefDraft(); setShowNew(false); setFormWorkspaceId(""); setMode(nextMode); setWorkspaceId(""); setSelection(null); setPersonFilter(""); setStateFilter(""); setEventFilter("");
  }

  function changeWorkspace(nextWorkspaceId: string) {
    retainBriefDraft(); setShowNew(false); setFormWorkspaceId(""); setWorkspaceId(nextWorkspaceId); setSelection(null);
  }

  // A later same-route navigation (for example a dashboard link) applies its rechecked link
  // without remounting, so unsaved drafts survive. Echoes of our own URL updates are ignored;
  // the comparison includes the revision, so moving between revisions of one task still applies.
  const applyLink = useEffectEvent((link: OfficeLinkState | undefined) => {
    const next = link?.status === "ok" ? link : null;
    const nextSelection = linkSelection(link);
    retainBriefDraft(); setShowNew(false); setFormWorkspaceId("");
    setLinkNotice(linkNoticeText(link));
    // The navigation's rechecked family is merged so a linked revision outside the bounded window shows at once.
    const family = initialActivity?.family;
    if (family && nextSelection && family.tasks.some((task) => task.id === nextSelection.taskId)) setSnapshot((current) => mergeFamily(current, family));
    setMode(next?.mode ?? (link?.status === "not_found" ? link.mode : "demo"));
    setWorkspaceId(next?.workspaceId ?? "");
    setSelection(nextSelection);
    setFocusTaskId(next?.taskId ?? null);
    setView(next?.view ?? (next?.taskId ? "tasks" : "scene"));
    // Fresh evidence for the new selection; a workspace change refreshes through the polling effect.
    if ((next?.workspaceId ?? "") === workspaceId) { selectionRef.current = nextSelection; void refresh(); }
  });
  useEffect(() => {
    if (appliedLink.current === initialLink) return;
    appliedLink.current = initialLink;
    if (linkHref(initialLink) === writtenHref.current) return;
    const timer = setTimeout(() => applyLink(initialLink), 0);
    return () => clearTimeout(timer);
  }, [initialLink]);

  function draftExport() {
    return `# ${goal.trim() || "Untitled Office brief"}\n\nUnsaved Office brief draft · ${formWorkspaceName} (${mode === "demo" ? "demonstration" : "internal"}). Not saved in Office.\n\n${brief}\n`;
  }

  async function copyDraft() {
    try { await navigator.clipboard.writeText(draftExport()); setDraftNotice("Draft text copied to the clipboard. It is still not saved in Office."); }
    catch { setDraftNotice("The clipboard is unavailable here. Use Download instead."); }
  }

  function downloadDraft() {
    downloadText(`office-brief-draft-${goal.trim().slice(0, 40) || "untitled"}`, draftExport());
    setDraftNotice("Draft downloaded as a Markdown file. Store it according to your confidentiality rules; it is still not saved in Office.");
  }

  async function submitBrief(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || requestLock.current || !persistence.canSave || !formScopeAvailable || !effectiveFormWorkspaceId || goal.trim().length < 5 || brief.trim().length < 10) return;
    idempotencyKey.current ??= crypto.randomUUID();
    const attempt = submissionAttempt ?? { input: { workspaceId: effectiveFormWorkspaceId, mode, goal: goal.trim(), brief: brief.trim(), idempotencyKey: idempotencyKey.current }, uncertain: false };
    const draftKey = `${attempt.input.mode}:${attempt.input.workspaceId}`;
    setSubmissionAttempt(attempt); setSubmitProblem(null); setDraftNotice(null); setSubmitting(true);
    const result = await sendMutation({ operation: "submit", input: attempt.input }).finally(() => setSubmitting(false));
    if (result.ok) {
      const saved = savedTask(result.body);
      briefDrafts.current.delete(draftKey); setRetainedDrafts(countRetained());
      setGoal(""); setBrief(""); setSubmissionAttempt(null); idempotencyKey.current = null; setShowNew(false);
      if (!saved) { setNotice({ tone: "warning", text: "The server confirmed the save, but its task identifier could not be read. Refresh and inspect the task list; do not resubmit the same brief." }); await refresh(); return; }
      const execution = savedBriefExecution(attempt.input.mode, worker, evidenceStale ? undefined : liveBlocked);
      setNotice({ tone: execution.tone, text: saved.duplicate ? `Your earlier attempt was already saved as task ${saved.taskId}. No duplicate task was created. ${execution.text}` : `Saved as task ${saved.taskId} in ${workspaces.find((workspace) => workspace.id === attempt.input.workspaceId)?.name ?? "its workspace"}. It survives reload and browser closure. ${execution.text}` });
      setSelection({ taskId: saved.taskId, workspaceId: attempt.input.workspaceId, artifactId: null, artifactNotFound: false }); setFocusTaskId(saved.taskId); setView("tasks");
      if (attempt.input.workspaceId === workspaceId) await refresh(); else setWorkspaceId(attempt.input.workspaceId);
      return;
    }
    const failure = result.failure;
    const lock = nextSubmitLock(attempt.uncertain, classifySubmitFailure(failure));
    if (sessionFailure(failure)) setDenied(true);
    if (lock.keepLocked) {
      setSubmissionAttempt({ ...attempt, uncertain: true });
      setSubmitProblem({ kind: "uncertain", message: attempt.uncertain ? `The retry was not confirmed (${failure.message || "no response"}). The first attempt's outcome is still unknown, so the brief stays locked.` : `The save result is unknown (${failure.message || "no response"}). It may already exist.` });
      if (!failure.status) setSyncError("The brief's save result is unconfirmed. Refresh to reconcile before retrying.");
    } else {
      setSubmissionAttempt(null); idempotencyKey.current = crypto.randomUUID();
      setSubmitProblem({ kind: "rejected", message: `Not saved: ${failure.message || "the server refused the request"}. Nothing was stored; your text is unchanged and editable.` });
    }
  }

  const draftLabel = submitting ? "Saving · waiting for the server's confirmation" : submissionAttempt?.uncertain ? "Save result unknown · locked for a safe retry" : draftHasText ? "Unsaved draft · kept only in this tab's memory" : "Empty draft";
  const activeFilters = [personFilter, view === "activity" ? eventFilter : stateFilter, view === "activity" ? dateFilter : search.trim()].filter(Boolean).length;
  const scopeName = workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? "All workspaces";
  const connectionLabel = worker.state === "online" ? "Office online" : worker.state === "offline" ? "Office offline" : worker.state === "not_activated" ? "Office not connected" : "Status unavailable";

  return <div className={styles.office}>
    <header className={styles.header}>
      <div><h1 className={styles.title}>Office</h1><p className={styles.intro}>Welcome to the office!</p></div>
      <div className={styles.headerActions}>
        <div className={styles.officeHealth} aria-label="Connection and freshness">
          <span className={styles.healthChip} data-state={worker.state}><i className={styles.healthDot} aria-hidden="true" />{connectionLabel}</span>
          <span className={styles.freshnessChip} data-state={freshness.state}>{refreshing ? "Updating…" : freshness.state === "fresh" ? "Up to date" : freshness.state === "never" ? "Checking records…" : freshness.state === "denied" ? "Sign-in needed" : freshness.state === "offline" ? "You're offline" : "Needs refresh"}</span>
          <span className={styles.modeBadge}>{mode === "demo" ? "Simulation" : "Internal records"}</span>
          <OfficeInfo label="Office information">
            <strong>{mode === "demo" ? "Simulation workspace" : "Internal workspace"}</strong>
            <p>{mode === "demo" ? "Practice briefs, drafts and reviews use a deterministic simulation. They stay separate from internal records. No live AI or external action runs here." : (liveBlocked === null ? "Live drafts and reviews run through OpenAI; spending limits are checked before every request. " : `Saved internal records are available. Live AI is not running: ${liveBlocked?.detail ?? "status is loading."} `) + "Accepting a package does not send, build, pay or deploy anything."}</p>
            <dl className={styles.infoFacts}><div><dt>Worker</dt><dd>{worker.label} · {worker.detail}</dd></div><div><dt>Last update</dt><dd>{freshness.label}</dd></div><div><dt>Team</dt><dd>Seven AI roles share one worker. Profiles are separate from human accounts.</dd></div><div><dt>Usage / cost</dt><dd>{activity ? liveUsageLine(activity.execution).replace("Usage / cost: ", "") : "Unavailable — status is loading."}</dd></div></dl>
          </OfficeInfo>
        </div>
        <OfficeButton className={styles.refreshButton} onClick={() => void refresh()} disabled={refreshing || busy} aria-label="Refresh office records" title="Refresh office records"><RefreshCw className={styles.icon} aria-hidden="true" /></OfficeButton><OfficeButton ref={newBriefButton} primary onClick={prepareBrief} disabled={busy} aria-label="New internal brief"><FilePlus2 className={styles.icon} aria-hidden="true" />New brief</OfficeButton>
      </div>
    </header>

    {offline ? <OfficeNoticeBanner key="offline" tone="warning" label="Dismiss offline notification"><p><WifiOff className={styles.icon} aria-hidden="true" /> Offline. Reconnect and refresh before making changes.</p></OfficeNoticeBanner> : null}
    {linkNotice ? <div className={styles.notice} role="status"><Link2Off className={styles.icon} aria-hidden="true" /><p>{linkNotice}</p><button type="button" className={styles.close} onClick={() => setLinkNotice(null)} aria-label="Dismiss link notice"><X className={styles.icon} /></button></div> : null}
    {linkedOutsideWindow ? <OfficeNoticeBanner key={linked?.taskId} label="Dismiss linked task notification"><p>The linked task could not be loaded. Refresh to try again; no other task was selected.</p></OfficeNoticeBanner> : null}
    {syncError ? <OfficeNoticeBanner key={`sync-${syncError}`} tone="error" label="Dismiss connection notification"><p><AlertCircle className={styles.icon} aria-hidden="true" /> {syncError} {lastConfirmedAt ? <>Last update: <Time value={lastConfirmedAt} />.</> : null}</p></OfficeNoticeBanner> : null}
    {mutationError ? <OfficeNoticeBanner key={`mutation-${mutationError}`} tone="error" label="Dismiss action notification"><p>{mutationError}</p></OfficeNoticeBanner> : null}
    {notice ? <OfficeNoticeBanner key={notice.text} tone={notice.tone} label="Dismiss action confirmation"><p><CheckCheck className={styles.icon} aria-hidden="true" /> {notice.text}</p></OfficeNoticeBanner> : null}
    {availability !== "available" && loaded && !denied ? <details className={styles.notice} open><summary><strong>{availability === "disabled" ? "Configuration required" : "Office storage unavailable"}</strong> · profiles, list controls, and the 3D graybox can be inspected.</summary><div><p className={styles.hint}>{availability === "disabled" ? "Saving tasks needs the reviewed office migration and a durable worker. Live drafting also requires a separately approved provider and limits." : "Office is enabled, but its records could not be read. Nothing can be saved until storage is available."}</p><ul className={styles.checklist}>{visibleSnapshot.configurationRequired.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div></details> : null}
    {visibleSnapshot.available && mode === "live" && liveBlocked !== null && visibleSnapshot.configurationRequired.length ? <details className={styles.notice}><summary><strong>Live execution is not connected</strong> · configuration required</summary><div><p className={styles.hint}>{visibleSnapshot.health.disclosure}</p><ul className={styles.checklist}>{visibleSnapshot.configurationRequired.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div></details> : null}
    {visibleSnapshot.available && activityError ? <OfficeNoticeBanner key={activityError} tone="warning" label="Dismiss status notification"><p>{activityError}</p></OfficeNoticeBanner> : null}

    <div className={styles.toolbar}>
      <nav aria-label="Office views" className={styles.tabs}>
        <button type="button" className={styles.tab} aria-pressed={view === "scene"} onClick={() => setView("scene")}><LayoutGrid className={styles.icon} aria-hidden="true" />Office</button>
        <button type="button" className={styles.tab} aria-pressed={view === "tasks"} onClick={() => setView("tasks")} title={`Tasks loaded in this view (at most ${visibleSnapshot.limits.taskLimit} most recent)`}><ClipboardList className={styles.icon} aria-hidden="true" />Tasks<span className={styles.tabCount}>{scopedTasks.length}</span></button>
        <button type="button" className={styles.tab} aria-pressed={view === "inbox"} onClick={() => setView("inbox")}><Inbox className={styles.icon} aria-hidden="true" />Inbox{pendingCount ? <span className={styles.tabCount}>{pendingCount}</span> : null}</button>
        <button type="button" className={styles.tab} aria-pressed={view === "activity"} onClick={() => setView("activity")}><History className={styles.icon} aria-hidden="true" />Activity</button>
        <button type="button" className={styles.tab} aria-pressed={view === "status"} onClick={() => setView("status")}><Activity className={styles.icon} aria-hidden="true" />Status</button>
      </nav>
      <div className={styles.toolbarContext}><span className={styles.scopeName} title={scopeName}>{scopeName}</span><label className={styles.modeControl}><span className={styles.srOnly}>Records</span><select className={styles.select} value={mode} disabled={busy} onChange={(event) => changeMode(event.target.value as OfficeMode)}><option value="demo">Simulated work</option><option value="live">Internal records</option></select></label><OfficeButton className={activeFilters ? styles.activeFilter : undefined} aria-expanded={filtersOpen} aria-controls="office-filters" onClick={() => setFiltersOpen((current) => !current)}><SlidersHorizontal className={styles.icon} aria-hidden="true" />Filters{activeFilters ? <span className={styles.tabCount}>{activeFilters}</span> : null}</OfficeButton></div>
    </div>

    {filtersOpen ? <div className={styles.filters} id="office-filters">
      <label className={styles.field}>Client / project workspace<select className={styles.select} value={workspaceId} disabled={busy} onChange={(event) => changeWorkspace(event.target.value)}><option value="">All authorized {mode === "demo" ? "demo" : "internal"} workspaces</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.scope}</option>)}</select></label>
      <label className={styles.field}>Person<select className={styles.select} value={personFilter} onChange={(event) => { setPersonFilter(event.target.value); if (event.target.value) setSelectedAgent(event.target.value); }}><option value="">All seven profiles</option>{OFFICE_PROFILES.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} · {agent.role}</option>)}</select></label>
      <label className={styles.field}>{view === "activity" ? "Event type" : "Task status"}<select className={styles.select} value={view === "activity" ? eventFilter : stateFilter} onChange={(event) => view === "activity" ? setEventFilter(event.target.value) : setStateFilter(event.target.value)}><option value="">All {view === "activity" ? "event types" : "states"}</option>{(view === "activity" ? eventTypes : states).map((state) => <option key={state} value={state}>{stateLabel(state)}</option>)}</select></label>
      {view === "activity" ? <label className={styles.field}>Date · Asia/Jakarta<input className={styles.input} type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label> : <label className={styles.field}>Search tasks<input className={styles.input} type="search" placeholder="Title or brief…" value={search} maxLength={160} onChange={(event) => setSearch(event.target.value)} /></label>}
      <div className={styles.filterActions}>{activeFilters ? <button className={styles.eventTask} type="button" onClick={() => { setPersonFilter(""); setStateFilter(""); setEventFilter(""); setDateFilter(""); setSearch(""); }}>Clear filters</button> : null}<button className={styles.eventTask} type="button" onClick={() => setFiltersOpen(false)}>Done</button></div>
    </div> : null}

    {showNew ? <section className={`${styles.panel} ${styles.formPanel}`} aria-labelledby="office-new-brief-title"><div className={styles.formHeader}><div><p className={styles.eyebrow}>{mode === "demo" ? "Simulated intake" : "Internal intake"}</p><h2 id="office-new-brief-title" ref={newHeading} tabIndex={-1}>Prepare a website proposal brief</h2></div><button type="button" className={styles.close} onClick={closeBrief} disabled={busy} aria-label="Close new brief form"><X className={styles.icon} /></button></div>
      <div className={styles.persistence} data-tone={persistence.tone} role="status" aria-live="polite"><strong>{persistence.title}</strong><p>{persistence.detail}</p></div>
      <p className={styles.hint}>Leo captures the brief, Adrian coordinates scope, and the specialists prepare drafts with independent review. This pilot ends at an internal proposal package.</p>
      {submissionAttempt?.uncertain && !busy ? <div className={`${styles.notice} ${styles.noticeWarning}`} role="alert"><div><p><strong>Reconcile the earlier submission before anything else</strong></p><p>{submitProblem?.message} The text, workspace and submission key are locked so a retry cannot create a duplicate: retrying sends the identical submission, and if the first attempt was saved the server returns that task instead of creating another. Do not reload or leave this page until it is reconciled: the key exists only in this tab, so a fresh submission after a reload could create a second task.</p><OfficeButton onClick={() => { setView("tasks"); void refresh(); }} style={{ marginTop: 8 }}>Refresh and inspect saved tasks</OfficeButton></div></div> : null}
      {submitProblem?.kind === "rejected" && !busy ? <OfficeNoticeBanner key={submitProblem.message} tone="error" label="Dismiss save notification"><p>{submitProblem.message}</p></OfficeNoticeBanner> : null}
      <form onSubmit={(event) => void submitBrief(event)} className={styles.formGrid}>
        <label className={styles.field}>Workspace<select className={styles.select} required value={effectiveFormWorkspaceId} disabled={busy} onChange={(event) => { retainBriefDraft(); loadBriefDraft(event.target.value, mode); }}>{effectiveFormWorkspaceId && !formScopeAvailable ? <option value={effectiveFormWorkspaceId}>Previously selected workspace unavailable</option> : null}{workspaces.length ? workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>) : <option value="">{availability === "available" ? `No ${mode === "demo" ? "demonstration" : "internal"} workspace configured` : "Unavailable while Office storage is not active"}</option>}</select><small>Draft text stays within its selected workspace. Switching scope keeps a separate draft for each workspace on this page.</small></label>
        <label className={styles.field}>Goal<input className={styles.input} required minLength={5} maxLength={240} value={goal} disabled={busy || !!submissionAttempt} placeholder="What should this website achieve?" onChange={(event) => setGoal(event.target.value)} /></label>
        <label className={`${styles.field} ${styles.full}`}>Brief and permitted source references<textarea className={styles.textarea} required minLength={10} maxLength={12000} value={brief} disabled={busy || !!submissionAttempt} placeholder="Business goal, audience, pages or features, references, known constraints, timing preference, budget if supplied, and missing facts. Unknown details remain unknown." onChange={(event) => setBrief(event.target.value)} /><small>Use only sources permitted in this workspace. Missing prices, dates, and integrations are flagged instead of invented. Do not enter passwords or secrets.</small></label>
        <div className={`${styles.full} ${styles.draftStatus}`} data-state={submissionAttempt?.uncertain ? "uncertain" : draftHasText ? "unsaved" : "empty"}>
          <strong>{draftLabel}</strong><span>{goal.length + brief.length} characters</span>
          <p>Kept while you close this form or switch workspace or records mode on this page. Lost on reload, closing the tab, leaving Office, or re-authenticating. Nothing is written to browser storage, the URL or logs.</p>
          <OfficeButton onClick={() => void copyDraft()} disabled={!draftHasText}><Copy className={styles.icon} aria-hidden="true" />Copy draft text</OfficeButton>
          <OfficeButton onClick={downloadDraft} disabled={!draftHasText}><Download className={styles.icon} aria-hidden="true" />Download draft (.md)</OfficeButton>
          {draftNotice ? <OfficeNoticeBanner key={draftNotice} label="Dismiss draft notification"><p>{draftNotice}</p></OfficeNoticeBanner> : null}
        </div>
        <div className={`${styles.full} ${styles.buttonRow}`}><OfficeButton type="submit" primary disabled={busy || !persistence.canSave || !formScopeAvailable}>{submitting ? "Saving…" : submissionAttempt?.uncertain ? "Retry the same brief safely" : mode === "demo" ? "Save simulated brief" : "Save internal brief"}</OfficeButton><OfficeButton onClick={closeBrief} disabled={busy}>Keep draft text and close</OfficeButton><span className={styles.hint}>Saving to: {formWorkspaceName} · {mode === "demo" ? "demonstration (simulated)" : "internal records"}</span></div>
      </form>
    </section> : null}

    <div className={styles.workspace}>
      <div className={styles.main} aria-busy={refreshing && !loaded}>
        {!loaded ? <div className={styles.empty} role="status">Loading the last confirmed office snapshot…</div> : null}
        {view === "scene" ? <>
          <div className={styles.scene}>
            {sceneFailure ? <div className={styles.sceneLoading}><div><p>3D graphics unavailable.</p><p className={styles.hint}>{sceneFailure}</p><OfficeButton onClick={() => setView("tasks")}>Use the accessible task list</OfficeButton><OfficeButton onClick={() => { setSceneQuality("low"); setSceneFailure(null); }}>Retry in low quality</OfficeButton></div></div> : <OfficeScene profiles={sceneProfiles} selectedId={selectedAgent} onSelect={setSelectedAgent} reducedMotion={reducedMotion} quality={sceneQuality} onFallback={onSceneFailure} />}
          </div>
          <div className={styles.roster} aria-label="Select an AI profile">{OFFICE_PROFILES.map((agent) => <button type="button" key={agent.id} className={styles.person} aria-pressed={selectedAgent === agent.id} onClick={() => setSelectedAgent(agent.id)}><Portrait id={agent.id} small /><span>{agent.name}</span><small>{roleStatuses.find((entry) => entry.agentId === agent.id)?.label ?? "Status unavailable"}</small></button>)}</div>
          <div className={styles.section}><div className={styles.taskHead}><h2 className={styles.sectionTitle}>Current work in this workspace</h2><button type="button" className={styles.eventTask} onClick={() => setView("tasks")}>View all tasks <ArrowUpRight className={styles.icon} style={{ display: "inline" }} aria-hidden="true" /></button></div><TaskList tasks={visibleTasks.slice(0, 3)} snapshot={visibleSnapshot} selectedId={selectedTaskId} onTask={openTask} onNew={prepareBrief} filtered={!!(personFilter || stateFilter || search)} execution={executionLine} /></div>
        </> : view === "tasks" ? <TaskList tasks={visibleTasks} snapshot={visibleSnapshot} selectedId={selectedTaskId} onTask={openTask} onNew={prepareBrief} filtered={!!(personFilter || stateFilter || search)} execution={executionLine} />
          : view === "inbox" ? <OfficeInbox approvals={scopedApprovals} snapshot={visibleSnapshot} mutate={mutate} disabledReason={disabledReason} busy={busy} onTask={openTask} now={clock} selectedTaskId={selectedTaskId} />
          : view === "status" ? <OfficeRoleStatus statuses={roleStatuses} activity={scopedActivity} evidenceAgeMs={evidenceAgeMs} worker={worker} freshness={freshness} mode={mode} workspaceName={workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? null} selectedAgent={selectedAgent} onProfile={openProfile} onTask={openTask} />
          : <OfficeActivityFeed events={events} tasks={visibleSnapshot.tasks} onTask={openTask} loadedLimit={visibleSnapshot.limits.eventLimit} />}
        {selectedTask ? <OfficeTaskDetail key={selectedTask.id} task={selectedTask} familyMetering={evidenceStale ? undefined : familyMetering(selectedTask)} snapshot={visibleSnapshot} disabledReason={disabledReason} busy={busy} mutate={mutate} onClose={closeTask} onTask={openTask} now={clock} execution={evidenceStale ? undefined : executionByTask.get(selectedTask.id)} evidenceAgeMs={evidenceAgeMs} executionLine={executionLine(selectedTask)} worker={worker} provenance={provenance} artifactId={selection?.artifactId ?? null} artifactNotFound={!!selection?.artifactNotFound} onSelectArtifact={selectArtifact} onRevisionSaved={createRevisionSavedHandler(selection, setSelection)} focusOnMount={focusTaskId === selectedTask.id} /> : null}
      </div>

      <OfficeProfilePanel profile={profile} status={profileStatus} roleEvidence={scopedActivity?.roles.find((role) => role.agentId === profile.id && role.mode === mode)} evidenceGeneratedAt={scopedActivity?.generatedAt} observedAt={observedAt} assignedTasks={assignedTasks} events={scopedEvents.filter((event) => event.actorId === profile.id).slice(0, 3)} mode={mode} worker={worker} open={profileOpen} onOpen={() => setProfileOpen(true)} onClose={() => setProfileOpen(false)} onTask={openTask} onStatus={() => setView("status")} onNew={prepareBrief} />
    </div>

    <footer className={styles.footer}><span><ShieldCheck size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} aria-hidden="true" />Private application · owner access and existing business records remain separate.</span><span>Display limit: {visibleSnapshot.limits.taskLimit} tasks / {visibleSnapshot.limits.eventLimit} recent events{scopedActivity ? ` · exact tasks in scope: ${scopedActivity.taskWindow.total}` : ""}</span></footer>
    <span className={styles.srOnly} role="status">{busy ? "Saving office action." : refreshing ? "Refreshing office snapshot." : `Office view ready. ${worker.label}. Page data ${freshness.label.toLowerCase()}.`}</span>
  </div>;
}

export default OfficeView;
