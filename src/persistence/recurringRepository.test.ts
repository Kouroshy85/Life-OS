import initSqlJs from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import { calendarMonth, setCalendar } from "../domain/calendar";
import { occurrenceDate, type RecurringDraft } from "../domain/finance/recurring";
import { accountBalance, summary } from "../domain/finance/service";
import { FinanceRepository } from "./financeRepository";
import { migrate, MIGRATIONS } from "./migrations";
import { RecurringRepository } from "./recurringRepository";
import { createMemoryDriver, createSqlJsDriver } from "./sqljsDriver";

const today = "2026-11-19";
const account = { entity: "account", value: { id: null, name: "Bank", type: "bank", openingMinor: 1000, description: "", currency: "IRR", scale: 0, archived: false } } as const;
const income = (accountId: string, patch: Partial<RecurringDraft> = {}): RecurringDraft => ({ type: "income", name: "Salary", currency: "IRR", amountMinor: 100, frequency: "monthly", interval: 1, startDate: "2026-09-18", calendar: "gregory", accountId, categoryId: null, notes: "", ...patch });
let ledger: FinanceRepository;
let schedule: RecurringRepository;
let accountId: string;
beforeEach(async () => {
  const db = await createMemoryDriver();
  await migrate(db);
  ledger = new FinanceRepository(db);
  schedule = new RecurringRepository(db, ledger);
  accountId = (await ledger.commit([account])).accounts[0].id;
});

