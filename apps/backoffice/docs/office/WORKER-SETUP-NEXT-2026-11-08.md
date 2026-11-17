# Proposed Office worker setup — 8 November 2026

This records the Step2 proposal following recovery preparation. Its preactivation host setup has now been installed and verified; see [the Step2 verification report](WORKER-SETUP-VERIFICATION-2026-11-08.md) for actual identity, permissions, runtime, disabled task and acceptance limits. Production Office stays disabled. Migration003, production database-role provisioning and worker activation remain Step3.

## Recommended initial arrangement

Use a dedicated nonadministrator Windows worker identity and one deterministic demonstration worker, initially with concurrency 1. Keep its database credential, configuration, logs and runtime separate from the owner account, website and backoffice secrets.

For the first demonstration, the existing PC is sufficient if its required Windows session, database and worker remain available. Document the actual logon dependency; browser closure is independent, but sleep, shutdown and network loss interrupt availability. Do not describe an interactive logon task as an always-on service.

If work must continue before logon or while this PC is unavailable, select an always-on host and a reviewed service supervisor under the dedicated identity. A production Windows service wrapper is not supplied by the current implementation.

## Prepare before migration 003

1. **Create a minimal runtime package.** The worker currently imports `apps/backoffice/src/lib/office-runtime` and `office-contracts`, including `response-presets.json`. Package the required code and reviewed installed dependencies with a manifest; preserve the import layout or produce a reviewed self-contained build. Resolve dependencies for both subtrees without relying on the original repository. The existing supervisor expects its worker-local `tsx` loader. Do not copy `.env*`, database data, owner files, website credentials, unrelated workspaces or arbitrary repository contents into this runtime.
2. **Define filesystem permissions.** Give the worker identity read/execute access to the reviewed Node executable and packaged runtime, read access to its own configuration, and write access only to its owned log/temp directories. Keep runtime code unwritable by the worker. Verify that it cannot read backoffice/website environment files, PostgreSQL administrator credentials or the recovery package. A limited token under the existing owner account alone does not provide this separation.
3. **Prepare separate pending configuration.** Store it outside source control in an ACL-protected Office-only directory. Its current values should be:

   ```json
   {
     "OFFICE_ENABLED": "false",
     "OFFICE_DEMO_WORKER": "false",
     "OFFICE_WORKER_CONCURRENCY": "1",
     "OFFICE_WORKER_DATABASE_URL": ""
   }
   ```

   This intentionally fails closed before child startup or database access. Do not borrow the application connection. No provider secret is required for the deterministic adapter. Add the dedicated database credential only through protected host configuration at the later authorized step; never put it in chat, command arguments, logs or source control.
4. **Prepare disabled supervision.** Reuse the reviewed hidden supervisor and explicit environment allowlist. Prepare a disabled task definition under the intended identity, or add and review an explicit disabled-registration mode. The existing installer defaults to plan-only, while `-Activate` registers an **enabled** logon task; it must not be used for disabled preparation. Do not create an enabled task and disable it afterwards. Preserve the existing backoffice task and shared tunnel.
5. **Prepare the SQL provisioning template only.** Before migration 003, its Office tables, authorization function and guards do not exist. Do not apply its grants or create production worker roles as part of this preparation.

## Database setup after the separately approved migration

Use a fresh Office-only NOLOGIN capability role and a dedicated LOGIN inheriting only that capability role, or grant the reviewed permissions directly to a fresh login. The worker must not require `SET ROLE`: its preflight rejects differing session/current identities.

Apply the explicit column/table permissions in `apps/office-worker/office-role.example.sql`, with no elevated role memberships, database ownership, business-table access, acceptance-evidence writes or owner-decision-column writes. Review effective PUBLIC and inherited permissions as well as explicit grants. Do not weaken existing owner or application permissions to make a worker check pass.

Migration 003 guards and the worker's capability preflight are required together. Credentials and grants provide persistence authority for trusted runtime code; they are not a sandbox for arbitrary SQL or model-produced commands.

## Supervision and retention

`start-office-worker.ps1` already supplies a hidden direct Node child, scrubbed environment, private shutdown pipe, a 30-second graceful-stop allowance and 5/15/60-second failure backoff. Keep one supervisor per owned log directory. The worker binds no network listener.

The worker and supervisor each retain one current JSONL file and one previous file, capped at 2 MiB each: approximately 8 MiB total. Retain fixed lifecycle/error summaries and task/run identifiers; discard raw child stderr and never collect environment dumps. Confirm ACLs on rotated files as well as the directory.

## Verification and acceptance

Before migration 003, validate the runtime package and worker typecheck; run process-only lifecycle tests with database-test URLs cleared; confirm the pending configuration fails before launch/database access; and test that task registration produces a disabled definition without invoking a start command. Inspect effective filesystem access under the actual worker identity. Report any identity or permission work that remains incomplete.

After the separately authorized migration 003 and role setup, verify effective grants on a disposable restore first, then the intended production identity and a fresh worker heartbeat. Activate only in the agreed window. Test one explicitly simulated seven-role family through independent reviews and owner acceptance, worker stop/restart and lease recovery, denied user access, and unchanged protected business invariants.

A running deterministic worker proves simulated workflow execution only. Live model work still requires a reviewed provider adapter, dedicated provider connection, authorized sources and enforced spending/token/time/revision limits. Final 3D asset acceptance remains separate.

References: [activation and rollback](ACTIVATION-AND-ROLLBACK.md), [worker database boundary](WORKER-DATABASE-BOUNDARY.md), [worker lifecycle](WORKER-LIFECYCLE.md), and [worker setup](../../../office-worker/README.md).
