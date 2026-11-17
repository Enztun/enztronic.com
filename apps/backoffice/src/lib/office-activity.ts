import type { AgentId, OfficeApproval, OfficeArtifact, OfficeEvent, OfficeMode, OfficeReview, OfficeTask, RunState } from '@/lib/office-contracts';
import type { OfficeLinkTarget } from '@/lib/office-links';

// Read-only Office evidence shared by the server read model, the Office page and
// the dashboard. Every value is derived from persisted rows and database time;
// nothing here is synthesized from animation, prose or a page refresh.

/** Same rule as the runtime health check: a non-stopping heartbeat younger than this. */
export const WORKER_ONLINE_THRESHOLD_SECONDS = 60;
/** Page data older than this is shown as status unavailable, independent of the worker. */
export const SNAPSHOT_STALE_AFTER_MS = 45_000;
/** The runtime snapshot shows at most this many most recent tasks per request. */
export const OFFICE_TASK_WINDOW = 200;
/** Steps a worker leases and executes. Delegation/resume runs are web-request bookkeeping. */
export const WORKER_STEPS = ['draft', 'review', 'package', 'package_review'] as const;
export const COORDINATION_STEPS = ['delegate_internal_demo', 'delegate_internal_live', 'resume_internal_dependencies'] as const;

export type OfficeAvailability = 'disabled' | 'storage_unavailable' | 'available';

export type OfficeWorkerStatus = {
  workersSeen: number;
  online: boolean;
  /** Latest non-stopping heartbeat, as used for `online`. */
  lastHeartbeatAt: string | null;
  heartbeatAgeSeconds: number | null;
  /** The most recent heartbeat row of any kind, so a recorded graceful stop is visible. */
  latest: { heartbeatAt: string; startedAt: string; stopping: boolean; ageSeconds: number } | null;
  onlineThresholdSeconds: number;
};

/** What a worker with a fresh heartbeat advertised for live work. Display only; never a secret. */
export type OfficeLiveProvider = { provider: string; draftModel: string | null; packageModel: string | null; reasoningEffort: string | null };
/**
 * The owner's live switch and limits, in microunits (USD x 1,000,000). Used amounts are settled
 * charges plus open reservations, which count at their full maximum until settled.
 */
export type OfficeLiveBudget = {
  enabled: boolean; currency: 'USD';
  monthUsedMicrounits: number; monthLimitMicrounits: number;
  lifetimeUsedMicrounits: number; lifetimeLimitMicrounits: number;
  familyLimitMicrounits: number; requestLimitMicrounits: number;
};
export type OfficeExecutionCapability = {
  adapter: 'deterministic_demo' | 'openai_responses';
  /** A worker holding a live provider has a fresh heartbeat. */
  providerConfigured: boolean;
  /** An unresolved billed model outcome holds all live work until owner reconciliation. */
  unresolvedModelOutcome?: boolean;
  commandExecutionEnabled: false;
  provider?: OfficeLiveProvider | null;
  budget?: OfficeLiveBudget | null;
};
/** Metered model requests on one task: settled charges and still-open reservations. */
export type OfficeTaskMetering = { requests: number; chargedMicrounits: number; openReservationMicrounits: number };

export type OfficeRunRef = { id: string; taskId: string; agentId: AgentId; step: string; state: RunState; attempt: number; startedAt: string; finishedAt: string | null; errorCode: string | null; predecessorRunId: string | null };
/**
 * The run behind a leased dispatch, as read at `generatedAt`. A live lease is the only execution
 * evidence; an expired lease is stalled. Both lease fields are historical once read:
 * `leaseRemainingMs` is lease_until minus database now() (zero or less when expired), and a
 * client ages it by its own elapsed time instead of trusting `leaseLive` until the next poll.
 */
export type OfficeActiveRun = OfficeRunRef & { leaseUntil: string | null; leaseLive: boolean; leaseRemainingMs: number | null };

/** Pending dispatch rows split by whether the worker's admission filter would accept them now. */
export type OfficeStepCounts = { pending: number; runnable: number; waitingOnDependencies: number; retryScheduled: number; nextRetryAt: string | null; leased: number; done: number; exhausted: number; cancelled: number };

export type OfficeTaskExecution = {
  taskId: string;
  activeRun: OfficeActiveRun | null;
  /** Every leased run on this task when read, newest first; `activeRun` is the first live one. */
  leasedRuns: OfficeActiveRun[];
  /** Latest worker-step run only. */
  latestRun: OfficeRunRef | null;
  runs: { total: number; succeeded: number; failed: number; interrupted: number; cancelled: number };
  steps: OfficeStepCounts;
  /** Delegation or resume recorded by the owner's web request; no worker executed it. */
  coordination: { runId: string; step: string; recordedAt: string } | null;
  /** Live model requests only; absent when this task never reserved provider spend. */
  metering?: OfficeTaskMetering | null;
};

