# Office correction re-review

6 November 2026, Asia/Jakarta. Reviewed Claude's `CLAUDE-REVIEW-FIXES-REPORT-2026-11-05.md`, the17-file correction patch, current source, regression tests and retained evidence. Application/test-harness source was not changed during this review.

## Decision

The four findings from `CODEX-INDEPENDENT-REVIEW-2026-11-05.md` are closed within the reviewed scope. One new P2 navigation regression introduced by the correction pass still needs a fix before workstream sign-off. A separate P3 history-label wording issue is nonblocking.

| Original finding | Re-review result |
| --- | --- |
| Exact revision links discarded |Closed. Artifact identity participates in selection, canonical URLs, echo comparison and effect dependencies; controlled detail refuses substitution for unavailable revisions. Retained real-view checks cover reload/refresh/same-route selection. |
| Execution indicators outlive lease |Closed. Database-relative lease remaining time is aged from monotonic request-start time, with expiry timers and visibility/network/page-resume updates. Current role/task execution claims expire without a successful poll. |
| Acceptance passes after cleanup failure |Closed. Shared ownership/finalization registers resources early, cleans partial initialization, awaits owned exits/ports, preserves failures and fails on unresolved resources. Foreign listeners are diagnostic only. |
| Overlapping snapshot destinations |Closed. Canonical existing-ancestor resolution, Windows boundary/case handling, freshness and manifest checks occur before copy; links are not traversed and the dependency junction is verified. |

## P2 — a delayed save for task A changes task B's selected revision

Locations: `src/components/office/OfficeTaskDetail.tsx:69-73` and `:207`; `src/components/office/OfficeView.tsx:361-362`.

The new `saveRevision()` calls `onRevised()` after awaiting `mutate()`. Its callback calls the parent's unscoped `onSelectArtifact(null)`. That parent setter changes whichever task is selected when the request completes, rather than the task that originated the save.

Task navigation and revision selection remain available while the request is pending. Therefore:

1. Start saving a revision of taskA and hold its response.
2. Open taskB and explicitly select its historical revisionB/R1.
3. Release taskA's successful save response.
4. TaskB remains selected, but its artifact ID is cleared, its detail follows currentB/R2, and URL synchronization removes the requested revision.

The write is still scoped to taskA; this is an incorrect UI selection change, not a cross-task database write. It undermines the exact-revision behavior this correction pass establishes.

### Independent reproduction

`tmp/codex-rereview-20261106/regression-repro.mjs` extracts and executes the actual `saveRevision()`, its `onRevised` callback and the actual `selectArtifact()` setter from the source. With a deferred mutation promise:

- request task: `task-A`;
- selected task/revision while pending: `task-B` / `B-R1`;
- after taskA success: selected task remains `task-B`, artifact becomes null;
- `defectReproduced:true`.

Evidence: `tmp/codex-rereview-20261106/regression-repro.json`. This is a controller/callback-level reproduction, not a claimed browser rerun. It uses synthetic values and no database or service.

### Required correction and acceptance

Bind completion to the originating task/workspace and relevant selection identity. Ignore the follow-current selection update if the owner has navigated to another task or made a later explicit selection. Preserve the successful save and its evidence; do not discard or repeat the write merely because navigation occurred.

Add a delayed-save real-view or component regression: taskA save pending → taskB historical revision selected → taskA success → taskB ID, revision content, dropdown and URL remain unchanged. Returning to taskA should show its saved revision. Also preserve the closed-detail state if the owner closed it before completion. Prefer guarding the completion over freezing all navigation during an uncertain request.

## P3 — latest-run history has ambiguous Running wording

`OfficeTaskDetail.tsx:50` renders `stateLabel(latest.state)` directly. For a crashed run before recovery, its leased-run row correctly says `run record still open`, while its latest-worker-run row still says `Running` for the same run ID. The historical heading and timestamp reduce the ambiguity, so this does not reopen the core lease-aging finding.

