# Claude review-fix report: Office corrections for re-review

5–6 November 2026, Asia/Jakarta. This report responds to `CODEX-INDEPENDENT-REVIEW-2026-11-05.md` under `CLAUDE-REVIEW-FIXES-HANDOFF-2026-11-05.md`. The work is a local implementation with isolated verification only. Nothing was committed, pushed, deployed, migrated or activated, and production Office remains disabled. `CLAUDE-WORKFLOW-REPORT-2026-11-04.md` and its 26-file diff are kept unchanged as the pre-correction record.

Paths are relative to `apps/backoffice/` unless absolute.

## Status

| Finding | Status | Correction | Regression evidence |
| --- | --- | --- | --- |
| 1. Revision identity dropped by URL sync | Fixed | The revision is part of the selection, the canonical URL, the echo comparison and the same-route link effect. An unavailable revision stays requested and is never replaced. | 13 real-view browser checks; integration test; Codex's `linkHref()` extraction now returns distinct URLs |
| 2. Execution indicators outliving the lease | Fixed | The server sends remaining lease time measured by the database. The browser ages it from the moment the request was sent, on its monotonic clock. A timer re-renders the page at expiry, and visibility, reconnect and page restore re-age evidence immediately. | 12 controlled-clock unit tests; 7 real-view browser checks (2 with fault-injected timing); read-model integration test |
| 3. Acceptance passing after cleanup failure | Fixed | One shared ownership registry and finalizer. Partly initialised clusters are stopped by their creator. Process exits and closed ports are confirmed. Any cleanup failure fails the run. | 13 tests (11 fault-injection, 2 real children); real-resource self-test 3/3; a real disk-full failure (below) |
| 4. Unsafe snapshot destinations | Fixed | Source and destination are canonicalised through junctions, links, case and separators, then validated before anything is created. | 7 tests on a synthetic tree |

Final tree:

| Check | Result |
| --- | --- |
| Vitest | 17 files, 167 tests, 0 skipped (pre-correction baseline: 15 files, 135 tests) |
| Lint and TypeScript | Pass |
| Webpack build | Build `40gNm8zkbT7ZnxtAOzaAp` |
| Production-mode HTTP checks | 15/15 |
| Browser acceptance | 57/57, cleanup confirmed |

## Baseline and scope

- **Baseline captured** at 2026-11-05 11:20:32 +0700, before any edit. It covers 25 files I might change, kept at `tmp/claude-review-fixes-20261105/baseline/<path>.baseline`. SHA-256 values by original path are in `baseline-sha256.txt`, also copied to `docs/office/claude-review-fixes-evidence-20261106/`.
  - All 25 matched the build snapshot Codex reviewed: `D:\tmp\claude-office-build-20261105-005755\app-manifest.json`, build `iUDWMP94wxcFdHAPJVCts`.
  - The `.baseline` suffix keeps the copies out of TypeScript, ESLint and Vitest collection.
- **Snapshot comparison.** The final build snapshot differs from Codex's reviewed snapshot only by:
  - the 14 modified and 3 new files below;
  - Codex's two new docs (`CODEX-INDEPENDENT-REVIEW-2026-11-05.md` and the handoff);
  - this pass's draft patch.
- **Modified (14):**
  - `src/components/office/`: `OfficeView.tsx`, `OfficeTaskDetail.tsx`, `OfficeRoleStatus.tsx`, `OfficeDashboardPanel.tsx`, `OfficeDashboardPanel.test.tsx`, `office-status.ts`, `office-status.test.ts`
  - `src/lib/`: `office-activity.ts`, `office-links.ts`
  - `src/lib/server/`: `office-read-model.ts`, `office-read-model.integration.test.ts`
  - `scripts/office-acceptance/`: `lib.mjs`, `run.mjs`, `build-snapshot.mjs`
- **New (3):** `scripts/office-acceptance/cleanup.test.mjs`, `snapshot.test.mjs`, `cleanup-selftest.mjs`.
- **Unchanged and re-verified against the baseline:** `OfficeInbox.tsx`, `office-ui.tsx`, `office.module.css`, `office-links.test.ts`, `office-dashboard.ts`, `office-dashboard.test.ts`, `team/page.tsx`, `api/office/status/route.ts`, `zombie-lease.ts`, `test-office-local.ps1`, `vitest.config.mts`.
- **Reserved code untouched:** `office-runtime/`, `office-contracts/`, `OfficeScene.tsx`/`scene-*`, worker, migrations, configuration, `.env*`, startup scripts, `.next*`, website and `employee/`. `git status --short` is identical before and after: every edit is in a path that was already modified or untracked.