export type OfficeRoleCounts = {
  open: number; queued: number; inProgress: number; awaitingReview: number; changesRequested: number; reviewPassed: number;
  waitingForOwner: number; blocked: number; failed: number; stopping: number; paused: number; completed: number; cancelled: number;
  /** Packages awaiting the owner with a live decision request for their current revision. */
  decisionsPending: number;
  /** Packages awaiting the owner whose decision request expired; an explicit renewal is needed. */
  decisionsRenewal: number;
  /** Pending author steps (draft/package) the worker's admission filter would accept now. */
  runnableSteps: number;
  /** Pending independent reviews assigned to this role that the worker could claim now. */
  runnableReviews: number;
  waitingOnDependencies: number;
  retryScheduled: number;
  /** Retries exhausted on open tasks; an owner recovery decision is required. */
  exhaustedSteps: number;
  executingRuns: number;
  /** Runs whose lease expired before recovery; durable recovery will retry them. */
  stalledRuns: number;
  /** Live leases whose run was asked to pause or cancel. */
  stoppingRuns: number;
};

export type OfficeRoleActivity = {
  agentId: AgentId;
  mode: OfficeMode;
  enabled: boolean;
  counts: OfficeRoleCounts;
  activeRun: OfficeActiveRun | null;
  /** Every leased run attributed to this role when read, newest first; the lease counts derive from these. */
  leasedRuns: OfficeActiveRun[];
  latestRun: OfficeRunRef | null;
  /** Latest event this role produced inside a run. Owner revisions recorded under the role are excluded. */
  lastEvent: { eventType: string; occurredAt: string; taskId: string | null; runId: string } | null;
  /** Latest run-produced revision authored by this role. */
  latestArtifact: { id: string; taskId: string; title: string; revision: number; artifactHash: string; createdAt: string; current: boolean; review: { reviewerId: AgentId; state: string; decidedAt: string | null } | null } | null;
  /** A newer owner-prepared revision recorded under this role, which the role did not produce. */
  latestOwnerRevision: { id: string; taskId: string; revision: number; createdAt: string } | null;
  latestReviewGiven: { id: string; taskId: string; artifactId: string; authorAgentId: AgentId; state: string; decidedAt: string | null } | null;
  /** A live review lease held by another role on one of this role's tasks; its remaining time ages like any lease. */
  reviewInProgress: { reviewerId: AgentId; runId: string; taskId: string; leaseRemainingMs: number | null } | null;
  blocked: { taskId: string; reason: string | null; since: string } | null;
  nextRetryAt: string | null;
  /** The task behind the active run, else the most recently updated open task. */
  focusTaskId: string | null;
};

/** A task's whole package family in the runtime snapshot shapes, for exact links beyond the snapshot window. */
export type OfficeFamily = { rootTaskId: string; tasks: OfficeTask[]; artifacts: OfficeArtifact[]; reviews: OfficeReview[]; approvals: OfficeApproval[]; events: OfficeEvent[] };

export type OfficeActivity = {
  generatedAt: string;
  scope: { workspaceId: string | null };
  worker: OfficeWorkerStatus;
  execution: OfficeExecutionCapability;
  roles: OfficeRoleActivity[];
  tasks: OfficeTaskExecution[];
  /** Whether each loaded revision came from a run (false: owner-prepared under a role). */
  provenance: { artifactId: string; producedByRun: boolean }[];
  /** `covered` tasks carry execution detail; `total` is the exact task count in scope. */
  taskWindow: { limit: number; covered: number; total: number };
  family: OfficeFamily | null;
};

export type OfficeStateCounts = {
  total: number; parents: number; queued: number; inProgress: number; startedNotExecuting: number; executing: number; awaitingReview: number; changesRequested: number;
  reviewPassed: number; waitingForOwner: number; blocked: number; failed: number; stopping: number; paused: number; completed: number; cancelled: number;
};
export type OfficeModeSummary = {
  mode: OfficeMode;
  workspaces: number;
  tasks: OfficeStateCounts;
  steps: { runnable: number; waitingOnDependencies: number; retryScheduled: number; leasedLive: number; stalled: number; exhausted: number };
  decisions: { pending: number; renewal: number; approved: number; rejected: number };
};
export type OfficeDashboardDecision = { approvalId: string; link: OfficeLinkTarget; goal: string; workspaceName: string; revision: number; createdAt: string; expiresAt: string; renewalNeeded: boolean };
export type OfficeDashboardOutput = { reviewId: string; artifactId: string; link: OfficeLinkTarget; title: string; revision: number; authorAgentId: AgentId; ownerPrepared: boolean; reviewerId: AgentId; decidedAt: string | null; status: 'review_passed' | 'owner_accepted' | 'superseded' };
export type OfficeDashboardEvent = { eventId: string; eventType: string; occurredAt: string; actorType: 'owner' | 'agent' | 'worker'; agentId: AgentId | null; ownerRecordedUnderRole: boolean; coordination: boolean; mode: OfficeMode; link: OfficeLinkTarget | null; goal: string | null };
export type OfficeDashboardRole = { agentId: AgentId; demo: OfficeRoleCounts; live: OfficeRoleCounts; lastActivityAt: string | null };

export type OfficeDashboardData =
  | { state: 'disabled' }
  | { state: 'unavailable'; reason: 'schema_missing' | 'storage_error' }
  | {
    state: 'available';
    generatedAt: string;
    worker: OfficeWorkerStatus;
    execution: OfficeExecutionCapability;
    modes: { demo: OfficeModeSummary; live: OfficeModeSummary };
    roles: OfficeDashboardRole[];
    decisions: { pending: number; renewal: number; latest: OfficeDashboardDecision[] };
    outputs: OfficeDashboardOutput[];
    events: OfficeDashboardEvent[];
    windows: { decisions: number; outputs: number; events: number };
  };
