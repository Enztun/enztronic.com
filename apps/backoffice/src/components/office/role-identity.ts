import type { CSSProperties } from "react";

import type { OfficeProfileId } from "./profiles";

export type RoleIdentity = {
  tone: string;
  category: string;
  color: string;
  softColor: string;
  borderColor: string;
};

function identity(tone: string, category: string, color: string): RoleIdentity {
  return {
    tone,
    category,
    color,
    softColor: `color-mix(in srgb, ${color} 11%, var(--panel))`,
    borderColor: `color-mix(in srgb, ${color} 40%, var(--line))`,
  };
}

// The label carries the meaning; color is a consistent, secondary recognition cue.
const ROLE_IDENTITIES: Record<OfficeProfileId, RoleIdentity> = {
  adrian: identity("rose", "Project management", "#cf6687"),
  clara: identity("gold", "Finance", "#b68b18"),
  nadia: identity("amber", "Administration", "#cf8234"),
  leo: identity("green", "Sales", "#3d9c62"),
  lisa: identity("blue", "Design", "#4f8ddd"),
  sam: identity("teal", "Frontend", "#299c9a"),
  theo: identity("violet", "Backend", "#9274d5"),
};
const UNASSIGNED = identity("neutral", "Unassigned", "#8794a6");

export function getRoleIdentity(agentId: string | null | undefined): RoleIdentity {
  return agentId && Object.hasOwn(ROLE_IDENTITIES, agentId) ? ROLE_IDENTITIES[agentId as OfficeProfileId] : UNASSIGNED;
}

export function roleIdentityStyle(agentId: string | null | undefined): CSSProperties {
  const role = getRoleIdentity(agentId);
  return {
    "--agent-color": role.color,
    "--agent-soft": role.softColor,
    "--agent-border": role.borderColor,
    "--agent-ink": `color-mix(in srgb, ${role.color} 52%, var(--ink))`,
  } as CSSProperties;
}
