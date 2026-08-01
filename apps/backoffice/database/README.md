# Back-office database

The back office uses PostgreSQL through `postgres.js`. Monetary values are stored
as `bigint` minor units; quantities are decimal strings with up to six fractional
digits.

Set `DATABASE_URL` in the process environment, then run:

```powershell
npm run db:migrate
```

The runner serializes concurrent migration attempts with a PostgreSQL advisory
lock and rejects edits to migrations that have already been recorded in
`backoffice.schema_migrations`.

Invoice numbers are allocated only when a draft is finalized. The counter,
immutable snapshot, invoice state, audit event, and PDF/email outbox entries are
committed in one transaction. `overdue` is a derived display state based on the
Asia/Jakarta calendar date; the persisted states are `draft`, `sent`, `paid`, and
`void`.