describe("recurring finance", () => {
  it("catches up independent monthly, daily, weekly and annual income in bounded batches without duplicates", async () => {
    await schedule.save(income(accountId));
    await schedule.save(income(accountId, { name: "Daily", frequency: "daily", startDate: "2026-11-17" }));
    await schedule.save(income(accountId, { name: "Weekly", frequency: "weekly", startDate: "2026-11-05" }));
    await schedule.save(income(accountId, { name: "Annual", frequency: "yearly", startDate: "2025-11-19" }));
    const first = await schedule.processIncome(today, 2);
    expect(first).toMatchObject({ posted: 8, more: true, errors: {} });
    const next = await schedule.processIncome(today, 2);
    expect(next).toMatchObject({ posted: 3, more: false, errors: {} });
    expect(accountBalance(next.finance, accountId)).toBe(2100);
    expect((await schedule.processIncome(today)).posted).toBe(0);
  });

  it("records each expense once on its actual payment date and never deducts a forecast", async () => {
    const id = await schedule.save(income(accountId, { type: "expense", name: "Rent", accountId: null }));
    const [rule] = await schedule.rules();
    expect(rule.accountId).toBeNull();
    await schedule.processIncome(today);
    expect(accountBalance(await ledger.load(), accountId)).toBe(1000);
    const attempts = await Promise.allSettled([1, 2].map(() => schedule.pay(id, rule.startDate, rule.revision, accountId, today, today)));
    expect(attempts.map((item) => item.status)).toEqual(["fulfilled", "rejected"]);
    const after = await ledger.load();
    expect(accountBalance(after, accountId)).toBe(900);
    expect(after.transactions[0]).toMatchObject({ date: today, amountMinor: 100, type: "expense" });
    expect(await schedule.history(id)).toEqual([expect.objectContaining({ dueDate: "2026-09-18", ledgerDate: today })]);
  });

  it("keeps history when editing, pausing, resuming and archiving a rule", async () => {
    const draft = income(accountId);
    const id = await schedule.save(draft);
    await schedule.processIncome("2026-09-18");
    await schedule.setStatus(id, "paused");
    expect((await schedule.processIncome(today)).posted).toBe(0);
    await schedule.save({ ...draft, amountMinor: 250, startDate: "2026-09-17" }, id);
    await schedule.setStatus(id, "active");
    expect((await schedule.processIncome(today)).posted).toBe(2);
    expect((await schedule.history(id)).map((entry) => entry.amountMinor)).toEqual([250, 250, 100]);
    const [rule] = await schedule.rules();
    expect(rule.originalStartDate).toBe("2026-09-18");
    expect(occurrenceDate(rule, rule.nextIndex)).toBe("2026-12-17");
    await schedule.setStatus(id, "archived");
    expect((await schedule.processIncome("2027-01-01")).posted).toBe(0);
    expect((await ledger.load()).transactions).toHaveLength(3);
  });

  it("lets other income post when one source is blocked and retries after account restoration", async () => {
    const active = (await ledger.commit([{ ...account, value: { ...account.value, name: "Other" } }])).accounts.find((item) => item.name === "Other")!;
    const blocked = await schedule.save(income(accountId));
    await schedule.save(income(active.id));
    const old = (await ledger.load()).accounts.find((item) => item.id === accountId)!;
    const { createdAt: _created, updatedAt: _updated, ...value } = old;
    await ledger.commit([{ entity: "account", value: { ...value, archived: true } }]);
    const result = await schedule.processIncome(today);
    expect(result.posted).toBe(3);
    expect(result.errors).toHaveProperty(blocked);
    expect(await schedule.history(blocked)).toEqual([]);
    await ledger.commit([{ entity: "account", value }]);
    expect((await schedule.processIncome(today)).posted).toBe(3);
  });

  it("preserves deduplication across a real database reload after deleting an income transaction", async () => {
    const SQL = await initSqlJs();
    const database = new SQL.Database();
    const db = createSqlJsDriver(database);
    await migrate(db);
    const before = new FinanceRepository(db);
    const { accounts: [bank] } = await before.commit([account]);
    const recurring = new RecurringRepository(db, before);
    const id = await recurring.save(income(bank.id, { startDate: today }));
    const first = await recurring.processIncome(today);
    const record = first.finance.transactions[0];
    await before.commit([{ entity: "delete_transaction", id: record.id }]);
    const reopened = createSqlJsDriver(new SQL.Database(database.export()));
    const after = new FinanceRepository(reopened);
    const processor = new RecurringRepository(reopened, after);
    expect(await processor.history(id)).toEqual([expect.objectContaining({ transactionId: null, dueDate: today })]);
    expect((await processor.processIncome(today)).posted).toBe(0);
    expect((await after.load()).transactions).toEqual([]);
  });

  it("migrates existing v6 finances unchanged and groups real transactions by the chosen calendar", async () => {
    const db = await createMemoryDriver();
    for (const migration of MIGRATIONS.filter((row) => row.version <= 6)) await db.batch(migration.statements.map((sql) => ({ sql })));
    await db.execute("PRAGMA user_version=6");
    const repo = new FinanceRepository(db);
    const { accounts: [bank] } = await repo.commit([account]);
    for (const date of ["2026-10-22", "2026-10-23", "2026-11-21", "2026-11-22"]) {
      await repo.commit([{ entity: "transaction", value: { id: null, accountId: bank.id, destinationId: null, categoryId: "finance-salary", date,
        type: "income", amountMinor: 100, currency: "IRR", scale: 0, description: "Existing income", notes: "" } }]);
    }
    const preMigration = await repo.load();
    expect(await migrate(db)).toEqual({ from: 6, to: 7 });
    expect(await repo.load()).toEqual(preMigration);
    expect(await new RecurringRepository(db, repo).rules()).toEqual([]);
    const selectedMonth = calendarMonth(today, "persian");
    expect(summary(preMigration, "IRR", selectedMonth.start, selectedMonth.end).transactions.map((entry) => entry.date)).toEqual(["2026-10-23", "2026-11-21"]);
    setCalendar("gregory");
    try {
      const month = calendarMonth(today);
      expect(summary(preMigration, "IRR", month.start, month.end).transactions.map((entry) => entry.date)).toEqual(["2026-11-21", "2026-11-22"]);
      expect(await repo.load()).toEqual(preMigration);
    } finally { setCalendar("persian"); }
  });
});
