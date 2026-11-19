"use client";

import { Upload } from "lucide-react";
import { useActionState } from "react";

import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ReceiptFormState } from "@/receipt-actions";

export interface ReceiptUploadFormProps {
  action: (state: ReceiptFormState, formData: FormData) => Promise<ReceiptFormState>;
  disabled: boolean;
}

export function ReceiptUploadForm({ action, disabled }: ReceiptUploadFormProps) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <Card className="p-5 sm:p-7">
      <form action={formAction} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
        <Field label="Receipt" htmlFor="receipt_file" hint="A transfer screenshot or a PDF, up to 5 MB." required>
          <Input
            id="receipt_file"
            name="file"
            type="file"
            required
            disabled={disabled}
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="py-2 file:mr-3 file:rounded-lg file:border-0 file:bg-overlay-strong file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink"
          />
        </Field>
        <Field label="What was it for?" htmlFor="receipt_note" hint="Optional. Helps Clara pick the category.">
          <Input
            id="receipt_note"
            name="note"
            maxLength={1000}
            disabled={disabled}
            autoComplete="off"
            placeholder="e.g. Figma for November, client lunch with PT ABC"
          />
        </Field>
        {/* Label height, so the button lines up with the inputs. */}
        <SubmitButton disabled={disabled} pendingLabel="Clara is reading…" className="lg:mt-7">
          <Upload aria-hidden="true" className="size-4" />
          Send to Clara
        </SubmitButton>
      </form>
      {state.error ? (
        <p role="alert" className="mt-4 text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}
    </Card>
  );
}
