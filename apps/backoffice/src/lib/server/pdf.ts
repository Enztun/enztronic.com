import "server-only";

import { stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { getPdfEnv } from "@/lib/env";

const MAX_ITEMS = 100;
const MAX_STDERR_BYTES = 64 * 1024;

export type InvoiceDecimal = string | number;

export interface InvoicePdfParty {
  name: string;
  addressLines?: readonly string[];
  email?: string;
  phone?: string;
  taxId?: string;
}

export interface InvoicePdfItem {
  description: string;
  quantity: InvoiceDecimal;
  unitPrice: InvoiceDecimal;
  lineTotal?: InvoiceDecimal;
}

export interface InvoicePdfInput {
  invoiceNumber: string;
  currency: string;
  currencyFractionDigits?: number;
  issueDate: string;
  dueDate?: string;
  purchaseOrder?: string;
  company: InvoicePdfParty;
  client: InvoicePdfParty;
  items: readonly InvoicePdfItem[];
  subtotalAmount?: InvoiceDecimal;
  taxAmount?: InvoiceDecimal;
  discountAmount?: InvoiceDecimal;
  totalAmount?: InvoiceDecimal;
  amountPaid?: InvoiceDecimal;
  notes?: string;
  paymentInstructions?: string;
}

interface NormalizedInvoicePdfInput {
  invoiceNumber: string;
  currency: string;
  currencyFractionDigits: number;
  issueDate: string;
  dueDate?: string;
  purchaseOrder?: string;
  company: InvoicePdfParty;
  client: InvoicePdfParty;
  items: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
    lineTotal?: string;
  }>;
  subtotalAmount?: string;
  taxAmount: string;
  discountAmount: string;
  totalAmount?: string;
  amountPaid: string;
  notes?: string;
  paymentInstructions?: string;
}

export class PdfRenderError extends Error {
  readonly code:
    | "invalid_input"
    | "renderer_unavailable"
    | "renderer_timeout"
    | "renderer_failed"
    | "output_too_large"
    | "invalid_output";

  constructor(
    code: PdfRenderError["code"],
    message = "Invoice PDF could not be generated",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PdfRenderError";
    this.code = code;
  }
}