Independent rendering of the actual `ExecutionEvidence` component with expired synthetic evidence confirmed `Lease expired`, `run record still open` and `Running` together. HTML retained at `tmp/codex-rereview-20261106/expired-run-evidence.html`.

Suggested cleanup: prefix a history value with `Recorded state:` or reuse aged wording when the latest run is the currently displayed expired leased run. Do not change immutable historical records.

## Independent checks

| Check | Observed result |
| --- | --- |
| Fresh disposable PostgreSQL runner |17 files,167 tests passed, zero skipped. Cluster `tmp/office-verification-20261106-004632/` stopped. Log onC: `C:\Users\hoyec\AppData\Local\Temp\enztronic-codex-review-20261106\tests.txt`. |
| Lint / TypeScript |Both passed; logs under the sameC: review root. |
| Fresh isolated Webpack build |Passed. Build `gZEt5ILHFFFE9j3wPRBZq`, snapshot `D:\tmp\codex-rereview-20261106\claude-office-build-20261105-174935\app`. No production build replacement. |
| Isolated next start HTTP smoke |15/15 passed against the fresh build, development bypass false, synthetic signed assertions and a local HTTPS issuer. New PostgreSQL data/logs were placed onC:. |
| Smoke cleanup |Database/app/issuer ports55459/3130/43459 confirmed closed. Report `C:\Users\hoyec\AppData\Local\Temp\enztronic-codex-review-20261106\production-smoke-1793901057336\report.json`. |
| New navigation regression |Reproduced using actual source callbacks and a deferred promise, with no data/service changes. |
| Patch provenance |SHA256 `3701be0dfbe6c5fde73d213e1d974b98eed7154cfbe9627422a1c217bae0efd6`; all25 captured baseline hashes match the previously reviewed build; in-memory patch replay reproduces all17 current targets; all17 match the submitted final257-file build manifest. |
| Retained Claude evidence |Curated reports/manifests match retained originals:57/57 browser checks, functional and cleanup passed, no unresolved resources; cleanup self-test3/3; production smoke15/15. Codex did not rerun the57-check browser flow or real-resource self-test. |

The first fresh-build attempt placed source onC: with a dependency junction intoD:. Next.js Webpack rejected cross-drive client-entry paths (`./D:/.../next/dist/client/...`). This was an isolation-layout failure, not a product regression. A single bounded same-drive snapshot onD: then built successfully; its logs remain onC:. No dependency or application configuration was changed to work around it.

## Production, disk and separate follow-ups

Production remained on3100/PID23404 and54329/PID45704, build `HMB4cGweGXqsAnyVbpkcG`. A fresh production environment summary confirmed Office disabled and development bypass false. No production migration, worker, service/tunnel/startup change, provider call, financial action or build promotion occurred.

D: free space measured7.45GB before review and7.08GB afterward. New large build output was limited to one successful same-drive snapshot; smoke fixtures/evidence were placed onC:. Nothing was deleted. Retention of earlier snapshots, disposable clusters and rollback evidence remains a separate owner decision; the production PostgreSQL data directory must be excluded from any such cleanup.

The documented browser-wall-clock approval-expiry behavior remains a separate follow-up. It was not introduced by these four corrections and was not silently added as a new blocking requirement. Conservative soft-navigation lease expiry may briefly report awaiting fresh status; it does not falsely claim current execution.

Actual owner-browser acceptance of the unpromoted corrected UI, mobile/assistive-technology coverage, worker uptime/reboot, final3D/GPU, real-provider work and production activation remain pending. Passing local checks does not authorize them.

## Return to Claude

Fix the P2 delayed-save selection regression and add its targeted regression evidence; include the P3 label cleanup if practical. Keep the original four fixes intact. Return a narrow correction diff/report for re-review, preserving all local-only boundaries. Do not activate Office, migrate production, replace the running build or touch reserved scene/GPU work.