## Finding 1: exact artifact revision links

**Before.**
- `linkHref()` and the URL-sync effect both omitted `artifactId`. A link to R1 was rewritten without its revision, so a reload showed the current revision.
- A same-route navigation from R1 to R2 produced the same comparison URL, so the echo guard ignored it.
- The dropdown choice lived only inside the detail component and never reached the URL.
- A rejected revision link opened the task with its current revision (with a notice).

**After.**
- `TaskSelection` carries `artifactId`, where null means "follow the current revision", plus `artifactNotFound`.
- `linkHref()` includes the revision, and a new `linkSelection()` builds the selection from a rechecked link.
- The URL-sync effect writes `artifact` whenever a task with an explicit revision is selected; `urlArtifact` is in its dependencies.
- The same-route effect now uses `useEffectEvent`, which removes the old `eslint-disable`. Its echo comparison includes the revision. It also:
  - merges the navigation's rechecked family, so an older linked revision shows at once;
  - starts a fresh evidence read for the new selection, keeping draft text in page memory.
- `OfficeTaskDetail` takes the revision as a controlled prop and is keyed by task only, so R1→R2 updates the open detail without remounting it.
- An explicitly requested revision is shown only if it is loaded for that task. Otherwise the detail says so and offers "Show the current revision".
- Viewing an earlier revision shows a notice with that same button. Choosing the current revision in the dropdown, or saving a new revision, returns the selection to "current".
- Opening another task, closing the detail, or switching workspace or mode clears the revision.
- `resolveLink()` now returns the requested `artifactId` with `artifact: 'not_found'` (previously null), so a reload stays denied rather than falling back to the current revision. Nothing about other scopes is returned.

**Tests.**

The integration test asserts the exact not-found shape for another task's revision and for an unknown revision.

Real-view browser checks 41–53 run on a second synthetic family. One child has a run-produced R1 and an owner-prepared R2, both written through the real Office API:

- an initial R1 link after hydration and the first poll;
- reload;
- record refresh;
- same-route R1→R2 through the Next.js client router (`window.next.router.push`), with unsaved brief text surviving;
- explicit selection, then return to current;
- close and reopen (no leak);
- another task's revision and an unknown revision, each on open and on reload;
- a mode switch clearing the selection.

Screenshots: `22-revision-link-r1-kept`, `23-revision-link-r1-to-r2`, `24-revision-link-rejected`.

## Finding 2: execution evidence expires locally

**Before.** Role and task presentation trusted the snapshot's `leaseLive` until the next successful poll or the 45 s staleness gate. Heartbeats were aged from receipt time on the wall clock.

**After.**

DTO additions in `office-activity.ts` (all additive):
- `OfficeActiveRun.leaseRemainingMs`: `lease_until − now()` in the database, rounded down; zero or less when expired.
- `OfficeRoleActivity.leasedRuns` and `OfficeTaskExecution.leasedRuns`: every leased run, newest first.
- `reviewInProgress.leaseRemainingMs`.

The read model computes these in the same read-only transaction.

In `office-status.ts`:
- `leaseNow()`, `agedRole()`, `agedExecution()`, `nextEvidenceChangeMs()`, `leaseWording()` and `leasedRunState()` are the single ageing rule.
- `deriveRoleStatus()` and `taskExecutionLine()` require `evidenceAgeMs`, and lease evidence is never presented un-aged. A lease without a server-relative remaining time is never treated as current.

States:

| State | Meaning | Shown as |
| --- | --- | --- |
| live | Remaining time minus local age is above 0 | Executing / Reviewing / Stop requested |
| `expired_since_read` | The server saw the lease live, but its time has run out locally | Indicator `stalled`, label **Lease expired**: not shown as executing; may have been renewed; recovery retries if not; not a recorded failure or a completed retry |
| `expired_at_read` | The database saw the lease already expired | **Stalled**, server-confirmed |

Ageing rules:
- Age runs from `performance.now()` taken just before the status request is sent. The database read happened after that, so request and response delay count against the evidence, and it can only expire early, never late.
- The browser wall clock is never compared with a database timestamp for leases or heartbeats. Server-rendered evidence is aged from navigation start.
- The worker heartbeat uses the same basis. It stays a separate indicator, and the worker can show online while a lease has run out.

