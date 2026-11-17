# Claude Office workflow and dashboard report

Prepared 4–5 November 2026, Asia/Jakarta, for Codex's independent review. Workspace `D:\Enztronic`, branch `codex/ai-office`, base `cf2f976`. Nothing was committed or pushed. Assignment: [CLAUDE-OPUS-5.5-HANDOFF-2026-11-04.md](CLAUDE-OPUS-5.5-HANDOFF-2026-11-04.md).

## Status

| Area | Status |
| --- | --- |
| Local implementation | Complete in the working tree (uncommitted). Reviewable diff: [CLAUDE-WORKFLOW-2026-11-04.diff](CLAUDE-WORKFLOW-2026-11-04.diff). |
| Deterministic verification | Passed on new disposable fixtures: Vitest 15 files / 135 tests / 0 skipped; `npm run lint` and `npm run typecheck`; isolated `npm run build -- --webpack`; isolated browser acceptance 37/37 checks. |
| Real provider work | Not implemented and not claimed. Live briefs are saved as `blocked / configuration_required` with zero runs. |
| Final 3D assets | Unchanged (Codex's workstream). `OfficeScene.tsx` and `scene-*` were not edited. |
| Production activation | Not performed. `OFFICE_ENABLED=false`, development bypass disabled. No production database access, restart, build promotion, migration, deployment or Access change. |

Independent agent review: two review passes were attempted; one design critic completed (its ten truthfulness findings are all fixed and covered by tests below), and the implementation reviewers stopped on a usage limit. I then reviewed the diff myself on four lenses (security, draft safety, Next.js/React, truthfulness). Codex's review is the first independent review of the final code.

## What changed

### A. Brief workflow (`OfficeView.tsx`, `office-status.ts`)
Before: with Office disabled the form had no workspace and a disabled Save button, and the reason appeared only beside the button, after writing. The save notice ignored the server's `{taskId, duplicate}` and selected nothing. Any failure carrying an HTTP status locked the brief for good, even a definitive rejection. A reload lost all context.

After:
- A persistence banner above the fields states the precise prerequisite before any typing: `OFFICE_ENABLED` is not `"true"` (migration 003, a dedicated worker and an authorized window are needed); storage unreadable; session unavailable; offline; unconfirmed records; or no registered workspace. Live mode states that the brief is saved as `blocked / configuration_required` and nothing runs. Demo mode separates saving from execution and names the worker state.
- The draft status line says the draft is kept only in this tab's memory and lists what keeps it (closing the form, switching workspace or records mode) and what loses it (reload, closing the tab, leaving Office, re-authenticating). Copy and Download (.md) are explicit actions. Nothing is written to localStorage, IndexedDB, URLs, logs or analytics. A `beforeunload` warning is active while unsaved text or an unconfirmed attempt exists.
- Outcomes. A 2xx is a confirmed save: the notice gives the task id and workspace, says the task survives reload and browser closure, and adds a truthful execution line. `duplicate: true` reads "already saved by your earlier attempt; no duplicate created". If a first attempt is definitively rejected (400/401/403/404/409/413/422, or 503 `configuration_required`), nothing was stored, so the text stays editable and the key rotates. Any other failure (network loss, timeout, 5xx, 503 `storage_unavailable`) locks the payload, workspace and key until a same-key retry returns 2xx. Once an attempt was uncertain, a later refusal keeps it locked, because the first attempt may exist.
- The saved task is selected and its workspace becomes the filter. The URL carries `mode`, `workspace`, `task` and `view`, so a reload reopens the exact task and its brief.

### B. Worker and role evidence (`office-read-model.ts`, `/api/office/status`, `OfficeRoleStatus.tsx`, `OfficeTaskDetail.tsx`)
- Meta bar: worker availability with heartbeat age (database-time age, re-aged locally; online under 60 s), page-data freshness (stale after 45 s), execution mode, and usage/cost Unavailable. If the status read fails, worker, role and run indicators become unavailable; saving is never blocked by telemetry.
- The new Status view has a card per role. Each shows the indicator, workload, last confirmed activity, active or latest worker run, latest run-produced output with hash and review result, latest review given and any blocked reason, plus buttons that open the exact task or revision. Owner revisions recorded under a role (`producer_run_id IS NULL`) and delegation/resume runs recorded inside the owner's web request are never credited to the role.
- Task list and detail show an execution line and an "Execution evidence" section built from leases, runs and dispatch rows. Execution means a live lease, nothing else. A freshly saved parent reads "Delegated · 0 of 7 specialist tasks reviewed · package step waits for every review". Each revision shows authored / independent review / owner acceptance as separate stages, including child revisions covered by the parent's package decision.
- The scene keeps its existing props; its label text now comes from the same role status.

### C. Dashboard (`dashboard/page.tsx`, `office-dashboard.ts`, `OfficeDashboardPanel.tsx`)
The dashboard gains a new last section for administrators only. Clients, invoices, earnings and commissions are untouched.
- Disabled: a plain statement, with no Office query.
- Enabled but the schema is missing or unreadable: "unavailable", with no zero counts.
- Available: configuration badges; separate simulated and live blocks with exact totals; a role workload table; pending decisions keyed to the package (a paused package is not decidable; an expired request shows "renewal needed"); the latest reviewed outputs, with authored, reviewed and owner-accepted kept apart and owner revisions labelled; and the latest eight events, labelled as a recent window.
- Every item links to its exact mode, workspace, task (and revision) in Office.
- Sales sessions never call the loader or render the section.

### D. Deep links (`office-links.ts`, `team/page.tsx`)
`/team?mode=&workspace=&task=[&artifact=][&view=]` carries identifiers only. Each identifier is validated, and repeated or incomplete parameters make the link invalid. The server then rechecks mode → workspace → task → artifact, and any mismatch looks the same as absence. A sales session gets "Administrator access required" with no Office lookup. A linked task older than the snapshot's 200-task window still opens: the read model returns its family in the runtime snapshot shapes. A linked revision that is not loaded is reported, never silently replaced by another.

### Defects found and fixed outside the new features (non-scene)
1. False success: `decideApproval` can return HTTP 200 with `state: expired|superseded`, and the inbox then said "The owner decision was recorded". It now reports success only for `approved`/`rejected`, keeps the typed reason, and points to renewal.
2. Stuck submission: any status-bearing failure locked the brief permanently. A definitive rejection of a first attempt now releases it safely.
3. Misattributed activity: delegation recorded in the owner's own request read "Adrian started the authorized task". Agent-typed events without a run (owner revisions) were shown as the role's work.
4. Test isolation: Vitest collected copied tests from `.runtime/releases/recovery-20261104T092745/app/` and ran them against the same disposable databases as the real suites, which collided (`duplicate key … pg_extension_name_index`). `vitest.config.mts` now excludes `**/.runtime/**`, which ESLint already ignored. Nothing inside `.runtime` was modified.

## Files

New: `src/lib/office-links.ts`, `src/lib/office-activity.ts`, `src/lib/server/office-read-model.ts`, `src/lib/server/office-dashboard.ts`, `src/app/api/office/status/route.ts`, `src/components/office/office-status.ts`, `src/components/office/OfficeRoleStatus.tsx`, `src/components/office/OfficeDashboardPanel.tsx`; tests `src/lib/office-links.test.ts`, `src/components/office/office-status.test.ts`, `src/components/office/OfficeDashboardPanel.test.tsx`, `src/lib/server/office-dashboard.test.ts`, `src/lib/server/office-read-model.integration.test.ts`; harness `scripts/office-acceptance/{lib.mjs,run.mjs,zombie-lease.ts,build-snapshot.mjs}`; this report, the diff and the evidence listed below.

Modified: `src/components/office/{OfficeView,OfficeTaskDetail,OfficeInbox}.tsx`, `office-ui.tsx`, `office.module.css` (additive classes only), `src/app/(protected)/team/page.tsx`, `src/app/(protected)/dashboard/page.tsx`, `vitest.config.mts` (one exclusion), `scripts/test-office-local.ps1` (adds the fourth explicitly named database `enztronic_office_dashboard_test` on the same guarded new cluster).

Preserved unchanged: the core runtime and contracts (`office-runtime/`, `office-contracts/`), `src/lib/server/{office,session,auth,office-http,db}.ts`, the existing Office API routes, migrations 001–003, `OfficeScene.tsx` and `scene-*`, the asset registry and modeling pipeline, `next.config.ts`, `.env*`, worker code/permissions/supervisor/startup scripts, `employee/`, the public website and every other pre-existing working-tree change. `git status` matches the starting snapshot plus only the files above.

How the diff was produced: most Office files were untracked, so `git diff` cannot show edits to them. Baselines came from the 4 November recovery source snapshot (`.runtime/releases/recovery-20261104T092745/app/`), read-only. Thirteen untouched files in it are byte-identical to the working tree, and every modified file matched the content captured at the start of this work. The dashboard baseline equals `git HEAD`.

## Verification

| Command (from `apps/backoffice`) | Result |
| --- | --- |
| `cmd /d /c "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-office-local.ps1 > tmp\claude-workflow-20261105\test-office-local-final.txt 2>&1"` | New cluster on 55439, four explicitly named `*_test` databases. **15 files, 135 tests passed, 0 skipped**, on the final tree. Retained: `tmp/office-verification-20261105-072623`. |
| `npm run lint` / `npm run typecheck` | Passed. |
| `node scripts/office-acceptance/build-snapshot.mjs` → `npm run build -- --webpack` | Passed in a separate snapshot (`D:\tmp\claude-office-build-20261105-002318\app`, own `.next`, no `.env*`, only `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`, `OFFICE_ENABLED=false`). Build ID `d5qJEeE4wpNLLG5zccsJm`; 229 snapshot files; compiled in 40 s, TypeScript passed, no warnings; route table includes `/api/office/status`. Log: `tmp/claude-workflow-20261105/build-20261105-002318.log`. |
| `node scripts/office-acceptance/run.mjs` | **37/37 checks passed.** Evidence: `tmp/claude-acceptance-20261105-002320/` (report, logs, worker JSONL, PostgreSQL data, screenshots); curated copy [claude-workflow-acceptance-2026-11-05.json](claude-workflow-acceptance-2026-11-05.json). |

Run `test-office-local.ps1` from a console, or with file-level redirection as above. If its output is captured through a pipe (for example PowerShell `*>`), `pg_ctl start` hands that pipe to the long-lived server and the runner waits forever. That happened once here; I stopped only my own runner and cluster.

New test coverage by handoff item:
1. Disabled Office and no migration 003. The real loader against a database with only 001/002 reports `schema_missing`, not zeros. A disabled Office pointed at an unreachable database returns `disabled` without connecting. Mocked suites show no `getDb`, read model or runtime call when disabled, and POST submit returns 503 without constructing the runtime.
2. Denied, sales and expired sessions. The status route returns 403/401 before any work; the dashboard renders no panel and the `/team` denial shows no lookup. In the browser, a sales session got no Office markers in the dashboard HTML or RSC payload, 403 from both Office APIs, and a denied deep link.
3. Draft failures. In the browser: an uncertain save where the server committed but the response was dropped locked the brief, the retry returned `duplicate`, and exactly one parent exists. Also: 409 rejection keeps text editable; 503 storage locks, then a same-key retry saves once; 401 and offline both keep the text. The state machine itself is unit-tested, including the refused-retry-after-uncertain lock.
4. Counts and links. Exact totals equal direct SQL, including beyond the 200-task snapshot window (224 tasks vs 200 loaded). Simulated and live are separated. Decisions are task-keyed (expiry, renewal, pause). The family read equals `snapshot()` record for record. Link resolution covers ok, wrong workspace, wrong mode, unknown task and a foreign artifact. Dashboard and status payloads contain no brief, artifact body or owner-note marker.
5–7. See the browser acceptance below.

## Isolated browser acceptance (deterministic simulation only)

Fixture: a new cluster on 55449 (`enztronic_office_acceptance_test`, trust auth, loopback). It held a synthetic owner, a synthetic sales user and a synthetic client, plus a fresh unprivileged worker login created from `office-role.example.sql`. The app ran as `next dev --webpack` on 3128 (owner) and 3129 (sales, separate `distDir`) from a working-tree snapshot under `D:\tmp` with a `node_modules` junction. Every child process got an explicit minimal environment: no inherited shell variables and no `.env*` files. Authentication was the existing development bypass, which production rejects. The browser was headless Chromium from the repository's Playwright. Ports 3100, 3118, 54329, 55439 and 5432 were never used, and production stayed up throughout.

Final run `claude-acceptance-20261105-002320`, 07:23–07:26 WIB on 5 November. Screenshots: `screenshots/claude-workflow-NN-*.png`.

**Phase 1: save with no worker, browser open**
- The dashboard showed "No worker connected" before any work [01]. The brief form showed the persistence banner before typing and labelled the draft as tab memory only [02].
- One synthetic brief was saved as parent `72300dd5-502a-4870-bf6d-8692fb3a9824`. Its id appeared in the notice and in the URL, the notice said nothing was executing, and the parent read "Delegated · 0 of 7…" and never "Executing" [03].
- A reload reopened the same task id and brief text from the URL [04].
- Uncertain save (live workspace): the server committed but the browser never received the response. The brief locked; the retry returned `duplicate`; the database holds exactly one parent [05, 06].
- 409: the text stayed editable and nothing was stored [07]. 503 storage: the brief locked, then a same-key retry saved exactly once. 401: the text was kept and nothing was stored [08]. Offline: the text was kept [09].
- The browser was then closed (00:24:14 UTC).

**Phase 2: browser closed; worker crash, stop, restarts and recovery**
- A helper using the limited worker login claimed Adrian's draft lease and exited without executing, as a worker dying mid-step would. The abandoned run was `9e8e5e3d-a286-4d3b-b393-94c16ca20e0c`.
- A continuous worker started but could not claim, because the abandoned live lease held the single capacity slot; zero steps ran. It was stopped gracefully through its supervisor pipe, and its stopping heartbeat was recorded.
- After the lease expired and the abandoned heartbeat aged past 60 s, the Status view showed "Worker stopped" and one Stalled lease, not a failure. All other roles read "Queued · not executing" [10].
- Two single-pass (`--once`) worker processes each started, committed one step and exited cleanly. The first also recovered the abandoned lease, whose run was marked `interrupted / lease_expired`.
- A continuous worker completed the family. Successor run `d7822f39-e0ab-4d5f-9fa8-5f2a9a9efc51` (attempt 2, `predecessor_run_id` = the abandoned run) redid the interrupted step.
- Replaying the abandoned lease's commit was refused with `LEASE_LOST`. This is at-least-once execution with fencing; exactly-once model execution is not claimed.

**Phase 3: reopen and decide**
- The dashboard showed the worker online, exact demo counts (7 review passed, 1 decision pending) and live 2 blocked with 0 runs [11].
- Its decision link opened `/team?mode=demo&workspace=00000000-0000-4000-8000-000000000001&task=72300dd5-…&view=inbox` on that exact inbox card and task [12].
- Status showed Adrian as "Owner decision needed" and the six specialists as "Review passed"; no role was idle or unknown [13].
- The package showed no active run, the delegation labelled as web-request bookkeeping, and separate authored, reviewed and owner-decision stages [14].
- Accepting it completed all 8 tasks with one acceptance record, `c654302d-ad5b-443f-bcf2-9c377da58d87`: a 7-child manifest and 8 review references [15].
- Invalid, cross-workspace [16], wrong-mode and unknown-task links each showed a notice and opened nothing.
- After acceptance the dashboard marked the outputs "Owner accepted" [17].

**Phase 4: sales session and invariants**
- The sales dashboard had no Office navigation and no panel, and neither its HTML nor its RSC payload contained an Office marker [18].
- `/api/office` and `/api/office/status` returned 403. The deep link showed "Administrator access required" with no data [19].
- All 12 non-Office business tables kept identical row counts and content digests from start to finish.

**Database record of the family** (`evidence.family` in the JSON):

| Record | What was persisted |
| --- | --- |
| Tasks | 8, all `completed`, sharing one `acceptance_evidence_id`. |
| Runs | 18: 1 delegation (bookkeeping), 8 draft (7 succeeded + 1 interrupted), 7 review, 1 package, 1 package review. |
| Artifacts | 8 (7 drafts and the package). Each was produced by a run, and its SHA-256 recomputed in SQL matches the stored digest. |
| Reviews | 8 passed, none by the artifact's author. |
| Handoffs and approval | 8/8 handoffs accepted; the one approval is `approved`. |
| Live workspace | Both briefs `blocked`, with 0 runs. |

How the three states are recorded:
- **Authored**: an artifact with a producing run.
- **Reviewed**: a passed review by a non-author.
- **Owner-accepted**: an `approved` approval, acceptance evidence, and completed tasks.

Screenshots 13–15 show each. All of this is deterministic simulation: no model, provider or external effect was involved.

### Retained local artifacts (nothing running)
- `apps/backoffice/tmp/` (gitignored):
  - `claude-acceptance-20261105-002320/`: the definitive run.
  - `claude-acceptance-20261104-190333`, `-190604`, `-190919` and `claude-acceptance-20261105-001838`: trial runs that exposed harness selector and loader bugs (since fixed); the last of these passed 37/37 on a slightly earlier tree.
  - `office-verification-20261105-*`: Vitest clusters, all stopped.
  - `claude-workflow-20261105/`: runner, build and acceptance logs.
- `D:\tmp\claude-office-acceptance-*` and `D:\tmp\claude-office-build-*`: working-tree snapshots. Each contains a `node_modules` **junction** into `apps/backoffice/node_modules`. Before deleting a snapshot, remove the junction with `rmdir <snapshot>\app\node_modules`, never a recursive delete through it.

## Integration contract (for Codex)

### Status route
`GET /api/office/status`: admin-only on every poll, `private, no-store`, and 503 `configuration_required` with no database access while Office is disabled. Parameters: optional `workspaceId` (scope), and optional `taskId` together with `taskWorkspaceId` (returns that task's package family, rechecked against its own workspace). Invalid ids return 400. The response is `OfficeActivity` (`src/lib/office-activity.ts`):
- `generatedAt` (database time) and `worker` (server-computed heartbeat age, online under 60 s, latest-row stopping flag).
- `execution`, where the provider and command flags are both false.
- `roles`: 7 roles × 2 modes.
- `tasks`: per task, the active run with a live or expired lease, the latest worker-step run, run totals, runnable/held/retry/exhausted dispatch counts, and any web-request bookkeeping run.
- `provenance`, `taskWindow` (`limit`, `covered`, exact `total`) and `family`.

### Role indicators for non-scene UI and future 3D badges
`deriveRoleStatus()` in `src/components/office/office-status.ts` returns `{ agentId, indicator, label, detail, activeTaskId, runId, since, stale }`. Indicators, highest precedence first:

`not_activated` › `unknown` (stale or failed status read; the last confirmed state is in `detail`) › `not_connected` (live mode) › `stopping` (a live lease whose run was asked to pause or cancel) › `executing` / `reviewing` (live lease only) › `stalled` (expired lease, recovery pending; not a failure) › `waiting_for_owner` › `renewal_needed` › `revision_needed` › `paused` › `needs_recovery` › `retry_scheduled` › `blocked` › `review_queued` › `queued` (runnable step) › `waiting_on_dependencies` › `awaiting_review` › `reviewed` › `waiting` › `idle` (zero open work only).

DOM hooks: Status cards `li[data-agent-id][data-indicator]`; dashboard rows `tr[data-agent-id]`. Today `OfficeView` passes `RoleStatus.label` through the existing `OfficeScene` `profiles[].state` string.

Proposed narrow scene follow-up (reserved; not done):
- Add optional `indicator?: RoleIndicator` and `stale?: boolean` to `OfficeScene`'s `Profile`, and pass them from `OfficeView`.
- Animate only for `executing`/`reviewing`; render `unknown` and `stalled` neutrally.
- Never infer state from label text or from movement.

### Deep links
Build links with `officeHref()` and parse them with `parseOfficeLink()` (`src/lib/office-links.ts`; dependency-free, so the client bundle stays lean). The server rechecks with `createOfficeReadModel(sql).resolveLink()`. Office keeps the URL in sync with `window.history.replaceState` (identifiers only).

### Coupling to keep in step (proposed runtime follow-ups, not done)
1. The read model's `runnable` SQL predicate mirrors `claim()` admission (`office-runtime/index.ts:192`), minus the global capacity check. Consider exporting one shared definition.
2. `family` reproduces the runtime snapshot mapping; the integration test asserts deep equality. Consider exporting the mappers, or `snapshot(workspaceId, { includeTaskIds })`.
3. The snapshot omits `office_reviews.decided_at` and `office_artifacts.producer_run_id`; the read model supplies them. Exposing both in the contract would let the UI drop `provenance`.
4. Delegation/resume bookkeeping emits `work_started` with owner/scheduler provenance; a distinct event type would remove the UI relabeling.
5. `decideApproval` answers 200 for expired/superseded requests; the UI now handles it, and whether to return 409 is Codex's call.

## Coverage gaps (not verified here)
- Real signed-in production browser, real Cloudflare Access JWTs in a browser (the existing `auth.test.ts` covers verification), and the production database. These belong to the owner and activation.
- `next start` serving the new code. Only the production build was verified; the browser ran `next dev` because the development bypass is rejected in production mode.
- Mobile and narrow viewports for the new Status view and dashboard panel (desktop 1440×1000 only), and assistive-technology testing beyond semantic structure.
- Long-running worker uptime, PC sleep or reboot, and a live provider or real model output.
- Turbopack, which was not attempted (webpack as instructed).
- 3D badge binding and GPU behavior.

## Remaining blockers and later activation steps (not executed)
1. Codex reviews this diff and decides on the follow-ups above. Owner signs in to accept the final UI.
2. To ship this UI before Office activation: build a release from the reviewed tree separately with `npm run build -- --webpack`, validate it, and promote it only in an authorized window. With `OFFICE_ENABLED=false`, administrators see the dashboard's "Office is disabled" card and the Office banner, and no Office tables are queried; sales see nothing new. No new migration is needed: the read model reads only migration-003 tables.
3. To activate Office (separately authorized, per [ACTIVATION-AND-ROLLBACK.md](ACTIVATION-AND-ROLLBACK.md)):
   - Make a production backup and do a restore check.
   - Apply migration 003 through `npm run db:migrate`.
   - Provision a dedicated least-privilege worker role, configuration and supervisor.
   - Enable Office.
   - Verify the signed-in admin dashboard panel (worker state, empty exact counts), sales denial, a deep link, and one deterministic family through owner acceptance.
4. Live agents remain blocked on a reviewed provider adapter, a dedicated connection, authorized sources, and enforced spend, token, time and revision limits.
