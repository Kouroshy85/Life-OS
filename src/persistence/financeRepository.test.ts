import initSqlJs from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import { draft } from "../domain/finance/fixtures";
import { accountBalance, goalProgress, summary } from "../domain/finance/service";
import type { FinanceCommand } from "../domain/finance/types";
import { checkBackup } from "./backup";
import type { SqlDriver } from "./driver";
import { FinanceRepository, financeFingerprint } from "./financeRepository";
import { LATEST_VERSION, migrate, MIGRATIONS } from "./migrations";
import { createMemoryDriver, createSqlJsDriver, retryBrowserPersistence } from "./sqljsDriver";
import { DurableSaveError } from "./driver";

let db: SqlDriver, repo: FinanceRepository;
const account = (name: string): FinanceCommand => ({ entity: "account", value: { id: null, name, type: "bank", currency: "USD", scale: 2, openingMinor: 10000, description: "", archived: false } });
const tx = (accountId: string, type: "income" | "expense" | "transfer" = "expense", destinationId: string | null = null): FinanceCommand => ({ entity: "transaction", value: { id: null, accountId, type, destinationId, categoryId: type === "transfer" ? null : type === "income" ? "finance-salary" : "finance-food", amountMinor: 2500, currency: "USD", scale: 2, description: "Test", date: "2026-11-14", notes: "" } });
beforeEach(async () => { db = await createMemoryDriver(); await migrate(db); repo = new FinanceRepository(db); });
describe("Finance repository", () => {
  it("seeds only categories, uses the existing settings table and persists account edits", async () => {
    expect((await repo.load()).categories).toHaveLength(12); expect((await repo.load()).transactions).toEqual([]);
    let s = await repo.commit([account("Checking"), { entity: "preferences", currency: "IRR" }]);
    expect(s.currency).toBe("IRR"); expect(s.accounts).toHaveLength(1);
    const old = s.accounts[0]; s = await repo.commit([{ entity: "account", value: { ...draft(old), name: "Main" } }]);
    expect(s.accounts[0].name).toBe("Main"); expect(s.accounts[0].createdAt).toBe(old.createdAt);
    await expect(db.execute("DELETE FROM finance_accounts WHERE id=?", [old.id])).resolves.toBeUndefined();
  });
  it("creates, reads, updates and deletes income and expenses with recalculated balances", async () => {
    let s = await repo.commit([account("A")]); const id = s.accounts[0].id;
    s = await repo.commit([tx(id, "income"), tx(id)]); expect(accountBalance(s, id)).toBe(10000);
    const expense = s.transactions.find((t) => t.type === "expense")!;
    s = await repo.commit([{ entity: "transaction", value: { ...draft(expense), amountMinor: 4000, date: "2026-10-31" } }]);
    expect(accountBalance(s, id)).toBe(8500); expect(summary(s, "USD", "2026-11-01", "2026-11-30").expenses).toBe(0);
    s = await repo.commit([{ entity: "delete_transaction", id: expense.id }]); expect(accountBalance(s, id)).toBe(12500);
  });
  it("edits transfer source, destination and amount and reverses deletion correctly", async () => {
    let s = await repo.commit([account("A"), account("B"), account("C")]); const [a, b, c] = s.accounts;
    s = await repo.commit([tx(a.id, "transfer", b.id)]); expect(accountBalance(s, a.id)).toBe(7500); expect(accountBalance(s, b.id)).toBe(12500);
    s = await repo.commit([{ entity: "transaction", value: { ...draft(s.transactions[0]), accountId: b.id, destinationId: c.id, amountMinor: 5000 } }]);
    expect(s.accounts.map((a) => accountBalance(s, a.id))).toEqual([10000, 5000, 15000]);
    expect(summary(s, "USD", "2026-11-01", "2026-11-30")).toMatchObject({ income: 0, expenses: 0, net: 0 });
    s = await repo.commit([{ entity: "delete_transaction", id: s.transactions[0].id }]); expect(s.accounts.map((a) => accountBalance(s, a.id))).toEqual([10000, 10000, 10000]);
  });
  it("rolls back a transfer if a subsequent SQL operation fails", async () => {
    const s = await repo.commit([account("A"), account("B")]);
    const transfer = repo.prepare(tx(s.accounts[0].id, "transfer", s.accounts[1].id), s).statement;
    await expect(db.batch([transfer, { sql: "INSERT INTO finance_transactions(id) VALUES('invalid')" }])).rejects.toThrow();
    expect((await repo.load()).transactions).toEqual([]); expect(accountBalance(await repo.load(), s.accounts[0].id)).toBe(10000);
  });
  it("keeps account/category histories and enforces foreign keys and archive rules in SQLite", async () => {
    let s = await repo.commit([account("A")]); s = await repo.commit([tx(s.accounts[0].id)]);
    const a = s.accounts[0], t = s.transactions[0], cat = s.categories.find((c) => c.id === t.categoryId)!;
    await expect(db.execute("DELETE FROM finance_accounts WHERE id=?", [a.id])).rejects.toThrow();
    await expect(db.execute("DELETE FROM finance_categories WHERE id=?", [cat.id])).rejects.toThrow();
    await expect(db.execute("UPDATE finance_accounts SET opening_minor=0 WHERE id=?", [a.id])).rejects.toThrow(/locked/);
    s = await repo.commit([{ entity: "account", value: { ...draft(a), archived: true } }, { entity: "category", value: { ...draft(cat), archived: true } }]);
    s = await repo.commit([{ entity: "transaction", value: { ...draft(t), description: "Historical receipt" } }]); expect(s.transactions[0].description).toBe("Historical receipt");
    await expect(repo.commit([tx(a.id)])).rejects.toThrow(/Archived/);
    await expect(db.execute("UPDATE finance_transactions SET amount_minor=5 WHERE id=?", [t.id])).rejects.toThrow(/archived/);
    expect(accountBalance(s, a.id)).toBe(7500);
  });
  it("enforces amount, currency and category constraints even for direct SQL", async () => {
    let s = await repo.commit([account("A")]); s = await repo.commit([tx(s.accounts[0].id)]); const id = s.transactions[0].id;
    for (const sql of ["amount_minor=0", "amount_minor=-1", "amount_minor=1.5", "scale=0", "category_id='missing'", "category_id='finance-salary'", "account_id='missing'", "type='transfer'"]) await expect(db.execute(`UPDATE finance_transactions SET ${sql} WHERE id=?`, [id])).rejects.toThrow();
  });
  it("persists budgets, goals, allocations and their edits without moving money", async () => {
    let s = await repo.commit([account("A")]);
    s = await repo.commit([{ entity: "budget", value: { id: null, categoryId: "finance-food", limitMinor: 1000, period: "monthly", startDate: "2026-11-01", endDate: null, currency: "USD", scale: 2 } }, { entity: "goal", value: { id: null, name: "PC", targetMinor: 10000, currency: "USD", scale: 2, targetDate: "2027-05-01", description: "", status: "active", accountId: s.accounts[0].id } }]);
    s = await repo.commit([{ entity: "contribution", value: { id: null, goalId: s.goals[0].id, amountMinor: 5000, date: "2026-11-14", notes: "allocation" } }]);
    s = await repo.commit([{ entity: "contribution", value: { id: null, goalId: s.goals[0].id, amountMinor: -1000, date: "2026-11-14", notes: "withdraw" } }]);
    expect(goalProgress(s, s.goals[0]).saved).toBe(4000); expect(accountBalance(s, s.accounts[0].id)).toBe(10000);
    s = await repo.commit([{ entity: "budget", value: { ...draft(s.budgets[0]), limitMinor: 2000 } }]); expect(s.budgets[0].limitMinor).toBe(2000);
    s = await repo.commit([{ entity: "delete_budget", id: s.budgets[0].id }]); expect(s.budgets).toEqual([]);
    await expect(db.execute("DELETE FROM finance_goals WHERE id=?", [s.goals[0].id])).rejects.toThrow();
  });
  it("serializes concurrent finance writes and rejects stale approvals", async () => {
    let s = await repo.commit([account("A")]); const before = financeFingerprint(s);
    await Promise.all([repo.commit([tx(s.accounts[0].id)]), repo.commit([tx(s.accounts[0].id, "income")])]);
    s = await repo.load(); expect(s.transactions).toHaveLength(2);
    await expect(repo.commit([account("Unapproved")], before)).rejects.toThrow(/changed/); expect((await repo.load()).accounts).toHaveLength(1);
  });
  it("validates a whole command batch before writing anything", async () => {
    const s = await repo.commit([account("A")]);
    await expect(repo.commit([tx(s.accounts[0].id), tx("missing")])).rejects.toThrow(); expect((await repo.load()).transactions).toEqual([]);
  });
});
describe("finance migrations and backups", () => {
  it("surfaces durable save failures and retries storage without duplicating the transaction", async () => {
    const SQL = await initSqlJs(); let fail = false; let bytes: Uint8Array = new Uint8Array();
    const driver = createSqlJsDriver(new SQL.Database(), { persist: async (data) => { if (fail) throw new Error("quota exceeded"); bytes = data; } });
    await migrate(driver); const finance = new FinanceRepository(driver);
    const s = await finance.commit([account("A")]); fail = true;
    await expect(finance.commit([tx(s.accounts[0].id)])).rejects.toBeInstanceOf(DurableSaveError);
    expect((await finance.load()).transactions).toHaveLength(1);
    fail = false; await retryBrowserPersistence();
    const restored = new FinanceRepository(createSqlJsDriver(new SQL.Database(bytes)));
    expect((await restored.load()).transactions).toHaveLength(1);
  });
  it("upgrades v5 without changing planning data or settings, and is idempotent", async () => {
    const old = await createMemoryDriver();
    for (const m of MIGRATIONS.filter((m) => m.version < 6)) await old.batch(m.statements.map((sql) => ({ sql })));
    await old.execute("PRAGMA user_version=5"); await old.execute("INSERT INTO settings(key,value) VALUES('existing','keep')");
    await old.execute("INSERT INTO goals(id,title,created_at,updated_at) VALUES('existing-goal','Keep goal','x','x')");
    expect(await migrate(old)).toEqual({ from: 5, to: LATEST_VERSION });
    expect(await old.select("SELECT title FROM goals WHERE id='existing-goal'")).toEqual([{ title: "Keep goal" }]);
    expect(await old.select("SELECT value FROM settings WHERE key='existing'")).toEqual([{ value: "keep" }]);
    await migrate(old); expect((await new FinanceRepository(old).load()).categories).toHaveLength(12);
  });
  it("survives a database export, reload and backup validation with finance rows intact", async () => {
    const SQL = await initSqlJs(); let bytes: Uint8Array = new Uint8Array();
    const driver = createSqlJsDriver(new SQL.Database(), { persist: async (data) => { bytes = data; } });
    await migrate(driver); const finance = new FinanceRepository(driver);
    let s = await finance.commit([account("Persistent")]); s = await finance.commit([tx(s.accounts[0].id)]);
    expect(checkBackup(bytes, SQL)).toBe("ok");
    const reloaded = new FinanceRepository(createSqlJsDriver(new SQL.Database(bytes)));
    expect(await reloaded.load()).toEqual(s);
  });
});
