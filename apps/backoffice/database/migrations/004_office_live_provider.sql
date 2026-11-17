-- Live model provider accounting for the Office pilot; no business tables are changed.
-- Defaults keep live execution disabled: live_enabled=false and every limit is zero until the
-- owner deliberately sets them. The worker role can only move reserved/spent amounts; it has no
-- privilege on these switches or limits (see apps/office-worker/office-role.example.sql).

ALTER TABLE backoffice.office_workers DROP CONSTRAINT office_workers_adapter_check;
ALTER TABLE backoffice.office_workers ADD CONSTRAINT office_workers_adapter_check
 CHECK (adapter IN ('deterministic_demo','openai_responses'));
-- Advertised by the worker for display only: provider name, model IDs, reasoning effort. Never secrets.
ALTER TABLE backoffice.office_workers ADD COLUMN capabilities jsonb NOT NULL DEFAULT '{}'
 CHECK (jsonb_typeof(capabilities)='object' AND octet_length(capabilities::text)<=2048);

-- limit_microunits (from 003) remains the lifetime ceiling across all live spend.
ALTER TABLE backoffice.office_budget
 ADD COLUMN live_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN monthly_limit_microunits bigint NOT NULL DEFAULT 0 CHECK (monthly_limit_microunits>=0),
 ADD COLUMN family_limit_microunits bigint NOT NULL DEFAULT 0 CHECK (family_limit_microunits>=0),
 ADD COLUMN request_limit_microunits bigint NOT NULL DEFAULT 0 CHECK (request_limit_microunits>=0);

-- A run's model call is "dispatched" from the moment its reservation commits. Until usage is
-- settled, a dispatched run retains its full reservation until explicit reconciliation.
ALTER TABLE backoffice.office_runs
 ADD COLUMN model text CHECK (model IS NULL OR length(model) BETWEEN 1 AND 64),
 ADD COLUMN provider_dispatched_at timestamptz,
 ADD COLUMN token_usage jsonb CHECK (token_usage IS NULL OR (jsonb_typeof(token_usage)='object' AND octet_length(token_usage::text)<=1024)),
 ADD COLUMN live_attempt_id uuid REFERENCES backoffice.office_runs(id);

-- Admission enforces the ceiling before dispatch. An observed provider overage is real debt:
-- it must be recordable in full even when it crosses that ceiling, then stop further live work.
ALTER TABLE backoffice.office_budget DROP CONSTRAINT office_budget_check;
CREATE INDEX office_runs_metered ON backoffice.office_runs(started_at) WHERE budget_reserved_microunits>0;
