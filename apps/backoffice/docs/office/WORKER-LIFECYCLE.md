# Worker lifecycle verification

Observed locally on 22 October 2026 (Asia/Jakarta), using Windows, Node 22.22.0 and the installed PowerShell 7 runtime. This supplements the database authority evidence; it does not activate production.

## Implemented behavior

The worker rejects invalid activation, PostgreSQL URLs, relative log paths, unsupported arguments and concurrency outside exact integer strings `1`–`4` before opening a database pool. SQL statement/lock waits are bounded to 10/5 seconds. Initial log failures enter the same cleanup path as runtime failures. Idle shutdown wakes immediately, overlapping heartbeat calls are prevented, and a stopping heartbeat plus pool close precedes the final fixed-code log.

A read-only startup capability preflight additionally rejects superuser/CREATEDB/CREATEROLE/replication/BYPASSRLS or database-owner identities, changed session identities, non-Office business table/column access, acceptance-evidence writes and owner-only approval/task fields. It runs before the started event or any worker heartbeat/claim. Refusal records only fixed `unsafe_database_role` summaries and never writes a worker record. The real fixture runs with a generated unprivileged login provisioned from `office-role.example.sql`; an app-owner URL is not a supported development shortcut.

The Windows supervisor uses the explicitly supplied Node executable and the installed `tsx` loader directly, with no CLI wrapper. It clears inherited environment settings and forwards only required Windows system/temp values, reviewed Office configuration, an absolute log directory and its private-pipe marker. Hidden process creation does not open a window. No network listener is added.

Normal cleanup sends a shutdown request over the child's private stdin, waits up to 30 seconds, and can terminate only that owned child tree as a fallback. Supervisor death closes the pipe; the worker stops further claims and finishes cleanup. Closed stdout is handled to avoid an `EPIPE` crash while flushing health/file logs. A forcibly killed worker or unavailable PC still leaves recovery to fenced durable leases.

Continuous supervision retries nonzero exits after 5, 15 and 60 seconds, with later waits remaining 60 seconds. A successful exit stops supervision. `-Once` forwards the worker's `--once`, performs one claim or idle check and never retries a failure. The installer defaults to a JSON plan with resolved absolute paths and no scheduler/service calls; registration remains a separately authorized operation.

The worker and supervisor each retain a current JSONL file plus one `.previous`, at most 2 MiB per file. Only IDs, timestamps, fixed lifecycle/error fields and explicit demonstration labels are recorded. Raw stdout/stderr from the child is drained without retention; the worker independently writes its structured file. Configuration values, source briefs, environment dumps and raw startup errors are not logged.

## Verification evidence

`npm run test:lifecycle` in `apps/office-worker` runs the offline process suite. For the PostgreSQL case, supply `OFFICE_LIFECYCLE_ADMIN_URL` through the local test environment, naming `/postgres` on an explicitly isolated loopback test cluster. The suite refuses default/production database ports 5432 and 54329. It creates a new random `office_worker_<uuid>_test` database and limited login, applies the three migrations plus the reviewed grant example there, then removes that generated role/grants/database in cleanup. It never resets the shared preview/test schemas.

The full run with capability preflight passed **8 tests, zero skipped**, in approximately 36 seconds. Worker `npm run typecheck` also passed.

| Check | Observed result |
|---|---|
| Default installer | JSON plan; mocked scheduler/service functions were never invoked; no log/config directory was created. |
| Startup validation | Invalid nonfinite/fractional/zero/out-of-range concurrency, invalid URLs, relative logs and unsafe config keys/types rejected before child launch or database access; connection-string sentinel absent from errors. |
| Capability preflight | App-owner URL, accidental business-table SELECT and owner-decision-column UPDATE each refused before started/heartbeat/claim; zero worker records were written by refusals. The unprivileged grant-example login passed and completed the lifecycle checks. |
| Environment | Actual child excluded inherited website key, `DATABASE_URL` and `NODE_OPTIONS`; only the explicit Office/system allowlist reached it. |
| Failure/restart | Child emitted 150 KB of raw crash stderr without blocking; secret sentinel absent from logs; only a replacement child started after the five-second backoff. |
| Single pass | `-Once` reached the child as `--once`; failed pass was not retried. Real idle `--once` exited successfully and recorded a stopping heartbeat. |
| Supervisor death | Both fixture and real worker received pipe EOF and exited. Real worker recorded `supervisor_disconnected`, flushed its file log and reported offline. |
| Cleanup after startup failure | A deliberate supervisor log failure triggered the private shutdown request; the owned child exited before the supervisor returned. |
| Rotation/health | Existing current/previous files rotated on Windows; sizes stayed bounded. Health reported demonstration-only online while running, offline after stop and offline for a heartbeat older than 60 seconds; provider/command flags stayed false. |

After verification, generated worker databases/roles and lifecycle temporary directories were removed. Existing preview/development workers, the shared tunnel, production database and services were not stopped or changed. No startup task/service was registered and no paid provider, external send, deployment or CI workflow was used.

## Coverage limits

The tests cover disposable Windows processes and the deterministic adapter on a local test cluster. They do not prove an installed scheduler/service identity, production ACLs/credentials/grants, sustained uptime, host sleep/off recovery, a live provider or external execution. Capability preflight is an additional check of the specified dangerous grants, not a complete PostgreSQL privilege/sandbox audit; keep the reviewed grant example and do not expose SQL to agents. Use one supervisor per owned log directory. The 30-second forced-termination fallback and later 15/60-second delays are implemented but were not deliberately exhausted in this suite. A production availability target, dedicated identity, reviewed configuration ACLs, production backup/migration and authorized activation window remain operator inputs.
