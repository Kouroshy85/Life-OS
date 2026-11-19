import { assertMinor, currencyScale, percent, subtractMoney, sumMoney } from "./money";
import { financeCommand, type Budget, type FinanceCommand, type FinanceSnapshot, type SavingsGoal, type Transaction } from "./types";

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export function checkDate(date: string): void {
  const parsed = new Date(`${date}T12:00:00Z`);
  check(/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date, "Choose a valid calendar date.");
}
export function validateCommand(input: unknown, s: FinanceSnapshot): FinanceCommand {
  const parsed = financeCommand.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid finance record.");
  const c = parsed.data;
  if (c.entity === "preferences") return c;
  if (c.entity === "delete_transaction" || c.entity === "delete_budget") {
    check((c.entity === "delete_transaction" ? s.transactions : s.budgets).some((x) => x.id === c.id), "This record no longer exists.");
    return c;
  }
  const v = c.value;
  if ("currency" in v) check(v.scale === currencyScale(v.currency), "Currency scale does not match its smallest unit.");
  if ("date" in v) checkDate(v.date);
  if ("targetDate" in v && v.targetDate) checkDate(v.targetDate);
  const table = { account: s.accounts, category: s.categories, transaction: s.transactions, budget: s.budgets, goal: s.goals, contribution: s.contributions }[c.entity];
  if (v.id) check(table.some((x) => x.id === v.id), "This record no longer exists.");
  switch (c.entity) {
    case "account": {
      const v = c.value, old = s.accounts.find((a) => a.id === v.id);
      if (old && (s.transactions.some((t) => t.accountId === old.id || t.destinationId === old.id) || s.goals.some((g) => g.accountId === old.id))) {
        check(old.currency === v.currency && old.scale === v.scale && old.openingMinor === v.openingMinor, "Opening balance and currency are locked once an account has history or linked goals.");
      }
      break;
    }
    case "category": {
      const v = c.value, old = s.categories.find((x) => x.id === v.id);
      if (old && (s.transactions.some((t) => t.categoryId === old.id) || s.budgets.some((b) => b.categoryId === old.id))) check(old.type === v.type, "A category with history cannot change type.");
      break;
    }
    case "transaction": {
      const v = c.value, old = s.transactions.find((x) => x.id === v.id);
      const account = s.accounts.find((x) => x.id === v.accountId);
      const dest = s.accounts.find((x) => x.id === v.destinationId);
      check(account, "Choose an existing account.");
      check(account.currency === v.currency && account.scale === v.scale, "Transaction currency must match the account.");
      const unchangedHistory = old && ["type", "amountMinor", "currency", "scale", "accountId", "destinationId", "date", "categoryId"].every((k) => old[k as keyof Transaction] === v[k as keyof typeof v]);
      check(!account.archived || unchangedHistory, "Archived accounts allow only description and notes edits. Restore the account to change amounts.");
      if (v.type === "transfer") {
        check(dest && dest.id !== account.id, "Choose a different destination account.");
        check(!dest.archived || unchangedHistory, "Restore the destination account before changing this transfer.");
        check(dest.currency === v.currency && dest.scale === v.scale, "Transfers require accounts with the same currency. Exchange conversion is not supported.");
        check(v.categoryId === null, "Transfers have no income or expense category.");
      } else {
        check(v.destinationId === null, "Only transfers have a destination account.");
        const category = s.categories.find((x) => x.id === v.categoryId);
        check(category && category.type === v.type, "Choose a category matching the transaction type.");
        check(!category.archived || (old?.categoryId === category.id && unchangedHistory), "Choose an active category.");
      }
      break;
    }
    case "budget": {
      const v = c.value;
      checkDate(v.startDate); if (v.endDate) { checkDate(v.endDate); check(v.endDate >= v.startDate, "Budget end must follow its start."); }
      const category = s.categories.find((x) => x.id === v.categoryId);
      check(category && category.type === "expense" && !category.archived, "Choose an active expense category.");
      check(!s.budgets.some((b) => b.id !== v.id && b.categoryId === v.categoryId && b.currency === v.currency && b.startDate <= (v.endDate ?? "9999-12-31") && v.startDate <= (b.endDate ?? "9999-12-31")), "A budget already covers this category and currency during that period.");
      break;
    }
    case "goal": {
      const v = c.value, old = s.goals.find((g) => g.id === v.id);
      if (old && s.contributions.some((x) => x.goalId === old.id)) check(old.currency === v.currency && old.scale === v.scale, "A goal with contributions cannot change currency.");
      if (v.accountId) { const account = s.accounts.find((a) => a.id === v.accountId); check(account && account.currency === v.currency && (!account.archived || old?.accountId === account.id), "Link an active account in the goal currency."); }
      break;
    }
    case "contribution": {
      const v = c.value, goal = s.goals.find((g) => g.id === v.goalId);
      check(goal && goal.status !== "archived", "Choose a goal that is not archived.");
      check(sumMoney([...s.contributions.filter((x) => x.goalId === v.goalId && x.id !== v.id).map((x) => x.amountMinor), v.amountMinor]) >= 0, "A withdrawal cannot exceed the goal's tracked savings.");
      const old = s.contributions.find((x) => x.id === v.id);
      check(!old || old.goalId === v.goalId, "A contribution cannot move between goals.");
      break;
    }
  }
  return c;
}
export function accountBalance(s: FinanceSnapshot, accountId: string): number {
  const account = s.accounts.find((a) => a.id === accountId);
  check(account, "Account not found.");
  return sumMoney([account.openingMinor, ...s.transactions.flatMap((t) => t.accountId === accountId ? [t.type === "income" ? t.amountMinor : -t.amountMinor] : t.destinationId === accountId ? [t.amountMinor] : [])]);
}
export function balancesByCurrency(s: FinanceSnapshot): Record<string, number> {
  // Archived balances still belong to the user and remain included.
  return Object.fromEntries([...new Set(s.accounts.map((a) => a.currency))].map((currency) => [currency, sumMoney(s.accounts.filter((a) => a.currency === currency).map((a) => accountBalance(s, a.id)))]));
}
export function monthRange(month: string): { start: string; end: string } {
  check(/^\d{4}-\d{2}$/.test(month), "Choose a valid month.");
  const start = `${month}-01`; checkDate(start);
  const year = Number(month.slice(0, 4)), m = Number(month.slice(5));
  const next = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
  const end = new Date(new Date(`${next}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  return { start, end };
}
export function summary(s: FinanceSnapshot, currency: string, start: string, end: string) {
  checkDate(start); checkDate(end); check(start <= end, "Start date must come before the end date.");
  const transactions = s.transactions.filter((t) => t.currency === currency && t.date >= start && t.date <= end);
  const income = sumMoney(transactions.filter((t) => t.type === "income").map((t) => t.amountMinor));
  const expenses = sumMoney(transactions.filter((t) => t.type === "expense").map((t) => t.amountMinor));
  const byCategory = s.categories.map((c) => ({ category: c, amount: sumMoney(transactions.filter((t) => t.type === "expense" && t.categoryId === c.id).map((t) => t.amountMinor)) })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  return { income, expenses, net: subtractMoney(income, expenses), byCategory, transactions };
}
export function budgetUsage(s: FinanceSnapshot, budget: Budget, month: string | { start: string; end: string }) {
  const range = typeof month === "string" ? monthRange(month) : month;
  const start = range.start > budget.startDate ? range.start : budget.startDate;
  const end = budget.endDate && budget.endDate < range.end ? budget.endDate : range.end;
  const active = start <= end;
  const spent = sumMoney(s.transactions.filter((t) => active && t.type === "expense" && t.categoryId === budget.categoryId && t.currency === budget.currency && t.date >= start && t.date <= end).map((t) => t.amountMinor));
  return { active, spent, remaining: subtractMoney(budget.limitMinor, spent), percentage: percent(spent, budget.limitMinor), over: spent > budget.limitMinor };
}
export function goalProgress(s: FinanceSnapshot, goal: SavingsGoal) {
  const saved = sumMoney(s.contributions.filter((c) => c.goalId === goal.id).map((c) => c.amountMinor));
  return { saved, remaining: Math.max(0, subtractMoney(goal.targetMinor, saved)), percentage: percent(saved, goal.targetMinor) };
}
export function previousRange(start: string, end: string): { start: string; end: string } {
  checkDate(start); checkDate(end); check(start <= end, "Invalid date range.");
  const first = Date.parse(`${start}T12:00:00Z`), last = Date.parse(`${end}T12:00:00Z`), duration = last - first + 86400000;
  return { start: new Date(first - duration).toISOString().slice(0, 10), end: new Date(first - 86400000).toISOString().slice(0, 10) };
}
export function projectCommand(command: FinanceCommand, state: FinanceSnapshot, id: string, timestamp: string): FinanceSnapshot {
  const c = validateCommand(command, state), s = structuredClone(state);
  if (c.entity === "preferences") s.currency = c.currency;
  else if (c.entity === "delete_transaction") s.transactions = s.transactions.filter((x) => x.id !== c.id);
  else if (c.entity === "delete_budget") s.budgets = s.budgets.filter((x) => x.id !== c.id);
  else {
    const key = ({ account: "accounts", category: "categories", transaction: "transactions", budget: "budgets", goal: "goals", contribution: "contributions" } as const)[c.entity];
    const rows = s[key] as { id: string; createdAt: string; updatedAt: string }[];
    const old = rows.find((x) => x.id === c.value.id);
    const row = { ...c.value, id: c.value.id ?? id, createdAt: old?.createdAt ?? timestamp, updatedAt: timestamp };
    if (old) rows.splice(rows.indexOf(old), 1, row); else rows.push(row);
  }
  // Reject overflow before any persistent write, including totals and derived balances.
  Object.values(balancesByCurrency(s)).forEach((v) => assertMinor(v));
  for (const g of s.goals) goalProgress(s, g);
  for (const currency of new Set(s.transactions.map((t) => t.currency))) summary(s, currency, "0001-01-01", "9999-12-31");
  for (const currency of new Set(s.budgets.map((b) => b.currency))) sumMoney(s.budgets.filter((b) => b.currency === currency).map((b) => b.limitMinor));
  return s;
}