function text(
  value: unknown,
  field: string,
  maximum: number,
  allowNewlines = false,
): string {
  if (typeof value !== "string") {
    throw new PdfRenderError("invalid_input", `${field} is required`);
  }
  const normalized = value.trim();
  const unsafe = allowNewlines
    ? /[\x00-\x09\x0b-\x1f\x7f]/
    : /[\x00-\x1f\x7f]/;
  if (!normalized || normalized.length > maximum || unsafe.test(normalized)) {
    throw new PdfRenderError("invalid_input", `${field} is invalid`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  field: string,
  maximum: number,
  allowNewlines = false,
): string | undefined {
  return value === undefined || value === null || value === ""
    ? undefined
    : text(value, field, maximum, allowNewlines);
}

function decimal(
  value: unknown,
  field: string,
  fallback?: string,
  strictlyPositive = false,
): string {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) {
    return fallback;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new PdfRenderError("invalid_input", `${field} is invalid`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new PdfRenderError("invalid_input", `${field} is invalid`);
  }

  const normalized = String(value).trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(normalized)) {
    throw new PdfRenderError("invalid_input", `${field} is invalid`);
  }
  if (strictlyPositive && Number(normalized) <= 0) {
    throw new PdfRenderError("invalid_input", `${field} must be greater than zero`);
  }
  return normalized;
}

function isoDate(value: unknown, field: string): string {
  const normalized = text(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new PdfRenderError("invalid_input", `${field} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new PdfRenderError("invalid_input", `${field} is not a real date`);
  }
  return normalized;
}

function fractionDigits(value: unknown): number {
  if (value === undefined || value === null) return 2;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 4
  ) {
    throw new PdfRenderError(
      "invalid_input",
      "currencyFractionDigits must be an integer between 0 and 4",
    );
  }
  return value;
}

function party(value: unknown, field: string): InvoicePdfParty {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PdfRenderError("invalid_input", `${field} is invalid`);
  }
  const source = value as InvoicePdfParty;
  const addressLines = source.addressLines
    ? [...source.addressLines].map((line, index) =>
        text(line, `${field}.addressLines[${index}]`, 180),
      )
    : undefined;
  if (addressLines && addressLines.length > 8) {
    throw new PdfRenderError("invalid_input", `${field} has too many address lines`);
  }

  return {
    name: text(source.name, `${field}.name`, 160),
    addressLines,
    email: optionalText(source.email, `${field}.email`, 254),
    phone: optionalText(source.phone, `${field}.phone`, 80),
    taxId: optionalText(source.taxId, `${field}.taxId`, 80),
  };
}

function normalizeInvoice(input: InvoicePdfInput): NormalizedInvoicePdfInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PdfRenderError("invalid_input", "Invoice payload is invalid");
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_ITEMS) {
    throw new PdfRenderError(
      "invalid_input",
      `Invoice must contain 1 to ${MAX_ITEMS} line items`,
    );
  }

  const currency = text(input.currency, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new PdfRenderError("invalid_input", "currency must be a three-letter code");
  }

  return {
    invoiceNumber: text(input.invoiceNumber, "invoiceNumber", 80),
    currency,
    currencyFractionDigits: fractionDigits(input.currencyFractionDigits),
    issueDate: isoDate(input.issueDate, "issueDate"),
    dueDate: input.dueDate ? isoDate(input.dueDate, "dueDate") : undefined,
    purchaseOrder: optionalText(input.purchaseOrder, "purchaseOrder", 100),
    company: party(input.company, "company"),
    client: party(input.client, "client"),
    items: input.items.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new PdfRenderError("invalid_input", `items[${index}] is invalid`);
      }
      return {
        description: text(item.description, `items[${index}].description`, 500, true),
        quantity: decimal(item.quantity, `items[${index}].quantity`, undefined, true),
        unitPrice: decimal(item.unitPrice, `items[${index}].unitPrice`),
        lineTotal:
          item.lineTotal === undefined
            ? undefined
            : decimal(item.lineTotal, `items[${index}].lineTotal`),
      };
    }),
    subtotalAmount:
      input.subtotalAmount === undefined
        ? undefined
        : decimal(input.subtotalAmount, "subtotalAmount"),
    taxAmount: decimal(input.taxAmount, "taxAmount", "0"),
    discountAmount: decimal(input.discountAmount, "discountAmount", "0"),
    totalAmount:
      input.totalAmount === undefined
        ? undefined
        : decimal(input.totalAmount, "totalAmount"),
    amountPaid: decimal(input.amountPaid, "amountPaid", "0"),
    notes: optionalText(input.notes, "notes", 2_000, true),
    paymentInstructions: optionalText(
      input.paymentInstructions,
      "paymentInstructions",
      2_000,
      true,
    ),
  };
}

function childEnvironment(): NodeJS.ProcessEnv {
  const permitted = [
    "PATH",
    "Path",
    "SYSTEMROOT",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
  ] as const;
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV ?? "production",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
  for (const name of permitted) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

function isPdf(buffer: Buffer): boolean {
  if (buffer.byteLength < 100 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return false;
  }
  return buffer.subarray(Math.max(0, buffer.byteLength - 1024)).includes(Buffer.from("%%EOF"));
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const config = getPdfEnv();
  const normalized = normalizeInvoice(input);
  const payload = Buffer.from(JSON.stringify(normalized), "utf8");
  if (payload.byteLength > config.maxInputBytes) {
    throw new PdfRenderError("invalid_input", "Invoice payload is too large");
  }

  const configuredRenderer = config.rendererPath.replaceAll("\\", "/");
  if (configuredRenderer !== "pdf/render_invoice.py") {
    throw new PdfRenderError("renderer_unavailable");
  }
  const rendererPath = path.join(process.cwd(), "pdf", "render_invoice.py");
  try {
    const rendererStat = await stat(rendererPath);
    if (!rendererStat.isFile()) throw new Error("Renderer is not a file");
  } catch (error) {
    throw new PdfRenderError("renderer_unavailable", undefined, { cause: error });
  }

  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(config.pythonExecutable, [rendererPath], {
      cwd: path.dirname(rendererPath),
      env: childEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const output: Buffer[] = [];
    let outputBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (error?: PdfRenderError, pdf?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else if (pdf) resolve(pdf);
      else reject(new PdfRenderError("renderer_failed"));
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new PdfRenderError("renderer_timeout"));
    }, config.timeoutMs);
    timer.unref();

    child.on("error", (error) => {
      finish(new PdfRenderError("renderer_unavailable", undefined, { cause: error }));
    });

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > config.maxOutputBytes) {
        child.kill();
        finish(new PdfRenderError("output_too_large"));
        return;
      }
      output.push(Buffer.from(chunk));
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_STDERR_BYTES) {
        child.kill();
        finish(new PdfRenderError("renderer_failed"));
      }
    });

    child.stdin.on("error", () => {
      // The close/error handlers provide the sanitized failure result.
    });

    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(new PdfRenderError("renderer_failed"));
        return;
      }
      const pdf = Buffer.concat(output, outputBytes);
      if (!isPdf(pdf)) {
        finish(new PdfRenderError("invalid_output"));
        return;
      }
      finish(undefined, pdf);
    });

    child.stdin.end(payload);
  });
}
