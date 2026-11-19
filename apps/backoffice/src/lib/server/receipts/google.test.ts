import { exportPKCS8, generateKeyPair, jwtVerify, type CryptoKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { createSheetsClient, LedgerUnavailableError, parseServiceAccount, type ServiceAccount } from "./google";
import { FAKE_ACCESS_TOKEN, PEM_HEADER, SHEET_CATEGORY_ROWS } from "./test-fixtures";

const EMAIL = "clara-ledger@enztronic-ledger.iam.gserviceaccount.com";
const SHEET = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";

let account: ServiceAccount;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  publicKey = pair.publicKey;
  account = { clientEmail: EMAIL, privateKey: await exportPKCS8(pair.privateKey), privateKeyId: null };
});

type Call = { url: URL; init: RequestInit; body: string };

function fakeGoogle(routes: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: new URL(String(input)), init, body: typeof init.body === "string" ? init.body : "" };
    calls.push(call);
    if (call.url.origin === "https://oauth2.googleapis.com") {
      const assertion = new URLSearchParams(call.body).get("assertion") ?? "";
      const { payload } = await jwtVerify(assertion, publicKey, { issuer: EMAIL, audience: "https://oauth2.googleapis.com/token" });
      if (payload.scope !== "https://www.googleapis.com/auth/spreadsheets") return new Response("{}", { status: 400 });
      return Response.json({ access_token: FAKE_ACCESS_TOKEN, expires_in: 3600 });
    }
    if ((init.headers as Record<string, string>).authorization !== `Bearer ${FAKE_ACCESS_TOKEN}`) return new Response("{}", { status: 401 });
    return routes(call) ?? new Response("{}", { status: 404 });
  };
  const client = createSheetsClient({ spreadsheetId: SHEET, account: async () => account, fetch: fetch as typeof globalThis.fetch });
  return { client, calls };
}

const path = (call: Call) => decodeURIComponent(call.url.pathname);

describe("ledger spreadsheet client", () => {
  it("signs in as the service account once and reads the category tab", async () => {
    const { client, calls } = fakeGoogle((call) =>
      path(call).endsWith("/values/Kategori!A2:E200") ? Response.json({ values: SHEET_CATEGORY_ROWS }) : undefined);
    const categories = await client.categories();
    await client.categories();
    expect(categories.map((category) => category.code)).toContain("6900");
    expect(calls.filter((call) => call.url.origin === "https://oauth2.googleapis.com")).toHaveLength(1);
  });

  it("appends raw values into the next formatted row and reports the row", async () => {
    const { client, calls } = fakeGoogle((call) =>
      path(call).endsWith("/values/Ledger!A:O:append") ? Response.json({ updates: { updatedRange: "Ledger!A5:O5" } }) : undefined);
    const cells = Array.from({ length: 15 }, (_, index) => (index === 4 ? "=HYPERLINK(\"x\")" : index));
    expect(await client.appendLedgerRow(cells)).toBe(5);
    const append = calls.at(-1)!;
    expect(append.url.searchParams.get("valueInputOption")).toBe("RAW");
    expect(append.url.searchParams.get("insertDataOption")).toBe("OVERWRITE");
    expect(JSON.parse(append.body).values).toEqual([cells]);
    await expect(client.appendLedgerRow([1, 2])).rejects.toThrow(RangeError);
  });

  it("finds a row by its ledger id even after the sheet was sorted", async () => {
    const { client, calls } = fakeGoogle((call) => {
      const target = path(call);
      if (target.endsWith("/values/Ledger!A9:O9")) return Response.json({ values: [["R-20261101-aaaaaa"]] });
      if (target.endsWith("/values/Ledger!A:A")) return Response.json({ values: [["ID", "R-20261101-aaaaaa", "R-20261116-ab12cd"]] });
      if (target.endsWith("/values/Ledger!A3:O3")) return Response.json({ values: [["R-20261116-ab12cd", 46342, "Pengeluaran / Expense"]] });
      return undefined;
    });
    expect(await client.findLedgerRow("R-20261116-ab12cd", 9)).toEqual({ row: 3, values: ["R-20261116-ab12cd", "46342", "Pengeluaran / Expense"] });
    expect(await client.findLedgerRow("R-20261130-ffffff", null)).toBeNull();
    expect(await client.findLedgerRow("ID", null)).toBeNull();
    expect(calls.some((call) => path(call).endsWith("/values/Ledger!A9:O9"))).toBe(true);
  });

  it("updates only the named cells, as raw values", async () => {
    const { client, calls } = fakeGoogle((call) => (path(call).endsWith("/values:batchUpdate") ? Response.json({}) : undefined));
    await client.updateLedgerCells(3, { 11: "Dibatalkan / Undone", 14: "Undone by Owner." });
    const body = JSON.parse(calls.at(-1)!.body);
    expect(body.valueInputOption).toBe("RAW");
    expect(body.data.map((entry: { range: string }) => entry.range)).toEqual(["Ledger!L3", "Ledger!O3"]);
    await expect(client.updateLedgerCells(3, { 15: "x" })).rejects.toThrow(RangeError);
  });

  it("reports an unshared sheet as a ledger error without details", async () => {
    const { client } = fakeGoogle(() => new Response(JSON.stringify({ error: { message: "secret detail" } }), { status: 403 }));
    const error = await client.appendLedgerRow(new Array(15).fill("")).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LedgerUnavailableError);
    expect((error as LedgerUnavailableError).code).toBe("ledger_append_http_403");
    expect(String((error as Error).message)).not.toContain("secret detail");
  });

  it("accepts only a real service account key file", () => {
    const valid = JSON.stringify({ type: "service_account", client_email: EMAIL, private_key: `${PEM_HEADER}\nabc\n` });
    expect(parseServiceAccount(valid).clientEmail).toBe(EMAIL);
    for (const text of ["not json", JSON.stringify({ type: "authorized_user", client_email: EMAIL, private_key: "x" }), JSON.stringify({ type: "service_account", client_email: "someone@gmail.com", private_key: PEM_HEADER })]) {
      expect(() => parseServiceAccount(text)).toThrow(LedgerUnavailableError);
    }
  });
});
