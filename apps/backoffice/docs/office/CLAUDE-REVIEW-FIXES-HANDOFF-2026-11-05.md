# Claude Opus 5.5 — Office independent-review corrections

5 November 2026, Asia/Jakarta. Work in `D:\Enztronic`.

## Objective and authority

Complete the four corrections identified in Codex's independent review, add meaningful regression tests, and return the corrected workstream for re-review. This is a local implementation and isolated verification assignment. Do not stop at a plan, and do not deploy or activate production Office.

The existing workflow/dashboard implementation is already in the working tree. Continue from it; do not reapply the original26-file patch. Preserve unrelated work and all prior evidence.

## Read first

Paths are relative to `apps/backoffice/` unless absolute:

1. `AGENTS.md`, then the relevant installed Next.js documentation for any Next.js behavior you change.
2. `docs/office/CODEX-INDEPENDENT-REVIEW-2026-11-05.md` — authoritative findings, reproductions, independent checks and coverage limits.
3. `docs/office/CLAUDE-OPUS-5.5-HANDOFF-2026-11-04.md` — original workstream and preservation boundaries.
4. `docs/office/CLAUDE-WORKFLOW-REPORT-2026-11-04.md` and its accompanying diff/evidence. Preserve them as the historical pre-correction record.
5. `docs/office/ACTIVATION-AND-ROLLBACK.md` and `docs/BACKOFFICE-RECOVERY-2026-11-04.md`.

Run `git status --short` and inspect the current source before editing. Much Office code remains untracked/uncommitted; clean HEAD is not the implemented baseline. Never reset, clean, stash or broadly revert the working tree. Capture a timestamped, secret-free baseline of files you will change, including SHA256 hashes, so your correction diff can be reviewed independently of earlier work.

## What already passed

Codex independently reran135 tests with zero skipped, lint, TypeScript, and a fresh isolated Webpack production build. It also passed12 isolated `next start` HTTP checks with synthetic signed assertions and development bypass disabled: disabled Office without003, missing-schema handling, admin reads, sales denial, synthetic brief save and exact task page loading. Claude's retained37-check browser evidence and26-file patch provenance were consistent.

Those results concern the pre-correction tree; do not present them as verification of your new changes. The four findings remain open. No production authorization, final3D approval, real provider execution or completed real client work follows from the simulation evidence.

## Fix 1 — preserve exact artifact revision links

Start at `src/components/office/OfficeView.tsx`: `linkHref()`, the URL synchronization effect and same-route echo guard. Their two calls to `officeHref()` omit artifact identity. Detail selection uses `initialArtifactId` and its React key.

Required behavior:

- Opening a valid historical revision keeps its artifact ID in the canonical URL.
- Reload and record refresh retain that exact revision, not whichever revision is currently latest.
- Same-route navigation from R1 to R2 of the same task/workspace/view applies R2 and updates the detail.
- Echo suppression includes artifact identity and does not suppress genuine navigation. Include the relevant effect dependencies.
- Changing task, closing the detail, switching workspace/mode or explicitly returning to current revision clears/preserves artifact selection intentionally; no stale revision leaks into another task.
- Invalid, missing or cross-workspace revisions remain denied/not found. Never silently substitute a current revision for an explicitly requested unavailable revision.
- Keep URLs identifier-only; preserve draft text in memory during same-route transitions.

Regression evidence must exercise the actual OfficeView behavior, not only `officeHref()` with correctly supplied arguments. Cover initial R1, reload R1, same-task R1→R2, closing/reopening and a rejected revision link.

## Fix 2 — expire execution evidence locally

Start at `src/components/office/office-status.ts`: `liveRoleStatus()` and `taskExecutionLine()`. Audit direct lease labels in `OfficeTaskDetail.tsx`, `OfficeRoleStatus.tsx`, and review-in-progress evidence too.

The server's `leaseLive` boolean is historical at snapshot creation. It cannot remain proof of current execution until the next poll. Current polling is15seconds and snapshot staleness45seconds; a lease can expire earlier.

Required behavior:

- Carry server-relative remaining lease duration, derived from database-time values, and advance it by local elapsed time since observation. Do not compare an unsynchronized browser wall clock directly with a database timestamp.
- Handle request delay conservatively; an already-expired observation must not be presented as current execution merely because it was just received.
- At expiry, stop saying Executing, Reviewing or lease held. Show stalled/recovery pending or explicitly unavailable until fresh evidence arrives. Expiry alone is not proof of a recorded failure or a completed retry.
- Make the local expiry cause a render/update independently of a successful network poll. Reconcile on visibility changes and reconnect.
- Worker heartbeat, page freshness and task/run lease validity remain separate. Preserve the distinctions among no worker, idle, queued, running, reviewing, stopped and unknown.
- Apply the same aged evidence to cards, task lines, execution detail and review-in-progress wording. Do not alter lease ownership/fencing or the canonical runtime to make a label easier.

You may make the narrow additive changes needed in Claude-owned `src/lib/office-activity.ts` DTOs and `src/lib/server/office-read-model.ts`. Core `office-runtime/`, `office-contracts/`, worker authority and scene code remain reserved. If a reserved interface change proves necessary, return the minimal proposed interface/patch for coordination.

Use controlled-clock tests for immediately before/at/after expiry with no new fetch; worker still online; delayed response; hidden/visible tab; clock skew; stopping/reviewing runs; and a newer snapshot renewing/replacing evidence. Assert that no stale lease produces a current-execution claim.

## Fix 3 — fail acceptance on cleanup/resource leaks

Start at `scripts/office-acceptance/run.mjs`'s finalizer and `lib.mjs`'s `stopTree()`/`createCluster()`.

Required behavior:

