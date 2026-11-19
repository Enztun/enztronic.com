// The ledger's "Kategori" tab is the source of truth for categories and for
// Clara's per-category rule. Parsing is strict: an unreadable row is skipped,
// and a rule that is neither "Auto" nor "Ask first" is treated as Ask first.

export type ReceiptKind = "expense" | "income" | "transfer";

export interface LedgerCategory {
  code: string;
  /** Exactly as written in the sheet; the Ledger tab's dropdown only accepts this text. */
  name: string;
  group: string;
  examples: string;
  askFirst: boolean;
  /** The part of the rule after the dash, e.g. "may be a fixed asset". */
  ruleNote: string | null;
}

export const OTHER_CATEGORY_CODE = "9999";

export function parseCategoryRows(rows: unknown): LedgerCategory[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const categories: LedgerCategory[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const [code, name, group, examples, rule] = row.map((cell) => (typeof cell === "string" ? cell.trim() : ""));
    if (!/^\d{4}$/.test(code ?? "") || !name || name.length > 200 || seen.has(code)) continue;
    seen.add(code);
    const ruleText = rule ?? "";
    const auto = /^otomatis\s*\/\s*auto\b/i.test(ruleText);
    const note = ruleText.split(/\s+[—–-]\s+/).slice(1).join(" — ").trim();
    categories.push({
      code,
      name,
      group: group ?? "",
      examples: examples ?? "",
      askFirst: !auto,
      ruleNote: note ? note.slice(0, 200) : null,
    });
  }
  return categories;
}

/** Direction of the money, from the category; Ringkasan excludes 8xxx from P&L totals. */
export function kindForCategory(code: string): ReceiptKind {
  if (code === "8400") return "income";
  if (code === "8100") return "transfer";
  return "expense";
}
