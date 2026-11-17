# Step 2 worker preparation — 8 November 2026

Step2 preparation is installed and verified. The owner authorized this work. The dedicated Windows account and startup task are deliberately disabled, production Office remains disabled, and the worker has not processed work or connected to the production database. Migration003, production database-role provisioning and activation remain Step3.

## Installed arrangement

| Item | Verified state |
| --- | --- |
| Installation | `C:\ProgramData\EnztronicOffice` with protected access controls. |
| Identity | Dedicated ordinary local account `EnztronicOfficeSvc`; not an administrator; disabled after verification. Batch logon granted; local interactive and Remote Desktop logons denied for this SID. Existing owner account and business users unchanged. |
| Runtime | Actual copied files, no repository/dependency junctions.1296 files,20,746,474 bytes. Includes worker source, required backoffice runtime/contracts and each subtree's installed dependency versions. |
| Runtime manifest | SHA256 `ee0baaf3e076202c0e625cb9151ecdc8edcf942bb67a41497b926242c2c8fd3a`; installed copy matches. |
| Executables | Copied Node22.22.0 and separate portable PowerShell7.6.9. PowerShell ZIP matched the official release hash; Microsoft executable signature was valid. No global Node, PowerShell or PATH installation was changed. |
| Configuration | `configuration\pending.json`: exact string values `OFFICE_ENABLED=false`, `OFFICE_DEMO_WORKER=false`, concurrency1 and an empty worker database URL. No borrowed application/provider/owner credentials. |
| Code/configuration access | Worker reads code/configuration but cannot modify either existing files or their parent directories. |
| Writable installation branches | Owned `logs` and `logs\temp`. Supervisor passes this dedicated temporary directory to its child instead of an owner's temporary directory. |
| Sensitive access | New worker SID denied repository/owner-profile access and explicitly denied the tested sensitive files. Existing users' access entries and file contents preserved. Actual identity checks confirmed denial for website/backoffice environments, PostgreSQL passwords and C:/E: recovery files. |
| Account credential storage | Windows owner-bound encrypted credential export under `administration`, inaccessible to the worker. Task Scheduler holds its noninteractive Password-logon credential. No password was printed, placed in command arguments or committed. |
| Task | `\EnztronicOfficeWorker`: disabled; dedicated Password-logon principal; least privilege; delayed boot trigger disabled; demand start disabled. Normal owner session can inspect its metadata through an added read-only access rule. Actions/principal/trigger definition otherwise unchanged. |
| Main task execution | Last result267011 (`0x00041303`, has not run). The actual worker task was never started. |
| Retention | Worker/supervisor structured logs each retain a current and previous file capped at2MiB: approximately8MiB total. Raw child stderr is not retained. |
| Database template | Reviewed grant template retained privately under `administration\database-role-template.sql`. No production database account, grants or migration were created in Step2. |

