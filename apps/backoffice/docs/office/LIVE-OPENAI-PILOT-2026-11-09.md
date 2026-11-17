# Live OpenAI pilot: implementation and activation

9 November 2026, Asia/Jakarta. **Built and verified locally against a scripted provider; not activated.** No OpenAI request has been made, no key is configured anywhere, and production is unchanged (Office build `7VQBHlMCw4uRSPfvo5f5T`, worker, database and configuration untouched). Activation needs the owner's key and a separately approved window.

The design follows the owner-reviewed [proposed live pilot](PROPOSED-LIVE-PILOT.md): OpenAI Responses API, GPT-6 Luna for role drafts and routine reviews, GPT-6.1 Sol for Adrian's package and its final review, low reasoning, and hard spending limits enforced before every request.

## What a live proposal does

A live brief submitted in the *Internal proposal pilot* workspace follows the same durable workflow as the demonstration:
1. Seven role drafts.
2. Seven independent reviews.
3. Adrian's package.
4. Nadia's package review.
5. The owner's decision.

Each worker step is exactly one model request, so a first attempt is 16 requests. Nothing is sent outside the Office. Accepting a package authorizes no external effect.

- **Prompts.** Each role's instructions come from its versioned database profile and the canonical presets (working rule, review restriction, response sections). The owner's brief, earlier drafts and reviewer notes are passed as quoted, untrusted data with closing-tag escaping. The rules forbid invented prices, rates, dates, integrations, credentials and approvals, and missing facts must be listed as unknowns. Output is written in the brief's language.
- **Structured output.** Each role has a strict JSON schema whose sections are its canonical response sections, plus summary, assumptions, unknowns and short source quotes. The app validates and bounds the JSON and renders it to Markdown. Artifacts are shown as escaped text, never as HTML. The package's component manifest is attached by the system from database rows; the model cannot change it.
- **Reviews.** The structural checks (exact digest, reviewer ≠ author) run first. If they fail, no request is made. The model reviews against five written criteria. Its "passed" verdict cannot stand if its own checks are `not_met` or it reports an `error` finding.
- **Reasoning.** Effort is `low` on both models. Reasoning tokens count inside each request's output allowance and are billed as output. No reasoning text or summary is requested, stored or shown.
- **Provider state.** Requests are stateless (`store: false`, no tools, no background mode, explicit Standard tier). Memory stays in the Office database.
- **Owner actions.** Live resume and retry work once live is available. **Revise with AI** asks the role to redraft from the latest reviewer findings and the owner's note: at most two revisions per task, each metered against the proposal limit. Owner-written revisions still work and need no model request.

## Spending controls

Limits live in `backoffice.office_budget` (migration 004). They default to zero with live switched off. Only the owner can change them: the worker role has no privilege on these columns, and its startup preflight refuses a role that does.

| Limit (pilot value) | Enforced |
| --- | --- |
| Per request: USD 0.15 | Before dispatch, on the worst-case reservation |
| Per proposal (package, children, reviews, retries, revisions): USD 1 | Settled charges plus open reservations |
| Per UTC calendar month: USD 10 | Same |
| Overall: USD 10 | Reserved plus spent |
| Live switch | Off → live requests are recorded as blocked |
| One live proposal at a time; at most 32 requests per proposal | Submission and reservation |

How each request is metered:
1. **Count.** Input is counted exactly with `POST /v1/responses/input_tokens`. More than 12,000 tokens is refused before any spend.
2. **Reserve.** The worst case is reserved:
   - counted input (plus 2% and 64 tokens) at the 30-minute cache-write rate;
   - plus the whole output allowance at the output rate (6,000 tokens for drafts and the package, 3,000 for reviews);
   - plus a 10% margin for the regional-processing premium.
   
   All four limits are checked in one transaction under the Office lock, and the run is marked dispatched.
