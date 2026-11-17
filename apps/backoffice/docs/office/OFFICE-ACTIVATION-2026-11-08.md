# Office activation — 8 November 2026

The owner authorized Step3 and Step4. **Both are complete for the deterministic simulated workflow.** Migration003 and the accepted application release are deployed, Office is enabled, and the dedicated worker is online with an advancing heartbeat. A controlled idle restart passed. The owner completed the genuine signed-in save/reload, seven-role review and package-acceptance test; independent read-only verification confirmed its exact records and Dashboard revision link. Protected business/access records still match after those actions.

The later [UI/UX refinement](OFFICE-UI-UX-SECOND-PASS-2026-11-08.md) now serves `7VQBHlMCw4uRSPfvo5f5T`, with complete prior builds retained for rollback. The activation results and genuine owner acceptance below remain historical evidence; the later UI-only promotions preserved the saved records and configuration.

## Production state at activation

| Component | Observed result |
| --- | --- |
| Database | Dedicated `enztronic_backoffice`, loopback54329, expected data directory. |
| Migration | Existing checksum-aware `npm run db:migrate` skipped001/002 and applied003 exactly once. SHA256:`d4a84915bfd40831bb3c16aa48c3eeed49fd8a1a397dd9ececdfe20af1a7a0db`. |
| Business/access preservation | All12 original tables other than the deliberately updated migration ledger match their pre-change digests. Original001/002 ledger rows, audit identity sequence and owner-access counts are unchanged. |
| Release | Complete accepted build `H2wsHC_p8niGqIW1qcF_K`, all230 build files checked against the validated snapshot and after promotion. |
| Rollback | Known-working `HMB4cGweGXqsAnyVbpkcG` retained at `apps/backoffice/.runtime/releases/office-activation-20261108-4e6c38baf8/working-build-before-office`. No database rollback occurred. |
| Application | `OFFICE_ENABLED=true`. Development authentication bypass remains false. Only the Office flag changed in the production environment file. |
| Profiles/workspaces | Seven enabled logical role profiles; registered internal demo/live workspaces. They are not human login accounts or evidence of running AI inference. |
| Worker database authority | Fresh NOLOGIN capability role and dedicated LOGIN inheriting only that role; ADMIN/SET membership options false. Actual source preflight passed and all13 original-table SELECT attempts were denied. Worker does not own the database and has no elevated capabilities. |
| Worker configuration | Protected Office-only configuration prepared with dedicated worker credential and explicit deterministic-demo flags. No website, application database, Cloudflare or provider credential was lent to it. |
| Windows worker | The owner approved fresh administrator consent. `EnztronicOfficeSvc` and its dedicated Password-logon task are enabled, running at least privilege, with its delayed boot trigger enabled. Actual production heartbeat verified. No owner demo task was created by the operator. |
| Web/dashboard model | Local bootstrap/static/auth-denial checks pass. Actual read-only dashboard model returns available, seven roles and eight completed demo tasks (parent plus seven children), zero pending decisions and zero live tasks. Its Owner accepted link resolves the accepted package revision exactly. |
| Owner browser acceptance | Owner reported task `db1cddf7-1b8f-4d2e-8074-210cc094562c` was all running well after the requested Dashboard, Access, Office, save/reload, review and acceptance test. Operator verification supplements this confirmation; it does not impersonate the owner. |
| Access/website | Public admin URL redirects to the configured Cloudflare Access issuer. Unsigned/spoofed/invalid assertions are rejected. Public website returns200; tunnel configuration and existing startup task definition are unchanged. |

The new Office records were added by the authorized additive migration. No `setup-local`, generic seeding command, human account fixture, financial mutation, external message, paid provider action, command executor, commit or push was used.

## Recovery and rehearsal evidence

A fresh timestamped custom-format production backup was created before migration with a baseline sharing the exported snapshot. Its full isolated restore matched all13 original tables, catalog comparison groups and the audit sequence; the original application credential worked. That temporary55469 cluster was stopped and the port closed.

An independent new cluster on55479 restored the same fresh archive and rehearsed the actual checksum-aware migration, capability/login grants and source worker. It denied13 protected table reads, completed a real limited-role worker one-pass heartbeat/stopping cycle, and preserved all12 business tables, owner access and audit sequence. Its cluster is stopped and port closed; no production connection was used in rehearsal.

Private activation/backup/configuration evidence:

`C:\Users\hoyec\Enztronic-Recovery\production-prep-20261108-4e6c38baf8`.

The latest pre-change database archive and role/activation recovery material were also copied into the protected second-disk directory:

`E:\Enztronic-Recovery\office-activation-20261108-4e6c38baf8`.

Archive bytes match. These are local copies on separate disks; the owner's earlier choice to defer off-computer storage remains in force. Secrets and full business snapshots stay out of this report and curated evidence.

After the genuine owner acceptance, a second fresh custom-format archive was created from a consistent exported, read-only production snapshot. It includes the accepted task and immutable evidence. A new isolated restore on55489 matched all32 current tables, full catalog groups, the audit sequence, four private roles/password verifiers and membership grantors exactly. The original application credential successfully read the same completed parent, seven children and acceptance evidence. No migration or worker was run against that restore. Its owned cluster is stopped and port55489 is closed; production processes/configuration/data were untouched.

This latest recovery set is protected for owner/SYSTEM/Administrators on both disks:

- `C:\Users\hoyec\Enztronic-Recovery\post-acceptance-20261108-64642ace-44df-4a0e-9912-c8446c753bf6`
- `E:\Enztronic-Recovery\post-acceptance-20261108-64642ace-44df-4a0e-9912-c8446c753bf6`

