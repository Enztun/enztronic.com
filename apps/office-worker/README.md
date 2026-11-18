# Office worker: reviewable local setup

This is an independent durable **deterministic demonstration** worker. It requires the additive migration `apps/backoffice/database/migrations/003_office.sql`. It does not call a model, run project commands, send messages or access financial actions. Live submissions remain `blocked / configuration_required` until a reviewed provider adapter, exact budgets, runtime caps and approved sources exist.

Install dependencies with `pnpm install --frozen-lockfile` in this directory after reviewing its lockfile. Set the worker environment securely in the approved host configuration:

- `OFFICE_ENABLED=true`
- `OFFICE_DEMO_WORKER=true`
- `OFFICE_WORKER_DATABASE_URL`: a dedicated office database role on the approved dedicated cluster. Never paste a secret into chat, commit it or point an isolated test at the live database.
- Optional `OFFICE_WORKER_CONCURRENCY=1` (bounded 1–4) and an absolute `OFFICE_WORKER_LOG_DIRECTORY` owned by the service account.

Run `pnpm start`; use `pnpm start --once` for a single local claim. The browser is independent: closed tabs do not stop work. The workstation, database, worker and network must remain awake and available. The application reports worker offline once its heartbeat exceeds 60 seconds. A logon task does not establish availability before logon or while the PC is off.

For a separately authorized production window, register a new dedicated Windows service through the owner's approved supervisor. Run a dedicated nonadministrator account with a scrubbed environment, database role and ACLs limited to office runtime code/logs and office tables; it must not read website credentials, source workspaces, human/client records or financial tables. Active-owner validation uses only the boolean `office_authorized_owner(uuid)` function, without exposing users to the worker. Use a new, reviewed Office-specific SQL role with no inherited memberships; `office-role.example.sql` grants only the prepared worker capabilities. Never use an app-owner/superuser connection for activation. Bind no network listener. Set supervisor restart-on-failure with bounded backoff (5, 15, 60 seconds), normal shutdown timeout of 30 seconds, and independent health polling of `office_workers.heartbeat_at`. If using a reviewed PowerShell `Start-Process` supervisor, include `-WindowStyle Hidden`. A Windows service wrapper is not supplied or silently installed by this implementation.

The worker writes JSON summaries to stdout and optionally rotates an office-owned log at 2 MiB, retaining one previous log. It records task/run IDs, process IDs, demonstration labels and fixed error codes only. The supplied supervisor writes its own bounded fixed-code log and drains/discards raw child output, which could otherwise disclose credentials from startup errors. Do not collect process environment dumps. Do not reuse or alter the existing backoffice logon task or shared tunnel.

SIGINT/SIGTERM stops future claims after the current safe deterministic step, records a stopping heartbeat and closes its own pool. A killed process leaves a fenced lease; another worker reclaims expired leases with bounded retry/backoff and preserved checkpoints. Exactly-once model execution is not claimed. Future external adapters must reconcile ambiguous outcomes using `office_tool_operations`; this worker cannot execute them.

Rollback: disable new office submissions/schedules, stop only this worker through its reviewed supervisor, reconcile any in-flight effects, and revert the office UI/code. Preserve office evidence/tables. Do not drop the schema, restore an older financial database, stop shared `cloudflared`, or alter other PostgreSQL listeners.

No startup task, service, production restart or live migration was performed by adding these files.

## Database authority boundary

The reviewed grants are **not** broad writes to all Office tables. The worker cannot insert acceptance evidence, set deciding-owner/decision/consumption metadata, attach task acceptance, change workspace/agent permissions, edit a task's initiating owner, raise spending limits, or create/re-enable schedules. Its role can persist drafts, independent structural reviews, run/lease/checkpoint records, prepare pending proposals, advance/disable existing owner-approved schedules and settle reservations within the owner's existing budget limit. Database guards reject approval/completion shortcuts, owner-event impersonation and edits to final owner decisions/completed tasks. Composite foreign keys also bind acceptance references to their workspace and approval.

Authenticated app owner-decision APIs retain their separately privileged app connection and repeat existing Cloudflare/active-admin authorization. Worker scheduling emits `worker / scheduler / confirmed_application_action` events; it does not impersonate a new authenticated browser action. The initiating owner is still checked for active authorization when the schedule dispatches and work executes.

