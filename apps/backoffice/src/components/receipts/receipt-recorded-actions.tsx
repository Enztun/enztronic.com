"use client";

import { Tags, Undo2 } from "lucide-react";
import { useActionState } from "react";

import { CategorySelect, type CategoryOption } from "@/components/receipts/receipt-review-form";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ReceiptFormState } from "@/receipt-actions";

type ReceiptAction = (state: ReceiptFormState, formData: FormData) => Promise<ReceiptFormState>;

export interface ReceiptRecordedActionsProps {
  changeCategoryAction: ReceiptAction;
  undoAction: ReceiptAction;
  version: number;
  categories: CategoryOption[];
  categoryCode: string;
}

export function ReceiptRecordedActions({ changeCategoryAction, undoAction, version, categories, categoryCode }: ReceiptRecordedActionsProps) {
  const [categoryState, changeCategory] = useActionState(changeCategoryAction, { error: null });
  const [undoState, undo] = useActionState(undoAction, { error: null });
  const error = categoryState.error ?? undoState.error;

  return (
    <Card className="p-5 sm:p-7">
      <h2 className="text-base font-semibold text-ink">Fix a mistake</h2>
      {categories.length ? (
        <form action={changeCategory} className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <input type="hidden" name="version" value={version} />
          <Field label="Category" htmlFor="change_category">
            <CategorySelect id="change_category" categories={categories} defaultValue={categoryCode} />
          </Field>
          <SubmitButton variant="secondary" pendingLabel="Saving…">
            <Tags aria-hidden="true" className="size-4" />
            Change category
          </SubmitButton>
        </form>
      ) : null}
      <form
        action={undo}
        className={categories.length ? "mt-5 border-t border-line pt-5" : "mt-3"}
        onSubmit={(event) => {
          if (!window.confirm("Mark this ledger row as Undone? The row stays in the sheet with status Dibatalkan / Undone.")) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="version" value={version} />
        <p className="mb-3 text-sm leading-6 text-muted">
          Undo keeps the row in the sheet and marks it &ldquo;Dibatalkan / Undone&rdquo;, so the ledger keeps its history.
        </p>
        <SubmitButton variant="danger" pendingLabel="Undoing…">
          <Undo2 aria-hidden="true" className="size-4" />
          Undo
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
