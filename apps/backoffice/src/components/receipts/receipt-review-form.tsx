"use client";

import { BookCheck, Trash2 } from "lucide-react";
import { useActionState } from "react";

import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";
import type { ReceiptFormState } from "@/receipt-actions";

type ReceiptAction = (state: ReceiptFormState, formData: FormData) => Promise<ReceiptFormState>;

export interface CategoryOption {
  code: string;
  name: string;
  group: string;
  askFirst: boolean;
}

export interface ReviewValues {
  txnDate: string;
  categoryCode: string;
  payee: string;
  amount: string;
  currency: string;
  paidFrom: string;
  description: string;
  reference: string;
}

export function CategorySelect({ id, categories, defaultValue }: { id: string; categories: CategoryOption[]; defaultValue: string }) {
  const groups = [...new Set(categories.map((category) => category.group))];
  return (
    <Select id={id} name="category_code" required defaultValue={defaultValue}>
      <option value="" disabled>
        Choose a category
      </option>
      {groups.map((group) => (
        <optgroup key={group} label={group || "Other"}>
          {categories
            .filter((category) => category.group === group)
            .map((category) => (
              <option key={category.code} value={category.code}>
                {category.code} · {category.name}
                {category.askFirst ? " (ask first)" : ""}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

export interface ReceiptReviewFormProps {
  recordAction: ReceiptAction;
  discardAction: ReceiptAction;
  version: number;
  categories: CategoryOption[];
  values: ReviewValues;
  currencies: readonly string[];
}

export function ReceiptReviewForm({ recordAction, discardAction, version, categories, values, currencies }: ReceiptReviewFormProps) {
  const [recordState, record] = useActionState(recordAction, { error: null });
  const [discardState, discard] = useActionState(discardAction, { error: null });
  const error = recordState.error ?? discardState.error;

  return (
    <Card className="p-5 sm:p-7">
      <h2 className="text-base font-semibold text-ink">Check and record</h2>
      <p className="mt-1 text-sm leading-6 text-muted">
        Nothing is in the ledger yet. Correct anything Clara misread, then record it.
      </p>
      <form action={record} className="mt-6 grid gap-5 sm:grid-cols-2">
        <input type="hidden" name="version" value={version} />
        <Field label="Payment date" htmlFor="txn_date" required>
          <Input id="txn_date" name="txn_date" type="date" required defaultValue={values.txnDate} />
        </Field>
        <Field label="Category" htmlFor="category_code" required>
          <CategorySelect id="category_code" categories={categories} defaultValue={values.categoryCode} />
        </Field>
        <Field label="Paid to" htmlFor="payee" required>
          <Input id="payee" name="payee" required maxLength={200} defaultValue={values.payee} />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <Field label="Amount" htmlFor="amount" hint="Digits only, e.g. 1250000." required>
            <Input id="amount" name="amount" inputMode="decimal" required defaultValue={values.amount} />
          </Field>
          <Field label="Currency" htmlFor="currency" required>
            <Select id="currency" name="currency" required defaultValue={values.currency || "IDR"}>
              {currencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Paid from" htmlFor="paid_from" hint="Bank or wallet, last four digits only.">
          <Input id="paid_from" name="paid_from" maxLength={120} defaultValue={values.paidFrom} />
        </Field>
        <Field label="Transfer reference" htmlFor="reference">
          <Input id="reference" name="reference" maxLength={120} defaultValue={values.reference} />
        </Field>
        <Field label="Description" htmlFor="description" className="sm:col-span-2">
          <Textarea id="description" name="description" maxLength={500} rows={2} className="min-h-20" defaultValue={values.description} />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <SubmitButton pendingLabel="Recording…">
            <BookCheck aria-hidden="true" className="size-4" />
            Record in ledger
          </SubmitButton>
        </div>
      </form>
      <form action={discard} className="mt-4 border-t border-line pt-4">
        <input type="hidden" name="version" value={version} />
        <SubmitButton variant="quiet" size="sm" pendingLabel="Discarding…">
          <Trash2 aria-hidden="true" className="size-4" />
          Discard, don&apos;t record
        </SubmitButton>
      </form>
      {error ? (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
