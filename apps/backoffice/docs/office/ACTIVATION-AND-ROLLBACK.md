# Activation and rollback plan

This is a review artifact. Do not execute production steps without the owner's authority and an agreed window. Current implementation defaults `OFFICE_ENABLED=false`; live providers and command execution are disabled.

## Before activation

1. Review this branch and migration `database/migrations/003_office.sql`, the asset report and verification report. Recheck installed dependencies and exact release revision. Run local lint, typecheck, tests and the isolated build.
2. Identify the dedicated backoffice database and runtime account without printing credentials. Verify it is the documented intended cluster, not an unrelated listener. Record active human/admin counts, client ownership, invoice counters/snapshot hashes, payments, commissions, invoice-outbox counts and immutable audit counts. Use read-only comparisons; retain sensitive details locally.
3. Create a timestamped `pg_dump --format=custom` backup using secure connection configuration. Validate it with `pg_restore --list`, restore to a NEW disposable database, and compare the protected invariants. A successful disposable test here is not evidence that the production backup has been made.
4. Configure a dedicated least-privilege worker credential, secret storage, log retention, startup/supervision arrangement and availability target. The worker must not receive website, financial-provider, Cloudflare administration or owner-machine credentials. Browser closure does not affect the worker; PC sleep/off does.
5. Authorize the additive migration and deployment/restart window. Apply migration through the existing checksum-aware `npm run db:migrate`; never edit already applied 001/002 files or bypass their checksum checks.
6. Build a release separately from the running app, validate it, then deliberately promote it during the authorized window. Enable Office only after the additive schema and worker are ready. Start the worker under its dedicated arrangement, on the dedicated database. Do not change the shared tunnel or unrelated database listeners.
7. Verify signed-in admin, sales denial, expired/revoked access, artifact/replay denial, worker heartbeat, demo isolation and harmless deterministic proposal acceptance. Repeat the protected financial invariant comparisons.

## Live pilot inputs still required

- A deliberately selected Office-specific provider/model connection and approved exact per-run/monthly spend, time, token and revision limits. Unset values disable execution. Current implementation has no enabled live provider adapter; it truthfully records `configuration_required`.
- Authorized internal brief and selected source records, plus any client/project registrations. No generic database or arbitrary filesystem reader is exposed.
- Any later coding executor needs task-owned workspaces plus verified OS/tool/network/resource isolation. A worktree alone does not qualify. Command execution remains unavailable until that capability is implemented and reviewed.
- Final GLB, native mesh/rig/animation sources and license/provenance records listed in the asset manifest. Sam's one-character proof must pass before expanding to all seven final characters.

The initial pilot authorizes an internal proposal package only. It cannot send messages, issue invoices, promise client terms, make payments, file tax documents, publish, merge or deploy. An approval is bound to the exact package digest and covered child revisions.

## Rollback

1. Stop accepting new submissions/schedules and disable Office in the application. Fence/pause the dedicated worker and inspect in-flight/unknown operations before any retry. Do not terminate the shared tunnel or unrelated processes.
2. Restore the previous backoffice application build/configuration within the authorized window. Preserve the new Office tables, immutable artifacts, events, reviews and acceptance evidence; do not drop tables or modify migration checksums.
3. Confirm the owner's existing login, clients, invoices, commission calculations and invoice outbox behavior. Financial records should need no data rollback because migration003 is additive.
4. Restore a database backup only under a separate recovery decision: restoring an old financial database can discard valid later transactions. Test restoration on another database first.

No production activation, backup or restoration is claimed by this plan.
