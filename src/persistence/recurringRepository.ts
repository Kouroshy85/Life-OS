import { currencyScale } from "../domain/finance/money";
import { firstAfter, occurrenceDate, validateRecurring, type RecurringDraft, type RecurringOccurrence, type RecurringRule } from "../domain/finance/recurring";
import { checkDate } from "../domain/finance/service";
import type { FinanceSnapshot } from "../domain/finance/types";
import { DurableSaveError, type SqlDriver, type SqlStatement } from "./driver";
import type { FinanceRepository } from "./financeRepository";
import { newId, nowIso } from "./repository";

const ruleColumns = `id, type, name, amount_minor AS amountMinor, currency, frequency, interval, start_date AS startDate,
 original_start_date AS originalStartDate, calendar, account_id AS accountId, category_id AS categoryId, notes,
 status, next_index AS nextIndex, revision, created_at AS createdAt,
 (SELECT MAX(due_date) FROM finance_occurrences WHERE rule_id=finance_recurring.id) AS lastPosted`;

export class RecurringRepository {
  constructor(private readonly db: SqlDriver, private readonly ledger: FinanceRepository) {}

  rules() {
    return this.db.select<RecurringRule>(`SELECT ${ruleColumns} FROM finance_recurring ORDER BY created_at,id`);
  }
  history(ruleId: string) {
    return this.db.select<RecurringOccurrence>(`SELECT rule_id AS ruleId,due_date AS dueDate,transaction_id AS transactionId,
      ledger_date AS ledgerDate,posted_at AS postedAt,amount_minor AS amountMinor,currency
      FROM finance_occurrences WHERE rule_id=? ORDER BY due_date DESC`, [ruleId]);
  }
  private async rule(id: string) {
    const [rule] = await this.db.select<RecurringRule>(`SELECT ${ruleColumns} FROM finance_recurring WHERE id=?`, [id]);
    if (!rule) throw new Error("This schedule no longer exists.");
    return rule;
  }
  save(input: RecurringDraft, id?: string) {
    return this.ledger.serialize(async () => {
      const draft = validateRecurring(input, await this.ledger.load());
      const values = [draft.name, draft.amountMinor, draft.currency, draft.frequency, draft.interval, draft.startDate,
        draft.calendar, draft.accountId, draft.categoryId, draft.notes];
      if (!id) {
        const id = newId();
        await this.db.execute(`INSERT INTO finance_recurring(id,type,name,amount_minor,currency,frequency,interval,start_date,calendar,
          account_id,category_id,notes,original_start_date,status,next_index,revision,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'active',0,1,?)`, [id, draft.type, ...values, draft.startDate, nowIso()]);
        return id;
      }
      const old = await this.rule(id);
      if (old.status === "archived" || old.type !== draft.type) throw new Error("This schedule cannot be edited.");
      const timingChanged = old.startDate !== draft.startDate || old.calendar !== draft.calendar || old.frequency !== draft.frequency || old.interval !== draft.interval;
      let nextIndex = old.nextIndex;
      if (timingChanged) nextIndex = old.lastPosted ? firstAfter(draft, old.lastPosted) : 0;
      await this.db.execute(`UPDATE finance_recurring SET name=?,amount_minor=?,currency=?,frequency=?,interval=?,start_date=?,calendar=?,
        account_id=?,category_id=?,notes=?,next_index=?,revision=revision+1 WHERE id=?`, [...values, nextIndex, id]);
      return id;
    });
  }
  setStatus(id: string, status: RecurringRule["status"]) {
    return this.ledger.serialize(async () => {
      const rule = await this.rule(id);
      if (rule.status === "archived") throw new Error("This schedule is archived.");
      await this.db.execute("UPDATE finance_recurring SET status=?,revision=revision+1 WHERE id=?", [status, id]);
    });
  }
  private async post(rule: RecurringRule, dueDates: string[], finance: FinanceSnapshot, accountId: string, paidDate?: string) {
    const available = finance.categories.filter((category) => category.type === rule.type && !category.archived);
    const category = rule.categoryId ? available.find((category) => category.id === rule.categoryId)
      : available.find((category) => category.id === `finance-other-${rule.type}`) ?? available[0];
    if (!category) throw new Error("Choose an active category for this schedule.");
    const statements: SqlStatement[] = [];
    const postedAt = nowIso();
    for (const dueDate of dueDates) {
      const transactionId = newId();
      const date = paidDate ?? dueDate;
      const prepared = this.ledger.prepare({ entity: "transaction", value: { id: null, type: rule.type, amountMinor: rule.amountMinor,
        currency: rule.currency, scale: currencyScale(rule.currency), description: rule.name, notes: rule.notes,
        accountId, destinationId: null, categoryId: category.id, date } }, finance, transactionId, postedAt);
      finance = prepared.state;
      statements.push(prepared.statement, { sql: `INSERT INTO finance_occurrences(rule_id,due_date,transaction_id,ledger_date,posted_at,amount_minor,currency,schedule_revision)
        VALUES(?,?,?,?,?,?,?,?)`, params: [rule.id, dueDate, transactionId, date, postedAt, rule.amountMinor, rule.currency, rule.revision] });
    }
    statements.push({ sql: "UPDATE finance_recurring SET next_index=?,revision=revision+1 WHERE id=?", params: [rule.nextIndex + dueDates.length, rule.id] });
    await this.db.batch(statements);
    return finance;
  }
  pay(id: string, expectedDueDate: string, expectedRevision: number, accountId: string, paidDate: string, today: string) {
    return this.ledger.serialize(async () => {
      checkDate(paidDate);
      const rule = await this.rule(id);
      const dueDate = occurrenceDate(rule, rule.nextIndex);
      if (rule.type !== "expense" || rule.status !== "active" || dueDate !== expectedDueDate || rule.revision !== expectedRevision) {
        throw new Error("This payment was already recorded or the schedule changed.");
      }
      if (paidDate > today) throw new Error("Choose today or an earlier payment date.");
      return this.post(rule, [dueDate], await this.ledger.load(), accountId, paidDate);
    });
  }
  /** One bounded batch per source. A blocked source cannot stop the others. */
  processIncome(today: string, batchSize = 32) {
    return this.ledger.serialize(async () => {
      checkDate(today);
      let finance = await this.ledger.load();
      const errors: Record<string, string> = {};
      let posted = 0;
      let more = false;
      for (const rule of await this.rules()) {
        if (rule.type !== "income" || rule.status !== "active" || !rule.accountId) continue;
        const dates: string[] = [];
        let index = rule.nextIndex;
        for (; dates.length < batchSize && occurrenceDate(rule, index) <= today; index++) dates.push(occurrenceDate(rule, index));
        if (!dates.length) continue;
        try {
          finance = await this.post(rule, dates, finance, rule.accountId);
          posted += dates.length;
          more ||= occurrenceDate(rule, index) <= today;
        } catch (error) {
          if (error instanceof DurableSaveError) throw error;
          errors[rule.id] = error instanceof Error ? error.message : String(error);
        }
      }
      return { finance, posted, more, errors, rules: await this.rules() };
    });
  }
}
