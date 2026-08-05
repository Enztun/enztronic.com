import { Ban, CheckCircle2, CreditCard, Mail } from "lucide-react";

import type { InvoiceStatus } from "@/components/invoice-status-badge";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Textarea } from "@/components/ui/textarea";
import { currentDateInTimeZone } from "@/lib/calendar";

type InvoiceAction = (formData: FormData) => void | Promise<void>;

export interface InvoiceActionsProps {
  /**
   * Sales users may prepare drafts but never issue an invoice number, void
   * one, take a payment, or email a client. The server actions enforce this
   * independently; hiding the controls just avoids offering dead buttons.
   */
  canManageBilling: boolean;
  status: InvoiceStatus;
  version: number;
  currency: string;
  balanceInputValue: string;
  finalizeAction: InvoiceAction;
  voidAction: InvoiceAction;
  paymentAction: InvoiceAction;
  emailAction: InvoiceAction;
}

export function InvoiceActions({
  canManageBilling,
  status,
  version,
  currency,
  balanceInputValue,
  finalizeAction,
  voidAction,
  paymentAction,
  emailAction,
}: InvoiceActionsProps) {
  const paymentDateInputValue = currentDateInTimeZone("Asia/Jakarta");
  const canCollectPayment =
    canManageBilling && (status === "sent" || status === "overdue");
  const canEmail =
    canManageBilling && status !== "draft" && status !== "void";
  const canVoid =
    canManageBilling && (status === "sent" || status === "overdue");

  return (
    <div className="space-y-4">
      {status === "draft" && canManageBilling ? (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
              <CheckCircle2 aria-hidden="true" className="size-[1.1rem]" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">Finalize invoice</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                Locks the draft values and assigns its final invoice number.
              </p>
            </div>
          </div>
          <form action={finalizeAction} className="mt-5">
            <input type="hidden" name="version" value={version} />
            <SubmitButton className="w-full" pendingLabel="Finalizing…">
              Finalize invoice
            </SubmitButton>
          </form>
        </Card>
      ) : null}

      {canEmail ? (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
              <Mail aria-hidden="true" className="size-[1.1rem]" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">Email client</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                Sends the finalized PDF to the client billing email.
              </p>
            </div>
          </div>
          <form action={emailAction} className="mt-5">
            <input type="hidden" name="version" value={version} />
            <SubmitButton
              variant="secondary"
              className="w-full"
              pendingLabel="Sending…"
            >
              <Mail aria-hidden="true" className="size-4" />
              Send invoice
            </SubmitButton>
          </form>
        </Card>
      ) : null}

      {canCollectPayment ? (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-success/10 text-success">
              <CreditCard aria-hidden="true" className="size-[1.1rem]" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">Record payment</h2>
              <p className="mt-1 text-xs leading-5 text-muted">
                Add a confirmed offline payment to the invoice ledger.
              </p>
            </div>
          </div>
          <form action={paymentAction} className="mt-5 space-y-4">
            <input type="hidden" name="version" value={version} />
            <input type="hidden" name="currency" value={currency} />
            <Field label={`Amount (${currency})`} htmlFor="payment_amount" required>
              <Input
                id="payment_amount"
                name="amount"
                type="number"
                inputMode="decimal"
                min="0"
                step={currency === "IDR" ? "1" : "0.01"}
                required
                defaultValue={balanceInputValue}
              />
            </Field>
            <Field label="Payment date" htmlFor="paid_on" required>
              <Input
                id="paid_on"
                name="paid_on"
                type="date"
                required
                defaultValue={paymentDateInputValue}
              />
            </Field>
            <Field label="Reference" htmlFor="payment_reference">
              <Input
                id="payment_reference"
                name="reference"
                placeholder="Bank transfer reference"
              />
            </Field>
            <SubmitButton
              variant="secondary"
              className="w-full"
              pendingLabel="Recording…"
            >
              Record payment
            </SubmitButton>
          </form>
        </Card>
      ) : null}

      {canVoid ? (
        <Card tone="quiet" className="p-5">
          <details>
            <summary className="flex list-none items-center gap-2 text-sm font-semibold text-danger marker:hidden">
              <Ban aria-hidden="true" className="size-4" />
              Void invoice
            </summary>
            <form action={voidAction} className="mt-5 space-y-4">
              <input type="hidden" name="version" value={version} />
              <Field label="Reason" htmlFor="void_reason" required>
                <Textarea
                  id="void_reason"
                  name="reason"
                  required
                  minLength={3}
                  placeholder="Why is this invoice being voided?"
                />
              </Field>
              <SubmitButton variant="danger" className="w-full" pendingLabel="Voiding…">
                Void invoice
              </SubmitButton>
            </form>
          </details>
        </Card>
      ) : null}
    </div>
  );
}
