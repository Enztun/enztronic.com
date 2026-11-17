# Production preparation verification — 8 November 2026

Step 1 local recovery preparation passed. The owner authorized this backup, isolated restore and release preservation. Production Office remains disabled, development authentication bypass remains false, and the accepted release candidate is not promoted. The remaining off-computer backup destination is pending; the two verified copies below are on separate disks within the same computer.

## Results

| Check | Result |
| --- | --- |
| Intended production database | Confirmed `enztronic_backoffice`, loopback54329, expected dedicated data directory. |
| Production backup | Custom-format archive and baseline share one exported PostgreSQL snapshot; archive listing passed. |
| Real restore rehearsal | Restored into a new, protected C: cluster on55469. All13 application tables, catalog comparison groups, role/membership/permission metadata, owner-access counts and the audit identity sequence matched exactly. Sequence state remained stable around the dump. |
| Existing database access | The unchanged application credential worked against the restored database. The active owner/admin still matches the configured Access allowlist. No identity or credential was changed. |
| External document scope | Zero ready-document object keys and zero logo references at this snapshot. One queued document row remains unchanged. No PDF regeneration, R2 write or download occurred. This does not inventory unreferenced R2 objects. |
| Working rollback release | Complete current production build `HMB4cGweGXqsAnyVbpkcG`, all232 build files, matching recorded build source, actual installed dependencies, lockfiles, Python PDF environment, protected configuration and startup task definition preserved. The older stale `previous-build/` is not the rollback target. |
| Accepted candidate | Complete build/source snapshot `H2wsHC_p8niGqIW1qcF_K` preserved separately, without promotion. |
| Independent rollback startup | Copied working release started from C: using copied dependencies.8/8 bootstrap, asset and unsigned/spoofed/invalid-token denial checks passed on temporary3133. It did not use the production database or real owner tokens. |
| Production preservation | Fresh before/after table/catalog/access/sequence comparison matched. Original build/configuration hashes and startup task definition matched. Local3100 responds and unsigned access is denied; public dashboard redirects to Cloudflare Access. |
| Cleanup | Rehearsal PostgreSQL and temporary app stopped;55469 and3133 closed. Production3100/PID23404 and54329/PID45704 unchanged. |
| Protection | Checked recovery directories and sensitive-file ACLs: only owner, SYSTEM and local administrators. Credentials and database contents are not included in this report. |
| Tool checks | Focused ESLint and syntax checks passed for the new recovery JavaScript helpers; archive sealing ran successfully using the standard-library Python helper. |

The rollback smoke is a bootstrap/static/authentication-denial check. It is not a fresh authenticated-owner dashboard acceptance. The real owner browser remains required for operational acceptance after the later Office activation. Existing owner access was not modified.

## Recovery locations

- Protected expanded package: `C:\Users\hoyec\Enztronic-Recovery\production-prep-20261108-f3d5f15456\`.
- C: archive: `C:\Users\hoyec\Enztronic-Recovery\archives\production-prep-20261108-f3d5f15456.tar.gz`.
- Second disk archive: `E:\Enztronic-Recovery\production-prep-20261108-f3d5f15456\production-prep-20261108-f3d5f15456.tar.gz`.
- Archive size:399,944,145 bytes. SHA256:`698a2baba4585ca74ab865b9c81f6b796edab3e594b58976679e08106c3264e8`.
- All44,147 regular archive files verified against their expected hashes; E: archive checksum matched. The seal result is in C:`archives\production-prep-20261108-f3d5f15456.verification.json` and E:`archive-verification.json` beside the archive.

C: and D: are partitions of Disk0. E: is Disk1. The E: copy protects against failure of Disk0 but is not an off-computer copy. No backup was uploaded to a provider. The owner explicitly chose to retain the two local copies for now and select an off-computer destination later; that limitation is accepted for proceeding to Step2.

The expanded package includes `RECOVERY-INSTRUCTIONS.md`, the logical database archive, role/credential recovery material, source/build/dependency/configuration manifests, accepted candidate, worker source, tracked working-tree patch, restored evidence and a full payload manifest. Protected configuration includes existing local Cloudflare Access settings and shared-tunnel configuration/credential. It is not a Cloudflare account or edge-policy export. Keep the package private; the access restrictions are NTFS permissions, not a claim of archive encryption.

The package was sealed before this final public report and Step2 proposal were written. Reports inside the frozen archive can describe the E: copy as planned; the external seal verification records above establish its completion. Do not edit the sealed payload or replace its archive in place.

## Retention and next step

The [retention plan](PRODUCTION-PREPARATION-RETENTION-2026-11-08.md) records approximately5.440GiB of scoped fixture/snapshot review candidates. No files were deleted or moved, and no automatic cleanup/backup schedule was installed. Preserve the working release, accepted candidate, production PostgreSQL directory, unique patches/baselines and acceptance evidence. D: still has approximately6.47GiB free; keep this pre-change recovery point pinned through rollout acceptance.

Proceed with [Step2: worker preparation](WORKER-SETUP-NEXT-2026-11-08.md). Recommended: a dedicated nonadministrator worker identity, a minimal runtime without owner secrets, separate pending configuration and disabled supervision. Initially use this PC for a clearly labelled deterministic pilot if its availability is acceptable. Migration003, production worker permissions/start, release promotion and enabling Office remain part of the separate activation window. Live model work additionally needs its reviewed provider adapter and approved limits.

No production SQL writes, setup/seeding, migrations, role/password changes, Office worker start, production restart, environment/startup/tunnel edits, public website changes, external messages, provider execution, financial actions, commit or push occurred in this preparation.