In `OfficeView`:
- A timer fires at the next lease expiry or heartbeat-threshold crossing, independent of any poll.
- `visibilitychange`, `online`, `offline` and `pageshow` (bfcache) re-age immediately and then reconcile.

Wording changes:
- Task detail, role cards, workload counts and review-in-progress wording all use the aged evidence.
- A leased run without a live lease reads "run record still open", never "Running".
- The static dashboard labels its counts "Executing when loaded".

**Tests.**

12 unit tests in `office-status.test.ts` cover:
- before, at and after expiry with no fetch (4 999 ms executing; 5 000 and 5 001 ms not);
- the worker still online after the lease runs out;
- a delayed response;
- a hidden tab becoming visible;
- clock skew in both directions;
- reviewing and stop-requested runs;
- review in progress;
- multiple leases;
- renewal and replacement by a newer snapshot;
- Codex's exact reproduction;
- timer scheduling and wording.

The read-model integration test asserts that `leaseRemainingMs` comes from database time, the expired-at-read shape, and the stalled derivation.

Real-view browser checks 19–25 use the real abandoned lease and heartbeat from crash phase 2:

| Checks | What is observed |
| --- | --- |
| 19–21 | Executing with database remaining time (22 713 ms in the final run); worker online; still executing just before expiry |
| 22 | After a hidden tab and a controlled page clock run past the remaining time: **Lease expired** with 0 requests made |
| 23 | On becoming visible, the fresh database read (still live) replaces the estimate |
| 24–25 | **Fault-injected timing:** one real response is held while 5 s of page time pass, and its reported remaining time is shortened to 3 s. The earlier read stays current while the response is held; once delivered, the expired-on-arrival evidence shows Lease expired, never executing. |

Screenshots: `20-lease-expired-locally-without-fetch`, `21-delayed-response-expired-on-arrival`.

## Finding 3: acceptance fails on cleanup and resource leaks

**Before.**
- The finalizer logged a PostgreSQL stop failure and still reported `passed:true` with exit 0.
- `stopTree()` ignored taskkill's result and never awaited an exit.
- `createCluster()` threw after a failed `createdb` without stopping the server it had started.

**After.** In `lib.mjs`:

| Mechanism | Behaviour |
| --- | --- |
| `createOwnership(system)` | Registers each process (with its fixture ports) and each cluster when it is created. Clusters are registered before `pg_ctl start`, so a half-started one is still owned. |
| `stopProcess()` | Issues taskkill but awaits the child's own exit event (taskkill's result is not proof), then requires its ports to close. It distinguishes `already_exited` from `termination_failed` and reports `listener_remaining` with diagnostic listener PIDs; a foreign process is never stopped. |
| `createCluster()` | Stops its own cluster when `createdb` or start fails, and keeps it owned if that stop fails too. |
| `stopOwnedCluster()` | Uses `pg_ctl status` to tell `already_stopped` from `stop_failed`. |
| `finalizeRun()` | Shared by `run.mjs`. It attempts every cleanup even after an earlier one fails, keeps the functional failure alongside cleanup failures, and sets `passed` from both functional and cleanup results. |

`safeMessage()` strips connection strings. `run.mjs` uses `finalizeRun()` and awaits each mid-run stop. Codex's production-smoke imports (`createCluster`, synchronous `stopCluster`, and the rest) stay compatible.

**Tests.**

`cleanup.test.mjs` drives the real functions with an injected operating system (11 cases):
- a clean run;
- PG stop failure while every check passed;
- already stopped;
- taskkill failure and taskkill "success" without an exit;
- an already-exited child and an exit race;
- a remaining owned listener (the foreign PID is reported, never signalled);
- partial cluster initialisation, with and without a cleanup failure;
- every cleanup attempted after earlier failures;
- Codex's false-pass scenario;
- refusal to act on an unowned PID.

It also has 2 real-process cases: a listening child terminated with its exit and port closure confirmed, and a child that exited on its own.

`cleanup-selftest.mjs`, run with real resources on new ports 55469/55479 (3/3 passed):
- A new PostgreSQL cluster whose `createdb postgres` fails after start: the cluster is stopped and reported, with `pg_ctl status` 3 afterwards.
- A real owned listener: terminated and confirmed.
- A real orphaned grandchild holding an owned port: the run fails and names the PID. The self-test then stops only that exact PID, which it created and confirmed as the listener.

