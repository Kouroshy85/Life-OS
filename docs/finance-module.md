# Finance implementation

Finance uses the existing native SQLite / sql.js drivers and the same database and backup file. No additional runtime dependencies, cloud services or authentication were added. The deterministic scheduler is unchanged.

## Layers and files

- `src/domain/finance/{types,money,service,export}.ts`: validated records, integer money parsing/formatting, balances, summaries, monthly budgets, savings progress and CSV export.
- `src/persistence/financeMigration.ts`: additive migration v6; six tables for accounts, categories, transactions, budgets, goals and contributions. Foreign keys, indexes, integer checks and integrity triggers preserve history. Only default categories are seeded.
- `src/persistence/financeRepository.ts`: validated statement preparation, serialized writes and atomic batches.
- `src/state/finance.ts`: separate Finance state, shared driver and storage retry handling.
- `src/features/finance/{FinanceView,FinanceEditor,IranUnitSwitch,copy}.tsx/ts` and `src/styles/finance.css`: overview, ledger, accounts, budgets, savings, reports and settings, inheriting the application theme and fonts.
- `src/ai/assistant/{finance,modules}.ts`: bounded context, reference resolution, module instructions and previews. The existing schema, parsing, proposal and application pipeline were extended; Finance has no separate chatbot.
- Existing App, Sidebar, store, assistant, i18n, migration registration and browser driver were updated for integration. The browser driver now reports durable-storage errors rather than silently swallowing them.

## Decisions

Stored money is a safe integer with explicit currency and scale; calculations use bigint. Balances are derived from opening balances and transaction history. A transfer is one atomic ledger record with two account effects and no income/expense effect. Historical accounts/categories are archived. Opening balances and currencies lock when history exists. Savings contributions are a separate tracking ledger and never move account money.

Selectable currencies are USD and IRR; the default is always IRR. The shared rial/toman preference changes presentation and form entry only. CSV and assistant commands retain canonical stored units. The parser retains support for historical currency scales internally, but new record validation and selectors only accept USD/IRR.

AI context excludes Finance from planning-only turns and supplies bounded summaries for finance/mixed turns. Read-only analysis has no approval step. Every mutation goes through schema/domain validation, preview, explicit approval, stale-data checking, and atomic repository application. Actual model quality remains dependent on the installed local model and was tested using the existing scripted provider rather than live inference.

## Verification

327 Vitest tests passed, including existing Planning tests and new finance domain, persistence, migration, backup, AI and durable-save recovery tests. Production frontend build passed. Interactive browser checks exercised CRUD, transfer reversal, real budget usage, savings/account separation, filtering, reload persistence, reports and 390px/Persian layouts. No mobile device or signed installer test has been performed.

No exchange conversion, bank sync, recurring transactions or trading is included. Report budget tables show at most 120 calendar months. Default category names remain editable English names. Some domain validation messages remain English in Persian UI.
