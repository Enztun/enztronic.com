import "server-only";

import type postgres from "postgres";

import { DomainError, getDb, type AuditActor } from "@/lib/server/db";

export interface BusinessProfileRecord {
  businessName: string;
  legalName: string | null;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  billingAddress: Record<string, unknown>;
  defaultCurrency: string;
  invoicePrefix: string;
  timezone: string;
  defaultPaymentTermsDays: number;
  paymentInstructions: string | null;
  emailFromName: string | null;
  emailReplyTo: string | null;
  logoStorageKey: string | null;
  version: number;
  updatedAt: string;
}

export interface BusinessProfileInput {
  businessName: string;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
  billingAddress?: Record<string, unknown>;
  defaultCurrency: string;
  invoicePrefix: string;
  timezone?: string;
  defaultPaymentTermsDays: number;
  paymentInstructions?: string | null;
  emailFromName?: string | null;
  emailReplyTo?: string | null;
}

interface BusinessRow {
  business_name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  billing_address: Record<string, unknown>;
  default_currency: string;
  invoice_prefix: string;
  timezone: string;
  default_payment_terms_days: number;
  payment_instructions: string | null;
  email_from_name: string | null;
  email_reply_to: string | null;
  logo_storage_key: string | null;
  version: string | number;
  updated_at: Date | string;
}

function mapBusiness(row: BusinessRow): BusinessProfileRecord {
  const version = Number(row.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Business profile version is invalid");
  }

  return {
    businessName: row.business_name,
    legalName: row.legal_name,
    email: row.email,
    phone: row.phone,
    taxId: row.tax_id,
    billingAddress: row.billing_address,
    defaultCurrency: row.default_currency,
    invoicePrefix: row.invoice_prefix,
    timezone: row.timezone,
    defaultPaymentTermsDays: row.default_payment_terms_days,
    paymentInstructions: row.payment_instructions,
    emailFromName: row.email_from_name,
    emailReplyTo: row.email_reply_to,
    logoStorageKey: row.logo_storage_key,
    version,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
  };
}

export async function getBusinessProfile(): Promise<BusinessProfileRecord> {
  const sql = getDb();
  const rows = await sql<BusinessRow[]>`
    SELECT
      business_name,
      legal_name,
      email,
      phone,
      tax_id,
      billing_address,
      default_currency,
      invoice_prefix,
      timezone,
      default_payment_terms_days,
      payment_instructions,
      email_from_name,
      email_reply_to,
      logo_storage_key,
      version,
      updated_at
    FROM backoffice.business_profile
    WHERE id = 1
  `;
  if (!rows[0]) throw new DomainError("NOT_FOUND", "Business profile not found");
  return mapBusiness(rows[0]);
}

export async function updateBusinessProfile(
  input: BusinessProfileInput,
  expectedVersion: number,
  actor: AuditActor = { type: "owner" },
): Promise<BusinessProfileRecord> {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new DomainError("VALIDATION_ERROR", "Business profile version is invalid");
  }

  const sql = getDb();
  return sql.begin(async (transaction) => {
    const rows = await transaction<BusinessRow[]>`
      UPDATE backoffice.business_profile
      SET
        business_name = ${input.businessName},
        legal_name = ${input.legalName ?? null},
        email = ${input.email ?? null},
        phone = ${input.phone ?? null},
        tax_id = ${input.taxId ?? null},
        billing_address = ${transaction.json(
          (input.billingAddress ?? {}) as postgres.JSONValue,
        )},
        default_currency = ${input.defaultCurrency},
        invoice_prefix = ${input.invoicePrefix},
        timezone = ${input.timezone ?? "Asia/Jakarta"},
        default_payment_terms_days = ${input.defaultPaymentTermsDays},
        payment_instructions = ${input.paymentInstructions ?? null},
        email_from_name = ${input.emailFromName ?? null},
        email_reply_to = ${input.emailReplyTo ?? null},
        version = version + 1
      WHERE id = 1 AND version = ${expectedVersion}
      RETURNING
        business_name,
        legal_name,
        email,
        phone,
        tax_id,
        billing_address,
        default_currency,
        invoice_prefix,
        timezone,
        default_payment_terms_days,
        payment_instructions,
        email_from_name,
        email_reply_to,
        logo_storage_key,
        version,
        updated_at
    `;

    if (!rows[0]) {
      const current = await transaction<{ exists: boolean }[]>`
        SELECT EXISTS(
          SELECT 1 FROM backoffice.business_profile WHERE id = 1
        ) AS exists
      `;
      if (!current[0]?.exists) {
        throw new DomainError("NOT_FOUND", "Business profile not found");
      }
      throw new DomainError(
        "CONFLICT",
        "Business settings changed in another session. Reload and try again.",
      );
    }

    await transaction`
      INSERT INTO backoffice.audit_events (
        entity_type,
        actor_type,
        actor_id,
        event_type,
        details
      )
      VALUES (
        'business',
        ${actor.type},
        ${actor.id ?? null},
        'business.updated',
        ${transaction.json({ version: Number(rows[0].version) })}
      )
    `;

    return mapBusiness(rows[0]);
  });
}
