import "server-only";

const DEFAULT_PDF_INPUT_LIMIT = 1024 * 1024;
const DEFAULT_PDF_OUTPUT_LIMIT = 10 * 1024 * 1024;

export type RuntimeMode = "development" | "test" | "production";

export interface RuntimeEnv {
  nodeEnv: RuntimeMode;
  host: "127.0.0.1" | "localhost" | "::1";
  port: number;
}

export interface DatabaseEnv {
  databaseUrl: string;
}

export interface CloudflareAccessEnv {
  nodeEnv: RuntimeMode;
  issuer: string | null;
  audience: readonly string[];
  allowedEmails: ReadonlySet<string>;
  developmentBypass: boolean;
  developmentEmail: string | null;
}

export interface R2Env {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
}

export interface EmailEnv {
  apiKey: string;
  from: string;
  replyTo?: string;
  bcc: readonly string[];
}

export interface PdfEnv {
  pythonExecutable: string;
  rendererPath: string;
  timeoutMs: number;
  maxInputBytes: number;
  maxOutputBytes: number;
}

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name: string): string {
  const value = read(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function runtimeMode(): RuntimeMode {
  const value = read("NODE_ENV") ?? "development";
  if (value !== "development" && value !== "test" && value !== "production") {
    throw new Error("NODE_ENV must be development, test, or production");
  }
  return value;
}

function integerInRange(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = read(name);
  if (!raw) return fallback;

  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer`);
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function exactBoolean(name: string, fallback = false): boolean {
  const raw = read(name);
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function normalizeEmail(value: string, name: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email)
  ) {
    throw new Error(`${name} contains an invalid email address`);
  }
  return email;
}

function emailList(name: string, requiredList: boolean): readonly string[] {
  const raw = read(name);
  if (!raw) {
    if (requiredList) throw new Error(`${name} must contain at least one email`);
    return [];
  }

  const values = raw
    .split(",")
    .map((value) => normalizeEmail(value, name))
    .filter((value, index, list) => list.indexOf(value) === index);

  if (requiredList && values.length === 0) {
    throw new Error(`${name} must contain at least one email`);
  }
  return values;
}

function commaList(name: string): readonly string[] {
  const raw = required(name);
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);

  if (values.length === 0 || values.some((value) => value.length > 512)) {
    throw new Error(`${name} must contain at least one valid value`);
  }
  return values;
}

function cloudflareIssuer(value: string): string {
  const candidate = value.includes("://") ? value : `https://${value}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("CLOUDFLARE_ACCESS_TEAM_DOMAIN must be a valid HTTPS URL");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error(
      "CLOUDFLARE_ACCESS_TEAM_DOMAIN must be an HTTPS origin without a path",
    );
  }

  return url.origin;
}

function safeHeaderValue(value: string, name: string): string {
  if (value.length > 998 || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} contains unsafe characters`);
  }
  return value;
}

export function getRuntimeEnv(): RuntimeEnv {
  const host = read("BACKOFFICE_HOST") ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("BACKOFFICE_HOST must remain a loopback hostname or address");
  }

  return {
    nodeEnv: runtimeMode(),
    host,
    port: integerInRange("BACKOFFICE_PORT", 3100, 1024, 65535),
  };
}

export function getDatabaseEnv(): DatabaseEnv {
  return { databaseUrl: required("DATABASE_URL") };
}

export function getCloudflareAccessEnv(): CloudflareAccessEnv {
  const nodeEnv = runtimeMode();
  const developmentBypass = exactBoolean("CLOUDFLARE_ACCESS_DEV_BYPASS");

  if (nodeEnv === "production" && developmentBypass) {
    throw new Error("Cloudflare Access bypass is forbidden in production");
  }

  if (developmentBypass) {
    const developmentEmail = normalizeEmail(
      required("CLOUDFLARE_ACCESS_DEV_EMAIL"),
      "CLOUDFLARE_ACCESS_DEV_EMAIL",
    );
    return {
      nodeEnv,
      issuer: null,
      audience: [],
      allowedEmails: new Set([developmentEmail]),
      developmentBypass: true,
      developmentEmail,
    };
  }

  const allowedEmails = emailList("CLOUDFLARE_ACCESS_ALLOWED_EMAILS", true);
  return {
    nodeEnv,
    issuer: cloudflareIssuer(required("CLOUDFLARE_ACCESS_TEAM_DOMAIN")),
    audience: commaList("CLOUDFLARE_ACCESS_AUDIENCE"),
    allowedEmails: new Set(allowedEmails),
    developmentBypass: false,
    developmentEmail: null,
  };
}

export function getR2Env(): R2Env {
  const accountId = required("R2_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new Error("R2_ACCOUNT_ID must be a 32-character account identifier");
  }

  const bucketName = required("R2_BUCKET_NAME");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName)) {
    throw new Error("R2_BUCKET_NAME is invalid");
  }

  return {
    accountId,
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucketName,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

export function getEmailEnv(): EmailEnv {
  const from = safeHeaderValue(required("RESEND_FROM_EMAIL"), "RESEND_FROM_EMAIL");
  if (!/<[^<>]+>$/.test(from) && !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(from)) {
    throw new Error("RESEND_FROM_EMAIL must be an email or Name <email> value");
  }

  const replyToRaw = read("RESEND_REPLY_TO");
  return {
    apiKey: required("RESEND_API_KEY"),
    from,
    replyTo: replyToRaw
      ? normalizeEmail(replyToRaw, "RESEND_REPLY_TO")
      : undefined,
    bcc: emailList("RESEND_BCC", false),
  };
}

export function getPdfEnv(): PdfEnv {
  const pythonExecutable = read("PDF_PYTHON_EXECUTABLE") ?? "python";
  if (/\0/.test(pythonExecutable) || pythonExecutable.length > 1024) {
    throw new Error("PDF_PYTHON_EXECUTABLE is invalid");
  }

  const rendererPath = read("PDF_RENDERER_PATH") ?? "pdf/render_invoice.py";
  if (/\0/.test(rendererPath) || rendererPath.length > 2048) {
    throw new Error("PDF_RENDERER_PATH is invalid");
  }

  return {
    pythonExecutable,
    rendererPath,
    timeoutMs: integerInRange("PDF_RENDER_TIMEOUT_MS", 15_000, 1_000, 60_000),
    maxInputBytes: integerInRange(
      "PDF_MAX_INPUT_BYTES",
      DEFAULT_PDF_INPUT_LIMIT,
      16 * 1024,
      5 * 1024 * 1024,
    ),
    maxOutputBytes: integerInRange(
      "PDF_MAX_OUTPUT_BYTES",
      DEFAULT_PDF_OUTPUT_LIMIT,
      128 * 1024,
      25 * 1024 * 1024,
    ),
  };
}
