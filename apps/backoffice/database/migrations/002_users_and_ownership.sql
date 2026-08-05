-- Multi-user back office: named operators, per-client ownership, and the
-- authorization data the application layer scopes every read against.
--
-- Roles:
--   admin -- full access to every client, invoice, payment, and setting.
--   sales -- sees only clients they own; may draft invoices but never
--            finalize, void, or record payments.

CREATE TABLE IF NOT EXISTS backoffice.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL CHECK (
    email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254
  ),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  role text NOT NULL CHECK (role IN ('admin', 'sales')),
  -- Commission accrues on amounts actually received, not amounts invoiced.
  commission_rate_bps integer NOT NULL DEFAULT 0
    CHECK (commission_rate_bps BETWEEN 0 AND 10000),
  archived_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS backoffice_users_email_key
  ON backoffice.users (email);
CREATE INDEX IF NOT EXISTS backoffice_users_active_idx
  ON backoffice.users (role, lower(name)) WHERE archived_at IS NULL;

DROP TRIGGER IF EXISTS backoffice_users_updated_at ON backoffice.users;
CREATE TRIGGER backoffice_users_updated_at
BEFORE UPDATE ON backoffice.users
FOR EACH ROW EXECUTE FUNCTION backoffice.set_updated_at();

-- Client ownership. NULL means unassigned: visible to admins only, never to
-- a sales user. Ownership is assigned by an admin, never inferred from who
-- happened to create the record.
ALTER TABLE backoffice.clients
  ADD COLUMN IF NOT EXISTS owner_user_id uuid
    REFERENCES backoffice.users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS backoffice_clients_owner_idx
  ON backoffice.clients (owner_user_id, lower(name))
  WHERE archived_at IS NULL;

-- Widen the audit actor vocabulary. Existing 'owner' rows are deliberately
-- left untouched: backoffice.audit_events carries an immutability trigger and
-- rewriting recorded history would defeat the point of the log. 'owner' is the
-- historical single-operator value; new writes use 'admin' or 'sales'.
ALTER TABLE backoffice.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_actor_type_check;
ALTER TABLE backoffice.audit_events
  ADD CONSTRAINT audit_events_actor_type_check
  CHECK (actor_type IN ('owner', 'admin', 'sales', 'system'));
