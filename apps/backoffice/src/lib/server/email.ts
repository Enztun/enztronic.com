import "server-only";

import { createElement } from "react";
import { Resend } from "resend";

import InvoiceEmail from "../../../email/InvoiceEmail";
import { getEmailEnv } from "@/lib/env";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_RECIPIENTS = 10;

let client: Resend | undefined;
let clientApiKey: string | undefined;

export interface InvoiceEmailAttachment {
  filename: string;
  content: Uint8Array;
}

export interface SendInvoiceEmailInput {
  idempotencyKey: string;
  to: string | readonly string[];
  companyName: string;
  clientName: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  totalAmount: string | number;
  currency: string;
  downloadUrl?: string;
  attachment?: InvoiceEmailAttachment;
}

export interface SendInvoiceEmailResult {
  messageId: string;
  idempotencyKey: string;
}

export class EmailDeliveryError extends Error {
  constructor(message = "Invoice email could not be sent", options?: ErrorOptions) {
    super(message, options);
    this.name = "EmailDeliveryError";
  }
}

function resendClient(apiKey: string): Resend {
  if (!client || clientApiKey !== apiKey) {
    client = new Resend(apiKey);
    clientApiKey = apiKey;
  }
  return client;
}

function safeText(value: string, field: string, maximum: number): string {
  const text = value.trim();
  if (!text || text.length > maximum || /[\0\r\n]/.test(text)) {
    throw new Error(`${field} is invalid`);
  }
  return text;
}

function emailAddress(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email)
  ) {
    throw new Error("Recipient email address is invalid");
  }
  return email;
}

function recipientList(value: string | readonly string[]): string[] {
  const source = typeof value === "string" ? [value] : [...value];
  const recipients = source
    .map(emailAddress)
    .filter((email, index, list) => list.indexOf(email) === index);
  if (recipients.length < 1 || recipients.length > MAX_RECIPIENTS) {
    throw new Error(`Invoice email must have 1 to ${MAX_RECIPIENTS} recipients`);
  }
  return recipients;
}

function idempotencyKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]+$/.test(key)) {
    throw new Error("Resend idempotency key is invalid");
  }
  return key;
}

function currencyCode(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency code is invalid");
  return currency;
}

function formattedMoney(value: string | number, currency: string): string {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(raw)) {
    throw new Error("Invoice total is invalid");
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invoice total is invalid");

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    throw new Error("Currency code is not supported");
  }
}

function secureDownloadUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invoice download URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password || value.length > 4096) {
    throw new Error("Invoice download URL must be a safe HTTPS URL");
  }
  return url.toString();
}

function safeAttachment(
  value: InvoiceEmailAttachment | undefined,
): { filename: string; content: Buffer } | undefined {
  if (!value) return undefined;
  const filename = value.filename.trim();
  if (
    filename.length < 5 ||
    filename.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._ -]*\.pdf$/i.test(filename) ||
    filename.includes("..") ||
    value.content.byteLength < 5 ||
    value.content.byteLength > MAX_ATTACHMENT_BYTES
  ) {
    throw new Error("Invoice PDF attachment is invalid");
  }

  const content = Buffer.from(value.content);
  if (!content.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("Invoice attachment is not a PDF");
  }
  return { filename, content };
}

export async function sendInvoiceEmail(
  input: SendInvoiceEmailInput,
): Promise<SendInvoiceEmailResult> {
  const config = getEmailEnv();
  const key = idempotencyKey(input.idempotencyKey);
  const invoiceNumber = safeText(input.invoiceNumber, "Invoice number", 80);
  const companyName = safeText(input.companyName, "Company name", 160);
  const clientName = safeText(input.clientName, "Client name", 160);
  const issueDate = safeText(input.issueDate, "Issue date", 40);
  const dueDate = input.dueDate
    ? safeText(input.dueDate, "Due date", 40)
    : undefined;
  const currency = currencyCode(input.currency);
  const total = formattedMoney(input.totalAmount, currency);
  const attachment = safeAttachment(input.attachment);

  try {
    const { data, error } = await resendClient(config.apiKey).emails.send(
      {
        from: config.from,
        to: recipientList(input.to),
        bcc: config.bcc.length ? [...config.bcc] : undefined,
        replyTo: config.replyTo,
        subject: `Invoice ${invoiceNumber} from ${companyName}`,
        react: createElement(InvoiceEmail, {
          companyName,
          clientName,
          invoiceNumber,
          issueDate,
          dueDate,
          total,
          downloadUrl: secureDownloadUrl(input.downloadUrl),
        }),
        attachments: attachment ? [attachment] : undefined,
      },
      { idempotencyKey: key },
    );

    if (error || !data?.id) {
      throw new EmailDeliveryError(undefined, { cause: error });
    }
    return { messageId: data.id, idempotencyKey: key };
  } catch (error) {
    if (error instanceof EmailDeliveryError) throw error;
    throw new EmailDeliveryError(undefined, { cause: error });
  }
}
