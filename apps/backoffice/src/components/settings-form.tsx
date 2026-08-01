import { Save } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";

export interface SettingsFormValues {
  version?: number;
  businessName?: string | null;
  legalName?: string | null;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  paymentInstructions?: string | null;
  invoicePrefix?: string | null;
  defaultCurrency?: string | null;
  timezone?: string | null;
  defaultPaymentTermsDays?: number | null;
  emailFromName?: string | null;
  emailReplyTo?: string | null;
}

export interface SettingsFormProps {
  action: (formData: FormData) => void | Promise<void>;
  initialValues?: SettingsFormValues;
}

export function SettingsForm({ action, initialValues }: SettingsFormProps) {
  return (
    <form action={action} className="mt-8 max-w-5xl space-y-6">
      {initialValues?.version !== undefined ? (
        <input type="hidden" name="version" value={initialValues.version} />
      ) : null}
      <Card className="p-5 sm:p-7">
        <h2 className="text-base font-semibold text-ink">Business identity</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          These details appear on generated invoices and client correspondence.
        </p>
        <div className="mt-7 grid gap-6 sm:grid-cols-2">
          <Field label="Trading name" htmlFor="business_name" required>
            <Input
              id="business_name"
              name="business_name"
              required
              autoComplete="organization"
              defaultValue={initialValues?.businessName ?? "Enztronic"}
            />
          </Field>
          <Field label="Legal entity name" htmlFor="legal_name">
            <Input
              id="legal_name"
              name="legal_name"
              defaultValue={initialValues?.legalName ?? ""}
            />
          </Field>
          <Field label="Billing email" htmlFor="email" required>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              defaultValue={initialValues?.email ?? ""}
            />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              defaultValue={initialValues?.phone ?? ""}
            />
          </Field>
          <Field label="Tax ID" htmlFor="tax_id">
            <Input
              id="tax_id"
              name="tax_id"
              defaultValue={initialValues?.taxId ?? ""}
            />
          </Field>
          <Field label="Address line 1" htmlFor="address_line1">
            <Input
              id="address_line1"
              name="address_line1"
              autoComplete="address-line1"
              defaultValue={initialValues?.addressLine1 ?? ""}
            />
          </Field>
          <Field label="Address line 2" htmlFor="address_line2" className="sm:col-span-2">
            <Input
              id="address_line2"
              name="address_line2"
              autoComplete="address-line2"
              defaultValue={initialValues?.addressLine2 ?? ""}
            />
          </Field>
          <Field label="City" htmlFor="city">
            <Input
              id="city"
              name="city"
              autoComplete="address-level2"
              defaultValue={initialValues?.city ?? ""}
            />
          </Field>
          <Field label="Province / state" htmlFor="province">
            <Input
              id="province"
              name="province"
              autoComplete="address-level1"
              defaultValue={initialValues?.province ?? ""}
            />
          </Field>
          <Field label="Postal code" htmlFor="postal_code">
            <Input
              id="postal_code"
              name="postal_code"
              autoComplete="postal-code"
              defaultValue={initialValues?.postalCode ?? ""}
            />
          </Field>
          <Field label="Country" htmlFor="country">
            <Input
              id="country"
              name="country"
              autoComplete="country-name"
              defaultValue={initialValues?.country ?? "Indonesia"}
            />
          </Field>
          <Field
            label="Payment instructions"
            htmlFor="payment_instructions"
            className="sm:col-span-2"
            hint="Bank or transfer instructions shown to the client. Never enter login credentials."
          >
            <Textarea
              id="payment_instructions"
              name="payment_instructions"
              defaultValue={initialValues?.paymentInstructions ?? ""}
              placeholder="Bank name, account holder, and account number"
            />
          </Field>
        </div>
      </Card>

      <Card className="p-5 sm:p-7">
        <h2 className="text-base font-semibold text-ink">Invoice defaults</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          Defaults speed up draft creation and can still be changed per invoice.
        </p>
        <div className="mt-7 grid gap-6 sm:grid-cols-3">
          <Field label="Invoice prefix" htmlFor="invoice_prefix">
            <Input
              id="invoice_prefix"
              name="invoice_prefix"
              defaultValue={initialValues?.invoicePrefix ?? "INV"}
              maxLength={12}
            />
          </Field>
          <Field label="Default currency" htmlFor="default_currency">
            <Select
              id="default_currency"
              name="default_currency"
              defaultValue={initialValues?.defaultCurrency ?? "IDR"}
            >
              <option value="IDR">IDR</option>
              <option value="USD">USD</option>
              <option value="SGD">SGD</option>
              <option value="EUR">EUR</option>
            </Select>
          </Field>
          <Field label="Payment terms (days)" htmlFor="default_payment_terms_days">
            <Input
              id="default_payment_terms_days"
              name="default_payment_terms_days"
              type="number"
              min="0"
              max="365"
              step="1"
              defaultValue={initialValues?.defaultPaymentTermsDays ?? 14}
            />
          </Field>
          <Field label="Timezone" htmlFor="timezone" className="sm:col-span-3">
            <Input
              id="timezone"
              name="timezone"
              defaultValue={initialValues?.timezone ?? "Asia/Jakarta"}
              placeholder="Asia/Jakarta"
            />
          </Field>
        </div>
      </Card>

      <Card className="p-5 sm:p-7">
        <h2 className="text-base font-semibold text-ink">Email sender</h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          The verified sender address remains an environment-level setting.
        </p>
        <div className="mt-7 grid gap-6 sm:grid-cols-2">
          <Field label="Sender name" htmlFor="email_from_name">
            <Input
              id="email_from_name"
              name="email_from_name"
              defaultValue={initialValues?.emailFromName ?? "Enztronic Billing"}
            />
          </Field>
          <Field label="Reply-to email" htmlFor="email_reply_to">
            <Input
              id="email_reply_to"
              name="email_reply_to"
              type="email"
              defaultValue={initialValues?.emailReplyTo ?? ""}
            />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving settings…">
          <Save aria-hidden="true" className="size-4" />
          Save settings
        </SubmitButton>
      </div>
    </form>
  );
}
