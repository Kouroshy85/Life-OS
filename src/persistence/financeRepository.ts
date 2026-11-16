import { currencySchema, emptyFinance, type FinanceCommand, type FinanceSnapshot } from "../domain/finance/types";
import { projectCommand } from "../domain/finance/service";
import type { SqlDriver, SqlParam, SqlStatement } from "./driver";
import { newId, nowIso } from "./repository";

const tables = { account: "accounts", category: "categories", transaction: "transactions", budget: "budgets", goal: "goals", contribution: "contributions" } as const;
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function fromRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), k === "archived" ? Number(v) === 1 : v]));
}
/** Shares the application's driver and backup file. It never opens a second database. */
export class FinanceRepository {
  constructor(private readonly db: SqlDriver) {}
  async load(): Promise<FinanceSnapshot> {
    const s = emptyFinance();
    const rows = await Promise.all(Object.values(tables).map((table) => this.db.select(`SELECT * FROM finance_${table} ORDER BY created_at,id`)));
    Object.values(tables).forEach((table, i) => { (s[table] as unknown[]) = rows[i].map(fromRow); });
    const prefs = await this.db.select<{ value: string }>("SELECT value FROM settings WHERE key='finance.currency'");
    const currency = currencySchema.safeParse(prefs[0]?.value);
    if (currency.success) s.currency = "IRR";
    return s;
  }
  /** A preview and its statement are built through exactly the same domain validation. */
  prepare(command: FinanceCommand, state: FinanceSnapshot, id = newId(), timestamp = nowIso()): { state: FinanceSnapshot; statement: SqlStatement } {
    const next = projectCommand(command, state, id, timestamp);
    if (command.entity === "preferences") return { state: next, statement: { sql: "INSERT INTO settings(key,value) VALUES('finance.currency',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params: [command.currency] } };
    if (command.entity === "delete_transaction" || command.entity === "delete_budget") return { state: next, statement: { sql: `DELETE FROM finance_${command.entity === "delete_transaction" ? "transactions" : "budgets"} WHERE id=?`, params: [command.id] } };
    const table = tables[command.entity];
    const row = next[table].find((x) => x.id === (command.value.id ?? id))!;
    const entries = Object.entries(row);
    const columns = entries.map(([k]) => snake(k));
    const params = entries.map(([, v]) => typeof v === "boolean" ? Number(v) : v) as SqlParam[];
    // Full records are validated above; column names come only from fixed domain schemas.
    if (command.value.id) {
      const changed = entries.filter(([k]) => k !== "id" && k !== "createdAt");
      return { state: next, statement: { sql: `UPDATE finance_${table} SET ${changed.map(([k]) => `${snake(k)}=?`).join(",")} WHERE id=?`, params: [...changed.map(([, v]) => typeof v === "boolean" ? Number(v) : v) as SqlParam[], command.value.id] } };
    }
    return { state: next, statement: { sql: `INSERT INTO finance_${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`, params } };
  }
  private queue: Promise<unknown> = Promise.resolve();
  /** Serializes read/validate/write against other Finance writes, including assistant approval. */
  commit(commands: FinanceCommand[], expectedFingerprint?: string, additionalStatements: SqlStatement[] = []): Promise<FinanceSnapshot> {
    const work = this.queue.then(async () => {
      let s = await this.load();
      if (expectedFingerprint !== undefined && financeFingerprint(s) !== expectedFingerprint) throw new Error("Finance data changed. Review a fresh proposal before applying it.");
      const statements: SqlStatement[] = [...additionalStatements];
      for (const command of commands) { const next = this.prepare(command, s); s = next.state; statements.push(next.statement); }
      await this.db.batch(statements);
      return this.load();
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
}
/** Exact serialized state, rather than a collision-prone hash, guards approval staleness. */
export const financeFingerprint = (state: FinanceSnapshot) => JSON.stringify(state);
