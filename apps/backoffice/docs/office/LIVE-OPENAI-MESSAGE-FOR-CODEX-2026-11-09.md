Codex: at the owner's request I wired the Office to OpenAI, following PROPOSED-LIVE-PILOT.md. It is built and verified locally with a scripted provider and ready for your review. It is not activated: no OpenAI request has been made, no key is configured anywhere, and nothing is committed, deployed or migrated. This touches the runtime and worker you own, so please review before any activation.

Read `docs/office/LIVE-OPENAI-PILOT-2026-11-09.md` first.

- **Patch:** `docs/office/LIVE-OPENAI-2026-11-09.diff`
  - 34 files (23 modified, 11 new), +1851/−111.
  - SHA-256 `bfa24acf062ba8fb7b2f3d039c872a706e38c9aba0eb3395ace226fafd7c9afa`.
  - It is a delta from a baseline captured before any edit (`tmp/live-openai-20261109/baseline/`, hashes in `baseline-sha256.txt`). Replay onto the baseline reproduces all 34 files byte-for-byte.
- **Evidence:** `docs/office/live-openai-evidence-20261109/`.

**Design:**
- Each worker step makes one Responses request: `store:false`, strict `json_schema`, Standard tier, low effort, no tools.
- The client uses raw `fetch` with no SDK and no automatic retry.
- Luna handles drafts and child reviews; Sol handles Adrian's package and Nadia's package review. That is 16 requests per first attempt.
- Prompts quote the brief and artifacts as untrusted data. The manifest is attached by the system, and structural review checks run before any model request.

**Spend:**
- Input is counted exactly (`/v1/responses/input_tokens`, at most 12,000 tokens).
- The worst case is reserved: input at the 30-minute cache-write rate, plus the full output allowance including reasoning, plus a 10% regional margin.
- Four owner-only limits are checked in one transaction under the Office lock: request, proposal family, UTC month and lifetime. They live in migration 004 with live off and all limits at zero by default.
- Dispatched runs are marked before sending.
- Rejected 4xx requests release the reservation. Timeouts, 5xx and unreadable responses keep the full reservation as spend.
- Lease recovery charges any dispatched, unsettled run at its full reservation. A late result is fenced.
- `settleKnownDemoBudget` became `settleOpenReservation`, so a dispatched run is never released as free.

**Runtime:**
- `execute` now splits into the demo path and `executeLive`, sharing `commitStep` (unchanged lease, scope, review and approval checks).
- `claim` filters by the modes the worker supports, and live submission delegates like demo.
- `fail` accepts exhausted, retry-after and a blocked reason.
- New owner action `redraft`: at most two per task, prompted with findings and the owner's note.
- Live resume and retry are allowed once live is configured.
- `health` reports the live provider from heartbeats in database time; the demo disclosure text is unchanged.

**Worker:**
- Optional `OFFICE_LIVE_WORKER` and `OFFICE_OPENAI_*` settings, validated before database access. The key is deleted from the environment and never logged.
- The preflight now refuses a role that can change the live switch or limits.
- The supervisor allowlist accepts the OpenAI keys only with the live switch.
- The packaging list adds 3 modules: the runtime is now 1,299 files; smoke (network forbidden) and packaged typecheck pass.
- The `started` log keeps `simulated` for demo-only workers.

**Owner helpers:**
- `apps/office-worker/live-activation.example.sql` sets the limits and switch.
- `apps/office-worker/set-office-openai-key.ps1` writes the key through a hidden prompt and `File.Replace`, keeps the file's access rules, and supports `-Remove`. It is tested on temporary files.

**UI and read model:**
- Execution capability (provider, models, budget) and per-task metering.
- Live role and task indicators are evidence-based once live is available, and say exactly why when it isn't.
- Task detail shows request costs and a "Revise with AI" button.
- The dashboard and status panel show conservative usage against the limits.

**Tests, all on new fixtures:**

| Check | Result |
| --- | --- |
| Lint and typecheck | Pass |
| Vitest | 23 files, 226 tests, 0 skipped (live: 15 unit, 10 database) |
| Worker suites | Lifecycle 10/10 (real PostgreSQL), packaging 7/7, activation 10/10, installer 7/7 |
| Build | `hq5hlbwiIdVA39CZ_S1Ae`; no OpenAI client in browser or server bundles |
| Eval harness dry run | 8 briefs; its language and conflict checks discriminate |

**Points for your judgement:**
- **Unknown outcomes.** Possibly-billed outcomes keep the full reservation and allow bounded retry, rather than blocking for manual reconciliation. Model calls have no external effect beyond cost, and the limits stay hard.
- **Count endpoint billing.** It is undocumented and assumed free; confirm it on the first live run.
- **Proposal clock.** The "10 minutes per proposal attempt" is not enforced as a clock.
- **Activation order.** Migration 004 must be applied before any build or worker from this source starts.

Production was not touched: 3100 and 54329 have the same PIDs, and the build is still `7VQBHlMCw4uRSPfvo5f5T`.

Separately, the owner approved a disk cleanup (see `MAINTENANCE_LOGS/disk_cleanup_20261108.md`). It removed the npm cache, old Office test snapshots, stopped fixture clusters, MeteoraLP's `node_modules`, and the unused `apps/meteora-lp` copy. Your accepted candidate `D:\tmp\codex-final-correction-20261106` and every rollback release were kept.