**Real incident.**
- The first production-mode attempt hit "No space left on device" during `createdb` (drive D: was down to about 7.6 MB free).
- The new path stopped the just-started cluster, confirmed all three fixture ports closed and reported a failure. It did not pass. Retained at `tmp/claude-review-fixes-20261105/production-smoke-1793854815359/`.
- After the owner freed space, it passed on retry.

The delivered 37-check run of 5 November is not affected; that run stopped PostgreSQL successfully.

## Finding 4: unsafe snapshot destinations are rejected before copying

**Before.** The target was created before the source was walked. Overlapping or existing destinations were merged into, which allowed self-copying.

**After.**
- `canonicalPath()` resolves the nearest existing ancestor with `realpathSync.native` (through junctions and symbolic links) and re-appends the missing tail.
- Comparison is case- and separator-insensitive on Windows and respects path boundaries.
- `assertSafeSnapshotDestination()` rejects, in order: `same_as_source`, `inside_source`, `contains_source`, `exists` (including an existing manifest). The source defaults to the app.
- `snapshotWorkingTree(target, { source, cwd })` validates before creating anything and never follows links while copying. It keeps the `.env*`, runtime, data and generated-output exclusions. It verifies that the `node_modules` junction resolves to exactly the source's installed packages.
- `build-snapshot.mjs` and `run.mjs` validate before creating any directory. `build-snapshot.mjs` accepts an optional evidence directory as a second argument; the default is unchanged.

**Tests.** `snapshot.test.mjs` uses a tiny synthetic tree under a new temp directory, with a junction inside the source pointing outside it. Each rejected case also asserts that the source listing is unchanged and that nothing was created:
- a fresh external copy (5 files; exclusions kept; junction verified; the outside link not followed);
- an existing destination, and an orphan manifest;
- the source itself and `.`;
- nested `src`, `..`, and a relative path;
- containing the source;
- the sibling `backoffice-other`, which is allowed;
- a junction alias of the source, case and separator variants, and a junction into the source's `node_modules`.

No self-copy was attempted against the real tree. The test removes its junctions first, then its own temp directory.

## Verification on the final tree

| Command (from `apps/backoffice`) | Result | Evidence |
| --- | --- | --- |
| `npm run lint`; `npm run typecheck` | Both exit 0 | `tmp/claude-review-fixes-20261105/logs/{lint,typecheck}-final.txt` |
| `cmd /d /c "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-office-local.ps1 > …\vitest-runner-final.txt 2>&1"` | 17 files, 167 tests, 0 skipped. New cluster on 55439, stopped afterwards | `logs/vitest-runner-final.txt`; `tmp/office-verification-20261106-003540/` |
| `node scripts/office-acceptance/build-snapshot.mjs D:\tmp tmp\claude-review-fixes-20261105\build` | Webpack build `40gNm8zkbT7ZnxtAOzaAp`. 257 files, no `.env*`, TypeScript ran, junction → app `node_modules`; snapshot at `D:\tmp\claude-office-build-20261105-173613\app` | `build/build-20261105-173613.{json,log}`; manifest copied to the evidence folder |
| `node tmp\claude-review-fixes-20261105\production-smoke.mjs <build json>` | 15/15. `next start`, dev bypass false, synthetic RS256 against a local HTTPS JWKS, new PG on 55459, app on 3130, issuer on 43459; fixture stopped and all three ports confirmed closed | `production-smoke-1793900247253/report.json` |
| `node scripts/office-acceptance/run.mjs` | 57/57; `functionalPassed` and `cleanupPassed` true; no unresolved resources. Next dev on 3128/3129, new PG on 55449 | `tmp/claude-acceptance-20261105-173833/acceptance-report.json` (run stamp is UTC) |
| `node scripts/office-acceptance/cleanup-selftest.mjs` | 3/3, ports freed | `cleanup-selftest-20261106-003749/` |
| `node --import tsx tmp/claude-review-fixes-20261105/findings-recheck.mjs` | `defectReproduced: false` for all three findings | `findings-recheck.json` |

About the production-mode check:
- It is a copy of Codex's `tmp/codex-review-20261105/production-smoke.mjs` with all 12 original checks unchanged. Codex's original file was not modified.
- It adds three checks: an expired but correctly signed assertion is denied (API 401, no Office page); a rejected revision link page; and the lease-evidence shape of `/api/office/status`. It also adds a closed-port check.

About the acceptance run:
- All 37 original checks still pass. The phase 1 save, uncertain-save and failure checks, crash, fencing and restart, deep links, sales denial and unchanged business invariants are all preserved.
- It used a new snapshot under `D:\tmp` and the synthetic development identity. It ran on `next dev`, not on the owner's signed-in browser.

