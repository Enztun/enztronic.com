# Production preparation: backup and retention plan

8 November 2026, Asia/Jakarta. This document records the preparation evidence and proposes future retention. It does not register a backup schedule or authorize file deletion or relocation. No cleanup is performed by this plan.

## Protected recovery package

The current protected package is `C:\Users\hoyec\Enztronic-Recovery\production-prep-20261108-f3d5f15456\`. Its access controls restrict the package to the owner, SYSTEM and local administrators. It contains sensitive database/configuration recovery material; keep its contents out of source control and shared reports.

The production custom-format archive was created with an exported snapshot shared by the read-only baseline capture. Archive listing and a complete restore into a new cluster on loopback port `55469` passed. All 13 business tables, catalog comparison groups and the audit identity sequence matched, and the existing application credential worked on the restored database. Migrations `001` and `002` were present; Office migration `003` was absent. The temporary cluster was stopped and its port closed. Evidence is retained in `database-backup.json`, `production-baseline.json`, `restored-baseline.json`, `sequence-after-dump.json` and `restore-result.json` inside the protected package.

Private-object coverage follows keys referenced by the captured database. `private-objects-result.json` records zero referenced keys, zero ready documents and zero logo references at this snapshot; it therefore required no downloads. This is not a bucket-wide inventory or a statement that R2 contains no other objects.

## Copies and failure coverage

| Location | Physical storage | Status and purpose |
| --- | --- | --- |
| Protected package on C: | Disk 0 | Verified local recovery package. |
| Application, production data and snapshots on D: | Disk 0 | C: and D: share a physical disk; neither protects the other from failure of Disk 0. |
| Verified protected archive on E: | Disk 1 | `E:\Enztronic-Recovery\production-prep-20261108-f3d5f15456\production-prep-20261108-f3d5f15456.tar.gz`. Its checksum matches the verified C: archive. |
| Owner-controlled destination outside this computer | Deferred by owner | Owner explicitly accepted two local copies for now and will select an off-computer destination later. This remaining gap covers loss, theft or failure of the whole computer. |

The E: copy improves physical-disk coverage but remains in this computer. It is not an off-computer backup. Every one of the archive's 44,147 regular files passed checksum verification, and the E: copy is byte-identical to the C: archive. SHA256: `698a2baba4585ca74ab865b9c81f6b796edab3e594b58976679e08106c3264e8`. Verification records sit alongside both archives. No external transfer has occurred.

## Items to preserve

- The working production application and rollback source/configuration/dependency material. The promoted build is `HMB4cGweGXqsAnyVbpkcG`; preserve the complete build, not selected files. The old `previous-build/` retained by the 4 November recovery is a known stale build and must not be mistaken for the working rollback release.
- The accepted, unpromoted candidate `H2wsHC_p8niGqIW1qcF_K` at `D:\tmp\codex-final-correction-20261106\claude-office-build-20261105-204259\app`, plus its protected `accepted-candidate/` copy and manifest. Promotion/migration/worker activation remain separate operations.
- The production PostgreSQL data directory, `apps/backoffice/.runtime/postgres-data`, and its current owner/business records. Never treat it as a disposable fixture or use a live directory copy as a substitute for the validated logical backup.
- All source patches, the bases required to replay them, lockfiles, private Office assets/reference files, curated verification evidence and manifests. Preserve the full 58-check acceptance evidence on C: at `C:\Users\hoyec\AppData\Local\Temp\enztronic-codex-final-correction-20261106\`, including `acceptance-20261105-204249`.
- Protected environment/credential recovery material, relevant database roles/memberships/grants, PostgreSQL connection configuration and the existing startup task/scripts. Preserve Cloudflare Access and shared tunnel configuration without exposing credentials or changing unrelated routes.
- Database-referenced private object bytes and their key/hash metadata whenever references exist. A successful database restore alone does not establish recovery of externally stored invoice PDFs or logos.

The candidate and acceptance evidence above are documented in [the final-correction report](CODEX-FINAL-CORRECTION-2026-11-06.md). Working-release boundaries and startup behavior are recorded in [the recovery report](../BACKOFFICE-RECOVERY-2026-11-04.md).

## Current disk inventory

The preparation inventory identified approximately **5.440 GiB** across the following groups. Category figures are rounded independently. This is a review inventory; no space has been reclaimed.

| Inventory group | Approximate size | Retention treatment |
| --- | ---: | --- |
| `apps/backoffice/tmp` | 1.798 GiB | Preserve pending an exact, reviewed item list and identification of unique fixture/evidence files. |
| Twelve older `D:\tmp\claude-office-{acceptance,build}*` snapshots | 3.070 GiB | Potential later retirement only after confirming newer accepted evidence and protected copies cover each item. |
| Final-correction snapshots | 0.573 GiB | Preserve the accepted `H2wsHC_p8niGqIW1qcF_K` snapshot and its supporting evidence. Do not retire this group as a unit. |

The inventory found no active owned fixture among 25 discovered test PostgreSQL roots: 24 had no PID file, and one had a stale `postmaster.pid` referring to nonexistent PID `40284`. Recheck cluster ownership and current process/port state before any later operation; a stale PID file alone does not identify a running process. Fourteen `node_modules` junctions must be excluded from traversal so a future operation cannot act on their shared dependency targets.

No production database directory, working release, accepted candidate, patch/base or unique evidence becomes disposable because it appears under a temporary-looking path. Current inventory observations must be refreshed before any future cleanup.

## Proposed future retention

Adopt the following only after choosing the storage destination, confirming capacity and scheduling ownership, and recording the owner's approval:

| Tier | Proposed retained recovery points |
| --- | --- |
| Daily | Seven successful daily recovery points. |
| Weekly | Four successful weekly recovery points. |
| Monthly | Six successful monthly recovery points. |
| Before a production change | Pin a verified recovery point and the working application release through rollout acceptance and until a newer verified rollback point supersedes them. |

A recovery point may carry several tier labels without duplicating its archive bytes. Failed or unverified runs do not replace a successful retained point. Keep the manifest, matching database/role/configuration/object material and restore evidence together so a retained archive remains usable.

Propose a fresh isolated restore rehearsal before substantial schema changes and periodically for retained backups. Record table/catalog/sequence comparisons, existing application-role access and the temporary cluster's shutdown. Never restore an old database over production merely to test a backup.

These limits concern backup generations. They do not authorize automatic deletion of financial records, immutable audit history, Office artifacts/acceptance evidence or business documents. Do not install automatic expiration or cleanup as part of this preparation. Any later retirement needs an exact reviewed list, confirmed protected copies, current process/junction checks and a recorded owner decision.

Before a subsequent Office rollout, preserve the current recovery package as the pre-change point and follow [the activation and rollback plan](ACTIVATION-AND-ROLLBACK.md). Application rollback and disabling Office are separate from any decision to restore financial data. Leave additive Office tables and audit/acceptance history intact during an application rollback.
