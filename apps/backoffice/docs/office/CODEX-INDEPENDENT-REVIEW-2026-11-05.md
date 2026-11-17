# Independent review of Claude's Office workflow/dashboard workstream

5 November 2026, Asia/Jakarta. Reviewed the current working tree in `D:\Enztronic`, Claude's26-file baseline diff, implementation report, retained source manifests and acceptance evidence. This is a review, not deployment or production Office activation.

## Decision

Changes requested before workstream sign-off. Two product defects affect exact output selection and truthful execution status. The acceptance harness also needs cleanup and snapshot-destination safeguards. No application or test-harness source fix was made during this review.

The server-side authorization, disabled-Office guards, scoped aggregate queries, current queue-admission predicate and family mappings did not produce an additional concrete finding in this review. The submission uncertainty rules and expired/superseded approval handling are consistent with the current API behavior.

## Findings

### 1. P2 — exact revision identity is discarded by URL synchronization

Locations: `src/components/office/OfficeView.tsx:82`, `:268`, `:366`; downstream revision selection in `OfficeTaskDetail.tsx:112` and the detail key at `OfficeView.tsx:508`.

Both `linkHref()` and the URL-sync effect call `officeHref()` without `artifactId`. A valid link to revisionR1 is therefore rewritten without its artifact parameter. Reload opens the current revision instead. Navigating from R1 to R2 of the same task/view also produces the same comparison URL, so the same-route echo guard ignores the new revision and the detail remains on R1.

Reproduction: evaluated the actual `linkHref()` source against two otherwise identical, valid links to different artifact IDs. Both returned the same URL, whereas `officeHref()` with the full inputs returned distinct revision URLs. The omitted artifact parameter in the synchronization effect is confirmed in source.

Required correction: preserve artifact identity in canonical URL construction, echo comparison and effect dependencies. Add a regression covering an initial historical revision link, reload retaining that revision, and same-route navigation R1→R2 for the same task. Preserve the server's workspace/task/artifact authorization checks.

### 2. P2 — client execution indicators can outlive the lease

Locations: `src/components/office/office-status.ts:119` and `:181`; direct lease labels in `OfficeTaskDetail.tsx:41` and `OfficeRoleStatus.tsx:77`; polling at `OfficeView.tsx:209`.

`leaseLive` is computed when the server snapshot is created. Both role and task presentation rules trust that boolean without aging `leaseUntil`. Worker heartbeat is advanced by local elapsed time, but leases are not. A response received near lease expiry can continue saying Executing or Reviewing after expiry, until another successful poll or the45-second stale-data gate. Hidden tabs suppress polling; a visible request can also be delayed.

Reproduction: a snapshot captured at00:00:04 contains a lease expiring at00:00:05. At simulated client time00:00:10 the snapshot is only6seconds old, but both actual presentation functions still return `executing`. The mocked input represents a previously valid snapshot, not a server incorrectly calculating lease validity.

Required correction: carry server-relative lease remaining time, advance it with local elapsed time, and treat an expired lease as stalled/recovery pending or unavailable. Avoid comparing unsynchronized browser and database wall clocks. Apply the same rule to role/task/detail lease labels and review-in-progress evidence. Add no-new-fetch boundary tests before and after expiry, plus a delayed/hidden-tab case. Animation must remain subordinate to confirmed execution evidence.

### 3. P2 — acceptance can pass after fixture cleanup fails

Locations: `scripts/office-acceptance/run.mjs:374-380`; process/cluster ownership in `lib.mjs:69-74` and `:90-98`.

The finalizer catches a PostgreSQL stop failure and only logs it. `report.passed` and process exit status do not include that error or nonempty `remainingProcesses`. `stopTree()` also ignores taskkill failure. If `createdb` fails after PostgreSQL starts, `createCluster()` throws before returning its handle, leaving the caller unable to stop that newly started cluster through its normal finalizer.

Reproduction: evaluated the actual finalizer body with a mocked failing `stopCluster()` and one remaining owned child. It logged `pg_stop_failed`, reported `passed:true`, and returned exit code0. This fault injection started no process and touched no database.

Required correction: register owned resources immediately after creation; clean partially initialized clusters in their creator; await owned process exits; fail the run on cleanup failure; verify owned fixture listeners are closed. Do not stop or adopt an unrelated process to satisfy cleanup.

The delivered37-check run records PostgreSQL shutdown exit0 and no remaining tracked children. This finding does not retroactively invalidate that successful run.

### 4. P2 — overlapping snapshot destinations can cause recursive copying

