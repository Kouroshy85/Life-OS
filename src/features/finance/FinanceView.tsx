import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarDays, ChevronLeft, Coins, List, Settings2, ShoppingCart, BookOpen, Briefcase, Car, ChevronRight, Download, Film, Gift, Home, Laptop, Pencil, Plus, Repeat, Search, ShoppingBag, Trash2, Utensils, Wallet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { csv, transactionsCsv } from "../../domain/finance/export";
import { CURRENCIES, currencyScale, decimalMoney, formatMoney } from "../../domain/finance/money";
import { accountBalance, balancesByCurrency, budgetUsage, goalProgress, previousRange, summary } from "../../domain/finance/service";
import type { Category, FinanceSnapshot, Transaction } from "../../domain/finance/types";
import { getLang, num, pct } from "../../domain/locale";
import { formatFullDate, formatMonthYear, formatShortDate } from "../../domain/time";
import { calendarMonth, calendarQuarter, displayDate, getCalendar, shiftCalendarMonth, shiftDate, APP_TIME_ZONE } from "../../domain/calendar";
import { occurrenceDate } from "../../domain/finance/recurring";
import { processRecurringIncome, retryFinanceStorage, saveFinance, useFinance, useRecurring } from "../../state/finance";
import { toast, useApp } from "../../state/store";
import { DateInput, SelectInput, TextInput } from "../../ui/fields";
import { Bar, Button, Dialog, Empty, Field, IconButton, Menu } from "../../ui/primitives";
import { IranUnitSwitch, useIranUnit } from "./IranUnitSwitch";
import { categoryLabel, f, sectionNames, typeName } from "./copy";
import { editorKey, FinanceEditor, type EditorRequest } from "./FinanceEditor";

import { FinanceNavigation, financeNavigate, useFinanceNavigation } from "./FinanceNavigation";
import { RecurringView } from "./RecurringView";
type OpenEditor = (request: EditorRequest) => void;
const locale = () => getLang() === "fa" ? "fa-IR" : "en-US";
const money = (value: number | bigint, currency: string) => formatMoney(value, currency, locale(), useIranUnit.getState().unit);
const categoryIcons: Record<string, typeof Wallet> = { wallet: Wallet, utensils: Utensils, car: Car, home: Home, book: BookOpen, gift: Gift, laptop: Laptop, film: Film, briefcase: Briefcase, repeat: Repeat, "shopping-bag": ShoppingBag, plus: Plus };
function CategoryIcon({ category }: { category?: Category }) { const Icon = categoryIcons[category?.icon ?? "wallet"] ?? Wallet; return <span className="finance-icon" style={category?.color ? { color: category.color } : undefined}><Icon size={18} /></span>; }
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Panel({ title, children, action, className = "" }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <section className={`card finance-panel ${className}`}><div className="finance-panel-head"><h2>{title}</h2>{action}</div>{children}</section>;
}
function NoData({ title, text, action }: { title: string; text?: string; action?: ReactNode }) { return <Empty icon={<Wallet size={22} />} title={title} text={text} action={action} />; }
function Metric({ label, value, tone, hint, onClick }: { label: string; value: string; tone?: string; hint?: string; onClick?: () => void }) {
  return <button type="button" className={`finance-metric ${tone ? `finance-${tone}` : ""}`} onClick={onClick}><span>{label}</span><strong className="tabular">{value}</strong>{hint && <small>{hint}</small>}</button>;
}
function Breakdown({ data, currency, start, end }: { data: FinanceSnapshot; currency: string; start: string; end: string }) {
  const report = summary(data, currency, start, end);
  if (!report.byCategory.length) return <NoData title={f("No spending in this period", "در این بازه هزینه‌ای ثبت نشده")} text={f("Your category breakdown will appear as you record expenses.", "با ثبت هزینه‌ها، سهم هر دسته اینجا نمایش داده می‌شود.")} />;
  return <div className="finance-breakdown">{report.byCategory.map(({ category, amount }) => <div key={category.id}><div className="finance-row"><CategoryIcon category={category} /><span>{categoryLabel(category)}</span><strong className="tabular">{money(amount, currency)}</strong></div><Bar value={amount / report.expenses} /></div>)}</div>;
}
function Trends({ data, currency, month }: { data: FinanceSnapshot; currency: string; month: string }) {
  const months = Array.from({ length: 6 }, (_, i) => shiftCalendarMonth(month, i - 5, getCalendar()));
  const rows = months.map((month) => { const range = calendarMonth(month); return { month, ...summary(data, currency, range.start, range.end) }; });
  const max = Math.max(...rows.flatMap((r) => [r.income, r.expenses]), 1);
  return <><div className="finance-legend"><span className="finance-income">● {typeName("income")}</span><span className="finance-expense">● {typeName("expense")}</span><span className="muted">{currency}</span></div><div className="finance-chart" role="img" aria-label={f("Monthly income and expense chart. Exact amounts are listed below.", "نمودار درآمد و هزینه ماهانه. مبالغ دقیق در ادامه آمده‌اند.")}>{rows.map((r) => <div key={r.month} className="finance-chart-col"><div className="finance-chart-bars"><span className="finance-chart-income" style={{ height: `${r.income / max * 100}%` }} /><span className="finance-chart-expense" style={{ height: `${r.expenses / max * 100}%` }} /></div><span>{displayDate(r.month, locale(), { month: "short" })}</span></div>)}</div><details className="finance-chart-data"><summary>{f("View exact monthly figures", "نمایش مبالغ دقیق ماهانه")}</summary><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>{f("Month", "ماه")}</th><th>{typeName("income")}</th><th>{typeName("expense")}</th><th>{f("Net", "خالص")}</th></tr></thead><tbody>{rows.map((r) => <tr key={r.month}><td>{formatMonthYear(r.month)}</td><td>{money(r.income, currency)}</td><td>{money(r.expenses, currency)}</td><td>{money(r.net, currency)}</td></tr>)}</tbody></table></div></details></>;
}
function Transactions({ data, rows, onSelect }: { data: FinanceSnapshot; rows: Transaction[]; onSelect: (t: Transaction) => void }) {
  return <div className="finance-activity">{rows.map((t) => { const category = data.categories.find((c) => c.id === t.categoryId); return <button key={t.id} type="button" className="finance-activity-row" onClick={() => onSelect(t)}><span className={`finance-icon finance-${t.type}`}>{t.type === "income" ? <ArrowDownLeft size={18} /> : t.type === "transfer" ? <ArrowLeftRight size={18} /> : <ArrowUpRight size={18} />}</span><span className="finance-activity-desc"><strong>{t.description}</strong><small>{data.accounts.find((a) => a.id === t.accountId)?.name}{t.destinationId && ` → ${data.accounts.find((a) => a.id === t.destinationId)?.name}`}</small></span><span className="finance-tag finance-activity-category">{category ? categoryLabel(category) : typeName(t.type)}</span><span className="finance-activity-amount"><strong className={`tabular finance-${t.type}`}>{t.type === "income" ? "+" : t.type === "expense" ? "−" : ""}{money(t.amountMinor, t.currency)}</strong></span><time dateTime={t.date}>{formatFullDate(t.date)}</time><ChevronRight size={14} className="faint flip-rtl" /></button>; })}</div>;
}

