-- REVIEW ONLY. Owner-run, after migration 004 is applied in an approved window and the worker has
-- its Office-only OpenAI key. Amounts are microunits: 1,000,000 = USD 1. These are the reviewed
-- pilot limits from docs/office/PROPOSED-LIVE-PILOT.md; change them deliberately, never upward to
-- "get unstuck". The worker role cannot change any of these columns.
BEGIN;
UPDATE backoffice.office_budget SET
  limit_microunits = 10000000,          -- overall ceiling across all live spend: USD 10
  monthly_limit_microunits = 10000000,  -- per UTC calendar month: USD 10
  family_limit_microunits = 1000000,    -- per proposal (package, children, reviews, retries, revisions): USD 1
  request_limit_microunits = 150000,    -- per single model request, reserved before dispatch: USD 0.15
  live_enabled = true
WHERE id = 1;
SELECT live_enabled, limit_microunits, monthly_limit_microunits, family_limit_microunits, request_limit_microunits, reserved_microunits, spent_microunits FROM backoffice.office_budget WHERE id = 1;
COMMIT;

-- Switch live execution off again (new live requests are recorded as blocked; nothing else changes):
-- UPDATE backoffice.office_budget SET live_enabled = false WHERE id = 1;
