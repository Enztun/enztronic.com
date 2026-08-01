"use client";

import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { buttonStyles, Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";

export interface InvoiceClientOption {
  id: string;
  label: string;
  defaultCurrency?: string | null;
}

export interface InvoiceItemFormValue {
  id?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
}

export interface InvoiceFormValues {
  version?: number;
  clientId?: string;
  issueOn?: string;
  dueOn?: string;
  currency?: string;
  notes?: string | null;
  terms?: string | null;
  items?: InvoiceItemFormValue[];
}

interface EditableItem extends InvoiceItemFormValue {
  localKey: string;
}

export interface InvoiceFormProps {
  action: (formData: FormData) => void | Promise<void>;
  clients: InvoiceClientOption[];
  initialValues?: InvoiceFormValues;
  submitLabel: string;
  cancelHref?: string;
}

const blankItem: InvoiceItemFormValue = {
  description: "",
  quantity: "1",
  unitPrice: "0",
  taxPercent: "0",
};

function asEditableItems(items?: InvoiceItemFormValue[]): EditableItem[] {
  const source = items?.length ? items : [blankItem];
  return source.map((item, index) => ({
    ...item,
    localKey: item.id ?? `initial-line-${index}`,
  }));
}

function parseDecimal(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function InvoiceForm({
  action,
  clients,
  initialValues,
  submitLabel,
  cancelHref = "/invoices",
}: InvoiceFormProps) {
  const [items, setItems] = useState<EditableItem[]>(() =>
    asEditableItems(initialValues?.items),
  );
  const [currency, setCurrency] = useState(initialValues?.currency ?? "IDR");
  const nextItemId = useRef(items.length);

  const totals = items.reduce(
    (result, item) => {
      const subtotal = parseDecimal(item.quantity) * parseDecimal(item.unitPrice);
      const tax = subtotal * (parseDecimal(item.taxPercent) / 100);
      return {
        subtotal: result.subtotal + subtotal,
        tax: result.tax + tax,
      };
    },
    { subtotal: 0, tax: 0 },
  );

  const formatter = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "IDR" ? 0 : 2,
  });

  function updateItem(
    localKey: string,
    field: keyof InvoiceItemFormValue,
    value: string,
  ) {
    setItems((current) =>
      current.map((item) =>
        item.localKey === localKey ? { ...item, [field]: value } : item,
      ),
    );
  }

  function addItem() {
    const localKey = `new-line-${nextItemId.current}`;
    nextItemId.current += 1;
    setItems((current) => [...current, { ...blankItem, localKey }]);
  }

  function removeItem(localKey: string) {
    setItems((current) => current.filter((item) => item.localKey !== localKey));
  }

  function chooseClient(clientId: string) {
    const client = clients.find((option) => option.id === clientId);
    if (client?.defaultCurrency && !initialValues?.currency) {
      setCurrency(client.defaultCurrency);
    }
  }

  return (
    <form action={action} className="mt-8">
      {initialValues?.version !== undefined ? (
        <input type="hidden" name="version" value={initialValues.version} />
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-7">
            <div>
              <h2 className="text-base font-semibold text-ink">Invoice details</h2>
              <p className="mt-1 text-sm leading-6 text-muted">
                Set the client, billing period, and currency for this draft.
              </p>
            </div>
            <div className="mt-7 grid gap-6 sm:grid-cols-2">
              <Field label="Client" htmlFor="client_id" required className="sm:col-span-2">
                <Select
                  id="client_id"
                  name="client_id"
                  required
                  defaultValue={initialValues?.clientId ?? ""}
                  onChange={(event) => chooseClient(event.target.value)}
                >
                  <option value="" disabled>
                    Select a client
                  </option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Issue date" htmlFor="issue_on" required>
                <Input
                  id="issue_on"
                  name="issue_on"
                  type="date"
                  required
                  defaultValue={initialValues?.issueOn}
                />
              </Field>
              <Field label="Due date" htmlFor="due_on" required>
                <Input
                  id="due_on"
                  name="due_on"
                  type="date"
                  required
                  defaultValue={initialValues?.dueOn}
                />
              </Field>
              <Field label="Currency" htmlFor="currency">
                <Select
                  id="currency"
                  name="currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  <option value="IDR">IDR — Indonesian Rupiah</option>
                  <option value="USD">USD — US Dollar</option>
                  <option value="SGD">SGD — Singapore Dollar</option>
                  <option value="EUR">EUR — Euro</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-col justify-between gap-4 border-b border-line px-5 py-5 sm:flex-row sm:items-center sm:px-7">
              <div>
                <h2 className="text-base font-semibold text-ink">Line items</h2>
                <p className="mt-1 text-sm leading-6 text-muted">
                  Amounts are entered in the selected currency.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={addItem}>
                <Plus aria-hidden="true" className="size-4" />
                Add item
              </Button>
            </div>

            <div className="divide-y divide-line">
              {items.map((item, index) => (
                <fieldset key={item.localKey} className="p-5 sm:p-7">
                  <legend className="sr-only">Line item {index + 1}</legend>
                  <input type="hidden" name="item_id[]" value={item.id ?? ""} />
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-xs font-bold tracking-[0.12em] text-muted uppercase">
                      Item {index + 1}
                    </p>
                    <Button
                      variant="quiet"
                      size="sm"
                      aria-label={`Remove line item ${index + 1}`}
                      disabled={items.length === 1}
                      onClick={() => removeItem(item.localKey)}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      Remove
                    </Button>
                  </div>
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_7rem_11rem_8rem]">
                    <Field label="Description" htmlFor={`description-${item.localKey}`} required>
                      <Input
                        id={`description-${item.localKey}`}
                        name="item_description[]"
                        required
                        value={item.description}
                        placeholder="Service or deliverable"
                        onChange={(event) =>
                          updateItem(item.localKey, "description", event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Quantity" htmlFor={`quantity-${item.localKey}`} required>
                      <Input
                        id={`quantity-${item.localKey}`}
                        name="item_quantity[]"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        step="0.01"
                        required
                        value={item.quantity}
                        onChange={(event) =>
                          updateItem(item.localKey, "quantity", event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Unit price" htmlFor={`unit-price-${item.localKey}`} required>
                      <Input
                        id={`unit-price-${item.localKey}`}
                        name="item_unit_price[]"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step={currency === "IDR" ? "1" : "0.01"}
                        required
                        value={item.unitPrice}
                        onChange={(event) =>
                          updateItem(item.localKey, "unitPrice", event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Tax %" htmlFor={`tax-${item.localKey}`}>
                      <Input
                        id={`tax-${item.localKey}`}
                        name="item_tax_percent[]"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="100"
                        step="0.01"
                        value={item.taxPercent}
                        onChange={(event) =>
                          updateItem(item.localKey, "taxPercent", event.target.value)
                        }
                      />
                    </Field>
                  </div>
                </fieldset>
              ))}
            </div>
          </Card>

          <Card className="p-5 sm:p-7">
            <h2 className="text-base font-semibold text-ink">Notes and terms</h2>
            <div className="mt-7 grid gap-6 lg:grid-cols-2">
              <Field
                label="Client note"
                htmlFor="notes"
                hint="A short message that appears on this invoice."
              >
                <Textarea
                  id="notes"
                  name="notes"
                  defaultValue={initialValues?.notes ?? ""}
                  placeholder="Thank you for your business."
                />
              </Field>
              <Field label="Payment terms" htmlFor="terms">
                <Textarea
                  id="terms"
                  name="terms"
                  defaultValue={initialValues?.terms ?? ""}
                  placeholder="Payment due within 14 days."
                />
              </Field>
            </div>
          </Card>
        </div>

        <aside className="xl:sticky xl:top-10 xl:self-start">
          <Card className="p-5 sm:p-6">
            <p className="text-xs font-bold tracking-[0.14em] text-muted uppercase">
              Draft total
            </p>
            <dl className="mt-5 space-y-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">Subtotal</dt>
                <dd className="font-medium text-ink">{formatter.format(totals.subtotal)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted">Tax</dt>
                <dd className="font-medium text-ink">{formatter.format(totals.tax)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-line pt-4">
                <dt className="font-semibold text-ink">Total</dt>
                <dd className="text-lg font-bold tracking-[-0.02em] text-ink">
                  {formatter.format(totals.subtotal + totals.tax)}
                </dd>
              </div>
            </dl>
            <p className="mt-5 rounded-xl border border-accent/15 bg-accent/[0.07] px-3.5 py-3 text-xs leading-5 text-muted">
              Saving keeps this invoice in draft. You can review and finalize it from the invoice page.
            </p>
          </Card>
        </aside>
      </div>

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link href={cancelHref} className={buttonStyles({ variant: "quiet" })}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          Cancel
        </Link>
        <SubmitButton pendingLabel="Saving draft…">
          <Save aria-hidden="true" className="size-4" />
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}
