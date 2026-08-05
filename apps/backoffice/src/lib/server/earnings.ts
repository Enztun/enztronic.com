import "server-only";

import { getDb } from "@/lib/server/db";
import type { AccessScope } from "@/lib/server/session";

/**
 * Money actually received, and the commission accrued on it.
 *
 * Commission is deliberately calculated on payments received rather than on
 * invoiced totals -- an invoice a client never settles should not earn one.
 * Reversals subtract, so a refunded payment withdraws its commission too.
 */
export interface EarningsByCurrency {
  currency: string;
  receivedMinor: bigint;
  outstandingMinor: bigint;
  commissionMinor: bigint;
}

export interface EarningsSummary {
  byCurrency: EarningsByCurrency[];
  clientCount: number;
  paidInvoiceCount: number;
  openInvoiceCount: number;
  overdueInvoiceCount: number;
  commissionRateBps: number;
}

type ReceivedRow = {
  currency: string;
  received_minor: string;
  paid_invoice_count: string;
};

type OutstandingRow = {
  currency: string;
  outstanding_minor: string;
  open_count: string;
  overdue_count: string;
};

/**
 * Commission on a per-currency total. Rounds half-up at the minor unit, which
 * keeps the figure stable regardless of how the underlying payments were split.
 */
function commissionOn(receivedMinor: bigint, rateBps: number): bigint {
  if (rateBps <= 0 || receivedMinor <= 0n) return 0n;
  const scaled = receivedMinor * BigInt(rateBps);
  const half = 10_000n / 2n;
  return (scaled + half) / 10_000n;
}

export async function getEarningsSummary(
  scope: AccessScope,
): Promise<EarningsSummary> {
  const sql = getDb();
  const owner = scope.ownerUserId;
  const rateBps = scope.user.role === "sales" ? scope.user.commissionRateBps : 0;

  const [received, outstanding, clientCount] = await Promise.all([
    sql<ReceivedRow[]>`
      SELECT
        i.currency,
        COALESCE(SUM(
          CASE WHEN p.kind = 'payment' THEN p.amount_minor
               ELSE -p.amount_minor END
        ), 0)::text AS received_minor,
        COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'paid')::text
          AS paid_invoice_count
      FROM backoffice.invoice_payments p
      JOIN backoffice.invoices i ON i.id = p.invoice_id
      JOIN backoffice.clients c ON c.id = i.client_id
      WHERE (${owner}::uuid IS NULL OR c.owner_user_id = ${owner})
      GROUP BY i.currency
    `,
    sql<OutstandingRow[]>`
      SELECT
        i.currency,
        COALESCE(SUM(GREATEST(i.total_minor - paid.paid_minor, 0)), 0)::text
          AS outstanding_minor,
        COUNT(*)::text AS open_count,
        COUNT(*) FILTER (
          WHERE i.due_on < (now() AT TIME ZONE 'Asia/Jakarta')::date
        )::text AS overdue_count
      FROM backoffice.invoices i
      JOIN backoffice.clients c ON c.id = i.client_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(
          CASE WHEN p.kind = 'payment' THEN p.amount_minor
               ELSE -p.amount_minor END
        ), 0)::bigint AS paid_minor
        FROM backoffice.invoice_payments p
        WHERE p.invoice_id = i.id
      ) paid ON true
      WHERE i.status = 'sent'
        AND paid.paid_minor < i.total_minor
        AND (${owner}::uuid IS NULL OR c.owner_user_id = ${owner})
      GROUP BY i.currency
    `,
    sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM backoffice.clients c
      WHERE c.archived_at IS NULL
        AND (${owner}::uuid IS NULL OR c.owner_user_id = ${owner})
    `,
  ]);

  const currencies = new Map<string, EarningsByCurrency>();
  const ensure = (currency: string) => {
    let entry = currencies.get(currency);
    if (!entry) {
      entry = {
        currency,
        receivedMinor: 0n,
        outstandingMinor: 0n,
        commissionMinor: 0n,
      };
      currencies.set(currency, entry);
    }
    return entry;
  };

  let paidInvoiceCount = 0;
  for (const row of received) {
    const entry = ensure(row.currency);
    entry.receivedMinor = BigInt(row.received_minor);
    entry.commissionMinor = commissionOn(entry.receivedMinor, rateBps);
    paidInvoiceCount += Number(row.paid_invoice_count);
  }

  let openInvoiceCount = 0;
  let overdueInvoiceCount = 0;
  for (const row of outstanding) {
    const entry = ensure(row.currency);
    entry.outstandingMinor = BigInt(row.outstanding_minor);
    openInvoiceCount += Number(row.open_count);
    overdueInvoiceCount += Number(row.overdue_count);
  }

  return {
    byCurrency: [...currencies.values()].sort((a, b) =>
      a.currency.localeCompare(b.currency),
    ),
    clientCount: Number(clientCount[0]?.count ?? 0),
    paidInvoiceCount,
    openInvoiceCount,
    overdueInvoiceCount,
    commissionRateBps: rateBps,
  };
}
