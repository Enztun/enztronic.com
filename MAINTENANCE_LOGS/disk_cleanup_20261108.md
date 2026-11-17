# Disk cleanup - 8 November 2026

Drive D: holds the production back-office PostgreSQL data directory and had fallen
to 2.5 GB free (98% used). The owner approved three groups from an exact reviewed
list. Afterwards D: had **24 GB free** (77% used). Nothing used by production, its
rollback releases or its recovery packages was included.

## Deleted

| Group | What | Size |
| --- | --- | ---: |
| Caches | npm download cache `D:\npm-cache\_cacache` (`npm cache clean --force`; `_npx` kept) | 13.0 GB |
| Caches | Website local build cache `D:\Enztronic\.next`; back-office dev/check builds `.next-office-check` and `.next-office-dev` | 1.0 GB |
| Office test leftovers | `app\` copies inside 12 `D:\tmp\claude-office-{acceptance,build}-*` snapshots and Codex's superseded re-review snapshot `D:\tmp\codex-rereview-20261106\…\app` | 3.4 GB |
| Office test leftovers | 23 stopped fixture PostgreSQL data directories under `apps/backoffice/tmp` (synthetic data only), including the stale `office-test-pg` | 1.7 GB |
| MeteoraLP | `node_modules` (4 folders) and `.next` under `D:\MeteoraLP` | 1.4 GB |
| MeteoraLP | Unused tracked copy `apps/meteora-lp` (535 files) removed from the working tree; still in git history; not committed | 17 MB |

All snapshot `app-manifest.json` files, acceptance and smoke reports, logs,
screenshots and patch baselines were kept, so report references still resolve to
their evidence. Each `node_modules` junction inside a snapshot was removed as a
link before deletion; `apps/backoffice/node_modules` kept all 443 entries. No
fixture cluster was running. Four orphaned `tail` processes from the 5 November
acceptance runs were stopped first.

## Kept on purpose

- Production: `apps/backoffice/.next` (build `7VQBHlMCw4uRSPfvo5f5T`), `.runtime/postgres-data`, all four `.runtime/releases/*` rollback points, recovery packages on C: and E:.
- Codex's accepted candidate `D:\tmp\codex-final-correction-20261106` (see `PRODUCTION-PREPARATION-RETENTION-2026-11-08.md`).
- `D:\MeteoraLP` source, configs and git history. Everything except the bundled `repos/meridian` clone matches `D:\MeteoraLP-archive-20260618.zip` byte for byte (672 files). The clone holds local edits (`telegram.js`, `Dockerfile`, `user-config.json`) that are not in the archive.
- Website `public/` assets (13 MB): screenshots are resolved by slug in `src/lib/screenshots.ts`, so a missing literal reference does not mean unused.
- `src/proxy.ts` still excludes `/meteora` from the locale middleware, and `.gitleaksignore` keeps its history entries for commit `4871fca`.

After cleanup, ports 3100 and 54329 were served by the same processes, and `/` returned HTTP 307. The production
build ID and data directory were unchanged.
