# Corrected OpenAI pilot: activation and rollback

Prepared for independent review on 9 November 2026. This is a procedure, not activation authorization. It supersedes the activation/rollback ordering in `LIVE-OPENAI-PILOT-2026-11-09.md`; keep that original handoff as historical evidence.

## Before the production window

- Review `CODEX-LIVE-OPENAI-REVIEW-2026-11-09.md` and the exact final source/build/package hashes in its evidence. Use the complete isolated candidate, not a build made inside the production `.next` directory.
- Obtain separate owner approval for migration 004, app/worker replacement, key setup and the bounded paid evaluation. `PROPOSED-LIVE-PILOT.md` states: "Production activation retains its separate approved window."
- Prepare a dedicated Office-only OpenAI project and restricted project key. Check model access, current prices, account billing, retention settings and available project spending controls. Do not paste the key into chat, source, logs or browser JavaScript. Enter it only through the reviewed hidden-prompt helper on the host.
- The local ledger limits metered model charges and retains uncertain reservations. The token-count endpoint's billing was not established by the official documentation consulted. Resolve that billing question before describing USD 10 as a complete OpenAI invoice ceiling; taxes, other project usage and future price changes are outside the local model ledger. Project alerts alone are not proof of a hard stop.
- Review one short supplied-only internal test brief and its acceptance criteria. Mocked evaluations establish workflow behavior, not real model quality. A first paid evaluation remains necessary, with explicit spending authorization.

## Production window, in this order

1. Capture a fresh verified backup and preservation inventory using the existing recovery procedure. Preserve the current complete app build and installed sealed worker package, startup-task definitions, protected configuration, owner identity and records. Keep the current public website outside this release.
2. Confirm quiescence: no running Office step, active lease or outstanding external request. Stop the dedicated Office worker and backoffice web process through their existing startup arrangement. Keep PostgreSQL running. Check the recorded processes actually exited. Do not apply 004 to a running old connection pool: its cached `SELECT *` plans can fail after the added columns.
3. Apply only the reviewed migration 004 with the existing authorized migration role and checksum-aware migration runner. Verify earlier migration checksums. Do not seed, run setup-local or use port 3118. Verify live remains disabled and all new limits default to zero. Migration 004 includes a durable attempt reference and removes only the aggregate budget check that would prevent recording an actual provider overage; admission still enforces limits before dispatch.
4. Promote the complete validated app candidate and install/verify the corrected sealed worker runtime using the existing installation arrangement. Update only the reviewed runtime/grant changes. Keep the service account's restrictions and startup persistence. Start fresh processes, initially with live disabled. Verify the dashboard, Access settings, Office, current owner and existing records. Keep development authentication bypass disabled.
5. In elevated PowerShell 7, run the corrected `apps/office-worker/set-office-openai-key.ps1` with the installed task's existing configuration path and `-Apply`. Enter the dedicated project key at its hidden prompt. Restart the corrected worker so it reloads configuration. Confirm a fresh OpenAI-capable worker heartbeat; this alone does not enable paid task execution.
6. Under the separately approved spend authorization, set the reviewed caps: USD 0.15/request, USD 1/proposal family, USD 10/month UTC and USD 10/lifetime. Enable live using the reviewed owner-only SQL. Do not raise a cap merely to get a failed task unstuck. One proposal and one live model request are admitted at a time; each owner-approved attempt gets ten minutes and at most sixteen model calls, with thirty-two calls total across its family.
7. Run the bounded paid fixture evaluation first, using only approved synthetic/internal content. Check real model IDs/tier, response usage shape, count behavior, meaningful independent review, omissions/conflicts, refused external effects and provider usage reconciliation. Stop and reconcile any uncertain outcome; do not blindly retry. Read every output. Scripted success is not evidence that a real model meets the quality rubric.
8. Submit one approved real internal proposal in the owner's authenticated browser. Inspect the seven drafts, their independent reviews, the exact package revision/digest/manifest and metered requests. Compare with OpenAI's usage records before accepting the internal package. Owner acceptance authorizes no send, deployment, invoice, payment or other external effect.
9. Verify task restart behavior and startup persistence, record owner-browser acceptance, confirm preserved business/owner/access invariants, and retain the complete previous releases. A closed browser does not stop durable work; an asleep/off host cannot execute it.

## Stop and rollback

Disable `office_budget.live_enabled` first. This blocks new live dispatches; it cannot undo a request already sent. Stop new submissions and let the corrected runtime recover/drain outstanding work. Preserve all charged amounts and unresolved reservations.

Remove live settings with the corrected key helper's `-Apply -Remove`, then restart the **corrected new worker** in demonstration-only mode. It understands dispatched live holds even with no provider configured. The application may be rolled back to the prior complete accepted build after quiescence; keep migration 004 applied and start fresh database connections.

**Do not restore an older worker while any dispatched live reservation, unknown OpenAI operation or active live lease remains.** The older demo runtime does not understand `provider_dispatched_at`: it can release an uncertain live hold whose provider request ID has not arrived. Keep the corrected worker installed until reconciliation is complete. Only restore the older worker after the recorded rollback fence verifies no such state remains.

From `D:\Enztronic`, run `node apps/office-worker/read-live-rollback-fence.mjs`. This is read-only: exit 0 means the state fence passes, exit 2 means unresolved work blocks replacement, and exit 1 means the fence could not be verified. Stop/quiesce the worker first so the result cannot race another dispatch. Passing the fence is not deployment authorization.

For an uncertain request, inspect the provider evidence using the recorded request/client/run IDs. The owner-only `reconcileToolOperation` path requires an evidence reference and confirmed charge in exact USD microunits. A confirmed unprocessed failure costs zero; a known charge cannot be erased. Reconciliation settles the hold, and a separate explicit owner retry/resume/revision starts another bounded attempt while keeping all family spending and request counts.

Do not drop 004 to roll back. Do not clear the budget ledger, unknown operations or business data. Record any first-live-run failure and its disposition before expanding the pilot.
