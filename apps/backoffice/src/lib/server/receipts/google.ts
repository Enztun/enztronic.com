// Google Sheets access as a service account. The key file stays on disk outside
// the repository; only its client email and private key are read, and neither
// is ever logged or returned. The service account can reach only what the
// owner shared with it (the ledger spreadsheet).

import { readFile } from "node:fs/promises";

import { importPKCS8, SignJWT } from "jose";

import { parseCategoryRows, type LedgerCategory } from "./categories";
import { CATEGORY_SHEET, columnLetter, LEDGER_COLUMNS, LEDGER_SHEET, rowFromRange, type LedgerCell } from "./ledger";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_KEY_FILE_BYTES = 16 * 1024;

export class LedgerUnavailableError extends Error {
  constructor(readonly code: string) {
    super("The ledger spreadsheet could not be reached");
    this.name = "LedgerUnavailableError";
  }
}

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | null;
}

export function parseServiceAccount(text: string): ServiceAccount {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new LedgerUnavailableError("service_account_unreadable");
  }
  const email = data.client_email, key = data.private_key, keyId = data.private_key_id;
  if (
    data.type !== "service_account" ||
    typeof email !== "string" || !/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(email) ||
    typeof key !== "string" || !key.includes("-----BEGIN PRIVATE KEY-----")
  ) {
    throw new LedgerUnavailableError("service_account_invalid");
  }
  return { clientEmail: email, privateKey: key, privateKeyId: typeof keyId === "string" && /^[a-f0-9]{40}$/.test(keyId) ? keyId : null };
}

export async function loadServiceAccount(path: string): Promise<ServiceAccount> {
  let text: string;
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_KEY_FILE_BYTES) throw new LedgerUnavailableError("service_account_invalid");
    text = bytes.toString("utf8");
  } catch (error) {
    if (error instanceof LedgerUnavailableError) throw error;
    throw new LedgerUnavailableError("service_account_missing");
  }
  return parseServiceAccount(text);
}

export interface SheetsClientOptions {
  spreadsheetId: string;
  account: () => Promise<ServiceAccount>;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface LedgerRowMatch {
  row: number;
  values: string[];
}

export interface SheetsClient {
  categories(): Promise<LedgerCategory[]>;
  findLedgerRow(ledgerId: string, hint?: number | null): Promise<LedgerRowMatch | null>;
  appendLedgerRow(cells: LedgerCell[]): Promise<number>;
  updateLedgerCells(row: number, cells: Partial<Record<number, LedgerCell>>): Promise<void>;
}

type Json = Record<string, unknown>;

export function createSheetsClient(options: SheetsClientOptions): SheetsClient {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const spreadsheet = encodeURIComponent(options.spreadsheetId);
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt - 60_000 > now()) return token.value;
    const account = await options.account();
    let assertion: string;
    try {
      const key = await importPKCS8(account.privateKey, "RS256");
      const issuedAt = Math.floor(now() / 1000);
      assertion = await new SignJWT({ scope: SHEETS_SCOPE })
        .setProtectedHeader({ alg: "RS256", typ: "JWT", ...(account.privateKeyId ? { kid: account.privateKeyId } : {}) })
        .setIssuer(account.clientEmail)
        .setAudience(TOKEN_URL)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + 3600)
        .sign(key);
    } catch {
      throw new LedgerUnavailableError("service_account_invalid");
    }
    const response = await send(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    }, "token");
    const body = await json(response, "token");
    if (typeof body.access_token !== "string" || !body.access_token) throw new LedgerUnavailableError("token_invalid");
    const lifetime = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
    token = { value: body.access_token, expiresAt: now() + lifetime * 1000 };
    return token.value;
  }

  async function send(url: string, init: RequestInit, label: string): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new LedgerUnavailableError(`${label}_unreachable`);
    }
    if (!response.ok) {
      // 403 usually means the sheet was not shared with the service account.
      throw new LedgerUnavailableError(`${label}_http_${response.status}`);
    }
    return response;
  }

  async function json(response: Response, label: string): Promise<Json> {
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new LedgerUnavailableError(`${label}_invalid`);
    return body as Json;
  }

  async function sheets(path: string, init: RequestInit = {}, label = "sheets"): Promise<Json> {
    const response = await send(`${SHEETS_BASE}/${spreadsheet}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json", ...(init.headers ?? {}) },
    }, label);
    return json(response, label);
  }

  const range = (value: string) => encodeURIComponent(value);
  const rowValues = (body: Json): string[][] =>
    Array.isArray(body.values) ? body.values.map((row) => (Array.isArray(row) ? row.map((cell) => (typeof cell === "string" ? cell : String(cell ?? ""))) : [])) : [];

  return {
    async categories() {
      const body = await sheets(`/values/${range(`${CATEGORY_SHEET}!A2:E200`)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, {}, "categories");
      const categories = parseCategoryRows(body.values);
      if (!categories.length) throw new LedgerUnavailableError("categories_empty");
      return categories;
    },

    async findLedgerRow(ledgerId, hint) {
      const read = async (row: number) => {
        const body = await sheets(`/values/${range(`${LEDGER_SHEET}!A${row}:O${row}`)}?valueRenderOption=FORMATTED_VALUE`, {}, "ledger_read");
        return rowValues(body)[0] ?? [];
      };
      // The stored row is only a hint: the owner may sort or insert rows in the sheet.
      if (hint && hint >= 2) {
        const values = await read(hint);
        if (values[0] === ledgerId) return { row: hint, values };
      }
      const body = await sheets(`/values/${range(`${LEDGER_SHEET}!A:A`)}?majorDimension=COLUMNS`, {}, "ledger_ids");
      const ids = rowValues(body)[0] ?? [];
      const index = ids.indexOf(ledgerId);
      if (index < 1) return null;
      return { row: index + 1, values: await read(index + 1) };
    },

    async appendLedgerRow(cells) {
      if (cells.length !== LEDGER_COLUMNS) throw new RangeError("Ledger row must have 15 cells");
      // OVERWRITE fills the next empty row, which already carries the column
      // formats and dropdowns; INSERT_ROWS would add bare rows.
      const body = await sheets(
        `/values/${range(`${LEDGER_SHEET}!A:O`)}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`,
        { method: "POST", body: JSON.stringify({ majorDimension: "ROWS", values: [cells] }) },
        "ledger_append",
      );
      const updates = body.updates && typeof body.updates === "object" ? (body.updates as Json) : {};
      const row = rowFromRange(updates.updatedRange);
      if (!row) throw new LedgerUnavailableError("ledger_append_unconfirmed");
      return row;
    },

    async updateLedgerCells(row, cells) {
      const data = Object.entries(cells).map(([column, value]) => {
        const letter = columnLetter(Number(column));
        return { range: `${LEDGER_SHEET}!${letter}${row}`, majorDimension: "ROWS", values: [[value]] };
      });
      if (!data.length) return;
      await sheets(`/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) }, "ledger_update");
    },
  };
}
