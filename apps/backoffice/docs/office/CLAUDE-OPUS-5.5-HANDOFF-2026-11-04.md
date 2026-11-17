# Claude Opus 5.5 — Enztronic Office workflow and dashboard handoff

Prepared 4 November 2026, Asia/Jakarta. Workspace: `D:\Enztronic`.

## Assignment

Implement the Office workflow and dashboard workstream in the existing application. The owner wants a brief to become a saved, inspectable task, with clear evidence of what each of the seven roles did and visible job/output markers in the main dashboard. They currently can draft a simulated brief but cannot save it.

Complete the authorized local implementation and isolated verification. Do not stop at an architectural proposal. Leave production activation and all paid/live execution pending the separate activation process. This handoff is not permission to activate production Office.

Your model designation is Claude Opus 5.5; it does not select the models that will eventually power the Office agents.

## Division of work

| Owner | Workstream |
| --- | --- |
| Claude | Brief-saving UX, truthful worker/role/task status, admin dashboard Office integration, exact task deep links, focused tests, isolated deterministic workflow acceptance, implementation report. |
| Codex | 3D characters/environment/assets, `OfficeScene` and `scene-*`, GPU/rendering quality, independent review of Claude's changes, production activation/release coordination. |
| Owner | Authenticated real-browser acceptance and separate production/provider/financial authorizations. |

Claude may edit the non-scene Office UI, add a server-side Office dashboard read model and panel, integrate that panel into the existing dashboard, add focused tests, and write the report. Preserve existing contracts and runtime semantics; use existing APIs where possible. Propose a narrow interface change if integration needs a reserved file rather than editing across ownership silently.

Reserved: `OfficeScene.tsx`, `scene-*`, the asset registry/manifest and modeling pipeline, production configuration, database migrations, worker permissions/supervisor/startup scripts, live provider implementation, and the public website. Changes to core runtime/contracts beyond a narrow demonstrated defect require coordination with Codex; do not rewrite the engine.

## Read first

Paths below are relative to `apps/backoffice/`, except where stated:

1. `AGENTS.md`. Read the relevant installed Next.js documentation under `node_modules/next/dist/docs/` before changing Next.js behavior; do not assume an older version's APIs.
2. `docs/BACKOFFICE-RECOVERY-2026-11-04.md` — latest operational recovery and owner acceptance.
3. `docs/office/ACTIVATION-AND-ROLLBACK.md` — production boundary and later activation requirements.
4. `docs/office/IMPLEMENTATION-REPORT.md`, `WORKER-DATABASE-BOUNDARY.md`, and `WORKER-LIFECYCLE.md`. Historical test results are not new verification results.
5. `office-spec/ACCEPTANCE.md`, `office-spec/specs/product-and-presets.md`, and `office-spec/data/{agent-profiles,response-presets}.json`.
6. `src/components/office/OfficeView.tsx`, `OfficeTaskDetail.tsx`, and the existing Office presentation helpers.
7. `src/lib/server/{office,session,auth,office-http}.ts`, `src/app/api/office/route.ts`, `src/lib/office-contracts/`, and `src/lib/office-runtime/`.
8. `src/app/(protected)/dashboard/page.tsx`, `src/components/navigation-items.ts`, `scripts/test-office-local.ps1`, and `vitest.config.mts`.
9. `D:\Enztronic\apps\office-worker\README.md` and its current implementation, for understanding only.

Capture `git status --short` and inspect relevant diffs before editing. Much of the Office implementation is uncommitted or untracked. A clean worktree created from HEAD will omit it. Preserve and deliberately carry the current working-tree snapshot into any isolated checkout. Do not reset, clean, stash, broadly revert, replace dependencies, or overwrite somebody else's edits.

## Verified starting state — recheck narrowly before relying on it

- The existing backoffice at `https://admin.enztronic.com` was recovered on 4 November. The owner confirmed both Dashboard and Settings → Access load.
- Web service: loopback `127.0.0.1:3100`. Existing Windows task: `Enztronic Backoffice`, using `scripts/start-backoffice.ps1 -Background`.
- Intended production database: `enztronic_backoffice` at `127.0.0.1:54329`, application role `enztronic_app`, data under `.runtime/postgres-data`. These identifiers do not authorize using it for tests or mutations.
- Production `OFFICE_ENABLED=false`; development authentication bypass is disabled. Migrations001/002 are applied and checksum-verified;003 is not applied.
- Existing Cloudflare Access and the owner's active administrator/allowlist relationship were preserved. All13 production business-table digests matched before/after recovery.
- No Office worker was running at the latest review. There are seven logical role profiles, not seven independently running daemons. A shared durable worker executes role-specific queue steps, default concurrency1.
- The current adapter is deterministic simulation only. `providerConfigured` and `commandExecutionEnabled` are false; live work is blocked with `configuration_required`.
- `/team` exists, but disabled Office returns `available:false`, empty workspaces/tasks, disabled profiles, and configuration-required health.
- The dashboard queries clients, invoices and earnings. It has navigation to Office, but no operational Office summaries.
- The runtime model registry is empty. The seven scene markers are geometric placeholders, not completed people. Graphics work is Codex's separate stream.

