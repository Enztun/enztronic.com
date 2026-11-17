# Final workflow correction and release-candidate acceptance

6 November 2026, Asia/Jakarta. The owner explicitly instructed Codex to finish the remaining correction and accepted the release candidate in chat. That acceptance is recorded here; it is not a claim of a new signed-in production browser test.

## Result

The delayed revision-save selection regression is fixed and verified. The four earlier independent-review findings remain closed. The nonblocking latest-run history wording is also clarified. No blocking finding remains in this correction's reviewed scope.

The workflow/dashboard release candidate is accepted by the owner and validated locally. Production promotion, migration003 and Office worker activation remain separate operational steps.

## What changed

| File | Change |
| --- | --- |
| `src/components/office/office-selection.ts` | A small typed callback factory captures the immutable originating selection. A successful save follows the newly current revision only if that exact selection is still current. |
| `src/components/office/OfficeView.tsx` | Supplies the bound `onRevisionSaved` callback separately from immediate dropdown selection. |
| `src/components/office/OfficeTaskDetail.tsx` | Forwards that captured completion callback through the asynchronous revision save. Latest-run history explicitly says `Recorded state:`. |
| `src/components/office/office-selection.test.ts` | Nine deferred-save regression cases for unchanged selection, polling, taskB/R1, closing, close/reopen, A→B→A, later revision choice, workspace changes and absent origin. |
| `scripts/office-acceptance/run.mjs` | One added actual-view delayed-response check, preserving all57 earlier checks. |

The selection object is an in-memory navigation/revision token. Polling updates records without replacing it; owner navigation creates a new object. Functional React state updates compare against the captured object, so an older completion cannot replace a newer choice even when the task IDs are identical. No persisted identifier, new dependency, database/API contract, global navigation lock or runtime state-machine change was needed.

React component review checked immutable state, functional updates, callback capture across await, and separation of immediate interactions from asynchronous completion. An independent source reviewer found no blocking issue in the final fix.

## Regression evidence

### Actual callbacks

The earlier source-level reproduction was rerun through the actual updated callback wiring. A save request for taskA completes after taskB/R1 is selected; taskB and B/R1 remain selected. `defectReproduced:false`. The actual execution-evidence renderer also confirms the history value is explicitly qualified as recorded state.

Evidence: `codex-final-correction-evidence-20261106/callback-regression.json`.

### Actual browser view

The new acceptance case uses a new synthetic family and two reviewed specialist tasks. It gives taskB a currentR2, starts taskA's revision save through the UI, lets the server commit, and holds only its successful response. While that response is held, the browser closes A, opens B through the task list and selects B/R1. After the response is released and React/URL effects commit, it asserts:

- B's task ID, selected dropdown revision, artifact content, historical-revision notice and complete URL are unchanged;
- B/R2 is not substituted;
- A's new revision remains persisted, current and owner-authored.

The response gate is released and interception removed in `finally`. The full run also checks the original save uncertainty, worker recovery/fencing, seven-role review/package acceptance, revision links, sales denial and unchanged12 synthetic non-Office business tables.

Screenshot: [taskB remains on historicalR1 after A saves](codex-final-correction-evidence-20261106/delayed-save-preserves-other-task-r1.png).

## Validation

| Check | Result |
| --- | --- |
| Focused new regression suite |9/9 passed. |
| Fresh disposable PostgreSQL full suite |18 files,176 tests passed, zero skipped. |
| Lint / TypeScript |Passed. |
| Fresh isolated Webpack production build |Passed; build ID `H2wsHC_p8niGqIW1qcF_K`. |
| Production-mode HTTP smoke |15/15 passed against that build, production authentication bypass false, synthetic RS256 assertions/local HTTPS JWKS, new fixture database. |
| Full browser acceptance |58/58 passed, including the delayed-save case. |
| Acceptance cleanup |Passed; no unresolved resources. Browser, app, worker and PostgreSQL fixtures stopped. |
| Patch replay |All5 changed/new source files reproduced byte-for-byte; each hash also matches the fresh build snapshot manifest. |

Browser acceptance ran the existing Next development-mode fixture with a synthetic identity. The separate production-mode smoke used `next start` with signed synthetic assertions and bypass disabled. Neither used a real owner token or production database.

The browser harness was derived only to direct its evidence/PostgreSQL directory toC: and resolve its helper import from that temporary location. Its checks and fixture isolation are the actual checked-in script, including the new case. Build/acceptance source snapshots stayed onD: to avoid the previously observed cross-drive Next.js dependency-junction problem.

Curated evidence is in `docs/office/codex-final-correction-evidence-20261106/`. Full logs are under `C:\Users\hoyec\AppData\Local\Temp\enztronic-codex-final-correction-20261106\`; the browser run is `acceptance-20261105-204249`, and its filename stamp is UTC. Full test cluster: `tmp/office-verification-20261106-033937/` (stopped).

The fresh build snapshot is `D:\tmp\codex-final-correction-20261106\claude-office-build-20261105-204259\app`. It was not promoted.

## Reviewable delta

Patch: `docs/office/CODEX-FINAL-CORRECTION-2026-11-06.diff`.

SHA256: `6cf64b96a1e878983a7130bd4ffb87bbbdc12299d57a3800df9f2fc18b2eb52c`.

The delta starts from the pre-correction current working tree, not cleanHEAD. Baseline copies and replay evidence are retained under `tmp/codex-final-correction-20261106/`; patch replay was performed in a new temporary directory onC:. Existing Claude/review reports, patches and evidence remain unchanged.

## Production state and authority

At final verification, production remained on3100/PID23404 and54329/PID45704, build `HMB4cGweGXqsAnyVbpkcG`. Office remained disabled and development authentication bypass false. No production database query/mutation, migration, worker activation, environment/tunnel/startup change, promotion, commit/push, provider call, message or financial action occurred in this correction.

D: had6.52GB free at the final port/build check. Nothing was deleted. Test/backup retention and sufficient production disk headroom still need an explicit plan; production database files and the working rollback release must be preserved.

## What remains before an operational production Office

1. **Production preparation:** capture fresh protected business/access invariants, create a custom-format production backup, validate it and restore it into a new disposable database. Plan disk retention and keep the current working release available for rollback.
2. **Worker operations:** provision a dedicated least-privilege worker role/configuration, protected secrets/logs, reviewed startup/supervision and an availability target. The current PC arrangement depends on the host staying logged in, awake and online.
3. **Authorized activation window:** apply additive003 with the checksum-aware runner, promote the validated release, start the dedicated worker and enable Office. Do not change the shared tunnel or public website.
4. **Production acceptance:** verify the real signed-in owner and denied paths, exact links, one simulated brief through all seven roles/reviews/package acceptance, dashboard evidence and unchanged business records. The owner has already accepted this release candidate; this is operational verification after activation.

That activates the deterministic simulated workflow. Actual AI work additionally needs the reviewed live provider adapter, dedicated connection and enforced spending/token/time/revision limits, followed by one bounded real proposal. Coding, messaging, payments and deployment capabilities remain separately scoped.

Final3D characters/environment, state-driven scene badges and Radeon/High-mode/device performance acceptance remain the parallel visual workstream. Mobile/assistive-technology coverage and the known browser-wall-clock approval-expiry follow-up remain disclosed; server-side approval checks stay authoritative.
