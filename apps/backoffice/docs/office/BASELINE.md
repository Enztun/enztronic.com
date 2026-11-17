# Implementation baseline

Local implementation started 21 October 2026 and continued 22 October 2026, Asia/Jakarta.

- Repository: `D:\Enztronic`, original revision `cf2f97610175800e90eef2f4748e7c4f3506dbd6`, implementation branch `codex/ai-office`.
- Initial Git status: only `?? employee/`. That owner directory and its archive remain untouched.
- No applicable AGENTS.md found in the repository or its parent locations.
- Starting the upgraded isolated development server subsequently generated the standard Next.js AGENTS.md; its local route-handler and distDir documentation was read before continuing.
- Existing private app: Next 16.2.10, React/React DOM 19.2.7, postgres.js, Zod, Vitest. The public root app is separate.
- The Office feature stays at protected `/team`. Human access management is retained at `/settings/access`; human identity, commission fields and business ownership are not converted to agent identities.
- Existing Cloudflare JWT/allowlist and active-user checks remain authoritative. Every Office API repeats admin authorization. Mutation requests require same origin and bounded validated JSON.
- Existing migrations 001/002 are unchanged. Migration 003 creates Office tables only. Invoice outbox and financial audit tables are not reused.
- Stable exact 3D dependencies were checked against registry peer requirements and [Fiber's React compatibility guidance](https://r3f.docs.pmnd.rs/getting-started/introduction): Fiber 9.8.2, Drei 10.7.9, Three 0.186.1, types 0.186.0.
- The private app's existing Next version had critical advisories in the current npm audit. Next and matching eslint configuration were updated to 16.4.2, and the existing PostCSS override to 8.5.31. npm 10's resolver failed on general dependency remediation; npm 11 completed nonbreaking audit fixes. The final production dependency audit reports zero vulnerabilities. Five high findings remain in the development-only eslint/fast-glob/micromatch/braces chain, whose offered forced fix downgrades eslint-config-next to Next14 and was not applied. No production service restart occurred.
- Development verification uses dedicated PostgreSQL 17 on loopback port 55439 and disposable databases ending `_test`. It does not use production DATABASE_URL. Browser verification uses separate port 3118 and `.next-office-dev`; build verification uses `.next-office-check`. Existing `.next` is preserved.
- No deployment, live migration, external message, invoice delivery, financial posting, Access-policy change, scheduled paid work or production/shared-service restart is authorized by this implementation.

This baseline establishes source boundaries, not current production user counts, listener health, backup quality, DNS state or login verification. Those remain activation checks.
