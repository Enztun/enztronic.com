# Operator setup and capability boundaries

## Setup records, not credentials in documents

Store only provider aliases, role policy IDs, budget units, model selections and connection health in reviewable configuration. Configure secrets through the project's secure server-side setup. Never paste credentials into chat, seed fixtures, logs, client bundles, screenshots or this pack.

The backoffice public website may already use provider credentials; that does not grant the office permission to reuse them. Select and configure the office connection deliberately.

## Model execution

Set a permitted model alias, output/token limits, time limit, revision limit, concurrency limit, per-run budget and global budget. Keep prices/version metadata server-side and current. Unknown price/usage must be shown as unavailable or estimated; no invented cost totals. If a required budget/provider is missing, block the paid dispatch with configuration_required.

Recommended first active-workflow limit: one. It is a conservative proposed default, not a performance claim. Increase only after queue races, workspace isolation, cost reservations and recovery have passed.

## Agent powers

Profiles are fictional working personas, not human login accounts. The owner assigns scopes through server-enforced tool policy. A persona sentence or output approval does not authorize another action.

Initial pilot: read supplied/authorized project sources, create internal drafts/artifacts, make bounded role recommendations, review current revisions and record owner acceptance. Financial records remain owned by the existing backoffice services; sending, issuing, marking paid, voiding or mutating ledgers is not part of the pilot.

Adding a future tool requires explicit input/output schema, scope, limits, idempotency/reconciliation behavior, audit fields and an approval policy matched to its effect. Evidence and authorization must be recorded independently of agent prose.

## Windows hosting

Recheck documented local listeners and launch scripts before activation; do not change running services merely to match the planning snapshot. The documented app/database arrangement is detailed in specs/integration-and-execution.md.

Give the office worker its own hidden, supervised startup and health record. Browser visibility is not worker health. Distinguish worker offline, database unavailable, provider unavailable, connection expired and retry pending. Persist work through restarts; a PC that is off or sleeping cannot execute jobs. An always-on host or proper unattended service is a separate operating decision.

## Coding work for Sam and Theo

Register a project root and permitted repo/domains, create a task-owned checkout/worktree and constrain execution with real OS/executor isolation. A Git worktree alone is not a security boundary. Scrub secrets from the environment and enforce time/network/resource limits. A source file cannot instruct the executor to widen permissions.

If suitable isolation is absent, the agents can prepare plans and drafts; command execution stays unavailable. Return reviewable diffs, artifact links and verification evidence. Pushes, merges and production effects need their own enabled capability and approval scope.

## First successful live acceptance

Use a supplied website request to create the bounded internal proposal. Record real task/run/artifact/review IDs, model usage and the exact revision accepted by the owner. Demonstrate a recoverable error and browser reconnect. Do not claim a website was built or deployed by a proposal-only workflow.

## Operating decisions to record

Maintain a short decision record for provider, model alias, budgets, host, approved integrations, workspace roots, artifact retention and notification channel. The owner may choose these when dependent activation becomes concrete; do not interrupt independent build work simply because a live connection is absent.