PowerShell was deployed using the separate [Microsoft ZIP deployment method](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows#install-the-zip-package). The task's not-run status is defined in [Microsoft's Task Scheduler constants](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-error-and-success-constants).

The repository and owner-profile deny rules apply only to the new worker SID. They preserve existing users' permissions. Windows propagated the inherited rule through a large repository; read-only inventory counted176,474 files and13,848 directories with reparse points excluded. No project files were deleted, moved, reset or overwritten by that permission operation.

## Verification

| Check | Result |
| --- | --- |
| Runtime package safety tests |7/7 passed. |
| Disabled installer tests |7/7 passed with registration mocked; no start calls. |
| Existing process lifecycle suite |7 passed;1 database integration intentionally skipped with test database URLs removed. |
| Packaged source typecheck |Passed using separate verification tooling; development tooling is absent from the deployed runtime. |
| Package independence |Passed. Observed imports stayed inside the package while networking was forbidden; disabled startup returned `configuration_required`. |
| Actual Windows identity |A temporary Password-logon probe ran under the real dedicated nonadministrator account. All19 labeled file/directory targets passed their read/write expectations, including conclusive access-denied results rather than missing-file assumptions. |
| Runtime under real identity |Copied Node/tsx/runtime loaded successfully and rejected disabled configuration. Verification-only networking guard was installed and confirmed. No database connection or claim was made. |
| Supervisor under real identity |Pending configuration rejected before child launch, with logs unchanged. |
| Probe cleanup |Temporary verification task stopped/completed and removed; no probe task remains. Dedicated worker account disabled and read back; main task disabled and never run. |
| Owner visibility |Normal, unelevated owner session successfully inspected task state after its additive metadata-read grant. Task definition and activation state were preserved. |
| Production preservation |Before/after all13 business/access table digests matched; owner allowlist/admin state and001/002 migration checks matched.003 absent. Production configuration/source-build hashes and original backoffice task definition unchanged. |
| Production processes |Backoffice3100/PID23404 and PostgreSQL54329/PID45704 unchanged. No restart, tunnel change or new worker listener. |

The temporary identity probe was separate from the disabled Office task. It only checked access and refusal under explicitly false flags with an empty database URL. Its networking guard is a verification measure, not a production firewall or arbitrary-code sandbox. This remains trusted runtime code; command execution and live providers are separate capabilities.

Curated, nonsecret evidence: [worker-setup-evidence-20261108](worker-setup-evidence-20261108/). Private full receipts/tools are in `C:\Users\hoyec\Enztronic-Worker-Preparation\step2-20261108-ee8d2b8704`. Production database checks were explicitly read-only.

## Recovery copies

Preparation inputs, installed runtime/tools, pending configuration, protected credential export, permission snapshots, task XML and verification receipts were archived after installation. Every archived regular file was verified against its source digest; the E: copy matches the C: archive.

- C: `C:\Users\hoyec\Enztronic-Worker-Preparation\archives\worker-preparation-20261108-ee8d2b8704.tar.gz`.
- E: `E:\Enztronic-Recovery\worker-preparation-20261108-ee8d2b8704\worker-preparation-20261108-ee8d2b8704.tar.gz`.
- 5248 verified files;430,165,857 bytes.
- SHA256:`fda0b87fc45f29a11522773a4920872ff0e98bcf34b275e744a537704838f535`.

These are protected local copies, matching the owner's accepted storage choice. No off-computer transfer occurred. The account export is encrypted to the original Windows owner; this is not an operating-system image or a claim that owner-bound secrets can be decrypted on another machine. A replacement host should provision a fresh worker identity and review its new SID/permissions.

No automatic backup expiration or repository cleanup was installed. The Step1 financial backup and known-working application rollback remain pinned and unchanged. This final report and curated index were written after archive sealing; underlying receipts and proofs are inside the archive.

## Step 3 and acceptance limits

During the separately authorized activation window:

1. Confirm the pre-change backup, accepted build and dedicated intended database; recheck current protected business/access invariants.
2. Apply additive003 through the checksum-aware migration runner. Provision a fresh least-privilege Office database capability/login from the reviewed template and verify effective permissions. Do not reuse the application or administrator connection.
3. Put only that worker credential into protected host configuration, promote the complete accepted release, and deliberately activate the Office flags, Windows account and disabled task/trigger/start arrangement. Task changes require administrator authority; metadata inspection is available in the normal owner session.
4. Verify heartbeat, actual runtime-role refusal boundaries, worker stop/restart and lease recovery, then perform Step4's real owner/denied-user/dashboard acceptance and one explicitly simulated seven-role proposal through review and owner acceptance. Repeat protected business invariants.

No reboot or sustained-uptime acceptance was performed in Step2. The worker's noninteractive task does not require an open browser, but useful processing still depends on the current backoffice database's owner-logon startup and an awake host. Pre-logon availability and PC-off operation are not established. Reliable24/7 service needs an always-on arrangement.

This prepares the deterministic simulated workflow. Live model work still requires its reviewed adapter, dedicated provider connection, authorized sources and enforced limits. Real owner-browser operational acceptance remains Step4; the earlier release-candidate acceptance is already recorded and is not being requested again.

No production SQL writes, schema migration, database credential/role changes, worker claims/heartbeat, Office enablement, release promotion, existing service restart, public website modification, external message, paid provider action, financial action, commit or push occurred in Step2.
