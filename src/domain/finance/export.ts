import { decimalMoney } from "./money";
import type { FinanceSnapshot, Transaction } from "./types";

/** Quote every field and neutralize spreadsheet formulas in user-authored text. */
export function csv(rows: (string | number)[][]): string {
  return "\uFEFF" + rows.map((row) => row.map((v) => `"${String(v).replace(/^[\s]*[=+@\-\t\r]/, (prefix) => `'${prefix}`).replaceAll('"', '""')}"`).join(",")).join("\r\n");
}
export function transactionsCsv(s: FinanceSnapshot, rows: Transaction[]): string {
  return csv([["id", "date", "type", "description", "amount", "currency", "scale", "amount_minor", "account", "destination", "category", "notes", "created_at", "updated_at"],
    ...rows.map((t) => [t.id, t.date, t.type, t.description, decimalMoney(t.amountMinor, t.scale), t.currency, t.scale, t.amountMinor, s.accounts.find((a) => a.id === t.accountId)?.name ?? t.accountId, s.accounts.find((a) => a.id === t.destinationId)?.name ?? "", s.categories.find((c) => c.id === t.categoryId)?.name ?? "", t.notes, t.createdAt, t.updatedAt])]);
}
