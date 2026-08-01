import { ArrowLeft, Save } from "lucide-react";
import Link from "next/link";

import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";

export interface ClientFormValues {
  id?: string;
  version?: number;
  displayName: string;
  legalName?: string | null;
  email: string;
  phone?: string | null;
  taxId?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface ClientFormProps {
  action: (formData: FormData) => void | Promise<void>;
  initialValues?: ClientFormValues;
  submitLabel: string;
}

export function ClientForm({
  action,
  initialValues,
  submitLabel,
}: ClientFormProps) {
  return (
    <form action={action} className="mt-8 max-w-5xl">
      {initialValues?.id ? <input type="hidden" name="id" value={initialValues.id} /> : null}
      {initialValues?.version !== undefined ? (
        <input type="hidden" name="version" value={initialValues.version} />
      ) : null}

      <Card className="p-5 sm:p-7">
        <div>
          <h2 className="text-base font-semibold text-ink">Client details</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Keep billing contacts accurate so invoices reach the right person.
          </p>
        </div>

        <div className="mt-7 grid gap-6 sm:grid-cols-2">
          <Field label="Display name" htmlFor="display_name" required>
            <Input
              id="display_name"
              name="display_name"
              required
              autoComplete="name"
              defaultValue={initialValues?.displayName ?? ""}
              placeholder="e.g. Meridian Labs"
            />
          </Field>
          <Field label="Legal name" htmlFor="legal_name">
            <Input
              id="legal_name"
              name="legal_name"
              autoComplete="organization"
              defaultValue={initialValues?.legalName ?? ""}
              placeholder="Registered company or individual name"
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
              placeholder="finance@example.com"
            />
          </Field>
          <Field label="Phone" htmlFor="phone">
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              defaultValue={initialValues?.phone ?? ""}
              placeholder="+62 812 3456 7890"
            />
          </Field>
          <Field label="Tax ID" htmlFor="tax_id">
            <Input
              id="tax_id"
              name="tax_id"
              defaultValue={initialValues?.taxId ?? ""}
              placeholder="NPWP or local tax identifier"
            />
          </Field>
          <Field label="Address line 1" htmlFor="address_line1">
            <Input
              id="address_line1"
              name="address_line1"
              autoComplete="address-line1"
              defaultValue={initialValues?.addressLine1 ?? ""}
              placeholder="Street address"
            />
          </Field>
          <Field label="Address line 2" htmlFor="address_line2" className="sm:col-span-2">
            <Input
              id="address_line2"
              name="address_line2"
              autoComplete="address-line2"
              defaultValue={initialValues?.addressLine2 ?? ""}
              placeholder="Suite, unit, building (optional)"
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
        </div>
      </Card>

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link href="/clients" className={buttonStyles({ variant: "quiet" })}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving client…">
          <Save aria-hidden="true" className="size-4" />
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
