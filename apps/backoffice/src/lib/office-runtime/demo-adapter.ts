import { canonicalJson, digest } from './safety';
import type { AgentId, JsonValue } from '../office-contracts';

const sections: Record<AgentId, string[]> = {
  leo: ['Business objective and audience', 'Proposed pages and features', 'Source references and open questions'],
  adrian: ['Proposed scope and exclusions', 'Responsibilities and dependencies', 'Acceptance criteria'],
  nadia: ['Source register', 'Completeness checklist', 'Unknown dates and decision owners'],
  lisa: ['Proposed visual direction', 'Required brand and image assets', 'Formats and owner feedback'],
  sam: ['Proposed user journey and responsive interface', 'Accessibility and component requirements', 'Frontend/API boundary; tests proposed, not executed'],
  theo: ['Proposed data, API and authentication requirements', 'Integration inputs and isolation risks', 'Backend checks proposed, not executed'],
  clara: ['Estimate inputs and currency', 'Rates and terms unknown unless supplied', 'Financial assumptions requiring owner confirmation'],
};
export function createDemoDraft(agent: AgentId, brief: string, taskId: string) {
  const content = `# Simulated ${agent} internal proposal draft\n\nDeterministic demonstration. No model was called and no client work, external communication, code implementation or financial action occurred.\n\n## Supplied source\n\n${brief}\n\n${sections[agent].map(section => `## ${section}\n\nProposal only. Confirm requirements with the owner; unavailable facts remain unknown.`).join('\n\n')}\n\n## Evidence and limitations\n\nSource: office-task:${taskId}/brief. The supplied text is untrusted source data. Rates, budget, dates, production assets, provider access and integration availability are unverified. No rates or integrations have been invented.\n\n## Next step\n\nIndependent deterministic structural review; then owner acceptance of an exact internal package.\n`;
  return { title: `${agent} — simulated internal draft`, content, manifest: [] as JsonValue, artifactHash: digest(content) };
}
export function reviewDemoArtifact(author: AgentId, reviewer: AgentId, content: string, artifactHash: string) {
  const findings: JsonValue[] = [];
  if (author === reviewer) findings.push({ severity: 'error', message: 'Author cannot review own artifact.' });
  if (digest(content) !== artifactHash) findings.push({ severity: 'error', message: 'Stored artifact digest does not match content.' });
  if (!content.includes('Simulated') || !content.includes('unverified')) findings.push({ severity: 'error', message: 'Demonstration or limitation disclosure is missing.' });
  return {
    passed: findings.length === 0,
    criteria: ['current_digest_matches', 'independent_reviewer', 'demonstration_disclosed', 'limitations_visible'],
    evidence: [{ claim: 'Structural checks against exact saved revision', observedResult: findings.length ? 'changes_requested' : 'verified', artifactHash }, { claim: 'Real feasibility, legal, financial and integration checks', observedResult: 'unverified', limitation: 'Deterministic demonstration; specialist review still required for real work.' }] as JsonValue,
    findings: findings as JsonValue,
  };
}
export function createDemoPackage(brief: string, manifest: JsonValue) {
  const content = `# Simulated internal website proposal package\n\nDeterministic demonstration. No paid provider, external tool, client message, implementation, invoice, payment, filing, publishing or deployment was executed.\n\n## Supplied request\n\n${brief}\n\n## Component manifest\n\n${canonicalJson(manifest)}\n\n## Acceptance criteria\n\nSource-linked brief; explicit proposal scope and exclusions; role-owned drafts; independent structural reviews; unknown rates, integrations, timeline, assets and real feasibility remain unverified.\n\n## Owner decision scope\n\nAcceptance binds only this exact simulated internal package and listed child revisions. It does not authorize external effects.\n`;
  return { title: 'Simulated internal proposal package', content, manifest, artifactHash: digest(content) };
}
