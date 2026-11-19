import "server-only";

import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

import { OPENAI_MODEL_PRICES } from "@/lib/office-runtime/live-pricing";

/**
 * Receipt intake settings. Off unless RECEIPTS_ENABLED=true and every value is
 * present. The OpenAI key is a dedicated, capped project key for receipts only;
 * it is never the Office worker's key or a website key.
 */
export interface ReceiptsConfig {
  openaiApiKey: string;
  model: string;
  reasoningEffort: string;
  monthlyBudgetMicrounits: number;
  serviceAccountFile: string;
  spreadsheetId: string;
  /** Public backoffice origin for the ledger's receipt link; optional. */
  publicBaseUrl: string | null;
}

export interface ReceiptsSetupItem {
  key: string;
  label: string;
  ready: boolean;
}

export interface ReceiptsSetup {
  enabled: boolean;
  items: ReceiptsSetupItem[];
}

export class ReceiptsConfigurationError extends Error {
  constructor(message = "Receipt reading is not set up yet") {
    super(message);
    this.name = "ReceiptsConfigurationError";
  }
}

const DEFAULT_MODEL = "gpt-6-luna";
const DEFAULT_BUDGET_USD = "5";

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function budgetMicrounits(raw: string | undefined): number | null {
  const value = raw ?? DEFAULT_BUDGET_USD;
  if (!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const micro = Number(whole) * 1_000_000 + Number(fraction.padEnd(2, "0")) * 10_000;
  return micro > 0 ? micro : null;
}

function publicBaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

function values() {
  const model = read("OPENAI_RECEIPTS_MODEL") ?? DEFAULT_MODEL;
  const reasoningEffort = read("OPENAI_RECEIPTS_REASONING_EFFORT") ?? "low";
  return {
    enabled: read("RECEIPTS_ENABLED") === "true",
    openaiApiKey: read("OPENAI_RECEIPTS_API_KEY"),
    model,
    reasoningEffort,
    modelPriced: OPENAI_MODEL_PRICES[model]?.efforts.includes(reasoningEffort) ?? false,
    monthlyBudgetMicrounits: budgetMicrounits(read("RECEIPTS_MONTHLY_BUDGET_USD")),
    serviceAccountFile: read("GOOGLE_SERVICE_ACCOUNT_FILE"),
    spreadsheetId: read("LEDGER_SPREADSHEET_ID"),
    publicBaseUrl: publicBaseUrl(read("BACKOFFICE_PUBLIC_URL")),
  };
}

/** Which settings are present, for the setup checklist. Never returns a value. */
export function getReceiptsSetup(): ReceiptsSetup {
  const current = values();
  return {
    enabled: current.enabled,
    items: [
      { key: "RECEIPTS_ENABLED", label: "Receipt reading switched on", ready: current.enabled },
      {
        key: "OPENAI_RECEIPTS_API_KEY",
        label: "Dedicated OpenAI key for receipts",
        ready: Boolean(current.openaiApiKey && /^sk-[A-Za-z0-9_-]{20,400}$/.test(current.openaiApiKey)),
      },
      { key: "OPENAI_RECEIPTS_MODEL", label: "Priced model and reasoning effort", ready: current.modelPriced },
      { key: "RECEIPTS_MONTHLY_BUDGET_USD", label: "Monthly reading budget", ready: current.monthlyBudgetMicrounits !== null },
      {
        key: "GOOGLE_SERVICE_ACCOUNT_FILE",
        label: "Google service account key file",
        // Presence only; the file is read (never shown) when the ledger is first used.
        ready: Boolean(current.serviceAccountFile && isAbsolute(current.serviceAccountFile) && existsSync(current.serviceAccountFile)),
      },
      {
        key: "LEDGER_SPREADSHEET_ID",
        label: "Ledger spreadsheet",
        ready: Boolean(current.spreadsheetId && /^[A-Za-z0-9_-]{20,100}$/.test(current.spreadsheetId)),
      },
    ],
  };
}

export function getReceiptsConfig(): ReceiptsConfig {
  const setup = getReceiptsSetup();
  if (!setup.items.every((item) => item.ready)) throw new ReceiptsConfigurationError();
  const current = values();
  return {
    openaiApiKey: current.openaiApiKey!,
    model: current.model,
    reasoningEffort: current.reasoningEffort,
    monthlyBudgetMicrounits: current.monthlyBudgetMicrounits!,
    serviceAccountFile: current.serviceAccountFile!,
    spreadsheetId: current.spreadsheetId!,
    publicBaseUrl: current.publicBaseUrl,
  };
}

/** Sheets settings alone, so recorded receipts can still be undone if reading is switched off. */
export function getLedgerConfig(): Pick<ReceiptsConfig, "serviceAccountFile" | "spreadsheetId" | "publicBaseUrl"> {
  const current = values();
  if (!current.serviceAccountFile || !current.spreadsheetId || !/^[A-Za-z0-9_-]{20,100}$/.test(current.spreadsheetId)) {
    throw new ReceiptsConfigurationError("The ledger connection is not set up yet");
  }
  return {
    serviceAccountFile: current.serviceAccountFile,
    spreadsheetId: current.spreadsheetId,
    publicBaseUrl: current.publicBaseUrl,
  };
}