**Real observations versus injected faults.**
- Real: the browser checks, except 24–25, use the real server, database, leases, heartbeats and Office view.
- Controlled, not real: the page clock (Playwright clock) and the hidden-tab state (an emulated `document.hidden` with a `visibilitychange` event).
- Fault-injected: checks 24–25, and every case in `cleanup.test.mjs` except the two real-process cases.

## Environment, isolation and cleanup

**Production unchanged.**
- 3100 (PID 23404) and 54329 (PID 45704) kept the same PIDs at start and end.
- Production build `HMB4cGweGXqsAnyVbpkcG` is unchanged.
- No `.env*`, `.next*`, migration, grant, Cloudflare, scheduled-task or startup change. No provider, message or financial action.

**Test ports.** Only new fixtures were used, each checked free first: 55439, 55449, 55459, 55469, 55479, 3128, 3129, 3130 and 43459. All were free again afterwards. Only processes this work started were stopped, each confirmed by its exit event.

**Disk.**
- Drive D: reached about 7.6 MB free during this pass. Test artifacts are large: snapshots under `D:\tmp` and `tmp/` together hold several GB from both workstreams and Codex's review. This pass added about 1.7 GB, measured without following junctions: two build snapshots of 281 MB each, two acceptance snapshots of 301 and 319 MB, two Vitest clusters of 97 MB each, and about 330 MB of evidence and fixture data.
- I deleted nothing. The owner freed space, and D: had 8.67 GB free when work resumed.
- Recommendation: a deliberate retention decision for old snapshots (remove each `node_modules` junction first). The production database is on D:.

## Evidence locations

| Item | Location |
| --- | --- |
| Patch | `docs/office/CLAUDE-REVIEW-FIXES-2026-11-05.diff` |
| Curated machine-readable evidence | `docs/office/claude-review-fixes-evidence-20261106/`: acceptance, production smoke, self-test, findings recheck, build JSON, snapshot manifest, baseline hashes, Vitest summary, screenshots 20–24 |
| Full logs, baseline, derived helpers, failed-ENOSPC attempt | `tmp/claude-review-fixes-20261105/` |
| First correction round, before the "run record still open" wording fix | `tmp/claude-acceptance-20261105-172757` (57/57); build `tQquKpwvW5tqpGbhAzDqX`; smoke 14/14 |

## Remaining gaps and coordination

1. **Approval expiry wall clock.** Inbox, `taskDecision()` and approval stages still compare the browser wall clock with database `expires_at`. This is the same class of skew as finding 2, but outside it. Proposal: add `expiresInMs` to the read model and age it the same way. This is Claude-owned code and needs no reserved interface.
2. **Conservative ageing edges.**
   - A soft navigation into `/team` ages server-rendered leases from document navigation start, so a live lease can briefly show "Lease expired · awaiting fresh status" until the first poll on mount.
   - Pre-hydration HTML shows evidence as of generation.
   - The dashboard is static and labelled "when loaded".
3. **Scene binding.** "Lease expired" uses the existing `stalled` indicator, so a neutral 3D badge needs no new value. `li[data-agent-id][data-indicator]` is unchanged, and the scene's `profiles[].state` label now ages.
4. **Harness limits.**
   - Port probes use loopback only; fixtures bind 127.0.0.1.
   - Snapshot validation is not proof against a junction created between validation and copy.
   - Codex's original repro can no longer extract an inline finalizer, by design. `findings-recheck.mjs` re-drives that scenario.
5. **Not verified:** the owner's signed-in production browser and real Cloudflare; mobile and assistive technology; long-running worker uptime; a live provider; 3D/GPU; production activation. These still need separate authorization per `ACTIVATION-AND-ROLLBACK.md`.

## Patch

`docs/office/CLAUDE-REVIEW-FIXES-2026-11-05.diff`:
- 17 files: the 14 modified files diffed against the captured pre-fix baseline, plus 3 additions. It is +1299/−198 lines; SHA-256 `3701be0dfbe6c5fde73d213e1d974b98eed7154cfbe9627422a1c217bae0efd6`, also recorded with the per-file replay hashes in `tmp/claude-review-fixes-20261105/logs/patch-replay.txt`.
- Paths are repository-relative (`apps/backoffice/…`). Apply from the repository root with `git apply -p1` onto the baseline copies.
- Replay onto the baseline reproduced all 17 working-tree files byte-for-byte.
- The report and evidence files are not part of the patch.
