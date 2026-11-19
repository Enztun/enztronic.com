import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { closeDbForTests, DomainError, getDb } from "@/lib/server/db";

import { ledgerIdFor } from "./ledger";
import { createReceiptRepository, type ReceiptRepository } from "./repository";
import { reading } from "./test-fixtures";

// Dedicated disposable database only; never falls back to DATABASE_URL.
const testUrl = process.env.RECEIPTS_TEST_DATABASE_URL;
const suite = testUrl ? describe : describe.skip;
const actor = { type: "admin" as const, id: "owner@example.test" };

suite("receipt records on a disposable PostgreSQL database", () => {
  let repository: ReceiptRepository;
  let sql: ReturnType<typeof getDb>;

  const newReceipt = async (sha = "a".repeat(64)) => {
    const id = randomUUID();
    return repository.insert({
      id, ledgerId: ledgerIdFor(id, new Date()), fileKey: `receipts/2026/11/${id}.png`, fileName: "transfer.png",
      contentType: "image/png", fileBytes: 1234, fileSha256: sha, note: "Domain", uploadedBy: actor.id,
    }, actor);
  };
  const proposal = {
    txnDate: "2026-11-16", kind: "expense" as const, categoryCode: "6400", payee: "PT Jetorbit", amountMinor: 793100n,
    currency: "IDR", paidFrom: null, description: "Domain", reference: "75916", claraNotes: "Transfer successful.",
  };
  const recordedValues = (row: number) => ({ ...proposal, sheetRow: row, recordedBy: "Owner", recordedAt: new Date() });

  beforeAll(async () => {
    const target = new URL(testUrl!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.port !== "55439" || !target.pathname.endsWith("_receipts_test")) {
      throw new Error("Disposable receipts test database required");
    }
    process.env.DATABASE_URL = testUrl!;
    sql = getDb();
    // Destruction is confined to the explicitly named disposable database.
    await sql.unsafe("DROP SCHEMA IF EXISTS backoffice CASCADE");
    for (const file of ["001_init.sql", "002_users_and_ownership.sql", "003_office.sql", "004_office_live_provider.sql", "005_receipts.sql"]) {
      await sql.unsafe(await readFile(`database/migrations/${file}`, "utf8"));
    }
    repository = createReceiptRepository(sql);
  });
  afterAll(async () => {
    await closeDbForTests();
  });

  it("stores an upload, Clara's reading and the proposal exactly", async () => {
    const receipt = await newReceipt();
    expect(receipt).toMatchObject({ status: "needs_review", version: 1, reviewReasons: ["Clara is still reading this receipt."] });
    const big = { ...proposal, amountMinor: 12_345_678_901_234n };
    const saved = await repository.saveReading(receipt.id, {
      reading: reading(), readingError: null, reasons: ["Check the payee: Clara wasn't sure."], proposal: big, model: "gpt-6-luna", chargedMicrounits: 1500,
    });
    expect(saved).toMatchObject({ version: 2, txnDate: "2026-11-16", amountMinor: 12_345_678_901_234n, chargedMicrounits: 1500, model: "gpt-6-luna" });
    expect(saved.reading).toMatchObject({ payee: "PT Jetorbit", categoryCode: "6400" });
    await repository.flagForReview(receipt.id, "Second reason.");
    expect((await repository.get(receipt.id))!.reviewReasons).toEqual(["Check the payee: Clara wasn't sure.", "Second reason."]);
    expect(await repository.chargedThisMonth()).toBeGreaterThanOrEqual(1500);
  });

  it("refuses incomplete recorded rows and duplicate ledger ids at the database", async () => {
    const receipt = await newReceipt();
    await expect(sql`UPDATE backoffice.receipts SET status = 'recorded' WHERE id = ${receipt.id}`).rejects.toThrow(/receipts_ledger_values_complete/);
    await expect(sql`UPDATE backoffice.receipts SET status = 'undone' WHERE id = ${receipt.id}`).rejects.toThrow();
    const clash = randomUUID();
    await expect(repository.insert({
      id: clash, ledgerId: receipt.ledgerId, fileKey: `receipts/x/${clash}.png`, fileName: "x.png", contentType: "image/png",
      fileBytes: 1, fileSha256: "b".repeat(64), note: null, uploadedBy: actor.id,
    }, actor)).rejects.toThrow(/backoffice_receipts_ledger_id_key/);
  });

  it("records, undoes and audits in order, and serializes a double click", async () => {
    const receipt = await newReceipt("c".repeat(64));
    const saved = await repository.saveReading(receipt.id, { reading: reading(), readingError: null, reasons: [], proposal, model: "gpt-6-luna", chargedMicrounits: 0 });

    let writes = 0;
    const attempt = () => repository.withLock(saved.id, saved.version, async (locked, transaction) => {
      if (locked.status !== "needs_review") throw new DomainError("INVALID_STATE", "already handled");
      writes += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await repository.markRecorded(transaction, locked, recordedValues(7), actor, false);
    });
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(writes).toBe(1);

    const recorded = (await repository.get(receipt.id))!;
    expect(recorded).toMatchObject({ status: "recorded", sheetRow: 7, recordedBy: "Owner", reviewReasons: [] });
    await repository.withLock(recorded.id, recorded.version, (locked, transaction) =>
      repository.markClosed(transaction, locked, "undone", "Owner", actor, 9));
    expect((await repository.get(receipt.id))!).toMatchObject({ status: "undone", closedBy: "Owner", sheetRow: 9 });
    await expect(repository.withLock(recorded.id, recorded.version, async () => undefined)).rejects.toMatchObject({ code: "CONFLICT" });

    const events = await sql<{ event_type: string }[]>`
      SELECT event_type FROM backoffice.audit_events WHERE entity_type = 'receipt' AND entity_id = ${receipt.id} ORDER BY id
    `;
    expect(events.map((event) => event.event_type)).toEqual(["receipt.uploaded", "receipt.recorded", "receipt.undone"]);
  });

  it("finds the same file and the same recorded payment, ignoring discarded uploads", async () => {
    const first = await newReceipt("d".repeat(64));
    const firstSaved = await repository.saveReading(first.id, { reading: reading(), readingError: null, reasons: [], proposal: { ...proposal, amountMinor: 555n }, model: null, chargedMicrounits: 0 });
    await repository.withLock(first.id, firstSaved.version, (locked, transaction) =>
      repository.markRecorded(transaction, locked, { ...recordedValues(3), amountMinor: 555n }, actor, true));

    const again = await newReceipt("d".repeat(64));
    expect(await repository.duplicates({ id: again.id, sha256: "d".repeat(64), amountMinor: 555n, currency: "IDR", txnDate: "2026-11-16" }))
      .toEqual([{ ledgerId: first.ledgerId, reason: "same_file" }]);
    expect(await repository.duplicates({ id: again.id, sha256: "e".repeat(64), amountMinor: 555n, currency: "IDR", txnDate: "2026-11-16" }))
      .toEqual([{ ledgerId: first.ledgerId, reason: "same_payment" }]);
    expect(await repository.duplicates({ id: again.id, sha256: "e".repeat(64), amountMinor: 556n, currency: "IDR", txnDate: "2026-11-16" })).toEqual([]);

    const discarded = await newReceipt("f".repeat(64));
    await repository.withLock(discarded.id, discarded.version, (locked, transaction) =>
      repository.markClosed(transaction, locked, "discarded", "Owner", actor));
    expect(await repository.duplicates({ id: again.id, sha256: "f".repeat(64), amountMinor: null, currency: null, txnDate: null })).toEqual([]);
    expect((await repository.list(10)).length).toBeGreaterThanOrEqual(4);
  });
});