- A PostgreSQL stop error or a remaining owned process/listener makes `passed:false` and the process exit nonzero, even when every functional check passed.
- Track ownership as soon as a resource starts. A failure between PostgreSQL startup and `createdb` completion must still clean up that newly created cluster.
- Await owned child exits and verify owned fixture ports have closed. Do not treat issuing taskkill or immediately sampling a tracking map as proof of exit.
- Distinguish a child that already exited from an actual termination failure. Preserve the original functional failure and any cleanup failures in the report.
- Attempt every owned-resource cleanup even if an earlier cleanup action fails; report all unresolved resources afterward.
- Report unresolved resources honestly with safe identifiers. Never kill/adopt a different process because it happens to occupy a test port. Stop only resources this run created.
- Preserve logs and disposable data for review; do not add broad recursive cleanup.

Add deterministic fault-injection tests for PG shutdown failure, taskkill/child-exit failure, a remaining owned listener, partial cluster initialization failure, and a clean run. Exercise shared actual cleanup functions, not a duplicate of the finalizer maintained only in a test.

The delivered37-check run did stop PostgreSQL successfully. Preserve that historical result; the issue is that future cleanup failure can currently report success.

## Fix 4 — reject unsafe snapshot destinations before copying

Start at `scripts/office-acceptance/lib.mjs`'s `snapshotWorkingTree()` and both callers accepting a snapshot root.

Required behavior:

- Canonicalize source and destination with Windows case/separator handling and existing ancestor resolution. Detect junction/symlink aliases; string-prefix comparison alone is insufficient.
- Reject the source itself, destinations inside the source, destinations containing the source, and destinations that already exist. Never merge into an old snapshot.
- Validate before creating the target or copying source files. A new safe destination under `D:\tmp` remains supported. Distinguish a sibling such as `backoffice-other` from a contained path.
- Retain `.env*`, runtime/data and generated-output exclusions. The snapshot's dependency junction must still point only to the intended installed packages; no recursive traversal/deletion through it.

Use a tiny synthetic source tree for tests. Cover safe fresh external output; existing destination; same source; `.`; nested `src`; sibling-prefix; and a Windows junction alias to the source. Rejected cases must fail before copying and leave the synthetic source unchanged. Never attempt self-copying against the actual Enztronic tree.

The review confirmed that `.` can produce finite self-copying, whereas a target under an existing synthetic `src` recursively grew to a100-copy safety bound. Do not overstate this as every overlapping path inevitably recursing forever. Evidence is in the review report.

## Verification and isolation

Implement the fixes first, then run the meaningful regression tests and existing suites. Existing passing totals are a baseline, not a fixed target; new tests should increase coverage.

- Run the existing fresh-cluster test runner only if its dedicated55439 port is free. Inspect it first; it must create a new cluster and explicit test databases. Do not reuse, reset, stop or adopt an old fixture.
- Preserve file-level command redirection for the PowerShell runner so PostgreSQL does not inherit a captured output pipe indefinitely. Retain timestamped logs.
- Run relevant lint and TypeScript checks, then `npm run build -- --webpack` in a fresh external source snapshot with its own `.next`, explicit synthetic environment and no `.env*` files.
- Run the corrected acceptance harness, including the new actual-view revision/expiry cases and cleanup/path failure tests. Distinguish real browser observations from mocks/fault injection.
- Rerun isolated production-mode HTTP checks against the corrected build. Codex's reference helper is `tmp/codex-review-20261105/production-smoke.mjs`; inspect it before reuse and supply your fresh build manifest. It creates a NEW test cluster and local HTTPS issuer, uses synthetic assertions with production bypass false, and never uses actual owner/Cloudflare credentials. Its fixed ports must be free before use. Do not change global certificate validation or reuse its stopped database.
- Preserve admin/sales/expired authentication, no-query-disabled behavior with no003, missing-schema unavailable state, mode/workspace isolation, idempotent uncertain-save handling and unchanged synthetic business invariants.
- Complete all independent local implementation and verification before returning production dependencies. Report actual blockers/skips without claiming coverage that was unavailable.

## Boundaries that still apply

Keep production `OFFICE_ENABLED=false` and development authentication bypass disabled. Do not change or restart production3100/54329, the existing3118 preview, Cloudflare Access/tunnel/DNS, `.env*`, the active `.next*` directories, startup tasks/scripts, real database/grants/migrations, human access, business records, public website or `employee/`.

No setup-local, production seeding, production migration, release promotion, deployment, commit/push, paid CI/GitHub Actions, provider call, message or financial action. Synthetic fixtures belong only in newly created disposable test environments. Never request/copy/log real passwords, API keys, SSO cookies or JWTs.

Codex retains `OfficeScene.tsx`, `scene-*`, 3D/model assets/manifests, GPU work and release coordination. This correction pass is not a live provider adapter or a redesign of the Office.

## Return package

Create these new dated artifacts without overwriting the original report/diff:

1. `docs/office/CLAUDE-REVIEW-FIXES-REPORT-2026-11-05.md` — finding-by-finding fix, exact changed files, before/after behavior, commands/results, environment/process cleanup, evidence locations and remaining gaps.
2. `docs/office/CLAUDE-REVIEW-FIXES-2026-11-05.diff` — delta from your captured PRE-FIX current working tree, including new tests. Because many files are untracked, do not rely on plain git diff to capture everything. Verify patch replay reproduces corrected files byte-for-byte.
3. Fresh machine-readable acceptance/fault-injection reports and targeted browser screenshots, with timestamped paths. Include the fresh production build ID and snapshot manifest. Do not overwrite prior evidence.
4. A short message for Codex listing each of the four findings as fixed/pending, tests actually run, anything requiring coordination, and confirmation that production was untouched.

Leave a reviewable working-tree diff and return for independent re-review. Do not mark production-ready or proceed to production activation yourself.
