# Backoffice Admin Dashboard — Audit

**Date:** 2026-07-31
**Scope:** `apps/backoffice/` (Next.js 16.2.10 + Postgres + Cloudflare Access)

---

## Verdict

**The dashboard works.** Build, typecheck, lint, and tests all pass. I booted it on
`127.0.0.1:3100` and drove the full client → invoice → payment lifecycle through the
real server actions against the live Postgres cluster (port 54329).

**But it cannot ship as-is** — production mode 500s on every page because the
Cloudflare Access env vars are empty. See Blockers below.

---

## What was verified end-to-end

All routes return 200: `/`, `/dashboard`, `/clients`, `/clients/new`, `/invoices`,
`/invoices/new`, `/settings`.

| Flow | Result |
|---|---|
| Create client | PASS — 303 → edit page, row persisted |
| Client shows in list w/ contact + location | PASS |
| Update client | PASS — version 1→2 |
| Stale-version replay (optimistic lock) | PASS — rejected, integrity held |
| Create draft invoice (2 line items) | PASS — Rp 20,000,000 + 11% = **Rp 22,200,000** |
| Finalize invoice | PASS — `INV-2026-000001`, status `sent`, snapshot + counter written |
| PDF generation | PASS — real 2,851-byte ReportLab PDF |
| Record payment | PASS — status → `paid` |
| Settings save | PASS |

Audit trail recorded correctly:

```
client.created | client.updated | invoice.created [null->draft]
| invoice.finalized [draft->sent] | payment.recorded [sent->paid]
```

The domain layer in `src/lib/server/clients.ts` is solid: Zod validation,
transactional writes, optimistic concurrency via `version`, audit event on every
mutation.

Schema is fully migrated — 12 tables under the `backoffice` schema.

---

## Blockers (must fix before production)

### 1. Production mode is dead on arrival — CRITICAL

All Cloudflare Access vars in `.env.local` are **empty strings**:

- `CLOUDFLARE_ACCESS_TEAM_DOMAIN`
- `CLOUDFLARE_ACCESS_AUDIENCE`
- `CLOUDFLARE_ACCESS_ALLOWED_EMAILS`

Dev only works because `.env.development.local` sets `CLOUDFLARE_ACCESS_DEV_BYPASS=true`.
**Production never loads that file**, so every protected page throws
`AccessAuthenticationError: misconfigured`. Already visible in
`.runtime/logs/next-production.err.log`.

### 2. Email is broken

`RESEND_FROM_EMAIL` and `RESEND_REPLY_TO` are empty → `emailInvoiceAction` returns
500 at `getEmailEnv()`. Confirmed live.

---

## Non-blocking issues

3. **R2 unconfigured** — degrades gracefully by design
   (`src/lib/server/invoice-delivery.ts:199`), PDFs still stream fine. Side effect:
   `recordInvoicePdf` never runs, so `invoice_documents` rows sit at
   `status: 'queued'` forever.

4. **No archive-client UI** — `archiveClient()` and `includeArchived` exist in the lib
   but nothing calls them. The list renders an "Archived" badge for a state you can't
   reach from the UI.

5. **Conflicts surface as a raw 500** — no "someone else changed this" message.

6. **Thin test coverage** — 6 tests, all in `money.test.ts`. Zero tests for clients,
   invoices, or auth.

---

## Git status

**The entire backoffice app is untracked. None of it is in git.**

- `apps/backoffice/` — 71 files would be added. Its local `.gitignore` correctly
  excludes `node_modules/`, `.venv/`, `.runtime/`, `.next/`, `.env*`
- Modified: `eslint.config.mjs` (+2), `package.json` (+3), `package-lock.json`
- Deleted: 16 images in `public/` (DSC*.jpg, drama*.jpg, event banners)
- New: 6 SEO-named `.webp` files in `public/`, `.claude/`, `.vercelignore`,
  `Enztronic.code-workspace`, `enztronic_rebrand_seo_implementation_brief.md`,
  `errorlog.md`
- `tsconfig.tsbuildinfo` — **not gitignored at repo root**, add before committing

---

## Outstanding cleanup

Two items I could not complete (the delete was blocked by the permission classifier):

- **Smoke-test data still in the database**: 1 client ("Smoke Test Client RENAMED"),
  1 paid invoice `INV-2026-000001`, 1 payment, 5 audit events, and the 2026 number
  counter sitting at 1.
- **Settings now hold values I submitted** during the test — Enztronic /
  PT Enztronic Digital / BCA payment instructions. Verify these are what you want.
- **Stray file** `apps/backoffice/!x.valid))` — 0 bytes, from a mistyped shell
  command. Would get committed.
