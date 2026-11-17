import 'server-only';

import { OFFICE_AGENTS, type AgentId, type OfficeSnapshot } from '@/lib/office-contracts';
import { createOfficeRuntime } from '@/lib/office-runtime';
import { getDb } from '@/lib/server/db';

export function officeEnabled() {
  return process.env.OFFICE_ENABLED === 'true';
}

export function unavailableOfficeSnapshot(reason = 'Office activation is disabled. Review the additive migration and worker setup before enabling it.'): OfficeSnapshot {
  return {
    available: false,
    agents: OFFICE_AGENTS.map(role => ({ id: role.agentId as AgentId, name: role.displayName, role: role.role, responsibility: role.responsibility, enabled: false, profileVersion: 1 })),
    workspaces: [], tasks: [], artifacts: [], reviews: [], approvals: [], events: [],
    latestSequence: 0,
    health: { workerOnline: false, lastHeartbeatAt: null, providerConfigured: false, commandExecutionEnabled: false, status: 'configuration_required', disclosure: reason },
    configurationRequired: [reason, 'An approved Office-specific provider and explicit spend caps are required for live execution.', 'Final modeled and rigged assets remain pending.'],
    limits: { taskLimit: 100, eventLimit: 100 },
  };
}

export function getOfficeRuntime() {
  return createOfficeRuntime(getDb());
}
