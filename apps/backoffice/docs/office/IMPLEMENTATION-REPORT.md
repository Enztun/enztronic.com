# Enztronic Office implementation and verification

22 October 2026, Asia/Jakarta. Base revision `cf2f97610175800e90eef2f4748e7c4f3506dbd6`; branch `codex/ai-office`, uncommitted reviewable working tree. No push or deployment.

Browser verification updated **4 November 2026, Asia/Jakarta**. The measured graybox now renders in the same in-app browser in normal and low quality, and selecting Sam's scene label selects his profile. The earlier WebGL-unavailable conclusion was caused by the application's effectful canvas fallback, not established missing browser support. Final modeled assets, docking and hardware performance acceptance remain pending; no model has been promoted. See [the preview fix and evidence](WEBGL-PREVIEW-FIX-2026-11-04.md), including remaining nonblocking development diagnostics.

## Delivery status

| Milestone | Status | Evidence and limits |
|---|---|---|
| Specification/configuration integration | Implemented | Protected `/team` is Office; seven distinct profiles, canonical state contracts, immutable revisions, scoped events/reviews/approval evidence. Handoff retained under `office-spec`. |
| Browser visual prototype | Rendered graybox verified; final-model/hardware acceptance pending | Task/list/profile/inbox/filter/notes/decision controls tested. On 4 November, the same in-app browser rendered the Three/Fiber/Drei graybox in normal and low quality, with Sam label/profile selection confirmed. The false fallback was corrected. Final-model, dock animation and measured hardware performance acceptance are not claimed. |
| Final modeled assets | Technical proofs produced; production pending | Original Sam mesh, 22-bone rig, seven clips, three independently reopened native sources and CPU renders now exist privately. Shell/furniture GLBs and editable native sources also exist as separate proofs. Final-byte Khronos/headless checks pass; identity, deformation/docking, provenance acceptance and real GPU performance remain pending. Zero runtime models approved; the 15 approved-path manifest deliverables remain unmet. Other six characters wait for the Sam gate. |
| Durable background worker | Implemented and tested with limited deterministic role | Dedicated Node process, fenced durable leases, checkpoints, bounded retries, heartbeat, schedules, exact budget reservations, unknown-outcome ledger and rotated logs. Limited SQL role completed the closed-browser demo; startup refuses owner/elevated database credentials. Windows lifecycle tests pass. Production supervisor/role setup is prepared, not activated. |
| Verified live agent pilot | Pending selection, implementation and configuration | Recommended disabled OpenAI Luna/Sol profile and USD 10/month / USD 1 family caps are documented in `PROPOSED-LIVE-PILOT.md`; owner selection, account access, dedicated credential, reviewed live adapter and corresponding monthly/family limits remain pending. Live submission records `blocked / configuration_required` with zero runs/artifacts. No paid/live model success is claimed. |
| Production activation | Not performed | Default feature flag off. Additive migration, backup/recovery procedure, role-grant example, hidden startup/supervision scripts and rollback prepared for owner review. No live migration, production build promotion/restart, Access change, send, financial posting or public deployment. |

## Implemented behavior

The ordinary UI is usable without graphics: seven private portraits, agent responsibility/runtime panels, task list and detail, workspace/person/state/date/activity filters, owner inbox, version comparison/download/editing, child tasks and handoffs, bounded owner notes, priority/reassignment, pause/resume/cancel/retry/change requests and explicit expiry renewal. Draft text stays in its selected workspace. Failed/uncertain submissions retain their immutable idempotency payload; stale state must reconcile before mutation. Author reviews and internal owner acceptance are separate.

The server repeats verified Cloudflare/active-admin authorization for page and APIs. Mutations validate same-origin Host/protocol, bounded JSON, strict schemas, current record versions and scope. Private asset delivery uses a generated allowlist, canonical containment, size bounds and current SHA-256 checks. No source model is served publicly. Agent prose and notes cannot mutate trusted execution state or widen permissions.