## Why saving currently fails

`OfficeView.tsx` computes a disabled reason when Office persistence is unavailable; it also has no valid workspace in that state. The Save control is disabled and the submit handler returns. The API independently rejects Office mutations with503 while Office is disabled. Removing the button guard would not repair persistence.

Draft retention currently uses a React ref Map. It survives some UI transitions while the page stays mounted; it is not database persistence or reload-safe storage. Do not tell the owner an unsaved brief is safely saved.

## Deliverable A — honest and usable brief workflow

- Explain persistence availability and the precise missing prerequisite before the owner writes a long brief. Keep inspectable demo/profile views useful while Office is disabled.
- Distinguish an unsaved draft, a confirmed saved task, a queued task, and executing work. Clearly show what survives a reload.
- Preserve typed text after denied, stale, offline, timeout, conflict and uncertain-result errors. A failed request must never display saved/success without confirmation.
- Preserve existing immutable submission payloads and idempotency keys during retries. Reconcile an uncertain outcome before submitting another task; no duplicates.
- Keep mode/workspace separation. No accidental submission to another workspace after a filter or mode change.
- Do not silently put confidential briefs into localStorage, IndexedDB, URLs, analytics or logs. Prefer explicit copy/download and honest page-memory retention for this milestone. Any durable browser draft feature needs explicit opt-in plus clear/delete/retention behavior.
- Saving and execution are separate capabilities: when persistence is available but the worker is offline, a saved queued task must not be falsely described as executing. Preserve deliberate queue behavior rather than equating missing heartbeat with failed storage.
- Do not enable production Office or bypass authentication to make the form appear to work.

## Deliverable B — evidence of worker and individual role activity

Show these independently:

- Worker availability and heartbeat age. Current online threshold is a non-stopping heartbeat less than60seconds old.
- Snapshot freshness/network state. Current UI staleness threshold is45seconds; do not confuse it with worker heartbeat.
- Per-role workload and actual task/run state: unassigned/idle, queued, executing, reviewing, blocked, waiting for owner, completed/cancelled as supported by the canonical contracts.
- Last confirmed activity, active task, run identifier, latest output/revision, review result, and applicable blocked reason.
- Provider connection and execution mode. An idle role is not a failed process; a live role without an adapter is not connected.

The seven roles are Adrian, Clara, Nadia, Leo, Lisa, Sam, and Theo. A visible portrait/marker, animation, generated prose or recent page refresh is not execution evidence. Derive indicators from persisted state and timestamps; never synthesize work or completion.

Provide non-scene UI data/controls that Codex can later bind to 3D badges. Leave animation and meshes to Codex. Keep all essential actions keyboard-accessible without selecting a mesh.

## Deliverable C — main dashboard Office integration

Add a focused admin-only Office panel without replacing or changing the existing clients, invoices, payments, earnings or commission behavior.

Suggested content: Office configuration state; worker heartbeat/freshness; queued/executing/blocked/review/owner-decision counts; per-role workload; recent confirmed activity; latest reviewed outputs and pending owner decisions. Clearly separate simulated and live work. Unconfigured usage/cost is unavailable, not an invented zero.

Required safeguards and behavior:

- Enforce active-admin authorization server-side before fetching Office data. Sales must not receive Office data in HTML, RSC payloads, JSON or hidden UI.
- Check `officeEnabled()` before constructing the runtime, calling `getDb()` for Office, or querying Office tables. The dashboard must continue to render with Office disabled and migration003 absent. Do not catch every database error and disguise it as a zero count.
- Use scoped aggregate queries for exact totals. Existing snapshot task/event arrays are bounded; do not present their lengths as complete totals. Otherwise explicitly label a recent-window count.
- Do not expose full briefs, artifact bodies, private file paths or secrets on generic dashboard cards.
- Each task/output/decision link must open the exact authorized mode, workspace and task in Office. Current `OfficeView` has no complete URL deep-link handling; implement and test the needed selection rather than linking every card to a generic `/team`.
- Validate deep-link parameters and recheck server-side scope. Invalid, denied, deleted and stale links need useful states without leaking another workspace.
- Do not assume Office `scope_key`/`project_key` strings are validated business foreign keys. Link clients/projects only through verified existing registrations/mapping; do not invent joins or rewrite business ownership.

