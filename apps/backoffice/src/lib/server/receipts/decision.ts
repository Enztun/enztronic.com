// Whether a receipt goes straight into the ledger or waits for the owner.
// The owner's rule: record automatically only when everything is clear;
// anything unclear, unusual or "ask first" is confirmed before writing.

import { currencyFractionDigits, parseMinorUnits } from "@/lib/money";

import { kindForCategory, type LedgerCategory, type ReceiptKind } from "./categories";
import type { ReceiptReading, UncertainField } from "./reader";

export const LEDGER_CURRENCY = "IDR";

export interface DuplicateHint {
  ledgerId: string;
  reason: "same_file" | "same_payment";
}

export interface ReceiptProposal {
  txnDate: string | null;
  kind: ReceiptKind | null;
  categoryCode: string | null;
  payee: string | null;
  amountMinor: bigint | null;
  currency: string | null;
  paidFrom: string | null;
  description: string | null;
  reference: string | null;
  claraNotes: string | null;
}

export interface ReceiptDecision {
  autoRecord: boolean;
  reasons: string[];
  proposal: ReceiptProposal;
}

export interface DecisionInput {
  reading: ReceiptReading | null;
  readingError: string | null;
  categories: LedgerCategory[];
  duplicates: DuplicateHint[];
  today: string;
}

const FIELD_LABELS: Record<UncertainField, string> = {
  date: "date", amount: "amount", currency: "currency", payee: "payee", category: "category",
};

/** "1250000" or "12.50" -> minor units of the currency; null when it cannot be represented. */
export function decimalToMinor(value: string, currency: string): bigint | null {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,6})?$/.test(normalized)) return null;
  let digits: number;
  try {
    digits = currencyFractionDigits(currency);
  } catch {
    return null;
  }
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > digits && /[1-9]/.test(fraction.slice(digits))) return null;
  const minor = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.slice(0, digits).padEnd(digits, "0") || "0");
  if (minor <= 0n) return null;
  return parseMinorUnits(minor, "Amount");
}

function readingError(code: string): string {
  if (code === "budget_reached") {
    return "This month's reading budget is used up, so Clara didn't read this file. Fill in the details from the receipt.";
  }
  if (code.startsWith("configuration") || code.startsWith("rejected_401") || code.startsWith("rejected_403") || code.startsWith("billing_")) {
    return "Clara couldn't reach OpenAI with the receipts key. Fill in the details, and check the key and its budget.";
  }
  return "Clara couldn't read this file. Fill in the details from the receipt.";
}

export function decideReceipt(input: DecisionInput): ReceiptDecision {
  const reasons: string[] = [];
  const empty: ReceiptProposal = {
    txnDate: null, kind: null, categoryCode: null, payee: null, amountMinor: null, currency: null,
    paidFrom: null, description: null, reference: null, claraNotes: null,
  };

  const { reading } = input;
  if (!reading) {
    reasons.push(readingError(input.readingError ?? "unreadable"));
    return { autoRecord: false, reasons, proposal: empty };
  }

  const category = input.categories.find((candidate) => candidate.code === reading.categoryCode) ?? null;
  const currency = reading.currency;
  const amountMinor = reading.amount && currency ? decimalToMinor(reading.amount, currency) : null;
  const proposal: ReceiptProposal = {
    txnDate: reading.date,
    kind: category ? kindForCategory(category.code) : null,
    categoryCode: category?.code ?? null,
    payee: reading.payee,
    amountMinor,
    currency,
    paidFrom: reading.paidFrom,
    description: reading.description,
    reference: reading.reference,
    claraNotes: reading.notes || null,
  };

  if (!reading.isPaymentProof) {
    reasons.push("This looks like a bill or payment instruction, not a proof of payment. Record it only once it has been paid.");
  }
  const missing = [
    !reading.date && "date",
    !amountMinor && "amount",
    !currency && "currency",
    !reading.payee && "payee",
  ].filter(Boolean);
  if (missing.length) reasons.push(`Missing or unreadable: ${missing.join(", ")}.`);
  const unsure = reading.uncertain.filter((field) => !missing.includes(field)).map((field) => FIELD_LABELS[field]);
  if (unsure.length) reasons.push(`Check the ${unsure.join(", ")}: Clara wasn't sure.`);
  if (reading.confidence !== "high" && !unsure.length && !missing.length) {
    reasons.push("Clara wasn't fully confident about this reading.");
  }
  if (currency && currency !== LEDGER_CURRENCY) {
    reasons.push(`Paid in ${currency}. Confirm the amount, or enter the Rupiah amount actually charged.`);
  }
  if (reading.date && reading.date > input.today) reasons.push("The payment date is in the future.");
  if (!category) {
    reasons.push("Choose a category: Clara's choice isn't in the ledger's category list.");
  } else if (category.askFirst) {
    reasons.push(`${category.name} is an ask-first category${category.ruleNote ? ` (${category.ruleNote})` : ""}.`);
  }
  for (const duplicate of input.duplicates) {
    reasons.push(
      duplicate.reason === "same_file"
        ? `The same file was already uploaded as ${duplicate.ledgerId}.`
        : `${duplicate.ledgerId} has the same amount and date. Check it isn't the same payment.`,
    );
  }

  return { autoRecord: reasons.length === 0, reasons, proposal };
}
