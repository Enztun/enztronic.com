CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS backoffice;

CREATE TABLE IF NOT EXISTS backoffice.business_profile (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name text NOT NULL CHECK (length(btrim(business_name)) BETWEEN 1 AND 160),
  legal_name text,
  email text,
  phone text,
  tax_id text,
  billing_address jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(billing_address) = 'object'),
  default_currency char(3) NOT NULL DEFAULT 'IDR' CHECK (default_currency ~ '^[A-Z]{3}$'),
  invoice_prefix text NOT NULL DEFAULT 'INV' CHECK (invoice_prefix ~ '^[A-Z][A-Z0-9-]{1,11}$'),
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  default_payment_terms_days integer NOT NULL DEFAULT 14
    CHECK (default_payment_terms_days BETWEEN 0 AND 365),
  email_from_name text,
  email_reply_to text,
  payment_instructions text,
  logo_storage_key text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO backoffice.business_profile (id, business_name)
VALUES (1, 'Enztronic')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS backoffice.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  company_name text,
  email text NOT NULL CHECK (length(btrim(email)) BETWEEN 3 AND 254),
  phone text,
  tax_id text,
  billing_address jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(billing_address) = 'object'),
  default_currency char(3) NOT NULL DEFAULT 'IDR' CHECK (default_currency ~ '^[A-Z]{3}$'),
  archived_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backoffice_clients_name_idx
  ON backoffice.clients (lower(name));
CREATE INDEX IF NOT EXISTS backoffice_clients_email_idx
  ON backoffice.clients (lower(email));
