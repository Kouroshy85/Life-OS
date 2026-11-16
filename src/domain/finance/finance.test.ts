import { describe, expect, it } from "vitest";
import { csv, transactionsCsv } from "./export";
import { draft, financeAccount, financeState, financeTransaction } from "./fixtures";
import { currencyScale, decimalMoney, formatMoney, parseMoney, sumMoney } from "./money";
import { accountBalance, balancesByCurrency, budgetUsage, checkDate, goalProgress, monthRange, previousRange, projectCommand, summary, validateCommand } from "./service";
import type { Budget, SavingsGoal } from "./types";

describe("exact monetary values", () => {
  it("keeps rial/toman display and entry exact, including a single rial", () => {
    expect(formatMoney(12345, "IRR", "en-US", "toman")).toContain("1,234.5");
    expect(formatMoney(1, "IRR", "fa-IR", "toman")).toContain("۰٫۱");
    expect(parseMoney("۱۲۳۴٫۵", "IRR", "fa-IR", 1)).toBe(12345);
    expect(() => parseMoney("1.23", "IRR", "en-US", 1)).toThrow();
    expect(financeState().currency).toBe("IRR");
    expect(() => validateCommand({ entity: "account", value: { ...draft(financeAccount("x")), id: null, currency: "EUR" } }, financeState())).toThrow();
  });
  it("parses two, zero and three decimal currencies without rounding", () => {
    expect(parseMoney("0.29", "USD")).toBe(29);
    expect(parseMoney("300,000", "IRR")).toBe(300000);
    expect(parseMoney("1.234", "KWD")).toBe(1234);
    expect(parseMoney("۱٬۲۳۴٫۵۶", "USD", "fa-IR")).toBe(123456);
    expect(parseMoney("-0.01", "USD")).toBe(-1);
    expect(parseMoney("1.234,56", "EUR", "de-DE")).toBe(123456);
  });
  it("rejects excess precision, malformed groups, exponents and unsafe integers", () => {
    for (const text of ["0.001", "1,23", "1e3", "NaN", "", "1.2.3", "90071992547409.92"]) expect(() => parseMoney(text, "USD")).toThrow();
    expect(() => parseMoney("1.1", "JPY")).toThrow();
    expect(() => currencyScale("XXX")).toThrow();
  });
  it("round trips the maximum safe minor value and keeps localized fractions exact", () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(parseMoney(decimalMoney(max, 2), "USD")).toBe(max);
    expect(formatMoney(max, "USD", "en-US")).toBe("$90,071,992,547,409.91");
    expect(formatMoney(-1, "USD", "en-US")).toBe("-$0.01");
    expect(formatMoney(18014398509481982n, "USD", "en-US")).toBe("$180,143,985,094,819.82");
    expect(formatMoney(1234, "KWD", "en-US")).toContain("1.234");
    expect(formatMoney(123456, "USD", "fa-IR")).toContain("۵۶");
  });
  it("uses integer arithmetic and rejects aggregate overflow", () => {
    expect(sumMoney([10, 20, -1])).toBe(29);
    expect(sumMoney([Number.MAX_SAFE_INTEGER, 1, -1])).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => sumMoney([Number.MAX_SAFE_INTEGER, 1])).toThrow(/range/);
    expect(() => sumMoney([0.1])).toThrow();
  });
});
describe("finance calculations and validation", () => {
  it("derives income, expense, and both transfer balances; transfers leave net unchanged", () => {
    const s = financeState();
    s.transactions = [financeTransaction(), financeTransaction({ id: "i", type: "income", categoryId: "salary", amountMinor: 20000 }), financeTransaction({ id: "x", type: "transfer", destinationId: "a2", categoryId: null, amountMinor: 4000 })];
    expect(accountBalance(s, "a1")).toBe(25000); expect(accountBalance(s, "a2")).toBe(4000);
    expect(summary(s, "USD", "2026-11-01", "2026-11-30")).toMatchObject({ income: 20000, expenses: 1000, net: 19000 });
    expect(balancesByCurrency(s)).toEqual({ USD: 29000 });
    s.accounts[0].archived = true; expect(balancesByCurrency(s).USD).toBe(29000);
  });
  it("separates currencies and excludes other months and transfers from category spending", () => {
    const s = financeState(); s.accounts.push(financeAccount("jpy", { currency: "IRR", scale: 0, openingMinor: 250 }));
    s.transactions = [financeTransaction(), financeTransaction({ id: "prev", date: "2026-10-31" }), financeTransaction({ id: "next", date: "2026-12-01" }), financeTransaction({ id: "yen", currency: "IRR", scale: 0, amountMinor: 50, accountId: "jpy" })];
    expect(summary(s, "USD", "2026-11-01", "2026-11-30").expenses).toBe(1000);
    expect(balancesByCurrency(s)).toEqual({ USD: 7000, IRR: 200 });
  });
  it("rejects invalid transfers, wrong references, zero, negative and fractional amounts", () => {
    const s = financeState();
    const base = { entity: "transaction", value: { ...draft(financeTransaction()), id: null } };
    for (const patch of [{ amountMinor: 0 }, { amountMinor: -1 }, { amountMinor: 0.1 }, { accountId: "missing" }, { categoryId: "salary" }, { scale: 0 }, { type: "transfer", destinationId: "a1", categoryId: null }, { type: "transfer", destinationId: "a2" }, { destinationId: "a2" }, { date: "2026-02-30" }]) expect(() => validateCommand({ ...base, value: { ...base.value, ...patch } }, s)).toThrow();
    s.accounts[1].currency = "IRR"; s.accounts[1].scale = 0;
    expect(() => validateCommand({ ...base, value: { ...base.value, type: "transfer", destinationId: "a2", categoryId: null } }, s)).toThrow(/same currency/);
  });
  it("keeps historical archived records readable and permits only notes/description edits", () => {
    const s = financeState(); s.transactions = [financeTransaction()]; s.accounts[0].archived = true;
    expect(() => validateCommand({ entity: "transaction", value: { ...draft(s.transactions[0]), notes: "receipt" } }, s)).not.toThrow();
    expect(() => validateCommand({ entity: "transaction", value: { ...draft(s.transactions[0]), amountMinor: 2000 } }, s)).toThrow(/Archived/);
    expect(() => validateCommand({ entity: "account", value: { ...draft(s.accounts[0]), openingMinor: 0 } }, s)).toThrow(/locked/);
  });
  it("calculates monthly budgets from expense transactions in their exact active dates", () => {
    const s = financeState(); s.transactions = [financeTransaction({ date: "2026-11-01" }), financeTransaction({ id: "2", date: "2026-11-14", amountMinor: 6000 }), financeTransaction({ id: "3", date: "2026-11-30" })];
    const b: Budget = { id: "b", categoryId: "food", limitMinor: 5000, currency: "USD", scale: 2, period: "monthly", startDate: "2026-11-10", endDate: "2026-11-20", createdAt: "x", updatedAt: "x" };
    expect(budgetUsage(s, b, "2026-11")).toEqual({ active: true, spent: 6000, remaining: -1000, percentage: 120, over: true });
    expect(budgetUsage(s, b, "2026-12").active).toBe(false);
    s.budgets = [b];
    expect(() => validateCommand({ entity: "budget", value: { ...draft(b), id: null, startDate: "2026-11-20" } }, s)).toThrow(/already covers/);
  });
  it("tracks savings corrections without account effects or overspending tracked savings", () => {
    let s = financeState();
    const g: SavingsGoal = { id: "g", name: "PC", targetMinor: 10000, currency: "USD", scale: 2, targetDate: null, description: "", status: "active", accountId: null, createdAt: "x", updatedAt: "x" }; s.goals = [g];
    s = projectCommand({ entity: "contribution", value: { id: null, goalId: "g", amountMinor: 6000, date: "2026-11-14", notes: "" } }, s, "c", "x");
    expect(goalProgress(s, g)).toEqual({ saved: 6000, remaining: 4000, percentage: 60 });
    expect(accountBalance(s, "a1")).toBe(10000); expect(s.transactions).toEqual([]);
    expect(() => validateCommand({ entity: "contribution", value: { id: null, goalId: "g", amountMinor: -6001, date: "2026-11-14", notes: "" } }, s)).toThrow(/exceed/);
    s = projectCommand({ entity: "contribution", value: { id: "c", goalId: "g", amountMinor: 4500, date: "2026-11-14", notes: "correction" } }, s, "ignored", "later");
    expect(goalProgress(s, g).saved).toBe(4500);
  });
  it("rejects projected balance overflow before saving", () => {
    const s = financeState(); s.accounts[0].openingMinor = Number.MAX_SAFE_INTEGER;
    expect(() => projectCommand({ entity: "transaction", value: { ...draft(financeTransaction({ type: "income", categoryId: "salary" })), id: null } }, s, "i", "x")).toThrow(/range/);
  });
});
describe("date boundaries and exports", () => {
  it("handles leap years, year boundaries and inclusive date ranges without time-zone shifts", () => {
    expect(monthRange("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthRange("2026-12").end).toBe("2026-12-31");
    expect(previousRange("2026-11-01", "2026-11-30")).toEqual({ start: "2026-10-02", end: "2026-10-31" });
    expect(() => checkDate("2026-02-29")).toThrow();
    expect(() => monthRange("2026-13")).toThrow();
  });
  it("exports exact amounts, currency, scale, dates and escaped user content", () => {
    const s = financeState(); const t = financeTransaction({ description: '=HYPERLINK("bad")', notes: "line 1\nline 2" });
    const output = transactionsCsv(s, [t]);
    expect(output).toContain('"10.00","USD","2","1000"');
    expect(output).toContain("2026-11-14"); expect(output).toContain("'=HYPERLINK"); expect(output).toContain('"line 1\nline 2"');
    expect(csv([["a,b", 'a"b']])).toContain('"a,b","a""b"');
  });
});
