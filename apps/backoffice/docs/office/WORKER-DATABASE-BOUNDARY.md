# Office worker database authority

Verified locally on 22 October 2026 (Asia/Jakarta). No live database, production role, production service or existing preview access-test database was changed.

## Prepared implementation

`apps/office-worker/office-role.example.sql` now uses explicit task and approval column grants. The worker cannot insert acceptance evidence or write deciding-owner, decision-time, consumption or task-acceptance columns. Agent/workspace permissions, task initiating owner, budget limit/currency, schedule creation and template changes are also excluded. It has no read or mutation grants on any non-Office business table. Active-owner checks expose a boolean through the existing bounded authorization function rather than direct user queries.

The not-yet-applied production `003_office.sql` adds these guards:

- Approved/rejected decisions require the separate owner-decision capability and an active owner/time; exact approved evidence must match owner, workspace, approval, artifact digest and scope. Final approved/rejected records cannot be updated.
- Completed tasks require package acceptance, cannot subsequently be updated, and can only reference their own package or their parent's package in the same workspace.
- A worker principal cannot emit authenticated-owner events or owner-approval/completion event types.
- Existing schedules may advance one occurrence or be disabled; a worker cannot re-enable them.
- Composite foreign keys bind task evidence to workspace and approval evidence to workspace plus the precise approval ID.

The runtime's scheduled submission now records a worker/scheduler action instead of an authenticated-owner event. Browser-origin submissions and owner acceptance retain authenticated-owner provenance. Later owner notes on completed tasks append authenticated events without updating the accepted task row, version or evidence. All current application authorization remains in place.

These capabilities belong to a trusted worker that can write internal draft, review, run and dispatch records. They are not an arbitrary-SQL sandbox. The app's authenticated owner API uses its separately privileged connection; it must never share that connection with the worker. The example requires a fresh role without inherited membership or elevated PUBLIC grants. No automatic production login/grant or startup activation occurs.

## Disposable evidence

The new integration suite is `src/lib/office-runtime/worker-role.integration.test.ts`. It accepts only `OFFICE_ROLE_TEST_DATABASE_URL` targeting loopback port **55439**, database **enztronic_office_role_test**; it never falls back to application `DATABASE_URL`. The suite resets only that dedicated role fixture, creates a randomly named login with no elevated role capabilities or inherited memberships, applies the exact grant example, and removes only its generated login/grants afterward. Test data remains in the isolated role database for inspection.

Observed result: **8/8 tests passed**, including the completed-task owner-note compatibility regression.

| Verified capability/boundary | Observed result |
|---|---|
| All non-Office business tables | No SELECT/INSERT/UPDATE/DELETE grants; real reads denied, user mutation/payment insertion/client deletion denied. |
| Role elevation/schema modification | `SET ROLE office_test` and creating a backoffice table denied. |
| Complete deterministic pipeline | Limited login claimed, heartbeated, checkpointed and executed **16 worker steps**, reaching a pending package with seven reviewed children. No provider/network work. |
| Owner decisions/evidence | Approve/reject APIs, direct approval-state shortcut, deciding-owner/consumption writes, evidence insertion, task acceptance writes and completion without evidence denied. Pending approval unchanged after attempts. |
| Owner provenance/policy | Owner actor/source and owner-approval/completion events denied; agent/workspace permission and spending-limit changes denied. |
| Authenticated app owner | Owner accepted the package through the existing API runtime; all **8 tasks** completed with shared exact acceptance evidence. Later worker task/decision edits denied. |
| Completed-task owner notes | Authenticated owner note appended as one immutable event; entire accepted task row and acceptance evidence stayed unchanged. Limited worker's owner-note attempt denied. |
| Evidence scope | Privileged test attempts to attach cross-workspace evidence or unrelated same-workspace package evidence failed. Approval evidence composite FK rejected cross-workspace reference with PostgreSQL `23503`. |
| Owner-approved schedules | Limited login dispatched an existing schedule with truthful worker/scheduler events. Creating schedules, changing templates, arbitrary next-occurrence changes and re-enabling disabled schedules denied. |

The initial combined regression run with the independent runtime and role fixture variables passed **64 tests**, with three preservation tests skipped because the existing preview access-test database was intentionally not selected. After adding the owner-note compatibility regression, focused runtime and role suites passed **24/24**. Root verification runs the complete suite and preservation fixture separately before final delivery. Focused ESLint and TypeScript checks passed. `scripts/test-office-local.ps1` now creates/configures the third role fixture for complete fresh-cluster runs.

Production activation still requires a reviewed real role and ACL setup plus its own verified backup/migration/availability window. This local role evidence does not confirm production permissions or deployment state.