3. **Send.** Exactly one `POST /v1/responses` is made with a 90-second timeout. Nothing retries automatically: the client uses `fetch` directly, not an SDK.
4. **Settle.** Usage is priced from the reported uncached, cached, 30-minute and 12-hour cache-write and output tokens, multiplied by the reported service tier. A charge is never recorded above its reservation; if usage prices higher, the task is blocked for reconciliation.

| Outcome | Charge | Next |
| --- | --- | --- |
| Completed, usable | Reported usage | Commit the draft or review under the lease |
| Refusal, truncation, failed status, invalid JSON | Reported usage | Blocked for the owner (retry or AI revision), no automatic retry |
| 4xx rejected (not processed) | Released | 401/403/billing → blocked as `configuration_required`; 429 → bounded retry after `Retry-After`; others → blocked |
| Connection refused before sending | Released | Bounded retry |
| Timeout, 5xx, reset or unreadable response | **Full reservation**, since it may have been billed | Bounded retry, each attempt reserved anew |
| Worker lost its lease mid-request | Full reservation, via lease recovery | Late result fenced; nothing double-counted |
| Pause or cancel during a request | Reported usage | Result discarded; task paused or cancelled |

Prices used, checked 9 November 2026 on developers.openai.com (USD per 1M tokens, Standard, at most 272K input tokens):

| Model | Input | Cached input | 30-min cache write | 12-hour cache write | Output |
| --- | --- | --- | --- | --- | --- |
| `gpt-6-luna` | 0.10 | 0.01 | 0.125 | 0.25 | 0.50 |
| `gpt-6.1-sol` | 2.00 | 0.10 | 2.50 | 5.00 | 10.00 |

An unpriced model is refused at worker startup. Worst-case reservations at the maximum sizes:

| Request | Worst-case reservation |
| --- | --- |
| Luna draft | USD 0.0050 |
| Luna review | USD 0.0033 |
| Sol package | USD 0.0990 |
| Sol package review | USD 0.0660 |
| Whole first attempt | USD 0.22 |

Real requests should cost a fraction of that. The token-count endpoint's billing is not documented; it is treated as free and must be confirmed against the OpenAI usage page on the first live run.

## What the owner sees

- **Office status panel:** live provider and models, conservative usage this month against the limits, and the exact reason live is not running (no provider, switched off, or limits unset).
- **Dashboard:** the same live badges and usage line.
- **Live role and task indicators:** evidence-based, like demonstration ones, once live is available.
- **Task detail:** model requests per task and for the whole proposal, with charged and still-reserved amounts.

## Changes

New, in `apps/backoffice`:
- `database/migrations/004_office_live_provider.sql`: additive. Adds the live switch and limits; the worker adapter and capabilities; and per-run model, dispatch time and token usage.
- `src/lib/office-runtime/openai.ts`: Responses client and outcome classification.
- `src/lib/office-runtime/live-pricing.ts`: prices and exact microunit arithmetic.
- `src/lib/office-runtime/live-adapter.ts`: prompts, schemas, validation, rendering.
- Tests: `src/lib/office-runtime/live.test.ts` and `live.integration.test.ts`.
- `scripts/office-live-eval/`: evaluation briefs and runner.

New, in `apps/office-worker`:
- `live-activation.example.sql`: owner limits and switch.
- `set-office-openai-key.ps1`: hidden-prompt key setter and remover.

Changed:
- **Runtime** (`office-runtime/index.ts`): live submission, claim, execute, reserve, settle, fail, recovery and redraft.
- **Contracts:** health and the `redraft` action.
- **Read model:** execution capability and per-task metering.
- **Status helpers and Office UI:** status panel, dashboard, task detail, profile copy and view.
- **Worker:** entry point, supervisor key allowlist, runtime packaging list and grant comment.
- **Tests:** migration lists in every database test, the local test runner's live database, and new lifecycle cases.

## Activation (separate, owner-approved window)