All14 copied recovery files passed checksum verification. The167,623-byte archive SHA-256 is `54e0ef4138862fc008ee1701d81324d6d388fb07e95eb8b3fc50aa67b5acfefe`; root independently checked both archive copies and the closed restore port. Full records, password verifiers and configuration remain in the private recovery sets, outside curated evidence.

Nonsecret machine summaries: [activation-evidence-20261108](activation-evidence-20261108/). `activation-verification-after-owner.json` records `fullActivationComplete:true` and `workerOnline:true`, with the original business/access comparisons repeated after owner acceptance. The earlier `activation-web-verification.json`, `operator-read-model.json` and pending-state capture are historical evidence from before Windows consent/owner testing and should not be mistaken for the current state.

Promotion exposed two Windows lifecycle details: stopping the existing conhost/npm task could leave the Next child behind, and automatic task retries could race PostgreSQL shutdown. The controller now fences retries during the swap, cleanly stops only the dedicated PostgreSQL cluster, and stops only the captured owner-owned node listener on3100 if it remains. It restores the existing task's enabled state and exact definition afterwards. An atomic environment-write overload was checked with disposable files before the successful retry. Earlier failed attempts preserved/restored the old build and original environment; Office tables were never dropped and financial data was never restored from an old backup.

## Step3 completion

The initial Windows consent request was canceled; the owner subsequently authorized and approved a fresh prompt. The already-reviewed `activate-prepared-worker.ps1 -Activate` then enabled only the dedicated account/task and requested its start. Root verified a fresh real production heartbeat, the limited database authority, unchanged protected business/access records and persistence metadata. Windows task-start status alone was not counted as health proof.

The activation helper's ten mocked/fixture tests passed. It was executed outside the sealed runtime, whose1296-file manifest remains unchanged. Account/task/boot-trigger enabled states and the owner's read-only task visibility were verified. The original backoffice startup definition remains unchanged; production authentication bypass is false.

A controlled production restart was performed only after confirming zero open tasks, leased steps and open runs. The owned worker processes exited, the task/account were disabled during the stop, then the same dedicated arrangement was re-enabled and started. A new worker identity produced advancing heartbeats while the previous worker's heartbeat no longer advanced. Original business/access tables still matched afterwards. Graceful in-flight shutdown or a real production lease-loss case is not claimed by this idle restart; fencing/recovery was covered by the accepted isolated suites. No owner task or approval was fabricated for testing.

## Step4 owner acceptance

The connected computer-use inventory exposes only a fresh in-app browser and MCP Apps, with no signed-in owner Chrome tab. No owner session/cookie/token was copied. No owner actions, tasks or approval evidence were fabricated in production.

The owner completed the requested existing-browser test and supplied task `db1cddf7-1b8f-4d2e-8074-210cc094562c`, reporting “all running well.” The request covered `/dashboard`, `/settings/access`, `/team`, Worker online, saving a harmless simulated brief, persistence after reload, inspecting the seven outputs and independent reviews, and accepting the final internal package. This release has no separate scope-approval control.

Read-only database verification independently confirmed:

- Parent and all seven specialist children are completed; all seven role outputs have passed independent reviews, and the parent package has its own independent review.
- Accepted artifact `afbd1924-e807-46f8-af09-4d78ab92c5ac`, revision1; SHA-256 `2606a807077974c76219f5e7fc4b46143a0d7e20452647e22d58c80b82c804c4` matches its content and immutable acceptance evidence `f46fd39b-79ef-456b-b3fc-9024a8dcaa34`.
- The seven-component manifest matches the accepted package, each covered child/revision/digest and review reference. The acceptance record's flat review-reference set contains exactly the eight matching independent passed reviews, without duplicates.
- The real active administrator, initiating owner and deciding owner agree; the exact-package approval is consumed and bound to the acceptance evidence. No operator-created owner action was used.
- The actual Dashboard read model shows eight completed demo tasks, zero pending decisions and zero live tasks. Its **Owner accepted** package output carries the exact artifact identifier/revision; canonical URL construction, parsing and server resolution preserve that selection.
- The final production check again passed all12 protected business/access table digests, original001/002 migration rows, expected003 addition, audit sequence, owner-access counts, least-privilege worker authority, local responses, Cloudflare Access gate and public website.

The owner deferred UI/UX adjustments. Candidate topics are recorded in [UI-UX-FOLLOWUP-2026-11-08.md](UI-UX-FOLLOWUP-2026-11-08.md); no application/UI implementation was started for that note.

There is currently only the existing active administrator and no production sales-test identity. Signed-in sales/revoked/expired-user production checks cannot be claimed without legitimate sessions. Those boundaries passed the accepted isolated browser/production-mode suites; unsigned and invalid assertions were additionally rejected by the deployed production app.

Current startup metadata was rechecked after owner acceptance: both tasks are enabled/running, and the least-privilege Office worker has its delayed boot trigger. The existing backoffice task uses an interactive-token logon and still requires the owner to sign in; the host must remain awake. No reboot or sustained-uptime test is claimed.

This initial activation supports deterministic simulation only; no real provider execution is claimed. A live model adapter, dedicated provider connection, approved sources and enforced spending/token/time/revision limits remain separate. Final3D/GPU and broader mobile/accessibility acceptance are also separate.

Application rollback disables Office and fences/stops only its worker, then restores the complete known-working build/configuration. Preserve additive Office tables and immutable evidence. A financial database restore remains a distinct recovery decision.
