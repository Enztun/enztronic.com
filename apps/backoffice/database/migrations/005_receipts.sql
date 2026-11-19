-- Clara's receipt intake. An admin uploads a proof of payment, Clara reads it,
-- and clear receipts are written to the Google Sheets ledger (the ledger of
-- record). These rows are the audit trail, the review queue and the handle
-- that Undo / Change category use to find the ledger row again.
--
-- Statuses:
--   needs_review -- not in the ledger yet; an admin must confirm or discard it.
--   recorded     -- written to the ledger as "Tercatat / Recorded".
--   undone       -- the ledger row was kept but marked "Dibatalkan / Undone".
--   discarded    -- never written to the ledger.

ALTER TABLE backoffice.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_entity_type_check;
ALTER TABLE backoffice.audit_events
  ADD CONSTRAINT audit_events_entity_type_check
  CHECK (entity_type IN ('business', 'client', 'invoice', 'payment', 'document', 'email', 'receipt'));

CREATE TABLE IF NOT EXISTS backoffice.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Written to column A of the ledger; how a row is found again after sorting.
  ledger_id text NOT NULL CHECK (ledger_id ~ '^R-[0-9]{8}-[0-9a-f]{6}$'),
  status text NOT NULL DEFAULT 'needs_review'
    CHECK (status IN ('needs_review', 'recorded', 'undone', 'discarded')),

  file_key text NOT NULL CHECK (length(file_key) BETWEEN 1 AND 300),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  content_type text NOT NULL
    CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  file_bytes integer NOT NULL CHECK (file_bytes > 0),
  file_sha256 char(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  note text CHECK (note IS NULL OR length(note) <= 1000),

  -- What Clara read, exactly as validated from the model. Never edited later.
  reading jsonb CHECK (reading IS NULL OR jsonb_typeof(reading) = 'object'),
  reading_error text CHECK (reading_error IS NULL OR length(reading_error) <= 120),
  review_reasons text[] NOT NULL DEFAULT '{}',

  -- The values that were (or will be) written to the ledger.
  txn_date date,
  kind text CHECK (kind IN ('expense', 'income', 'transfer')),
  category_code text CHECK (category_code ~ '^[0-9]{4}$'),
  payee text CHECK (payee IS NULL OR length(payee) BETWEEN 1 AND 200),
  amount_minor bigint CHECK (amount_minor > 0),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  paid_from text CHECK (paid_from IS NULL OR length(paid_from) <= 120),
  description text CHECK (description IS NULL OR length(description) <= 500),
  reference text CHECK (reference IS NULL OR length(reference) <= 120),
  clara_notes text CHECK (clara_notes IS NULL OR length(clara_notes) <= 1000),
  sheet_row integer CHECK (sheet_row >= 2),

  model text,
  charged_microunits bigint NOT NULL DEFAULT 0 CHECK (charged_microunits >= 0),

  uploaded_by text NOT NULL,
  recorded_by text,
  recorded_at timestamptz,
  closed_by text,
  closed_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT receipts_ledger_values_complete CHECK (
    status NOT IN ('recorded', 'undone') OR (
      txn_date IS NOT NULL AND kind IS NOT NULL AND category_code IS NOT NULL
      AND payee IS NOT NULL AND amount_minor IS NOT NULL AND currency IS NOT NULL
      AND recorded_by IS NOT NULL AND recorded_at IS NOT NULL AND sheet_row IS NOT NULL
    )
  ),
  CONSTRAINT receipts_closed_complete CHECK (
    status NOT IN ('undone', 'discarded') OR (closed_by IS NOT NULL AND closed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS backoffice_receipts_ledger_id_key
  ON backoffice.receipts (ledger_id);
CREATE INDEX IF NOT EXISTS backoffice_receipts_recent_idx
  ON backoffice.receipts (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS backoffice_receipts_file_idx
  ON backoffice.receipts (file_sha256) WHERE status <> 'discarded';
CREATE INDEX IF NOT EXISTS backoffice_receipts_amount_idx
  ON backoffice.receipts (amount_minor, currency, txn_date) WHERE status = 'recorded';

DROP TRIGGER IF EXISTS backoffice_receipts_updated_at ON backoffice.receipts;
CREATE TRIGGER backoffice_receipts_updated_at
BEFORE UPDATE ON backoffice.receipts
FOR EACH ROW EXECUTE FUNCTION backoffice.set_updated_at();