Locations: `scripts/office-acceptance/lib.mjs:153-168`, `build-snapshot.mjs:11`, and `run.mjs`'s caller-selected root.

The snapshot helper creates its target before walking the source and does not enforce that the destination is fresh and outside the source. A caller supplying an existing source subdirectory such as `src` can cause the snapshot to recursively ingest its own output, consuming disk until a path or filesystem limit is reached. A `.` destination can instead cause finite self-copying; infinite recursion is not claimed for every overlapping path. Existing output is also merged instead of rejected. Defaults under `D:\tmp` avoid this issue.

Reproduction: ran the actual extracted helper/exclusion code against a five-file synthetic source with bounded filesystem operations and a stubbed junction command. The `.` case completed with six copies; the existing-`src` case reached the100-copy safety bound with repeated `app/src/.../app/src/...` paths. No unsafe copy was attempted against the real application. Evidence: `tmp/codex-review-20261105/snapshot-root-probe-1793840669634/result.json`.

Required correction: canonicalize and validate source/destination, reject source containment and an existing destination, and retain the node_modules-junction boundary. Add a small synthetic filesystem test for in-source/existing targets. Do not reproduce an unsafe self-copy against the real application tree.

## Independent verification

| Check | Independently observed result |
| --- | --- |
| Full fresh disposable PostgreSQL test runner |15 suites,135 tests passed, zero skipped. `tmp/codex-review-20261105/tests.txt`; cluster retained and stopped at `tmp/office-verification-20261105-075755/`. |
| Lint / TypeScript |Both passed; logs under `tmp/codex-review-20261105/`. |
| Fresh isolated Webpack production build |Passed; `D:\tmp\claude-office-build-20261105-005755\app`; build ID `iUDWMP94wxcFdHAPJVCts`. Production output was not replaced. |
| Isolated `next start` HTTP smoke |12/12 checks passed, using the fresh build, a new loopback PostgreSQL cluster on55459 and app port3130. |
| Production-mode authentication in that smoke |Development bypass explicitly false. Synthetic RS256 assertions verified against a local HTTPS JWKS fixture, with its CA trusted only by the isolated child. No real Cloudflare/owner credential was used. |
| Disabled Office without003 |Authenticated dashboard and Office render; status returns503 configuration_required. Invalid assertion401; sales status403 and dashboard excludes the Office panel. |
| Enabled Office without003 |Dashboard reports unavailable instead of zero counts. |
| Enabled Office after003 in the disposable database |Dashboard/status render; a synthetic demo brief saves and its exact task page loads. Eight family records exist with zero active worker leases. |
| Direct finding reproductions |Revision echo comparison, expired-lease presentation and finalizer cleanup false-pass reproduced; `tmp/codex-review-20261105/findings-repro.json`. |
| Evidence provenance |Curated and retained acceptance JSON are byte-identical. All26 diff targets match Claude's successful229-file source manifest. In-memory patch replay against the recovery snapshot reproduces the26 files. |
| Claude's browser run |Reviewed retained37/37 results, underlying harness, logs and persisted family evidence. The browser flow itself was not rerun by Codex; it used nextdev with a synthetic development identity. |

Definitive production-mode smoke report: `tmp/codex-review-20261105/production-smoke-1793840479898/report.json`. Its app, HTTPS issuer and PostgreSQL fixture were stopped. Synthetic tokens stayed in memory and are not written into the report.

Claude's evidence supports eight completed tasks, seven role outputs plus a package, eight matching artifact digests, independent reviews, one acceptance record and blocked live tasks with zero runs. This remains deterministic simulation, not real model work.

## Operational state and remaining limits

Production app/database process IDs remained23404/45704 on3100/54329. The running production build ID remained `HMB4cGweGXqsAnyVbpkcG`. No production environment, migration, Office worker, Cloudflare configuration, startup task, source model or public website was changed.

The isolated `next start` gap is now covered by authenticated HTTP checks, not by real owner-browser acceptance of this unpromoted build. Mobile/assistive-technology coverage, real Cloudflare browser acceptance, long-running worker uptime/reboot, final3D/GPU work and live provider activation remain pending. No production readiness claim follows from the disposable tests.

## Follow-up for Claude

Address findings1–3 and harden finding4 within the existing local-only boundaries. Add regression tests that fail on the current behavior, update the report/diff and retain new evidence. Do not activate Office, migrate production, restart/promote a build or change Codex's reserved 3D/GPU files. Return the corrected working-tree diff for re-review.
