# Backoffice recovery — 4 November 2026

The existing production backoffice was rebuilt separately, validated, promoted, and started through the existing `Enztronic Backoffice` Windows scheduled task. The web service is listening only on `127.0.0.1:3100`; the dedicated PostgreSQL cluster is listening only on `127.0.0.1:54329`. Service startup succeeded at approximately 16:33 WIB.

The owner confirmed in chat: “Dashboard and Settings → Access both load.” Authenticated dashboard and existing owner-access browser acceptance are complete by owner confirmation. The available automated browser had no owner session; this result comes from the owner's signed-in browser. No credentials or tokens were requested, copied, or changed.

## Release and rollback evidence

- Release: `.runtime/releases/recovery-20261104T092745/`.
- Build command: `npm run build -- --webpack`, in the separate `app/` source snapshot, using the installed dependencies. The production environment was loaded from the existing application `.env.local`; development/3118 configuration was excluded.
- Build ID: `HMB4cGweGXqsAnyVbpkcG`.
- Webpack compilation, TypeScript, static generation, and build tracing passed.
- The complete `.next` directory was validated on temporary loopback port3101. No validation server remains running there.
- All232 validated build files were hash-checked before and after promotion, including the previously missing `server/preview-props.json`, server chunks, manifests, static assets, and traced metadata. Manifest SHA256: `712054bb4cad4dfd09fa274e7e357c7a5163f7fbad7767af88db9465c06f7309`.
- Previous production build retained intact at `.runtime/releases/recovery-20261104T092745/previous-build/`. It is the stale, previously failing build, not a newly demonstrated working release. Previous logs and the original startup script are retained alongside it.
- See `build.log`, `validation.json`, `validated-build-files.json`, `promotion.json`, and `recovery-verification.json` within the release directory. Build source and installed-dependency versions were not upgraded during recovery.

Any rollback must stop only the backoffice application, preserve the current build separately, and swap the complete build directories under the same application root. Preserve the database and the shared tunnel. Restoring the stale build alone is expected to reintroduce its runtime incompatibility; no database rollback is part of this recovery.

## Production configuration and records

- Confirmed intended database `enztronic_backoffice` on loopback54329, application role `enztronic_app`, and data directory `.runtime/postgres-data` through `pg_ctl status`.
- The existing role has no superuser, database-creation, or role-creation powers. Verification transactions were explicitly read-only.
- One active administrator matches the sole configured Access allowlist identity. No human access record changed.
- Current edge issuer/audience match the production Cloudflare Access configuration. `.env.local` and shared `cross-config.yml` hashes are unchanged.
- `OFFICE_ENABLED` resolves false; `CLOUDFLARE_ACCESS_DEV_BYPASS=false`. The existing production configuration is preserved. No development fixture environment was used.
- Migrations001/002 match source checksums. Migration003 remains unapplied.
- All13 production business-table counts and SHA256 digests match the pre-recovery snapshot exactly, including users, clients, invoices, invoice counters/snapshots, payments, outbox, audit records, and migration history. Verification files: `.runtime/recovery/production-db-baseline-20261104.json` and `production-db-after-20261104.json`.
- No setup-local, seeding, migration, Office worker activation, financial action, or public website deployment was performed.

## Startup persistence

The existing task remains enabled for the owner's interactive Windows logon, with three retries at one-minute intervals and no execution time limit. Its registered action, principal, trigger, and settings are unchanged; it invokes `scripts/start-backoffice.ps1 -Background` through hidden conhost.

Ending the stale task also stopped its dedicated PostgreSQL child. The first immediate launch raced with that shutdown and reported PostgreSQL not ready. After the cluster had stopped, the existing script started the same data directory successfully and launched the new release.

One operational correction was made in `scripts/start-backoffice.ps1`: its failure trap now uses `exit 1` instead of `break`, allowing startup failures to return a nonzero result to the scheduler. A separate missing-build failure check, with `-SkipPostgres` and no database configuration, confirmed exit code1. This did not alter the production database or use the3118 preview.

The real scheduled task is running and owns the restored service. No reboot/logout or deliberate crash/retry test was performed. Availability still depends on the owner logging into this Windows machine and the host remaining awake and online.

## Verification

| Check | Result |
| --- | --- |
| Local root |307 to `/dashboard` |
| Local robots and static JavaScript/CSS/fonts |200 |
| Protected API without authentication |401 |
| Protected API with spoofed email or invalid assertion |401 |
| Public `/dashboard` without owner session |302 to configured Cloudflare Access; browser reaches Google sign-in |
| Shared tunnel readiness |200 |
| Public website |200 |
| Production data/access/schema digests |All13 tables unchanged |
| Authenticated dashboard and owner Settings → Access |Passed — owner confirmed both load in the signed-in browser |

The local authentication checks establish that the production server responds and refuses unauthenticated access. The owner's signed-in browser confirmation supplies the authenticated dashboard and Settings → Access acceptance evidence, completing the recovery acceptance checks. Office remains disabled; its production migration and worker activation remain separate.

## Office `/team`: separate activation work

Reviewed `docs/office/ACTIVATION-AND-ROLLBACK.md`. The recovered dashboard does not need migration003 while Office is disabled. Keep production Office migration and worker activation separate from this recovery.

1. Review the exact release, migration003, current verification and asset reports; rerun the checks appropriate to that later release and capture access/financial invariants.
2. Make a real custom-format production backup; validate its archive and restore it into a new disposable database, then compare invariants.
3. Obtain separate authorization for the additive003 migration and activation window; use the checksum-aware migration runner without editing001/002.
4. Provision dedicated least-privilege Office worker database and OS identities, protected Office-only configuration/secrets/logs, reviewed supervision, and an agreed host-availability target.
5. Enable Office only after the schema and worker are ready. Verify the signed-in admin, sales/revoked-user denial, artifact/replay boundaries, worker heartbeat, deterministic internal proposal acceptance, and unchanged protected business records.

Live agents also need an implemented and reviewed provider adapter, dedicated provider connection, authorized sources, and enforced spending/token/time/revision limits. The current live path remains `configuration_required`. A real coding executor additionally requires verified OS/tool/network/resource isolation.

Final3D acceptance remains separate: no runtime models are approved. Complete the Sam proof gate, remaining character/environment work, licenses/provenance, animation/docking/deformation checks, and target-device GPU acceptance before treating the visual Office as final.