The worker remains a **trusted persistence process**, with access to Office source briefs and draft/review records. These SQL credentials are not an execution sandbox and must never be passed to model-produced commands, repositories, documents or browser code. Grants alone cannot remove privileges inherited from another role or PUBLIC. Review both the migration guards and role inheritance/default privileges before activation.

`src/lib/office-runtime/worker-role.integration.test.ts` in the backoffice verifies the exact grant example with a newly created, unprivileged login on an explicitly named disposable database. The complete fixture runner includes that database; see `apps/backoffice/docs/office/WORKER-DATABASE-BOUNDARY.md` for observed local evidence and the unchanged production boundary.

## Prepared Windows logon alternative

`start-office-worker.ps1` is a dedicated supervisor that starts its child without a window, clears inherited environment variables, accepts only Office-specific configuration keys and applies bounded restart delays. Supply the reviewed Node executable, an ACL-protected Office-only JSON configuration file and an Office-owned log directory. Keep the configuration outside source control. The JSON values are the explicit environment strings described above; no provider secret is needed for this deterministic adapter.

`install-office-worker-task.ps1` prints a JSON plan by default, including resolved absolute paths, and invokes no task/service commands in that mode. During a separately owner-authorized activation window, `-Activate` registers a new **limited, current-user interactive logon** task without starting it or replacing any existing task. It uses hidden PowerShell and refuses to overwrite an existing Office task. This arrangement retains the same PC-awake/logged-in limitation; it is not an always-on service. Review configuration/log-directory ACLs and use a dedicated identity before activation. Verification invokes the installer only in plan mode and the supervisor only against disposable process/database fixtures.

## Windows lifecycle and repeatable verification

The supervisor launches the supplied Node executable directly with the installed `tsx` loader; there is no CLI wrapper process. Its JSON configuration accepts only the four Office keys above, with string values and exact `true` activation. Concurrency must be an integer string `1`–`4`; malformed, nonfinite or out-of-range values fail before startup. The child inherits only necessary Windows temporary/system paths and the reviewed Office settings. No inherited `PATH`, `NODE_OPTIONS`, website/database environment or provider key is forwarded.

Before recording a started heartbeat or claiming any work, the worker checks its database capabilities. It rejects an elevated/database-owner identity, access to non-Office business tables or columns, writes to acceptance evidence, and owner-only approval/task fields. An accidentally supplied app-owner URL therefore fails closed with `unsafe_database_role`; there is no development bypass. Review the full role grants and ACLs as well: the preflight is an additional guard, not a general SQL sandbox.

The supervisor owns a private stdin pipe. On normal supervisor cleanup, it requests a safe stop, waits up to 30 seconds, then can terminate only its child tree. If the supervisor disappears, pipe EOF asks the worker to stop claiming, mark its stopping heartbeat, close its pool and flush its file log. A closed stdout pipe is handled so that the final health/log update still finishes. Statement and lock waits are bounded to 10 and 5 seconds. Abrupt machine/process termination still requires durable lease recovery.

`start-office-worker.ps1 -NodeExecutable <reviewed-node> -ConfigurationFile <office-json> -LogDirectory <owned-directory> -Once` passes `--once` for a single claim or idle check and does not retry a failed pass. Continuous mode restarts nonzero exits after 5, 15 and then 60 seconds. `office-worker.jsonl` and `office-supervisor.jsonl` each retain one current file and one `.previous`, capped at 2 MiB per file. These logs summarize lifecycle/step events; raw child stderr is discarded.

Run `pnpm run test:lifecycle` here for startup/configuration/supervisor fixtures. The real PostgreSQL lifecycle case skips unless `OFFICE_LIFECYCLE_ADMIN_URL` explicitly identifies `/postgres` on a separate loopback test cluster, excluding ports 5432 and 54329. That case creates a new generated `office_worker_<uuid>_test` database and limited login from the grant example, then removes only its own role/grants/database; it never resets an existing test/preview schema. See [the lifecycle evidence](../backoffice/docs/office/WORKER-LIFECYCLE.md) for the observed result and coverage limits. No test registers a startup task or service.

