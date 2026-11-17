import { UserRound } from "lucide-react";

import { Portrait } from "./OfficePortrait";
import { OFFICE_PROFILES } from "./profiles";
import { getRoleIdentity, roleIdentityStyle } from "./role-identity";
import styles from "./office-agent-badge.module.css";

export function OfficeAgentBadge({ agentId, compact = false, showRole = true, className = "" }: {
  agentId: string | null | undefined;
  compact?: boolean;
  showRole?: boolean;
  className?: string;
}) {
  const profile = OFFICE_PROFILES.find((entry) => entry.id === agentId);
  const identity = getRoleIdentity(agentId);
  return <span className={`${styles.badge} ${compact ? styles.compact : ""} ${className}`} style={roleIdentityStyle(agentId)} data-agent-id={profile?.id} data-role-id={profile?.id ?? "unassigned"} data-role-tone={identity.tone} title={profile ? `${profile.name} · ${profile.role}` : "Unassigned"}>
    <span className={styles.portrait}>{profile ? <Portrait id={profile.id} small /> : <span className={styles.fallback}><UserRound size={16} aria-hidden="true" /></span>}</span>
    <span className={styles.identity}>
      <span className={styles.name}>{profile?.name ?? "Unassigned"}</span>
      {showRole ? <span className={styles.role}>{identity.category}</span> : null}
    </span>
  </span>;
}
