# Receipts: Clara reads proofs of payment into the ledger

An admin uploads a transfer screenshot or a PDF on **Receipts**, with an optional
note about what it was for. Clara, the finance role, reads it and fills the
ledger fields. What happens next depends on the receipt:

- **Recorded straight away** when it is clearly a completed payment in Rupiah,
  every field was read with high confidence, the date isn't in the future, the
  category's rule in the ledger is *Otomatis / Auto*, and it doesn't look like a
  file or payment already recorded. The page then offers **Undo** and
  **Change category**.
- **Held for review** otherwise: bills and payment instructions, anything Clara
  wasn't sure about, foreign currency, duplicates, and every *Tanya dulu / Ask
  first* category (equipment, entertainment, internal transfers, owner drawings,
  tax payments, income and *Other*). Nothing is written until an admin checks the
  fields and presses **Record in ledger**, or discards the receipt.

**Undo** never deletes a row. It sets the ledger row's status to *Dibatalkan /
Undone* and adds a note, so the sheet keeps its history. Rows are found by
their ID in column A, so sorting or inserting rows in the sheet is safe.

Clara never decides a tax treatment: tax payments go to category 8300 for the
accountant, and equipment that may be a fixed asset is always held for review.

## What is stored where

| Item | Location |
| --- | --- |
| Uploaded file | Private R2 bucket, `receipts/YYYY/MM/<id>.<ext>`, like invoice PDFs |
| What Clara read, review reasons, who recorded or undid what | `backoffice.receipts` and `backoffice.audit_events` |
| The ledger itself | The Google Sheet: tabs `Ledger`, `Kategori` (categories and Clara's rules), `Ringkasan` |

The category list and each category's rule are read from the `Kategori` tab,
so editing that tab changes Clara's behaviour within five minutes.

## One-time setup

### 1. OpenAI key for receipts only

Create a separate OpenAI project for receipts, set a monthly budget on it in the
OpenAI dashboard, and create an API key in that project. Do not reuse the Office
worker's key or any website key. The app also enforces its own monthly limit
(`RECEIPTS_MONTHLY_BUDGET_USD`, default 5). When that limit is reached, uploads
are still stored but wait for manual entry.

### 2. Google service account

1. In Google Cloud Console, create a project and enable the **Google Sheets API**.
2. **IAM & Admin → Service Accounts → Create service account**. It needs no
   project roles. Copy its email address.
3. Open the account, go to **Keys → Add key → Create new key → JSON**, and save
   the downloaded file outside this repository, readable only by the Windows
   account that runs the backoffice. Never commit it or paste its contents anywhere.
4. Share the ledger spreadsheet with the service account's email as **Editor**.
   The account can reach nothing else.

### 3. Environment

Add these to the backoffice's `.env.local` (see `.env.example`):

| Variable | Value |
| --- | --- |
| `RECEIPTS_ENABLED` | `true` to allow uploads |
| `OPENAI_RECEIPTS_API_KEY` | The receipts-only key from step 1 |
| `OPENAI_RECEIPTS_MODEL` / `OPENAI_RECEIPTS_REASONING_EFFORT` | Optional; default `gpt-6-luna` / `low`. Must be priced in `src/lib/office-runtime/live-pricing.ts` |
| `RECEIPTS_MONTHLY_BUDGET_USD` | Optional app-side cap, default `5` |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | Absolute path to the JSON key file |
| `LEDGER_SPREADSHEET_ID` | The ID in the ledger's URL, between `/d/` and `/edit` |
| `BACKOFFICE_PUBLIC_URL` | Optional `https://` origin, used for the receipt link in column K |

Apply the database migration (`pnpm run db:migrate`) and restart the app. The
Receipts page shows a checklist until every required item is set.

## Limits and safeguards

- Admins only; every action re-checks the role on the server.
- PNG, JPEG, WebP or PDF up to 5 MB. The type is taken from the file's bytes,
  never from its name.
- Text from receipts is written to the sheet as plain values, never formulas.
- Requests to OpenAI are not stored (`store: false`), use no tools, and are
  sent once. A failed or uncertain call is charged against the monthly limit at
  its maximum possible cost.
- Text inside a receipt or the note is treated as data, not instructions. In
  any case, Clara's reading never bypasses the rules above.
