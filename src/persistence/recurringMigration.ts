import type { Migration } from "./migrations";

export const recurringMigration: Migration = {
  version: 7,
  name: "recurring finance schedules and occurrence ledger",
  statements: [
    `CREATE TABLE finance_recurring (
      id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('income','expense')),
      name TEXT NOT NULL CHECK(length(trim(name))>0), amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor BETWEEN 1 AND 9007199254740991),
      currency TEXT NOT NULL CHECK(currency IN ('IRR','USD')), frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly','monthly','yearly')),
      interval INTEGER NOT NULL CHECK(typeof(interval)='integer' AND interval BETWEEN 1 AND 24),
      start_date TEXT NOT NULL, original_start_date TEXT NOT NULL, calendar TEXT NOT NULL CHECK(calendar IN ('persian','gregory')),
      account_id TEXT REFERENCES finance_accounts(id), category_id TEXT, notes TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','paused','archived')), next_index INTEGER NOT NULL CHECK(next_index>=0),
      revision INTEGER NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(category_id,type) REFERENCES finance_categories(id,type), CHECK(type='expense' OR account_id IS NOT NULL)
    )`,
    `CREATE TABLE finance_occurrences (
      rule_id TEXT NOT NULL REFERENCES finance_recurring(id), due_date TEXT NOT NULL,
      transaction_id TEXT UNIQUE REFERENCES finance_transactions(id) ON DELETE SET NULL,
      ledger_date TEXT NOT NULL, posted_at TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>0), currency TEXT NOT NULL,
      schedule_revision INTEGER NOT NULL,
      PRIMARY KEY(rule_id,due_date)
    )`,
    `CREATE INDEX idx_finance_recurring_status ON finance_recurring(status,type)`,
    `CREATE TRIGGER finance_occurrence_active BEFORE INSERT ON finance_occurrences
      WHEN NOT EXISTS (SELECT 1 FROM finance_recurring WHERE id=NEW.rule_id AND status='active' AND revision=NEW.schedule_revision)
      BEGIN SELECT RAISE(ABORT,'Recurring schedule changed. Reload and try again.'); END`,
  ],
};