const advancedSections = ["accounts", "settings", "budgets", "goals", "reports"] as const;

function MonthControl({ day, onChange }: { day: string; onChange: (day: string) => void }) {
  return <div className="finance-month-control">
    <IconButton label={f("Previous month", "ماه قبل")} onClick={() => onChange(shiftCalendarMonth(day, -1, getCalendar()))}><ChevronLeft className="flip-rtl" size={20} /></IconButton>
    <strong><CalendarDays size={19} /> {formatMonthYear(day)}</strong>
    <IconButton label={f("Next month", "ماه بعد")} onClick={() => onChange(shiftCalendarMonth(day, 1, getCalendar()))}><ChevronRight className="flip-rtl" size={20} /></IconButton>
  </div>;
}

function Upcoming({ today, onOpen }: { today: string; onOpen: () => void }) {
  const rules = useRecurring((state) => state.rules);
  const upcoming = rules.filter((rule) => rule.status === "active").map((rule) => ({ rule, date: occurrenceDate(rule, rule.nextIndex) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return <section className="card finance-panel finance-upcoming">
    <div className="finance-panel-head"><h2><CalendarDays size={22} />{f("Coming up", "دریافت‌ها و پرداخت‌های پیش رو")}</h2></div>
    {(["expense", "income"] as const).map((type) => {
      const rows = upcoming.filter(({ rule }) => rule.type === type).slice(0, 3);
      return <div className="finance-upcoming-group" key={type}>
        <h3>{type === "expense" ? f("Upcoming payments", "پرداخت‌های پیش رو") : f("Expected income", "درآمدهای پیش رو")}</h3>
        {rows.length ? rows.map(({ rule, date }) => <button className="finance-upcoming-row" type="button" key={rule.id} onClick={onOpen}>
          <span className={`finance-icon finance-${type}`}>{type === "income" ? <Coins size={18} /> : <ShoppingCart size={18} />}</span>
          <span className="finance-upcoming-text"><strong>{rule.name}</strong><small>{formatFullDate(date)} {date <= today && type === "expense" && <span className="finance-expense">{f("· Due", "· سررسید شده")}</span>}</small></span>
          <span className={`finance-tag finance-${type}`}>{money(rule.amountMinor, rule.currency)}</span>
        </button>) : <p className="muted">{type === "expense" ? f("No payments scheduled.", "پرداختی برنامه‌ریزی نشده است.") : f("No income scheduled.", "دریافتی برنامه‌ریزی نشده است.")}</p>}
      </div>;
    })}
    <Button variant="ghost" onClick={onOpen}>{f("Manage recurring entries", "مدیریت درآمد و هزینه ثابت")}</Button>
  </section>;
}

export function FinanceView() {
  useIranUnit();
  const { data, ready, error, needsSaveRetry, busy } = useFinance();
  const today = useApp((state) => state.clock.today);
  const { section, account: accountFilter } = useFinanceNavigation();
  const [month, setMonth] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>(data.currency);
  const [editing, setEditing] = useState<(EditorRequest & { key: string }) | null>(null);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const open: OpenEditor = (request) => setEditing({ ...request, key: editorKey() });
  const go = financeNavigate;
  const anchor = month ?? today;
  const range = calendarMonth(anchor);
  const report = summary(data, currency, range.start, range.end);
  const balances = balancesByCurrency(data);
  const recent = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const names = sectionNames();
  const activeAccounts = data.accounts.filter((account) => !account.archived);
  const add = (entity: EditorRequest["entity"], label: string) => <Button variant="primary" icon={<Plus size={18} />} onClick={() => open({ entity })}>{label}</Button>;
  const addTransaction = (type: "income" | "expense" | "transfer") => {
    if (!activeAccounts.length) { open({ entity: "account" }); return; }
    const account = activeAccounts.find((entry) => entry.currency === currency) ?? activeAccounts[0];
    open({ entity: "transaction", defaults: { type, accountId: account.id,
      categoryId: data.categories.find((category) => category.type === type && !category.archived)?.id ?? "" } });
  };
  const quickActions = <div className="finance-quick-actions">
    <Button className="finance-add finance-add--primary" icon={<Coins size={23} />} onClick={() => addTransaction("income")}>{f("Add income", "افزودن درآمد")} <Plus size={20} /></Button>
    <Button className="finance-add finance-add--secondary" icon={<Wallet size={23} />} onClick={() => addTransaction("expense")}>{f("Add expense", "افزودن هزینه")} <Plus size={20} /></Button>
  </div>;
  if (!ready) return <div className="page" role="status">{f("Opening Finance…", "در حال باز کردن بخش مالی…")}</div>;
  return <div className="page finance finance-redesign">
    <header className="finance-header">
      <div className="finance-heading">
        <span className="finance-hero-icon">{section === "recurring" ? <CalendarDays size={27} /> : section === "transactions" ? <ArrowLeftRight size={26} /> : <Wallet size={27} />}</span>
        <div><h1 tabIndex={-1} data-page-heading>{section === "overview" ? f("Finance", "مالی") : names[section]}</h1>
          <p>{section === "recurring" ? f("Manage the money you receive or pay regularly.", "درآمدها و هزینه‌هایی را که منظم تکرار می‌شوند مدیریت کنید.")
            : section === "transactions" ? f("See the money you received, spent, or moved.", "پول‌هایی را که دریافت، خرج یا جابه‌جا کرده‌اید ببینید.")
            : section === "overview" ? f("Manage your income and expenses in one place.", "درآمدها و هزینه‌های خود را یک‌جا مدیریت کنید.") : null}</p>
        </div>
      </div>
      <div className="finance-header-actions"><IranUnitSwitch /><Menu label={f("Finance tools", "ابزارهای مالی")}
        trigger={(props) => <Button {...props} icon={<Settings2 size={18} />}>{f("Finance tools", "ابزارهای مالی")}</Button>}
        items={[...advancedSections.map((item) => ({ label: names[item], onSelect: () => go(item) })),
          { label: f("Record a transfer", "ثبت انتقال"), onSelect: () => addTransaction("transfer") }]} /></div>
    </header>
    <FinanceNavigation compact />
    {error && <div role="alert" className="finance-error">{error}{needsSaveRetry && <Button disabled={busy} onClick={() => void retryFinanceStorage().then(processRecurringIncome)}>{f("Retry saving to device", "تلاش دوباره برای ذخیره روی دستگاه")}</Button>}</div>}
    {(section === "overview" || section === "budgets" || section === "reports") && <div className="finance-toolbar">
      {section === "overview" && <div><h2 className="finance-section-title">{names.overview}</h2><p className="muted">{f("Your money for the selected month", "وضعیت مالی شما در ماه انتخاب‌شده")}</p></div>}
      <div className="finance-controls">
        {section !== "reports" && <MonthControl day={anchor} onChange={setMonth} />}
        {section !== "budgets" && <SelectInput aria-label={f("Display currency", "ارز نمایش")} value={currency} onChange={(event) => setCurrency(event.target.value)}>
          {Object.keys(CURRENCIES).map((code) => <option key={code} value={code}>{code === "IRR" ? f("Iranian rial", "ریال ایران") : f("US dollar", "دلار آمریکا")}</option>)}
        </SelectInput>}
      </div>
    </div>}
    {section === "overview" && <>
      <div className="finance-overview-metrics">
        {[
          { label: f("Total balance", "موجودی کل"), value: balances[currency] ?? 0, tone: "balance", Icon: Wallet },
          { label: f("Income this month", "درآمد این ماه"), value: report.income, tone: "income", Icon: ArrowDownLeft },
          { label: f("Expenses this month", "هزینه این ماه"), value: report.expenses, tone: "expense", Icon: ArrowUpRight },
        ].map(({ label, value, tone, Icon }) => <article key={tone} className={`finance-stat finance-stat--${tone}`}><span className="finance-hero-icon"><Icon size={26} /></span><div><span>{label}</span><strong className="tabular">{money(value, currency)}</strong></div></article>)}
      </div>
      <div className="finance-net"><span>{f("Income minus expenses", "درآمد منهای هزینه")}</span><strong className={report.net < 0 ? "finance-expense" : "finance-income"}>{money(report.net, currency)}</strong></div>
      {!activeAccounts.length && <div className="finance-setup"><p>{f("Add an account to start recording income and expenses.", "برای ثبت درآمد و هزینه، ابتدا یک حساب اضافه کنید.")}</p>{add("account", f("Add account", "افزودن حساب"))}</div>}
      {quickActions}
      <div className="finance-overview-bottom">
        <section className="card finance-panel finance-recent"><div className="finance-panel-head"><h2><List size={22} />{f("Recent transactions", "آخرین تراکنش‌ها")}</h2></div>
          {recent.length ? <Transactions data={data} rows={recent} onSelect={setSelected} /> : <p className="finance-quiet-empty">{f("Your recorded income and expenses will appear here.", "درآمدها و هزینه‌های ثبت‌شده اینجا نمایش داده می‌شوند.")}</p>}
          <Button onClick={() => go("transactions")}>{f("View all transactions", "مشاهده همه تراکنش‌ها")}</Button>
        </section>
        <Upcoming today={today} onOpen={() => go("recurring")} />
      </div>
    </>}
    {section === "recurring" && <RecurringView data={data} today={today} onAccounts={() => open({ entity: "account" })} />}
    {section === "transactions" && <>{quickActions}<TransactionList key={accountFilter} data={data} initialAccount={accountFilter} open={open} onSelect={setSelected} /></>}
    {section === "accounts" && <><div className="finance-section-action">{add("account", f("New account", "حساب جدید"))}</div><div className="finance-grid">{data.accounts.map((a) => <Panel key={a.id} title={a.name} action={<IconButton label={f("Edit account", "ویرایش حساب")} onClick={() => open({ entity: "account", row: { ...a } })}><Pencil size={15} /></IconButton>}><div className="finance-row"><span className="chip">{typeName(a.type)}{a.archived ? ` · ${typeName("archived")}` : ""}</span><span className="muted">{a.currency}</span></div><strong className="finance-account-balance tabular">{money(accountBalance(data, a.id), a.currency)}</strong>{a.description && <p className="muted">{a.description}</p>}<p className="finance-note">{f("Opening balance", "مانده اولیه")}: {money(a.openingMinor, a.currency)} · {f("Created", "ایجاد")}: {formatShortDate(a.createdAt.slice(0, 10))}</p><div className="finance-actions"><Button size="sm" onClick={() => { go("transactions", a.id); }}>{f("View history", "سوابق تراکنش")}</Button><Button size="sm" variant="ghost" onClick={() => { const { createdAt: _c, updatedAt: _u, ...value } = a; void saveFinance({ entity: "account", value: { ...value, archived: !a.archived } }).catch(() => undefined); }}>{a.archived ? f("Restore", "بازگردانی") : f("Archive", "بایگانی")}</Button></div></Panel>)}</div>{!data.accounts.length && <NoData title={f("No accounts yet", "هنوز حسابی ندارید")} text={f("Create an account to begin. Accounts are archived instead of deleted, so history stays intact.", "برای شروع حساب بسازید. حساب‌ها بایگانی می‌شوند تا سوابق حفظ شود.")} />}</>}
    {section === "budgets" && <><div className="finance-section-action">{add("budget", f("New budget", "بودجه جدید"))}</div><div className="finance-grid">{data.budgets.map((b) => { const usage = budgetUsage(data, b, range); return <Panel key={b.id} title={data.categories.find((c) => c.id === b.categoryId)?.name ?? ""} action={<IconButton label={f("Edit budget", "ویرایش بودجه")} onClick={() => open({ entity: "budget", row: { ...b } })}><Pencil size={15} /></IconButton>}><div className={`finance-budget-status ${usage.over ? "finance-expense" : ""}`}><strong>{usage.active ? `${pct(usage.percentage)}` : f("Outside selected month", "خارج از ماه انتخابی")}</strong><span>{usage.over ? f("Over budget", "بیش از بودجه") : f("Monthly usage", "مصرف ماهانه")}</span></div><Bar value={usage.percentage / 100} /><dl className="finance-dl"><div><dt>{f("Limit", "سقف")}</dt><dd>{money(b.limitMinor, b.currency)}</dd></div><div><dt>{f("Spent", "خرج‌شده")}</dt><dd>{money(usage.spent, b.currency)}</dd></div><div><dt>{f("Remaining", "باقی‌مانده")}</dt><dd className={usage.over ? "finance-expense" : ""}>{money(usage.remaining, b.currency)}</dd></div></dl><p className="finance-note">{formatFullDate(b.startDate)} → {b.endDate ? formatFullDate(b.endDate) : f("Ongoing", "ادامه‌دار")}</p><RemoveBudget id={b.id} /></Panel>; })}</div>{!data.budgets.length && <NoData title={f("A little structure for your spending", "کمی نظم برای هزینه‌ها")} text={f("Set a monthly category limit. Usage comes from real expenses in the budget currency.", "برای هر دسته سقف ماهانه تعیین کنید. مصرف از هزینه‌های واقعی همان ارز محاسبه می‌شود.")} />}</>}
    {section === "goals" && <Savings data={data} open={open} />}
    {section === "reports" && <Reports data={data} currency={currency} today={today} />}
    {section === "settings" && <FinanceSettings data={data} open={open} />}
    {editing && <FinanceEditor key={editing.key} request={editing} data={data} onClose={() => setEditing(null)} />}
    {selected && <TransactionDetails transaction={data.transactions.find((t) => t.id === selected.id) ?? selected} data={data} open={open} onClose={() => setSelected(null)} />}
    <p className="finance-local-note">{f("Stored locally in your Life OS database. Included in full database backups in Settings. Transfers are excluded from income and expenses.", "در پایگاه داده محلی Life OS ذخیره می‌شود و در پشتیبان کامل تنظیمات قرار می‌گیرد. انتقال‌ها جزو درآمد و هزینه نیستند.")}</p>
  </div>;
}

function TransactionList({ data, initialAccount, open, onSelect }: { data: FinanceSnapshot; initialAccount: string; open: OpenEditor; onSelect: (t: Transaction) => void }) {
  const [search, setSearch] = useState(""), [account, setAccount] = useState(initialAccount), [category, setCategory] = useState(""), [type, setType] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [sort, setSort] = useState("date-desc"), [limit, setLimit] = useState(25);
  const rows = data.transactions.filter((t) => (!search || `${t.description} ${t.notes}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && (!account || t.accountId === account || t.destinationId === account) && (!category || t.categoryId === category) && (!type || t.type === type) && (!from || t.date >= from) && (!to || t.date <= to)).sort((a, b) => sort.startsWith("amount") ? a.currency.localeCompare(b.currency) || (a.amountMinor === b.amountMinor ? 0 : a.amountMinor > b.amountMinor ? 1 : -1) * (sort.endsWith("desc") ? -1 : 1) : (a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)) * (sort.endsWith("desc") ? -1 : 1));
  const filter = (label: string, value: string, set: (v: string) => void, options: { id: string; name: string }[]) => <Field label={label}><SelectInput value={value} onChange={(e) => { set(e.target.value); setLimit(25); }}><option value="">{f("All", "همه")}</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</SelectInput></Field>;
  return <Panel title={f("Transaction ledger", "دفتر تراکنش‌ها")} action={<Button size="sm" icon={<Download size={14} />} onClick={() => download(transactionsCsv(data, rows), "life-os-transactions.csv")}>{f("Export CSV", "خروجی CSV")}</Button>}><div className="finance-filters finance-search-line"><Field label={f("Search", "جست‌وجو")}><div className="finance-search"><Search size={15} /><TextInput value={search} placeholder={f("Description or notes", "شرح یا یادداشت")} onChange={(e) => { setSearch(e.target.value); setLimit(25); }} /></div></Field>{filter(f("Type", "نوع"), type, setType, ["income", "expense", "transfer"].map((id) => ({ id, name: typeName(id) })))}</div><details className="finance-filter-details" open={!!initialAccount || undefined}><summary>{f("More filters", "فیلترهای بیشتر")}</summary><div className="finance-filters">{filter(f("Account", "حساب"), account, setAccount, data.accounts)}{filter(f("Category", "دسته‌بندی"), category, setCategory, data.categories.map((c) => ({ id: c.id, name: categoryLabel(c) })))}<Field label={f("From", "از")}><DateInput value={from || null} onChange={(value) => setFrom(value ?? "")} /></Field><Field label={f("To", "تا")}><DateInput value={to || null} onChange={(value) => setTo(value ?? "")} /></Field><Field label={f("Sort", "مرتب‌سازی")}><SelectInput value={sort} onChange={(e) => setSort(e.target.value)}><option value="date-desc">{f("Newest first", "جدیدترین")}</option><option value="date-asc">{f("Oldest first", "قدیمی‌ترین")}</option><option value="amount-desc">{f("Largest, per currency", "بیشترین مبلغ، به تفکیک ارز")}</option><option value="amount-asc">{f("Smallest, per currency", "کمترین مبلغ، به تفکیک ارز")}</option></SelectInput></Field></div></details>{from && to && from > to && <p className="finance-error" role="alert">{f("Start date must be before the end date.", "تاریخ شروع باید قبل از پایان باشد.")}</p>}<div className="finance-row finance-results"><span className="muted">{num(rows.length)} {f("transactions", "تراکنش")}</span><Button variant="ghost" size="sm" onClick={() => { setSearch(""); setAccount(""); setCategory(""); setType(""); setFrom(""); setTo(""); }}>{f("Clear filters", "پاک کردن فیلترها")}</Button></div>{rows.length ? <><Transactions data={data} rows={rows.slice(0, limit)} onSelect={onSelect} />{limit < rows.length && <Button onClick={() => setLimit((l) => l + 25)}>{f("Show more", "نمایش بیشتر")}</Button>}</> : <NoData title={f("No matching transactions", "تراکنشی پیدا نشد")} text={f("Adjust your filters or record a transaction.", "فیلترها را تغییر دهید یا تراکنشی ثبت کنید.")} action={data.accounts.some((a) => !a.archived) && <Button onClick={() => open({ entity: "transaction" })}>{f("Add transaction", "افزودن تراکنش")}</Button>} />}</Panel>;
}
function TransactionDetails({ transaction: t, data, open, onClose }: { transaction: Transaction; data: FinanceSnapshot; open: OpenEditor; onClose: () => void }) {
  const [deleting, setDeleting] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Dialog open onClose={() => { if (!busy) onClose(); }} title={deleting ? f("Delete this transaction?", "این تراکنش حذف شود؟") : t.description} footer={deleting ? <><Button disabled={busy} onClick={() => setDeleting(false)}>{f("Keep transaction", "نگه داشتن تراکنش")}</Button><Button variant="danger" disabled={busy} onClick={async () => { setBusy(true); try { await saveFinance({ entity: "delete_transaction", id: t.id }); toast(f("Transaction deleted.", "تراکنش حذف شد."), "success"); onClose(); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>{f("Delete transaction", "حذف تراکنش")}</Button></> : <><Button variant="danger-ghost" icon={<Trash2 size={15} />} onClick={() => setDeleting(true)}>{f("Delete", "حذف")}</Button><Button icon={<Pencil size={15} />} onClick={() => { onClose(); open({ entity: "transaction", row: { ...t } }); }}>{f("Edit", "ویرایش")}</Button></>}>
    {error && <p className="finance-error" role="alert">{error}</p>}{deleting ? <p className="muted">{f("This removes the record and reverses its effect on both balances and reports. This cannot be undone.", "رکورد حذف می‌شود و اثر آن از موجودی حساب‌ها و گزارش‌ها برمی‌گردد. این کار قابل بازگشت نیست.")}</p> : <><strong className="finance-account-balance tabular">{money(t.amountMinor, t.currency)}</strong><dl className="finance-dl">{[[f("Type", "نوع"), typeName(t.type)], [f("Date", "تاریخ"), formatShortDate(t.date)], [f("Account", "حساب"), data.accounts.find((a) => a.id === t.accountId)?.name], [f("Destination", "مقصد"), data.accounts.find((a) => a.id === t.destinationId)?.name], [f("Category", "دسته‌بندی"), data.categories.find((c) => c.id === t.categoryId)?.name], [f("Created", "ایجاد"), new Date(t.createdAt).toLocaleString(locale(), { timeZone: APP_TIME_ZONE, calendar: getCalendar(), numberingSystem: "latn" })], [f("Updated", "ویرایش"), new Date(t.updatedAt).toLocaleString(locale(), { timeZone: APP_TIME_ZONE, calendar: getCalendar(), numberingSystem: "latn" })]].filter(([, value]) => value).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{t.notes && <p className="finance-notes">{t.notes}</p>}</>}
  </Dialog>;
}
function RemoveBudget({ id }: { id: string }) {
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false);
  return confirm ? <div className="finance-actions"><span>{f("Remove this budget?", "بودجه حذف شود؟")}</span><Button size="sm" disabled={busy} onClick={() => setConfirm(false)}>{f("Keep", "نگه داشتن")}</Button><Button size="sm" variant="danger" disabled={busy} onClick={async () => { setBusy(true); try { await saveFinance({ entity: "delete_budget", id }); } catch { setConfirm(false); } finally { setBusy(false); } }}>{f("Remove", "حذف")}</Button></div> : <Button size="sm" variant="danger-ghost" onClick={() => setConfirm(true)}>{f("Remove budget", "حذف بودجه")}</Button>;
}
function Savings({ data, open }: { data: FinanceSnapshot; open: OpenEditor }) {
  return <><div className="finance-section-action"><Button variant="primary" icon={<Plus size={16} />} onClick={() => open({ entity: "goal", defaults: { accountId: "" } })}>{f("New savings goal", "هدف پس‌انداز جدید")}</Button></div><p className="finance-note">{f("Allocations are a separate tracking ledger, not additional money. They do not change account balances. A linked account is informational only.", "تخصیص‌ها دفتر پیگیری جداگانه‌اند، پول اضافه نیستند و مانده حساب را تغییر نمی‌دهند. حساب مرتبط فقط برای اطلاع است.")}</p><div className="finance-grid">{data.goals.map((g) => { const p = goalProgress(data, g); const contributions = data.contributions.filter((c) => c.goalId === g.id).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)); return <Panel key={g.id} title={g.name} action={<IconButton label={f("Edit savings goal", "ویرایش هدف پس‌انداز")} onClick={() => open({ entity: "goal", row: { ...g } })}><Pencil size={15} /></IconButton>}><div className="finance-row"><span className="chip">{typeName(g.status)}</span><strong>{pct(p.percentage)}</strong></div><strong className="finance-account-balance tabular">{money(p.saved, g.currency)}</strong><p className="muted">{f("of", "از")} {money(g.targetMinor, g.currency)}</p><Bar value={p.percentage / 100} />{g.description && <p className="muted">{g.description}</p>}<p className="finance-note">{g.targetDate && `${f("Target date", "تاریخ هدف")}: ${formatShortDate(g.targetDate)} · `}{g.accountId && `${f("Linked to", "مرتبط با")}: ${data.accounts.find((a) => a.id === g.accountId)?.name}`}</p>{g.status !== "archived" && <Button size="sm" onClick={() => open({ entity: "contribution", defaults: { goalId: g.id, currency: g.currency } })}>{f("Allocate / withdraw", "تخصیص / برداشت")}</Button>}{contributions.length > 0 && <details className="finance-chart-data"><summary>{f("Allocation history", "سوابق تخصیص")} ({contributions.length})</summary>{contributions.map((c) => <div className="finance-row finance-contribution" key={c.id}><span>{formatShortDate(c.date)}<small className="muted">{c.notes}</small></span><strong>{money(c.amountMinor, g.currency)}</strong>{g.status !== "archived" && <IconButton label={f("Correct allocation", "اصلاح تخصیص")} onClick={() => open({ entity: "contribution", row: { ...c } })}><Pencil size={14} /></IconButton>}</div>)}</details>}</Panel>; })}</div>{!data.goals.length && <NoData title={f("Give your savings a purpose", "برای پس‌اندازتان هدف بگذارید")} text={f("Set a target, then track allocations and withdrawals without double-counting your money.", "هدف تعیین کنید و بدون دوباره‌شماری پول، تخصیص‌ها و برداشت‌ها را پیگیری کنید.")} />}</>;
}
function Reports({ data, currency, today }: { data: FinanceSnapshot; currency: string; today: string }) {
  const current = calendarMonth(today);
  const [start, setStart] = useState(current.start), [end, setEnd] = useState(current.end), [preset, setPreset] = useState("month");
  const valid = !!start && !!end && start <= end;
  if (!valid) return <Panel title={f("Report dates", "تاریخ گزارش")}><ReportDates start={start} end={end} setStart={setStart} setEnd={setEnd} /><p className="finance-error" role="alert">{f("Choose a valid start and end date.", "تاریخ شروع و پایان معتبر انتخاب کنید.")}</p></Panel>;
  const period = summary(data, currency, start, end);
  let previous = previousRange(start, end);
  if (preset === "month" || preset === "last") previous = calendarMonth(shiftDate(start, -1));
  if (preset === "quarter") previous = calendarQuarter(shiftDate(start, -1));
  const before = summary(data, currency, previous.start, previous.end);
  const activeBudgets = data.budgets.filter((b) => b.currency === currency && b.startDate <= end && (!b.endDate || b.endDate >= start));
  const exportReport = () => download(csv([["metric", "amount", "currency", "scale", "start", "end"], ...[["income", period.income], ["expenses", period.expenses], ["net", period.net]].map(([label, value]) => [String(label), decimalMoney(Number(value), currencyScale(currency)), currency, currencyScale(currency), start, end]), ...period.byCategory.map(({ category, amount }) => [`expense: ${category.name}`, decimalMoney(amount, currencyScale(currency)), currency, currencyScale(currency), start, end])]), "life-os-finance-report.csv");
  return <><Panel title={f("Choose a period", "انتخاب بازه")} action={<Button size="sm" icon={<Download size={14} />} onClick={exportReport}>{f("Export report", "خروجی گزارش")}</Button>}><div className="finance-filters"><Field label={f("Period", "بازه")}><SelectInput value={preset} onChange={(e) => { const next = e.target.value; setPreset(next); if (next === "custom") return; if (next === "month") { setStart(current.start); setEnd(current.end); } else if (next === "last") { const range = calendarMonth(shiftDate(current.start, -1)); setStart(range.start); setEnd(range.end); } else { const range = calendarQuarter(today); setStart(range.start); setEnd(range.end); } }}><option value="month">{f("This month", "این ماه")}</option><option value="last">{f("Last month", "ماه قبل")}</option><option value="quarter">{f("This quarter", "این فصل")}</option><option value="custom">{f("Custom range", "بازه دلخواه")}</option></SelectInput></Field><ReportDates start={start} end={end} setStart={(v) => { setPreset("custom"); setStart(v); }} setEnd={(v) => { setPreset("custom"); setEnd(v); }} /></div><p className="finance-note">{f("Compared with", "مقایسه با")}: {formatFullDate(previous.start)} → {formatFullDate(previous.end)} · {currency}. {f("Custom ranges compare with the preceding period of the same length.", "بازه دلخواه با همان تعداد روز پیش از آن مقایسه می‌شود.")}</p></Panel>
    <div className="finance-metrics finance-metrics--three">{[[f("Income", "درآمد"), period.income, before.income], [f("Expenses", "هزینه"), period.expenses, before.expenses], [f("Net cash flow", "جریان نقدی خالص"), period.net, before.net]].map(([label, value, old]) => <Metric key={String(label)} label={String(label)} value={money(Number(value), currency)} hint={`${f("Change", "تغییر")}: ${money(BigInt(value) - BigInt(old), currency)}`} />)}</div>
    <div className="finance-grid"><Panel title={f("Expense categories", "دسته‌بندی هزینه‌ها")}><Breakdown data={data} currency={currency} start={start} end={end} /></Panel><Panel title={f("Monthly trend ending in selected period", "روند ماهانه تا پایان بازه انتخابی")}><Trends data={data} currency={currency} month={end} /></Panel></div>
    <div className="finance-grid"><Panel title={f("Current account balances", "موجودی فعلی حساب‌ها")}>{data.accounts.filter((a) => a.currency === currency).map((a) => <div className="finance-row finance-report-row" key={a.id}><span>{a.name}{a.archived ? ` · ${typeName("archived")}` : ""}</span><strong>{money(accountBalance(data, a.id), currency)}</strong></div>)}<p className="finance-note">{f("Current balances include all recorded transactions, independent of the selected report dates.", "موجودی فعلی شامل همه تراکنش‌های ثبت‌شده است و به بازه گزارش وابسته نیست.")}</p></Panel><Panel title={f("Savings progress now", "پیشرفت فعلی پس‌انداز")}>{data.goals.filter((g) => g.currency === currency && g.status !== "archived").map((g) => <div key={g.id} className="finance-budget-mini"><div className="finance-row"><span>{g.name}</span><strong>{money(goalProgress(data, g).saved, currency)} / {money(g.targetMinor, currency)}</strong></div><Bar value={goalProgress(data, g).percentage / 100} /></div>)}<p className="finance-note">{f("Goal allocations are not included in income, expenses, or net cash flow.", "تخصیص هدف‌ها در درآمد، هزینه و جریان نقدی خالص محاسبه نمی‌شود.")}</p></Panel></div>
    <Panel title={f("Budget performance by month in this range", "عملکرد ماهانه بودجه در این بازه")}>{activeBudgets.length ? <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>{f("Category", "دسته")}</th><th>{f("Month", "ماه")}</th><th>{f("Limit", "سقف")}</th><th>{f("Spent", "خرج‌شده")}</th><th>{f("Remaining", "باقی‌مانده")}</th></tr></thead><tbody>{(() => { const months: string[] = []; let cursor = calendarMonth(start).start; while (cursor <= end && months.length < 120) { months.push(cursor); cursor = shiftDate(calendarMonth(cursor).end, 1); } return months.flatMap((m) => activeBudgets.map((b) => ({ b, m, u: budgetUsage(data, b, calendarMonth(m)) })).filter(({ u }) => u.active).map(({ b, m, u }) => <tr key={`${b.id}-${m}`}><td>{data.categories.find((c) => c.id === b.categoryId)?.name}</td><td>{formatMonthYear(m)}</td><td>{money(b.limitMinor, currency)}</td><td>{money(u.spent, currency)}</td><td className={u.over ? "finance-expense" : ""}>{money(u.remaining, currency)}</td></tr>)); })()}</tbody></table></div> : <p className="muted">{f("No budgets in this period.", "در این بازه بودجه‌ای وجود ندارد.")}</p>}<p className="finance-note">{f("Budget figures cover complete active calendar months, including days outside a partial report range. Up to 120 months are displayed.", "ارقام بودجه کل ماه فعال را پوشش می‌دهند، شامل روزهای خارج از بازه ناقص گزارش. حداکثر ۱۲۰ ماه نمایش داده می‌شود.")}</p></Panel>
  </>;
}
function ReportDates({ start, end, setStart, setEnd }: { start: string; end: string; setStart: (s: string) => void; setEnd: (s: string) => void }) { return <><Field label={f("From", "از")}><DateInput value={start || null} onChange={(value) => setStart(value ?? "")} /></Field><Field label={f("To", "تا")}><DateInput value={end || null} onChange={(value) => setEnd(value ?? "")} /></Field></>; }
function FinanceSettings({ data, open }: { data: FinanceSnapshot; open: OpenEditor }) {
  return <Panel title={f("Income & expense categories", "دسته‌بندی درآمد و هزینه")} action={<Button size="sm" icon={<Plus size={14} />} onClick={() => open({ entity: "category" })}>{f("New category", "دسته‌بندی جدید")}</Button>}><div className="finance-categories">{data.categories.map((c) => <div className="finance-category-row" key={c.id}><CategoryIcon category={c} /><span><strong>{categoryLabel(c)}</strong><small>{typeName(c.type)}{c.archived ? ` · ${typeName("archived")}` : ""}</small></span><IconButton label={f("Edit category", "ویرایش دسته‌بندی")} onClick={() => open({ entity: "category", row: { ...c } })}><Pencil size={14} /></IconButton><Button variant="ghost" size="sm" onClick={() => { const { createdAt: _created, updatedAt: _updated, ...value } = c; void saveFinance({ entity: "category", value: { ...value, archived: !c.archived } }).catch(() => undefined); }}>{c.archived ? f("Restore", "بازگردانی") : f("Archive", "بایگانی")}</Button></div>)}</div></Panel>;
}