## Live OpenAI provider (optional)

The worker runs demonstration tasks with no provider. Live tasks need all of:

- Migration `004_office_live_provider.sql`, applied before any build or worker from this source starts.
- `OFFICE_LIVE_WORKER=true` and an Office-only `OFFICE_OPENAI_API_KEY` in the protected worker configuration. Optional `OFFICE_OPENAI_DRAFT_MODEL` (default `gpt-6-luna`), `OFFICE_OPENAI_PACKAGE_MODEL` (default `gpt-6.1-sol`) and `OFFICE_OPENAI_REASONING_EFFORT` (default `low`) must name a priced model and an effort both models accept.
- The owner's live switch and all four limits in `backoffice.office_budget`; see `live-activation.example.sql`.

`set-office-openai-key.ps1 -ConfigurationFile <the task's office json>` prints a plan; add `-Apply` in an elevated PowerShell 7 to type the key into a hidden prompt, or `-Apply -Remove` to take the live settings out again. It replaces the file in one step, keeps its access rules and never prints the key. The supervisor accepts these keys only together with `OFFICE_LIVE_WORKER=true`. The worker validates them before any database access and removes the key from its own environment. Logs record IDs, model names, token counts and charges, never prompts, briefs or output.

Each live step counts its input with OpenAI's token-count endpoint, reserves the worst-case charge against the request, proposal, month and overall limits, then makes exactly one Responses request with `store: false` and no automatic retry. Rejected requests release their reservation. A timeout, server error or unreadable response keeps the whole reservation as spend, because it may have been billed. See [the live pilot implementation note](../backoffice/docs/office/LIVE-OPENAI-PILOT-2026-11-09.md).

## Standalone runtime preparation

`package-runtime.mjs` prepares an inert, dependency-complete release from the reviewed local installation. It never downloads packages, reads `.env` files, connects to a database, registers a task or activates a worker. Create and ACL-protect the destination's parent first; the destination itself must be new, absolute, and outside this workspace. Existing or source-overlapping destinations are refused before copying.

```powershell
node .\package-runtime.mjs 'C:\ProtectedWorkerStaging\release-NEW\runtime'
node .\package-runtime.mjs --verify 'C:\ProtectedWorkerStaging\release-NEW\runtime'
node .\package-runtime.mjs --smoke 'C:\ProtectedWorkerStaging\release-NEW\runtime'
node .\package-runtime.mjs --typecheck 'C:\ProtectedWorkerStaging\release-NEW\runtime'
node --test .\test\package-runtime.test.mjs
```

The release contains `apps/office-worker` with the worker entry, supervisor, installer, SQL permission example, and worker-local `tsx`; `apps/backoffice/src/lib/{office-runtime,office-contracts}` with only the required source and response presets; and each subtree's actual installed runtime dependency closure. Dependency versions are preserved separately, including when the worker and backoffice have different Zod versions. There are no links to the owner repository, copied development tools, tests, credentials or website code. Node and PowerShell executables remain separately reviewed installation inputs.

The new `runtime-manifest.json` and SHA-256 sidecar record every copied file, package version and digest. `--verify` refuses changed, missing, extra or linked files. Keep that manifest with the release and protect the finalized release against worker writes; generate a new release rather than editing a sealed one. A digest manifest detects changes relative to its retained checksum; trusted installation and ACLs provide its integrity boundary.

`--smoke` imports the real packaged worker with a scrubbed environment, false activation flags and a noncredential test URL. Verification-only loader guards reject imports outside the package, and a network guard forbids connection attempts. Success means the complete runtime loads and exits with the expected `configuration_required` refusal before database access. It is not a worker heartbeat or queue-execution test. The smoke check uses the installed Node module-loader hooks; use the reviewed Node 22 runtime or a compatible release.

`--typecheck` verifies the packaged source using the repository's separately installed TypeScript and Node typings. Those development tools are not included in, or required by, the deployed runtime. After copying a finalized package to the protected installation directory, rerun digest and fail-closed checks there under the actual worker identity; separately confirm that identity cannot read the owner repository or secrets. Production Office, migration 003, SQL roles and actual execution remain outside packaging.
