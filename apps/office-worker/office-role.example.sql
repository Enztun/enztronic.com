-- REVIEW ONLY. An existing database owner must provision a login securely and choose
-- its own role name/password/connection rules. Never run this against production as
-- part of ordinary implementation. Substitute the reviewed non-login grant role.
-- CREATE ROLE enztronic_office_runtime NOLOGIN;
-- Use a NEW role with no inherited memberships. This file grants capabilities;
-- it cannot remove elevated privileges inherited from another role or PUBLIC.
-- The 003 migration guards are required; applying grants alone is insufficient.
GRANT USAGE ON SCHEMA backoffice TO enztronic_office_runtime;
GRANT EXECUTE ON FUNCTION backoffice.office_authorized_owner(uuid) TO enztronic_office_runtime;
GRANT SELECT ON backoffice.office_agents, backoffice.office_agent_profiles,
 backoffice.office_workspaces, backoffice.office_workspace_grants,
 backoffice.office_tasks, backoffice.office_task_dependencies, backoffice.office_runs,
 backoffice.office_run_steps, backoffice.office_artifacts, backoffice.office_reviews,
 backoffice.office_approvals, backoffice.office_acceptance_evidence,
 backoffice.office_handoffs, backoffice.office_events, backoffice.office_schedules,
 backoffice.office_dispatch, backoffice.office_tool_operations,
 backoffice.office_workers, backoffice.office_budget TO enztronic_office_runtime;
GRANT INSERT, UPDATE ON backoffice.office_runs,
 backoffice.office_run_steps, backoffice.office_reviews,
 backoffice.office_handoffs, backoffice.office_dispatch,
 backoffice.office_tool_operations, backoffice.office_workers
 TO enztronic_office_runtime;
-- Owner identifiers and approval/evidence metadata are not writable. Task INSERT
-- is needed for existing owner-approved schedules; state defaults to queued.
GRANT INSERT(workspace_id,parent_task_id,initiating_owner_id,agent_id,goal,brief,
 mode,idempotency_key,input_hash,stage) ON backoffice.office_tasks
 TO enztronic_office_runtime;
GRANT UPDATE(state,stage,current_artifact_id,blocked_reason,version,updated_at)
 ON backoffice.office_tasks TO enztronic_office_runtime;
GRANT INSERT(workspace_id,task_id,artifact_id,artifact_hash,action_scope,state,expires_at)
 ON backoffice.office_approvals TO enztronic_office_runtime;
GRANT UPDATE(state,version) ON backoffice.office_approvals TO enztronic_office_runtime;
GRANT INSERT ON backoffice.office_artifacts, backoffice.office_events,
 backoffice.office_task_dependencies
 TO enztronic_office_runtime;
GRANT UPDATE(enabled,next_at) ON backoffice.office_schedules TO enztronic_office_runtime;
GRANT UPDATE(reserved_microunits,spent_microunits) ON backoffice.office_budget TO enztronic_office_runtime;
GRANT UPDATE(event_sequence) ON backoffice.office_workspaces TO enztronic_office_runtime;
-- No user/client/invoice/payment/outbox/audit privileges. No workspace registry or
-- permission changes, artifact/event rewrites, profile editing or approval bypass.
-- Migration 004's live switch and monthly/proposal/request limits on office_budget
-- are owner-only too; the worker preflight refuses a role that can change them.
-- No acceptance INSERT, owner-decision columns, task acceptance columns, budget
-- limits, schedule creation/template changes/re-enabling or completed-task edits.
-- Trigger guards reject state/event shortcuts and immutable owner decisions.
-- This is a TRUSTED worker capable of writing draft/review/run records, not an
-- execution sandbox for malicious code or model-produced SQL. Do not expose SQL
-- or this connection to agents, the browser, commands, documents or repositories.
-- App owner-decision APIs retain existing authenticated application authorization.
-- Confirm dedicated role privileges and denied financial mutations on disposable
-- fixtures before separately authorizing login/service activation.
