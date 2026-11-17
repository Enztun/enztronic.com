import { z } from 'zod';
import presets from './response-presets.json';

// The reviewed handoff is the single canonical state/role configuration.
export const OFFICE_PRESETS = presets;
export const OFFICE_AGENTS = presets.roles;
export type AgentId = 'adrian' | 'clara' | 'nadia' | 'leo' | 'lisa' | 'sam' | 'theo';
export type TaskState = keyof typeof presets.taskStateMachine.allowedTransitions;
export type RunState = keyof typeof presets.runStateMachine.allowedTransitions;
export type OfficeMode = 'demo' | 'live';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type OfficeWorkspace = { id: string; name: string; clientId: string; projectId: string; mode: OfficeMode; scope: 'internal' | 'client' };
export type OfficeAgent = { id: AgentId; name: string; role: string; responsibility: string; enabled: boolean; profileVersion: number };
export type OfficeTask = { id: string; workspaceId: string; clientId: string; projectId: string; parentTaskId: string | null; agentId: AgentId; goal: string; brief: string; priority: number; state: TaskState; mode: OfficeMode; version: number; createdAt: string; updatedAt: string; blockedReason: string | null; currentArtifactId: string | null; acceptanceEvidenceId: string | null };
export type OfficeArtifact = { id: string; taskId: string; workspaceId: string; clientId: string; projectId: string; authorAgentId: AgentId; title: string; revision: number; revisionId: string; artifactHash: string; hashAlgorithm: 'SHA-256'; content: string; manifest: JsonValue; createdAt: string };
export type OfficeReview = { id: string; taskId: string; workspaceId: string; artifactId: string; revisionId: string; artifactHash: string; reviewerId: AgentId; state: string; criteria: string[]; evidence: JsonValue; findings: JsonValue; createdAt: string };
export type OfficeApproval = { id: string; taskId: string; workspaceId: string; artifactId: string; revisionId: string; artifactHash: string; actionScope: 'accept_internal_proposal_package'; state: string; version: number; expiresAt: string; reason: string | null; decidedAt: string | null; acceptanceEvidenceId: string | null };
export type OfficeEvent = { eventId: string; sequence: number; eventType: string; occurredAt: string; workspaceId: string; clientId: string; projectId: string; taskId: string | null; runId: string | null; actorType: string; actorId: string; mode: 'visual_prototype' | 'connected_internal_workflow'; simulated: boolean; source: string; payload: Record<string, JsonValue> };
/** `providerConfigured`: a worker holding a live provider has a fresh heartbeat. `liveEnabled`: the owner's live switch. */
export type OfficeHealth = { workerOnline: boolean; lastHeartbeatAt: string | null; providerConfigured: boolean; liveEnabled?: boolean; commandExecutionEnabled: false; status: 'worker_online' | 'worker_offline' | 'configuration_required'; disclosure: string };
export type OfficeSnapshot = { available: boolean; workspaces: OfficeWorkspace[]; agents: OfficeAgent[]; tasks: OfficeTask[]; artifacts: OfficeArtifact[]; reviews: OfficeReview[]; approvals: OfficeApproval[]; events: OfficeEvent[]; health: OfficeHealth; latestSequence: number; limits: { taskLimit: number; eventLimit: number }; configurationRequired: string[] };

export const submitTaskSchema = z.object({ workspaceId: z.uuid(), mode: z.enum(['demo', 'live']), goal: z.string().trim().min(5).max(240), brief: z.string().trim().min(10).max(12000), idempotencyKey: z.string().min(8).max(100) }).strict();
export const taskActionSchema = z.object({ workspaceId: z.uuid(), taskId: z.uuid(), version: z.number().int().positive(), action: z.enum(['pause', 'resume', 'cancel', 'retry', 'request_changes', 'redraft', 'reassign', 'reprioritize', 'renew_approval', 'note']), reason: z.string().trim().min(3).max(2000).optional(), agentId: z.enum(['adrian', 'clara', 'nadia', 'leo', 'lisa', 'sam', 'theo']).optional(), priority: z.number().int().min(-10).max(10).optional() }).strict();
export const approvalDecisionSchema = z.object({ workspaceId: z.uuid(), approvalId: z.uuid(), version: z.number().int().positive(), decision: z.enum(['approve', 'reject', 'request_changes']), reason: z.string().trim().min(3).max(2000).optional() }).strict().refine(value => value.decision === 'approve' || !!value.reason, { message: 'A reason is required for rejection or changes.' });
export const artifactRevisionSchema = z.object({ workspaceId: z.uuid(), taskId: z.uuid(), version: z.number().int().positive(), title: z.string().trim().min(3).max(200), content: z.string().min(1).max(100000), authorAgentId: z.enum(['adrian', 'clara', 'nadia', 'leo', 'lisa', 'sam', 'theo']) }).strict();
export type SubmitTaskInput = z.infer<typeof submitTaskSchema>;
export type TaskActionInput = z.infer<typeof taskActionSchema>;
export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>;

export function canTaskTransition(from: TaskState, to: TaskState): boolean {
  return (presets.taskStateMachine.allowedTransitions[from] as string[]).includes(to);
}
export function canRunTransition(from: RunState, to: RunState): boolean {
  return (presets.runStateMachine.allowedTransitions[from] as string[]).includes(to);
}
export function eventLabel(eventType: string): string {
  return presets.statusPresets.find(preset => preset.eventType === eventType)?.label ?? 'Office update';
}
