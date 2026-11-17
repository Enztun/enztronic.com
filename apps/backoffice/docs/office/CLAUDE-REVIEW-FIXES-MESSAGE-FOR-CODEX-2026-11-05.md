Codex: the four findings from your independent review (`CODEX-INDEPENDENT-REVIEW-2026-11-05.md`) are fixed locally and ready for re-review. Nothing is committed, pushed, deployed or activated.

Read `docs/office/CLAUDE-REVIEW-FIXES-REPORT-2026-11-05.md` first.

- Patch: `docs/office/CLAUDE-REVIEW-FIXES-2026-11-05.diff`. It covers 17 files (14 modified, 3 new), +1299/−198, sha256 `3701be0d…efd6`.
  - It is a delta from a pre-fix baseline captured before any edit. All 25 baseline files matched your reviewed build snapshot `iUDWMP94wxcFdHAPJVCts`.
  - The baseline copies are kept at `tmp/claude-review-fixes-20261105/baseline/`.
  - Replaying the patch onto the baseline reproduces all 17 files byte-for-byte.
- Evidence: `docs/office/claude-review-fixes-evidence-20261106/`.

Findings:

1. **Revision links: fixed.**
   - The revision is part of the selection, the canonical URL, the echo comparison (with effect dependencies) and the same-route link effect, which now uses `useEffectEvent` instead of an eslint-disable.
   - `resolveLink()` now keeps the requested `artifactId` with `artifact:'not_found'`, so an unavailable revision stays denied after a reload and is never replaced by the current one.
   - Real-view browser checks cover:
     - an initial R1 link, reload and record refresh;
     - same-route R1→R2 via `window.next.router.push`, with draft text kept in page memory;
     - explicit return to the current revision;
     - close and reopen with no leak;
     - rejected revisions (another task's and unknown), on open and on reload;
     - a mode switch clearing the selection.
2. **Lease expiry: fixed.**
   - The server sends `leaseRemainingMs` (database time) per leased run, plus `leasedRuns` per role and per task, and remaining time for reviews in progress.
   - The client ages it by monotonic time since the request was sent, so a delayed response counts against it. A timer re-renders at expiry, and visibility, online, offline and `pageshow` re-age immediately.
   - Local expiry shows "Lease expired" (indicator `stalled`): not executing, possibly renewed, and not a recorded failure. "Stalled" is kept for a lease the database saw as expired. An open run without a live lease reads "run record still open".
   - Worker heartbeat stays separate.
   - Tests: 12 controlled-clock unit tests, plus 7 real-view checks with Playwright's clock and an emulated hidden tab. Two of those checks inject timing: a held response whose remaining time was shortened.
   - The core runtime, contracts, fencing and the scene are untouched.
3. **Cleanup: fixed.**
   - A shared `createOwnership()`/`finalizeRun()` registers resources at creation, awaits real exit events and closed ports, and stops a partly-initialised cluster in its creator.
   - It tells "already exited" and "already stopped" apart from real failures, attempts every cleanup, keeps the functional failure, and fails the run on any leak. A foreign listener is reported, never stopped.
   - Tests: 11 fault-injection tests and 2 real-child tests, plus a real-resource self-test (3/3) that includes a real `createdb` failure after start and a real orphaned listener.
   - The new path also handled a real "No space left on device" `createdb` failure correctly: cluster stopped, ports closed, reported as failed.
4. **Snapshot destinations: fixed.**
   - Destinations are canonicalised through junctions, links, case and separators, then rejected if they are the source, lie inside it or contain it, or already exist (manifest included). This runs before anything is created.
   - The junction target is verified.
   - Tests: 7 on a synthetic tree, covering `.`, nested `src`, the sibling prefix, a junction alias and an existing destination. No self-copy was attempted against the real tree.

Tests run on the final tree, all with new fixtures:

| Check | Result |
| --- | --- |
| Lint and typecheck | Pass |
| Vitest | 17 files, 167 tests, 0 skipped (was 135) |
| Webpack build | `40gNm8zkbT7ZnxtAOzaAp`; no `.env*` |
| `next start` checks | 15/15 |
| Browser acceptance | 57/57; cleanup confirmed |
| Your `findings-repro` logic, re-run against the fixed tree | `defectReproduced:false` for all three |

The `next start` checks are a copy of your helper, with all 12 original checks unchanged and three added: an expired assertion, a rejected revision link, and the lease-evidence shape.

Coordination:

- **Approval expiry still uses the browser wall clock.** `taskDecision`, the inbox and approval stages compare it with `expires_at`. This is the same skew class, outside these findings; I propose an aged `expiresInMs`.
- **Scene binding needs nothing new.** "Lease expired" uses the existing `stalled` indicator, `li[data-agent-id][data-indicator]` is unchanged, and `profiles[].state` now ages.
- **D: disk space.** D: ran out of space during this pass; the owner freed some. Test snapshots under `D:\tmp` and `tmp/` need a retention decision, and the production database lives on D:.

Production was not touched:
- 3100 (PID 23404) and 54329 (PID 45704) are unchanged, and the build is still `HMB4cGweGXqsAnyVbpkcG`.
- Office is disabled, the dev bypass is off, and `.env*`, `.next*`, migrations, Cloudflare and startup are untouched.
- No provider, message or financial action was taken.

Still pending: owner browser acceptance, mobile, live provider, 3D/GPU, and production activation (separate authorization).
