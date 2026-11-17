import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/server/auth', () => ({ authenticateAccessHeaders: async () => ({ email: 'owner@example.test' }) }));

import { getDb, closeDbForTests } from './db';
import { archiveUser, createUser, getSessionUser, updateUser, type AccessScope } from './session';
import { createClient, getClient } from './clients';
import { createDraftInvoice, finalizeInvoice, getInvoice, recordPayment, reversePayment } from './invoices';
import { getEarningsSummary } from './earnings';

// Dedicated disposable DB only. Never fall back to DATABASE_URL from local setup.
const testUrl = process.env.OFFICE_ACCESS_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
let owner: AccessScope;
let sales: AccessScope;
let stranger: AccessScope;
suite('owner and financial preservation on a disposable PostgreSQL database', () => {
  beforeAll(async () => {
    const target = new URL(testUrl!);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !target.pathname.endsWith('_access_test') || target.port !== '55439') throw new Error('Disposable access-test database required');
    process.env.DATABASE_URL = testUrl!;
    const sql = getDb();
    // Destruction is confined to the explicitly named disposable database.
    await sql.unsafe('DROP SCHEMA IF EXISTS backoffice CASCADE');
    for (const file of ['001_init.sql', '002_users_and_ownership.sql']) await sql.unsafe(await readFile(`database/migrations/${file}`, 'utf8'));
    const a = await createUser({ name: 'Owner fixture', email: 'owner@example.test', role: 'admin', commissionRateBps: 0 });
    const b = await createUser({ name: 'Sales fixture', email: 'sales@example.test', role: 'sales', commissionRateBps: 500 });
    const c = await createUser({ name: 'Other sales fixture', email: 'other@example.test', role: 'sales', commissionRateBps: 200 });
    owner = { user: a, ownerUserId: null }; sales = { user: b, ownerUserId: b.id }; stranger = { user: c, ownerUserId: c.id };
  });
  afterAll(async () => { await closeDbForTests(); });

  it('retains the verified active human identity and rejects self-demotion/email replacement/archive', async () => {
    expect((await getSessionUser()).id).toBe(owner.user.id);
    const actor = { type: 'admin' as const, id: owner.user.email };
    await expect(updateUser(owner.user.id, { ...owner.user, role: 'sales' }, 1, actor)).rejects.toThrow('own administrator');
    await expect(updateUser(owner.user.id, { ...owner.user, email: 'changed@example.test' }, 1, actor)).rejects.toThrow('own administrator');
    await expect(archiveUser(owner.user.id, 1, actor)).rejects.toThrow('own account');
    expect((await getSessionUser()).role).toBe('admin');
  });

  it('serializes concurrent demotion so one active admin always survives', async () => {
    const second = await createUser({ name: 'Second admin', email: 'second@example.test', role: 'admin', commissionRateBps: 0 });
    const third = await createUser({ name: 'Third admin', email: 'third@example.test', role: 'admin', commissionRateBps: 0 });
    // No actor bypasses the last-admin invariant: this is the lower persistence API.
    const results = await Promise.allSettled([
      updateUser(second.id, { ...second, role: 'sales' }, 1),
      archiveUser(third.id, 1),
      updateUser(owner.user.id, { ...owner.user, role: 'sales' }, 1),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    const [remaining] = await getDb()`SELECT count(*)::int AS count FROM backoffice.users WHERE role='admin' AND archived_at IS NULL`;
    expect(remaining.count).toBe(1);
    // Restore only the fixture owner for the remainder of this isolated suite.
    await getDb()`UPDATE backoffice.users SET role='admin' WHERE id=${owner.user.id}`;
  });

  it('preserves ownership, immutable invoice snapshots, numbering, outbox, payments and commission reversals across the Office migration', async () => {
    const client = await createClient(sales, { name: 'Test client', email: 'client@example.test', defaultCurrency: 'IDR' });
    expect(client.ownerUserId).toBe(sales.user.id);
    expect(await getClient(stranger, client.id)).toBeNull();
    const draft = await createDraftInvoice(sales, { clientId: client.id, currency: 'IDR', issueOn: '2026-10-22', dueOn: '2026-11-05', items: [{ description: 'Internal fixture only', quantity: '1', unitPriceMinor: 100000n }] });
    expect(await getInvoice(stranger, draft.id)).toBeNull();
    const issued = await finalizeInvoice(owner, draft.id, draft.version, `fixture-finalize-${draft.id}`);
    expect(issued.invoiceNumber).toMatch(/^INV/);
    expect(issued.snapshot?.contentSha256).toHaveLength(64);
    const paid = await recordPayment(owner, { invoiceId: issued.id, amountMinor: 100000n, currency: 'IDR', idempotencyKey: `fixture-payment-${issued.id}` });
    expect((await getEarningsSummary(sales)).byCurrency[0].commissionMinor).toBe(5000n);
    const sql = getDb();
    const [before] = await sql`SELECT (SELECT count(*) FROM backoffice.audit_events)::text AS audit, (SELECT count(*) FROM backoffice.outbox_events)::text AS outbox`;
    await sql.unsafe(await readFile('database/migrations/003_office.sql', 'utf8'));
    await sql.unsafe(await readFile('database/migrations/004_office_live_provider.sql', 'utf8'));
    const after = await getInvoice(owner, issued.id);
    expect(after?.snapshot?.contentSha256).toBe(issued.snapshot?.contentSha256);
    expect(after?.invoiceNumber).toBe(issued.invoiceNumber);
    expect(after?.status).toBe('paid');
    expect((await getClient(owner, client.id))?.ownerUserId).toBe(sales.user.id);
    const [counts] = await sql`SELECT (SELECT count(*) FROM backoffice.audit_events)::text AS audit, (SELECT count(*) FROM backoffice.outbox_events)::text AS outbox`;
    expect(counts).toEqual(before);
    await reversePayment(owner, paid.payments[0].id, `fixture-reversal-${issued.id}`, 'Fixture refund');
    expect((await getEarningsSummary(sales)).byCurrency[0].commissionMinor).toBe(0n);
    await expect(sql`UPDATE backoffice.audit_events SET event_type='tamper'`).rejects.toThrow();
  });
});