1. **Create the OpenAI project and key.** Use a dedicated OpenAI project with a project monthly spend limit at OpenAI (for example USD 10) as a second backstop. Create a key for that project only. Do not paste it into chat.
2. **Take a fresh verified backup.** Follow the [retention plan](PRODUCTION-PREPARATION-RETENTION-2026-11-08.md).
3. **Apply migration 004.** Run `npm run db:migrate` with the application owner role. It is additive and leaves live switched off. Apply it **before** any build or worker from this source starts: the new code reads its columns.
4. **Re-package and install the worker; deploy the back-office build.** Use `package-runtime.mjs` (`--verify`, `--smoke`, `--typecheck`) and the existing installation and promotion procedures.
5. **Store the key.** In an elevated PowerShell 7, run `set-office-openai-key.ps1 -ConfigurationFile <the worker task's configuration file> -Apply` and type the key into the hidden prompt.
6. **Restart the worker and confirm.** The dashboard should show *Live provider: OpenAI* with both models.
7. **Switch live on.** Run `live-activation.example.sql` as the owner.
8. **Optional rehearsal.** On a disposable `*_test` database, run `npx tsx scripts/office-live-eval/run.ts --confirm-spend --briefs standard-five-page,prompt-injection` with the key in `OFFICE_OPENAI_API_KEY`. It costs cents and writes a report with artifacts for the owner to read.
9. **First real proposal.** Submit one real internal brief. Then compare the 16 recorded charges with the OpenAI usage page, and read the package before deciding.

**Rollback.**
- Run `UPDATE backoffice.office_budget SET live_enabled=false WHERE id=1;`; new live requests are then blocked.
- Run `set-office-openai-key.ps1 … -Apply -Remove` and restart the worker.
- Earlier application rollback points are unchanged.
- Migration 004 stays; it is additive.

## Verification

These were final local runs on disposable fixtures with a scripted provider and no network. The machine-readable results are in [the evidence folder](live-openai-evidence-20261109/).

| Check | Result |
| --- | --- |
| Lint (`eslint .`) and typecheck | Pass |
| Back-office Vitest | 23 files, 226 tests, 0 failed, 0 skipped. Run by the official runner on a fresh cluster (`tmp/office-verification-20261109-010209`). |
| Live unit tests (`live.test.ts`) | 15. They cover pricing arithmetic, every client outcome class, strict-schema compliance, injection quoting, rendering bounds and contradictory review verdicts. |
| Live database tests (`live.integration.test.ts`) | 10. They cover: the switch and all limits; a full 16-request proposal with exact settled charges, owner-gated completion, and one live proposal at a time; request, proposal and monthly limits; billed-or-not failures; configuration rejection; unusable or oversized output; lease loss during a request; pause during a request; AI revision with findings and note; and read-model reporting. |
| Worker | Typecheck pass. Lifecycle 10/10, including the real PostgreSQL worker under the reviewed grants, refusal of a role that can change the live switch or limits, invalid live settings never disclosing the key, and the key helper keeping access rules. Packaging 7/7, activation 10/10, installer 7/7. |
| Sealed worker runtime | 1,299 files (three new modules). Smoke test with network forbidden: pass, all imports confined to the package. Packaged typecheck: pass. |
| Production build (isolated snapshot) | `hq5hlbwiIdVA39CZ_S1Ae`. No browser or server bundle contains the OpenAI client; only the price formatter reaches the browser. |
| Evaluation harness, offline dry run | All 8 briefs reached the owner decision with 16 scripted requests each. The scripted English, conflict-blind output correctly fails the `indonesian_language` and `conflict_flagged` checks, which shows the checks discriminate. |
| Production | Ports 3100 and 54329 served by the same processes; active build still `7VQBHlMCw4uRSPfvo5f5T`; no OpenAI request; no key configured. |

## Not done

- No real OpenAI request has been made, so prompt quality, real token use, the count endpoint's billing and model behaviour are unverified until the first live run.
- The proposal's "10 minutes per proposal attempt" is not enforced as a clock. The cost limits, 90-second request timeouts and request ceiling apply instead.
- Prices are code constants. A price or model change needs a reviewed code change.
- Knowledge base and memory (Obsidian import, approved learned memory) are the next phases and have not been started.