The additive Office schema is separate from financial audit and invoice outbox. Artifacts/events/acceptance evidence/profile revisions, completed tasks, finalized decisions and terminal runs have database immutability protections. Composite evidence keys bind workspace and exact approval; worker grants exclude owner decisions, business records and policy changes. Parent acceptance validates every covered current child digest/review atomically and records shared acceptance evidence. Owner notes after completion append immutable events without changing accepted task/evidence rows. Changed artifacts supersede dependent approvals; expired decisions can be explicitly renewed while retaining history. The independent reviewer exercised and verified stop/recovery, review aggregation, revision repair, expiry and revoked-schedule cases.

Only the explicitly internal proposal pilot can be submitted. Other-client data is excluded by workspace queries and composite foreign keys; no arbitrary client/file/tool reader is exposed. Command execution is disabled, including untrusted install/build scripts. Registered-path checking rejects actual junction escapes; a worktree is never treated as a sandbox. A future provider/executor remains an additional reviewed implementation/activation step, not a presumed integration.

## Local verification

The **22 October verification run** used Next 16.4.2 / React 19.2.7 / Vitest 4.1.12 and PostgreSQL 17 in a separately initialized loopback-only cluster on port 55439. Production connection values were not used. Build output stayed in `.next-office-check`; development output in `.next-office-dev`, port 3118. The existing `.next` production build was not overwritten. The check results below are historical unless explicitly dated otherwise. On **4 November**, focused ESLint, full typecheck and 17 scene-layout/static-batching tests passed. The isolated production build passed with Next's supported `--webpack` builder. The default Turbopack attempts encountered a restricted font download and then a local CSS-transform subprocess failure; no source or package change was made to work around them. See the dated preview-fix report for current evidence and limits.

| Check | Observed result |
|---|---|
| `npm test` with all three explicit disposable database variables | **79/79 passed**, ten suites; no skipped tests. Final preservation uses the NEW `enztronic_office_release_access_test`; the current continuation preview and prior preview database remain intact. |
| `npm run test:office-assets` | **6/6 passed**, including deliberate obstacle/route mutations and a real Windows junction escape. |
| `npm run lint` and `npm run typecheck` | Passed. Generated verification builds are excluded from lint. |
| `OFFICE_BUILD_DIR=.next-office-check npm run build` | Passed; final build has no whole-project asset-tracing warning. |
| Worker `npm run typecheck` / `npm run test:lifecycle` | Passed; **8/8 lifecycle tests**, including limited login, unsafe role/grant refusal, supervisor EOF, bounded logs, restart ownership and generated-database cleanup. No startup task/service registered. Worker dependency audit reports zero vulnerabilities. |
| Independent fresh-database review | Seven scenarios passed: honest normal workflow, repeated parent stop cycles, review aggregation, expiry renewal, child revision repair, exhausted-review retry and revoked-schedule isolation. |
| Production dependency audit | **0 vulnerabilities**. Full audit retains five high development-only findings in eslint-config-next → fast-glob → micromatch → braces; offered forced downgrade to Next14 tooling was not used. |
| Owner/finance preservation | Disposable migration test retained verified owner identity, serialized last-admin protection, client ownership/visibility, invoice numbering and immutable snapshots, invoice outbox/audit counts, payment commission and reversal calculations. Existing migrations001/002 and financial services are unchanged. |
| Geometry/assets | 41/41 reachable planning nodes, 43 edges, 36 obstacle boxes and 15 docks. Separate Sam export: 11,299 triangles, three materials, one skin, 22 bones, seven clips; normalized weights, independent clone skeletons, sampled floor/root checks pass, Khronos zero errors/warnings. Environment GLBs also have zero validator errors/warnings and actual static mesh envelope checks. Static import batching reduces 127 material primitives to 13 meshes while preserving 71,372 triangles and placed bounds. These are source checks; no animated docking or GPU acceptance is implied. |
| Browser | Historical desktop1440×1000/narrow390×844 checks and limited-worker closed-browser/acceptance/note evidence retained. On 4 November, the same in-app browser rendered the graybox in normal and low quality and selected Sam through his scene label. Remaining development diagnostics are recorded separately. Independent target-device GPU/frame-time and final-model acceptance remain pending. |
| Backup/recovery | New custom-format dump, archive-list validation and restore to a NEW disposable database: exact hashes/counts match across **30 stable tables** including human/client/financial history and Office acceptance. The deliberately live volatile worker-heartbeat table is excluded. Earlier 18-table proof retained. **No production backup is claimed.** |