## Deliverable D — isolated acceptance evidence

Use meaningful tests for the changed behavior, including:

1. Disabled Office plus no003 schema: dashboard works, setup state is truthful, no Office query is issued, saving cannot bypass the server guard.
2. Denied/sales/expired access: no Office data or mutation access; existing owner/admin behavior remains intact.
3. Draft failures and uncertain save: text retained, correct idempotency behavior, no false success or duplicate parent task.
4. Scoped dashboard counts, simulated/live separation, exact deep links and invalid/cross-workspace link denial.
5. In a NEW disposable demo environment only: owner saves one synthetic brief; reload preserves its task ID and source text; worker heartbeat is fresh; all seven specialist child tasks have persisted runs, artifact revisions/hashes and independent reviews; the parent becomes a reviewed package awaiting the owner decision; exact acceptance evidence completes the expected family. Distinguish authored, reviewed and owner-approved states.
6. Browser closure retains server work. An isolated worker restart demonstrates durable recovery/fencing without claiming exactly-once model execution. Retain logs and state evidence.
7. Existing synthetic business/access invariants remain unchanged by the Office tests.

This establishes deterministic simulation, not live AI work. Do not claim real client work, model success or production activation from these tests.

### Test/build isolation

- Never use production `DATABASE_URL`, ports3100/54329, production `.runtime/postgres-data`, owner identities, financial records, or the existing3118 preview configuration.
- Never load `.env.development.local` into a production build or copy real secrets into a test snapshot. Use explicit synthetic test environment values and mocked authentication; any browser fixture must be new, loopback-only, and backed by its own disposable data.
- Inspect `scripts/test-office-local.ps1` before running it. It creates a NEW timestamped cluster on55439, explicitly named test databases, and refuses an occupied port. Use it only when55439 is free. Do not adopt, reset, kill or reuse an existing fixture to unblock a test. Some role tests deliberately require55439; report a real collision rather than weakening target guards.
- Do not run setup-local or production seeding/migrations. Test fixtures/migration application are permitted only within the newly created, explicitly disposable test environment. Never fall back to production configuration.
- Build a separate snapshot of the CURRENT working tree with its own `.next`, excluding production/fixture `.env*`, runtime/data, generated output and credentials. Do not share or overwrite `.next`, `.next-office-check` or `.next-office-dev` in the active app. A dependency junction may share installed packages without modifying them; do not recursively clean through junctions.
- Use `npm run build -- --webpack`. Latest isolated Webpack builds passed; Turbopack encountered a local CSS-transform subprocess failure. Do not change dependencies or the public website to work around that.
- Run relevant lint, TypeScript and targeted tests, then the isolated build. Capture exact commands/results and skipped coverage. Review newly edited React components against the repository's existing patterns.
- Inspect live ports/processes first. Start only your own temporary test processes, hidden on Windows; stop only those processes afterward. Retain test logs/data for review. Do not perform broad process kills or recursive cleanup.

## Production and confidentiality boundaries

Keep production Office disabled and development authentication bypass disabled. Do not change `.env*`, Cloudflare Access/tunnel/DNS, human accounts/permissions, migrations001/002/003, database grants, services, scheduled tasks or production build/startup files. No restart, build promotion, deployment, push, GitHub Actions, paid CI, provider call, message, invoice, payment, filing or financial action is authorized by this assignment.

Preserve `employee/`, unrelated work, the public website, the restored backoffice release, rollback files, human access, clients, invoice numbering/snapshots, payments, commissions, outbox and audit history. Do not request, print, copy or retain passwords, recovery links, JWTs, SSO cookies or provider keys. Signed-in production browser acceptance belongs to the owner.

Live provider adapters, model selection, hard spending/time/token/revision limits and executor isolation remain separate future work. Merely setting a provider flag or enabling the UI must never suggest these capabilities exist.

## Return to Codex

Write `apps/backoffice/docs/office/CLAUDE-WORKFLOW-REPORT-2026-11-04.md` containing:

- Concrete changes and exact changed files; identify pre-existing changes you preserved.
- Before/after behavior, screenshots from the isolated browser where useful, and evidence paths for saved tasks/runs/revisions/reviews/owner decisions.
- Exact test/build commands, observed results, environment isolation and coverage gaps. Mark any real-browser or database verification that was unavailable.
- Integration contract for the new dashboard/status/deep-link UI, including any narrow follow-up needed in reserved scene code.
- Separate status for local implementation, deterministic verification, real provider work, final3D assets, and production activation.
- Remaining blockers and the exact later activation steps required, without executing them.

Leave a reviewable working-tree diff. Do not commit or push. Finish all independent local work before returning a dependency on production activation; do not present production's intentionally disabled flag as a reason to skip isolated implementation/testing.