CREATE INDEX IF NOT EXISTS backoffice_clients_active_idx
  ON backoffice.clients (created_at DESC) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS backoffice.invoice_number_counters (
  scope_year integer PRIMARY KEY CHECK (scope_year BETWEEN 2000 AND 9999),
  last_value bigint NOT NULL CHECK (last_value > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backoffice.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES backoffice.clients(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  invoice_number text UNIQUE,
  number_year integer,
  number_serial bigint,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  issue_on date NOT NULL,
  due_on date NOT NULL,
  notes text,
  terms text,
  subtotal_minor bigint NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  finalize_idempotency_key text UNIQUE,
  finalized_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backoffice_invoice_due_date CHECK (due_on >= issue_on),
  CONSTRAINT backoffice_invoice_number_pair UNIQUE (number_year, number_serial),
  CONSTRAINT backoffice_invoice_totals CHECK (
    total_minor = subtotal_minor - discount_minor + tax_minor
  ),
  CONSTRAINT backoffice_invoice_finalization_shape CHECK (
    (
      status = 'draft'
      AND invoice_number IS NULL
      AND number_year IS NULL
      AND number_serial IS NULL
      AND finalized_at IS NULL
    )
    OR
    (
      status IN ('sent', 'paid', 'void')
      AND invoice_number IS NOT NULL
      AND number_year IS NOT NULL
      AND number_serial IS NOT NULL
      AND finalized_at IS NOT NULL
    )
  ),
  CONSTRAINT backoffice_invoice_paid_shape CHECK (
    (status = 'paid' AND paid_at IS NOT NULL)
    OR (status <> 'paid' AND paid_at IS NULL)
  ),
  CONSTRAINT backoffice_invoice_void_shape CHECK (
    (status = 'void' AND voided_at IS NOT NULL AND length(btrim(void_reason)) > 0)
    OR (status <> 'void' AND voided_at IS NULL AND void_reason IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS backoffice_invoices_client_idx
  ON backoffice.invoices (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS backoffice_invoices_status_due_idx
  ON backoffice.invoices (status, due_on);
CREATE INDEX IF NOT EXISTS backoffice_invoices_created_idx
  ON backoffice.invoices (created_at DESC);

CREATE TABLE IF NOT EXISTS backoffice.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES backoffice.invoices(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_rate_bps integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 100000),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backoffice_invoice_item_position UNIQUE (invoice_id, position),
  CONSTRAINT backoffice_invoice_item_subtotal CHECK (
    subtotal_minor = round(quantity * unit_price_minor)::bigint
  ),
  CONSTRAINT backoffice_invoice_item_discount CHECK (discount_minor <= subtotal_minor),
  CONSTRAINT backoffice_invoice_item_tax CHECK (
    tax_minor = round(
      (subtotal_minor - discount_minor)::numeric * tax_rate_bps::numeric / 10000
    )::bigint
  ),
  CONSTRAINT backoffice_invoice_item_total CHECK (
    total_minor = subtotal_minor - discount_minor + tax_minor
  )
);

CREATE INDEX IF NOT EXISTS backoffice_invoice_items_invoice_idx
  ON backoffice.invoice_items (invoice_id, position);

CREATE TABLE IF NOT EXISTS backoffice.invoice_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL UNIQUE REFERENCES backoffice.invoices(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL UNIQUE,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  template_version text NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor bigint NOT NULL CHECK (discount_minor >= 0),
  tax_minor bigint NOT NULL CHECK (tax_minor >= 0),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backoffice_snapshot_totals CHECK (
    total_minor = subtotal_minor - discount_minor + tax_minor
  )
);

CREATE TABLE IF NOT EXISTS backoffice.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES backoffice.invoices(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('payment', 'reversal')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  paid_at timestamptz NOT NULL,
  method text,
  provider text,
  external_reference text,
  idempotency_key text NOT NULL UNIQUE,
  reverses_payment_id uuid REFERENCES backoffice.invoice_payments(id) ON DELETE RESTRICT,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backoffice_payment_reversal_shape CHECK (
    (kind = 'payment' AND reverses_payment_id IS NULL)
    OR (kind = 'reversal' AND reverses_payment_id IS NOT NULL)
  ),
  CONSTRAINT backoffice_one_reversal_per_payment UNIQUE (reverses_payment_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS backoffice_payment_provider_reference_idx
  ON backoffice.invoice_payments (provider, external_reference)
  WHERE provider IS NOT NULL AND external_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS backoffice_payments_invoice_idx
  ON backoffice.invoice_payments (invoice_id, created_at);

CREATE TABLE IF NOT EXISTS backoffice.invoice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES backoffice.invoices(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES backoffice.invoice_snapshots(id) ON DELETE RESTRICT,
  kind text NOT NULL DEFAULT 'invoice_pdf' CHECK (kind IN ('invoice_pdf', 'receipt_pdf')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'ready', 'failed')),
  template_version text NOT NULL,
  storage_key text,
  content_type text,
  byte_size bigint CHECK (byte_size IS NULL OR byte_size > 0),
  content_sha256 char(64) CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text,
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backoffice_document_ready_shape CHECK (
    status <> 'ready'
    OR (
      storage_key IS NOT NULL
      AND content_type IS NOT NULL
      AND byte_size IS NOT NULL
      AND content_sha256 IS NOT NULL
      AND generated_at IS NOT NULL
    )
  ),
  CONSTRAINT backoffice_document_version UNIQUE (snapshot_id, kind, template_version)
);

CREATE TABLE IF NOT EXISTS backoffice.invoice_email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES backoffice.invoices(id) ON DELETE RESTRICT,
  snapshot_id uuid NOT NULL REFERENCES backoffice.invoice_snapshots(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('invoice', 'reminder', 'receipt')),
  recipient text NOT NULL CHECK (length(btrim(recipient)) BETWEEN 3 AND 254),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'cancelled')),
  provider text,
  provider_message_id text,
  idempotency_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error_code text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS backoffice_email_provider_message_idx
  ON backoffice.invoice_email_messages (provider, provider_message_id)
  WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS backoffice_email_invoice_idx
  ON backoffice.invoice_email_messages (invoice_id, created_at DESC);

CREATE TABLE IF NOT EXISTS backoffice.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  aggregate_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backoffice_outbox_pending_idx
  ON backoffice.outbox_events (available_at, created_at)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS backoffice.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('business', 'client', 'invoice', 'payment', 'document', 'email')),
  entity_id uuid,
  invoice_id uuid REFERENCES backoffice.invoices(id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('owner', 'system')),
  actor_id text,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  request_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backoffice_audit_entity_id CHECK (
    entity_type = 'business' OR entity_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS backoffice_audit_invoice_idx
  ON backoffice.audit_events (invoice_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS backoffice_audit_entity_idx
  ON backoffice.audit_events (entity_type, entity_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION backoffice.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION backoffice.guard_invoice_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status <> NEW.status AND NOT (
    (OLD.status = 'draft' AND NEW.status = 'sent')
    OR (OLD.status = 'sent' AND NEW.status IN ('paid', 'void'))
    OR (OLD.status = 'paid' AND NEW.status = 'sent')
  ) THEN
    RAISE EXCEPTION 'Invalid invoice status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status <> 'draft' AND ROW(
    OLD.client_id,
    OLD.invoice_number,
    OLD.number_year,
    OLD.number_serial,
    OLD.currency,
    OLD.issue_on,
    OLD.due_on,
    OLD.notes,
    OLD.terms,
    OLD.subtotal_minor,
    OLD.discount_minor,
    OLD.tax_minor,
    OLD.total_minor,
    OLD.finalize_idempotency_key,
    OLD.finalized_at
  ) IS DISTINCT FROM ROW(
    NEW.client_id,
    NEW.invoice_number,
    NEW.number_year,
    NEW.number_serial,
    NEW.currency,
    NEW.issue_on,
    NEW.due_on,
    NEW.notes,
    NEW.terms,
    NEW.subtotal_minor,
    NEW.discount_minor,
    NEW.tax_minor,
    NEW.total_minor,
    NEW.finalize_idempotency_key,
    NEW.finalized_at
  ) THEN
    RAISE EXCEPTION 'Finalized invoice commercial fields are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION backoffice.guard_invoice_item_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_status text;
  parent_id uuid;
BEGIN
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  SELECT status INTO parent_status
  FROM backoffice.invoices
  WHERE id = parent_id
  FOR UPDATE;

  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'Invoice does not exist' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Items on a finalized invoice are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION backoffice.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$function$;

CREATE OR REPLACE FUNCTION backoffice.require_invoice_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status <> 'draft' AND NOT EXISTS (
    SELECT 1 FROM backoffice.invoice_snapshots WHERE invoice_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Finalized invoice requires an immutable snapshot'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION backoffice.validate_payment_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  parent_invoice backoffice.invoices%ROWTYPE;
  original_payment backoffice.invoice_payments%ROWTYPE;
  current_paid bigint;
  new_paid bigint;
BEGIN
  SELECT * INTO parent_invoice
  FROM backoffice.invoices
  WHERE id = NEW.invoice_id
  FOR UPDATE;

  IF parent_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Invoice does not exist' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF parent_invoice.status NOT IN ('sent', 'paid') THEN
    RAISE EXCEPTION 'Payments require a sent or paid invoice'
      USING ERRCODE = 'check_violation';
  END IF;
  IF parent_invoice.currency <> NEW.currency THEN
    RAISE EXCEPTION 'Payment currency must match invoice currency'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(
    CASE WHEN kind = 'payment' THEN amount_minor ELSE -amount_minor END
  ), 0)::bigint
  INTO current_paid
  FROM backoffice.invoice_payments
  WHERE invoice_id = NEW.invoice_id;

  IF NEW.kind = 'payment' THEN
    new_paid := current_paid + NEW.amount_minor;
    IF new_paid > parent_invoice.total_minor THEN
      RAISE EXCEPTION 'Payment would exceed the invoice balance'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT * INTO original_payment
    FROM backoffice.invoice_payments
    WHERE id = NEW.reverses_payment_id
    FOR UPDATE;

    IF original_payment.id IS NULL
      OR original_payment.invoice_id <> NEW.invoice_id
      OR original_payment.kind <> 'payment'
      OR original_payment.amount_minor <> NEW.amount_minor THEN
      RAISE EXCEPTION 'Reversal must fully reference a payment on the same invoice'
        USING ERRCODE = 'check_violation';
    END IF;

    new_paid := current_paid - NEW.amount_minor;
    IF new_paid < 0 THEN
      RAISE EXCEPTION 'Reversal would make the paid balance negative'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS backoffice_business_updated_at ON backoffice.business_profile;
CREATE TRIGGER backoffice_business_updated_at
BEFORE UPDATE ON backoffice.business_profile
FOR EACH ROW EXECUTE FUNCTION backoffice.set_updated_at();

DROP TRIGGER IF EXISTS backoffice_clients_updated_at ON backoffice.clients;
CREATE TRIGGER backoffice_clients_updated_at
BEFORE UPDATE ON backoffice.clients
FOR EACH ROW EXECUTE FUNCTION backoffice.set_updated_at();

DROP TRIGGER IF EXISTS backoffice_invoices_guard ON backoffice.invoices;
CREATE TRIGGER backoffice_invoices_guard
BEFORE UPDATE ON backoffice.invoices
FOR EACH ROW EXECUTE FUNCTION backoffice.guard_invoice_update();

DROP TRIGGER IF EXISTS backoffice_invoices_updated_at ON backoffice.invoices;
CREATE TRIGGER backoffice_invoices_updated_at
BEFORE UPDATE ON backoffice.invoices
FOR EACH ROW EXECUTE FUNCTION backoffice.set_updated_at();

DROP TRIGGER IF EXISTS backoffice_invoice_items_guard ON backoffice.invoice_items;
CREATE TRIGGER backoffice_invoice_items_guard
BEFORE INSERT OR UPDATE OR DELETE ON backoffice.invoice_items
FOR EACH ROW EXECUTE FUNCTION backoffice.guard_invoice_item_mutation();

DROP TRIGGER IF EXISTS backoffice_invoice_items_updated_at ON backoffice.invoice_items;
CREATE TRIGGER backoffice_invoice_items_updated_at
BEFORE UPDATE ON backoffice.invoice_items
FOR EACH ROW EXECUTE FUNCTION backoffice.set_updated_at();

DROP TRIGGER IF EXISTS backoffice_invoice_snapshot_immutable ON backoffice.invoice_snapshots;
CREATE TRIGGER backoffice_invoice_snapshot_immutable
BEFORE UPDATE OR DELETE ON backoffice.invoice_snapshots
FOR EACH ROW EXECUTE FUNCTION backoffice.reject_mutation();

DROP TRIGGER IF EXISTS backoffice_invoice_snapshot_required ON backoffice.invoices;
CREATE CONSTRAINT TRIGGER backoffice_invoice_snapshot_required
AFTER INSERT OR UPDATE OF status ON backoffice.invoices
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION backoffice.require_invoice_snapshot();

DROP TRIGGER IF EXISTS backoffice_payment_validate ON backoffice.invoice_payments;
CREATE TRIGGER backoffice_payment_validate
BEFORE INSERT ON backoffice.invoice_payments
FOR EACH ROW EXECUTE FUNCTION backoffice.validate_payment_insert();

DROP TRIGGER IF EXISTS backoffice_payment_immutable ON backoffice.invoice_payments;
CREATE TRIGGER backoffice_payment_immutable
BEFORE UPDATE OR DELETE ON backoffice.invoice_payments
FOR EACH ROW EXECUTE FUNCTION backoffice.reject_mutation();

DROP TRIGGER IF EXISTS backoffice_documents_updated_at ON backoffice.invoice_documents;
CREATE TRIGGER backoffice_documents_updated_at
BEFORE UPDATE ON backoffice.invoice_documents
FOR EACH ROW EXECUTE FUNCTION backoffice.set_updated_at();

DROP TRIGGER IF EXISTS backoffice_emails_updated_at ON backoffice.invoice_email_messages;
CREATE TRIGGER backoffice_emails_updated_at
BEFORE UPDATE ON backoffice.invoice_email_messages
FOR EACH ROW EXECUTE FUNCTION backoffice.set_updated_at();

DROP TRIGGER IF EXISTS backoffice_outbox_updated_at ON backoffice.outbox_events;
CREATE TRIGGER backoffice_outbox_updated_at
BEFORE UPDATE ON backoffice.outbox_events
FOR EACH ROW EXECUTE FUNCTION backoffice.set_updated_at();

DROP TRIGGER IF EXISTS backoffice_audit_immutable ON backoffice.audit_events;
CREATE TRIGGER backoffice_audit_immutable
BEFORE UPDATE OR DELETE ON backoffice.audit_events
FOR EACH ROW EXECUTE FUNCTION backoffice.reject_mutation();