Current raw test/build output is retained locally in `tmp/office-tests-continuation.txt` and `tmp/office-build-continuation.txt`; earlier diagnostics remain alongside them. These ignored files are not release dependencies. The repeatable isolated fixture runner is `scripts/test-office-local.ps1` and does not default to production DATABASE_URL. Asset reproduction/check commands and technical limits are recorded in `sam-proof.md`, `environment-proof.md` and `../office-assets.md`.

## Actual deterministic browser-to-worker proof

`demo-browser-proof.json` retains the initial closed-browser proof. `continuation-browser-worker-proof.json` records the fresh family produced by the dedicated limited SQL login. Browser closed at **2026-10-21T18:22:48.648Z**; the worker started at **18:24:23.472Z**, committed all 16 pipeline steps and the browser reopened afterward. The fresh family has **eight completed tasks, 17 run records, eight artifacts, eight passed structural reviews** and one shared exact acceptance, plus an authenticated append-only owner note. These are deterministic simulated drafts and structural checks; they are not professional/model-generated work or tested website implementation.

The live configuration fixture independently saved a blocked task with **zero runs and zero artifacts**. Usage/cost remains Unavailable in the UI. No provider credentials were reused from the website, and no paid model or external action was executed.

Evidence:

- `demo-browser-proof.json`: final closed-browser, parent/child acceptance and unconfigured-live checks.
- `disposable-backup-check.json`: archive SHA-256 and 18-table restoration comparison.
- `continuation-browser-worker-proof.json`, `continuation-backup-check.json`: limited-role family/decision/note and 30-table restoration comparison.
- `WORKER-DATABASE-BOUNDARY.md`, `WORKER-LIFECYCLE.md`: capability guards and actual Windows process tests.
- `sam-proof.md`, `environment-proof.md`, `MODELING-TOOL-PROVENANCE.json`: actual private editable assets, checks, CPU renders and verified portable tool source.
- `STATIC-MODEL-BATCHING.md`: actual-file batching counts, transform/sorting/cache cleanup regressions and GPU limits.
- [WEBGL-PREVIEW-FIX-2026-11-04.md](WEBGL-PREVIEW-FIX-2026-11-04.md): corrected false fallback, actual graybox browser checks and remaining development diagnostics.
- `asset-status.json` and `../office-assets.md`: exact absent asset paths and remaining modeling/browser gates.
- `screenshots/verified-office.jpg`, `verified-tasks.jpg`, `exact-revision-decision.jpg`, `desktop-fallback.jpg`, `mobile-list.jpg`, `live-configuration-required.jpg`.
- `screenshots/continuation-completed.png`: fresh synthetic completed-family preview and successful post-acceptance owner-note result.

## Preserved boundaries and remaining inputs

`employee/` originals/archive remain untouched. Public website source, root dependencies, existing financial services, invoice delivery, shared tunnel and production database/services were not changed. Root `.vercelignore` only adds exclusion of the new private worker. Human access remains available under `/settings/access`; owner identity is not an AI persona. Last-admin/self-removal protections are now transactional server rules.

The local fixture preview remains at `http://127.0.0.1:3118/team` with a separately launched deterministic worker and disposable database. Its local development-only authentication uses a synthetic `Owner fixture`; this does not change production authentication. Production defaults to Office disabled and rejects the existing development bypass. This preview requires the local PC/processes to remain available and is not a deployment.

Dependent work needs: approved modeled/native/rig/animation assets with provenance; target-device hardware/GPU, docking and final-model acceptance; deliberately selected Office provider/model adapter and explicit price/spend/runtime limits; authorized sources and client/project registration where needed; approved host identity/availability and production activation window. Actual production owner counts, login, backups, service role permissions and deployment checks remain pending.

Use `ACTIVATION-AND-ROLLBACK.md` and `apps/office-worker/README.md` before that window. Restore a financial backup only under a separate recovery decision; ordinary rollback preserves the additive Office evidence tables.
