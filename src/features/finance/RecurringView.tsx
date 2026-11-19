import { CalendarDays, Check, Coins, Ellipsis, History, Pause, Pencil, Play, Plus, ShoppingCart, Archive } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { getCalendar } from "../../domain/calendar";
import { currencyScale, formatMoneyInput, formatMoney, parseMoneyInput } from "../../domain/finance/money";
import { frequencies, occurrenceDate, recurringCalendar, scheduleUsesCalendar, type Frequency, type RecurringOccurrence, type RecurringRule } from "../../domain/finance/recurring";
import type { FinanceSnapshot } from "../../domain/finance/types";
import { getLang, num } from "../../domain/locale";
import { formatFullDate } from "../../domain/time";
import { changeRecurring, processRecurringIncome, recurringRepository, useRecurring } from "../../state/finance";
import { toast } from "../../state/store";
import { DateInput, SelectInput, TextArea, TextInput } from "../../ui/fields";
import { Button, Confirm, Dialog, Field, IconButton, Menu } from "../../ui/primitives";
import { categoryLabel, f } from "./copy";
import { IranUnitSwitch, useIranUnit } from "./IranUnitSwitch";

export const financeLocale = () => getLang() === "fa" ? "fa-IR" : "en-US";
export const financeAmount = (minor: number | bigint, currency: string) => formatMoney(minor, currency, financeLocale(), useIranUnit.getState().unit);
const fixed = (type: "income" | "expense") => type === "income" ? f("Recurring income", "درآمد ثابت") : f("Recurring expenses", "هزینه‌های ثابت");
const labels = () => ({ daily: f("Every day", "هر روز"), weekly: f("Every week", "هر هفته"), monthly: f("Every month", "هر ماه"), yearly: f("Every year", "هر سال") });
const intervalLabel = (rule: Pick<RecurringRule, "frequency" | "interval">) => rule.interval === 1 ? labels()[rule.frequency]
  : f(`Every ${rule.interval} ${{ daily: "days", weekly: "weeks", monthly: "months", yearly: "years" }[rule.frequency]}`, `هر ${num(rule.interval)} ${{ daily: "روز", weekly: "هفته", monthly: "ماه", yearly: "سال" }[rule.frequency]}`);

export function RecurringView({ data, today, onAccounts }: { data: FinanceSnapshot; today: string; onAccounts: () => void }) {
  const { rules, errors, processing } = useRecurring();
  const [editor, setEditor] = useState<{ type: "income" | "expense"; rule?: RecurringRule }>();
  const [payment, setPayment] = useState<RecurringRule>();
  const [history, setHistory] = useState<RecurringRule>();
  const [archive, setArchive] = useState<RecurringRule>();
  const [showArchived, setShowArchived] = useState(false);

  const setStatus = async (rule: RecurringRule, status: RecurringRule["status"]) => {
    try {
      await changeRecurring((repository) => repository.setStatus(rule.id, status));
      toast(f("Schedule updated.", "برنامه به‌روز شد."), "success");
      if (status === "active") void processRecurringIncome();
    } catch (error) { toast(String(error), "error"); }
  };

  return <div className="recurring-view">
    {(["income", "expense"] as const).map((type) => {
      const income = type === "income";
      const Icon = income ? Coins : ShoppingCart;
      const list = rules.filter((rule) => rule.type === type && (showArchived || rule.status !== "archived"));
      return <section key={type} className={`card recurring-panel recurring-panel--${type}`}>
        <div className="recurring-panel-head">
          <span className="finance-hero-icon"><Icon size={26} /></span>
          <div><h3>{fixed(type)}</h3><p>{income ? f("Income posts on its scheduled date or the next time you open Life OS.", "درآمد در تاریخ مقرر یا با باز کردن دوباره Life OS ثبت می‌شود.") : f("Expenses change your balance after you mark them as paid.", "هزینه پس از تأیید پرداخت از موجودی کم می‌شود.")}</p></div>
          <Button className={`finance-add finance-add--${type}`} icon={<Plus size={19} />} onClick={() => setEditor({ type })}>
            {income ? f("Add recurring income", "افزودن درآمد ثابت") : f("Add recurring expense", "افزودن هزینه ثابت")}
          </Button>
        </div>
        {list.length ? <div className="recurring-table-wrap"><table className="recurring-table">
          <thead><tr>{[f("Name", "نام"), f("Amount", "مبلغ"), f("Repeat", "تکرار"), f("Next date", "تاریخ بعدی"), f("Account", "حساب"), f("Status", "وضعیت"), f("Actions", "عملیات")].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{list.map((rule) => {
            const next = occurrenceDate(rule, rule.nextIndex);
            const due = rule.status === "active" && next <= today;
            const issue = errors[rule.id];
            const status = rule.status === "archived" ? f("Archived", "بایگانی‌شده") : rule.status === "paused" ? f("Paused", "متوقف")
              : issue ? f("Needs attention", "نیاز به بررسی") : due ? f("Due", "سررسید شده") : f("Active", "فعال");
            return <tr key={rule.id}>
              <th scope="row"><span className="recurring-name"><Icon size={20} /> <span>{rule.name}</span></span>{issue && <span className="recurring-issue">{f("Review the account, category, or amount, then retry.", "حساب، دسته‌بندی یا مبلغ را بررسی و دوباره تلاش کنید.")}</span>}</th>
              <td data-label={f("Amount", "مبلغ")} className={`tabular finance-${type}`}>{financeAmount(rule.amountMinor, rule.currency)}</td>
              <td data-label={f("Repeat", "تکرار")}><span className="finance-tag"><CalendarDays size={15} /> {intervalLabel(rule)}</span></td>
              <td data-label={f("Next date", "تاریخ بعدی")} className="tabular">{rule.status === "archived" ? "—" : formatFullDate(next)}</td>
              <td data-label={f("Account", "حساب")}>{data.accounts.find((a) => a.id === rule.accountId)?.name ?? f("At payment", "هنگام پرداخت")}</td>
              <td data-label={f("Status", "وضعیت")}><span className={`finance-tag ${due || issue ? "is-due" : rule.status === "active" ? "is-active" : ""}`}>{status}</span>
                {rule.lastPosted && <small className="recurring-last-posted">{f("Last recorded", "آخرین ثبت")} {formatFullDate(rule.lastPosted)}</small>}
              </td>
              <td className="recurring-action-cell"><div className="recurring-actions">
                {!income && rule.status === "active" && <Button size="sm" icon={<Check size={16} />} onClick={() => setPayment(rule)}>{f("Mark paid", "ثبت پرداخت")}</Button>}
                <Menu label={rule.name} trigger={(props) => <IconButton {...props} label={`${f("Actions", "عملیات")} · ${rule.name}`}><Ellipsis size={21} /></IconButton>} items={[
                  { label: f("Payment history", "سابقه پرداخت"), icon: <History size={17} />, onSelect: () => setHistory(rule) },
                  ...(rule.status === "archived" ? [] : [
                    { label: f("Edit", "ویرایش"), icon: <Pencil size={17} />, onSelect: () => setEditor({ type, rule }) },
                    { label: rule.status === "active" ? f("Pause", "توقف موقت") : f("Resume", "ادامه"), icon: rule.status === "active" ? <Pause size={17} /> : <Play size={17} />, onSelect: () => void setStatus(rule, rule.status === "active" ? "paused" : "active") },
                    { label: f("Archive", "بایگانی"), icon: <Archive size={17} />, onSelect: () => setArchive(rule) },
                  ]),
                ]} />
              </div></td>
            </tr>;
          })}</tbody>
        </table></div> : <p className="finance-quiet-empty">{income ? f("No recurring income yet. Add a regular payment, such as your salary.", "هنوز درآمد ثابتی ندارید. برای نمونه، حقوق ماهانه را اضافه کنید.") : f("No recurring expenses yet. Add a bill or regular payment.", "هنوز هزینه ثابتی ندارید. قبض یا پرداخت همیشگی خود را اضافه کنید.")}</p>}
      </section>;
    })}
    <div className="finance-row">
      {rules.some((rule) => rule.status === "archived") && <Button variant="ghost" onClick={() => setShowArchived(!showArchived)}>{showArchived ? f("Hide archived", "پنهان کردن بایگانی") : f("Show archived", "نمایش بایگانی")}</Button>}
      {Object.keys(errors).length > 0 && <Button disabled={processing} onClick={() => void processRecurringIncome()}>{f("Retry income posting", "تلاش دوباره برای ثبت درآمد")}</Button>}
    </div>
    {processing && <p className="muted" role="status">{f("Checking scheduled income…", "در حال بررسی درآمدهای ثابت…")}</p>}
    {editor && <RecurringEditor {...editor} data={data} today={today} onClose={() => setEditor(undefined)} onAccounts={() => { setEditor(undefined); onAccounts(); }} />}
    {payment && <PaymentDialog rule={payment} today={today} data={data} onClose={() => setPayment(undefined)} onAccounts={() => { setPayment(undefined); onAccounts(); }} />}
    {history && <HistoryDialog rule={history} onClose={() => setHistory(undefined)} />}
    {archive && <Confirm open title={f("Archive this schedule?", "این برنامه بایگانی شود؟")} message={f("Future occurrences stop. The payment history is kept.", "تکرارهای بعدی متوقف می‌شوند و سابقه پرداخت باقی می‌ماند.")}
      confirmLabel={f("Archive", "بایگانی")} onClose={() => setArchive(undefined)} onConfirm={() => void setStatus(archive, "archived")} />}
  </div>;
}

function RecurringEditor({ type, rule, data, today, onClose, onAccounts }: { type: "income" | "expense"; rule?: RecurringRule; data: FinanceSnapshot; today: string; onClose: () => void; onAccounts: () => void }) {
  const id = useId();
  const unit = useIranUnit((s) => s.unit);
  const activeAccounts = data.accounts.filter((account) => !account.archived);
  const preferred = activeAccounts.find((account) => account.currency === "IRR");
  const [accountId, setAccount] = useState(rule?.accountId ?? (type === "income" ? (preferred ?? activeAccounts[0])?.id ?? "" : ""));
  const account = activeAccounts.find((candidate) => candidate.id === accountId);
  const [chosenCurrency, setCurrency] = useState(rule?.currency ?? "IRR");
  const currency = account?.currency ?? chosenCurrency;
  const scale = currency === "IRR" && unit === "toman" ? 1 : currencyScale(currency);
  const [name, setName] = useState(rule?.name ?? "");
  const [amount, setAmount] = useState(rule ? formatMoneyInput(rule.amountMinor, scale, true) : "");
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? "monthly");
  const [interval, setInterval] = useState(rule?.interval ?? 1);
  const [date, setDate] = useState(rule?.startDate ?? today);
  const [category, setCategory] = useState(rule?.categoryId ?? "");
  const [notes, setNotes] = useState(rule?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const income = type === "income";
  const Icon = income ? Coins : ShoppingCart;
  const calendar = recurringCalendar(rule, getCalendar());
  const title = rule ? (income ? f("Edit recurring income", "ویرایش درآمد ثابت") : f("Edit recurring expense", "ویرایش هزینه ثابت"))
    : (income ? f("Add recurring income", "افزودن درآمد ثابت") : f("Add recurring expense", "افزودن هزینه ثابت"));

  const save = async () => {
    setBusy(true); setError("");
    try {
      await changeRecurring((repository) => repository.save({ type, name, amountMinor: parseMoneyInput(amount, currency, scale), currency,
        frequency, interval, startDate: date, calendar, accountId: accountId || null, categoryId: category || null, notes }, rule?.id));
      toast(f("Schedule saved.", "برنامه ذخیره شد."), "success");
      onClose();
      if (income) void processRecurringIncome();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  return <Dialog open wide title={<span className={`recurring-dialog-title finance-${type}`}><Icon size={27} /> {title}</span>} onClose={() => { if (!busy) onClose(); }} footer={<>
    <Button onClick={onClose} disabled={busy}>{f("Cancel", "انصراف")}</Button>
    <Button className={`finance-add finance-add--${type}`} form={id} type="submit" disabled={busy || (income && !account)} icon={<Check size={19} />}>{f("Save schedule", "ثبت برنامه")}</Button>
  </>}>
    <form id={id} className={`finance-form recurring-form recurring-form--${type}`} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {error && <p className="finance-error" role="alert">{error}</p>}
      <Field label={income ? f("Income name", "نام درآمد") : f("Expense name", "نام هزینه")}><TextInput value={name} required maxLength={160} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label={f("Amount", "مبلغ")}>
        <div className="recurring-amount-field"><TextInput value={amount} required inputMode="decimal" onChange={(event) => setAmount(num(event.target.value))}
          onBlur={() => {
            try { setAmount(formatMoneyInput(parseMoneyInput(amount, currency, scale), scale, currency === "IRR")); }
            catch { /* Leave invalid text in place for correction. */ }
          }} />
          {currency === "IRR" ? <IranUnitSwitch beforeChange={(next) => {
            if (amount) {
              const exact = parseMoneyInput(amount, currency, scale);
              setAmount(formatMoneyInput(exact, next === "toman" ? 1 : 0, true));
            }
          }} /> : <span>USD</span>}
        </div>
      </Field>
      {!account && !income && <Field label={f("Currency", "ارز")}><SelectInput value={chosenCurrency} onChange={(event) => { setCurrency(event.target.value as "IRR" | "USD"); setAmount(""); }}><option value="IRR">{f("Iranian rial", "ریال ایران")}</option><option value="USD">{f("US dollar", "دلار آمریکا")}</option></SelectInput></Field>}
      <fieldset className="recurring-frequency"><legend>{f("Repeat", "نحوه تکرار")}</legend><div>
        {frequencies.map((choice) => <label key={choice}><input type="radio" name={`${id}-frequency`} checked={frequency === choice} onChange={() => { setFrequency(choice); setInterval(1); }} /><CalendarDays size={23} /><span>{labels()[choice]}</span></label>)}
      </div></fieldset>
      <Field label={income ? f("First payment date", "اولین تاریخ دریافت") : f("First due date", "اولین تاریخ سررسید")}><DateInput required value={date} onChange={(value) => value && setDate(value)} /></Field>
      <Field label={income ? f("Destination account", "حساب مقصد") : f("Pay from (optional)", "حساب پرداخت (اختیاری)")}>
        <SelectInput value={accountId} required={income} onChange={(event) => {
          const next = event.target.value;
          const nextCurrency = activeAccounts.find((candidate) => candidate.id === next)?.currency ?? chosenCurrency;
          if (currency !== nextCurrency) setAmount("");
          setAccount(next);
        }}><option value="">{income ? f("Choose an account", "انتخاب حساب") : f("Choose when paying", "انتخاب هنگام پرداخت")}</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</SelectInput>
      </Field>
      {!activeAccounts.length && income && <Button onClick={onAccounts}>{f("Add an account first", "ابتدا یک حساب اضافه کنید")}</Button>}
      <details className="recurring-optional"><summary>{f("More options", "گزینه‌های بیشتر")}</summary>
        <Field label={f("Repeat every", "فاصله تکرار")}><SelectInput value={interval} onChange={(event) => setInterval(Number(event.target.value))}>{Array.from({ length: 24 }, (_, index) => <option key={index} value={index + 1}>{intervalLabel({ frequency, interval: index + 1 } )}</option>)}</SelectInput></Field>
        <Field label={f("Category (optional)", "دسته‌بندی (اختیاری)")}><SelectInput value={category} onChange={(event) => setCategory(event.target.value)}><option value="">{f("Other", "سایر")}</option>{data.categories.filter((c) => c.type === type && !c.archived).map((c) => <option key={c.id} value={c.id}>{categoryLabel(c)}</option>)}</SelectInput></Field>
        <Field label={f("Notes (optional)", "توضیحات (اختیاری)")}><TextArea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} /></Field>
      </details>
      {scheduleUsesCalendar(frequency) && <p className="muted">{calendar === "persian" ? f("This schedule follows Persian months.", "این برنامه بر اساس ماه‌های شمسی تکرار می‌شود.") : f("This schedule follows Gregorian months.", "این برنامه بر اساس ماه‌های میلادی تکرار می‌شود.")}</p>}
      {income && !rule && date <= today && <p className="muted">{f("Saving will record any income due from this date onward.", "با ذخیره، درآمدهای سررسیدشده از این تاریخ ثبت می‌شوند.")}</p>}
    </form>
  </Dialog>;
}

function PaymentDialog({ rule, today, data, onClose, onAccounts }: { rule: RecurringRule; today: string; data: FinanceSnapshot; onClose: () => void; onAccounts: () => void }) {
  const accounts = data.accounts.filter((account) => !account.archived && account.currency === rule.currency);
  const [account, setAccount] = useState(accounts.find((account) => account.id === rule.accountId)?.id ?? accounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const due = occurrenceDate(rule, rule.nextIndex);
  return <Dialog open onClose={() => { if (!busy) onClose(); }} title={f("Record payment", "ثبت پرداخت")} footer={<>
    <Button disabled={busy} onClick={onClose}>{f("Cancel", "انصراف")}</Button>
    <Button variant="primary" disabled={busy || !account} onClick={async () => {
      setBusy(true);
      try {
        await changeRecurring((repository) => repository.pay(rule.id, due, rule.revision, account, date, today));
        toast(f("Payment recorded.", "پرداخت ثبت شد."), "success"); onClose();
      } catch (error) { setError(String(error)); }
      finally { setBusy(false); }
    }}>{f("Confirm payment", "تأیید پرداخت")}</Button>
  </>}><div className="finance-form">
    <strong>{rule.name} · {financeAmount(rule.amountMinor, rule.currency)}</strong>
    <p className="muted">{f("Scheduled for", "سررسید")} {formatFullDate(due)}</p>
    {error && <p className="finance-error" role="alert">{error}</p>}
    {accounts.length ? <Field label={f("Paid from", "پرداخت از حساب")}><SelectInput value={account} onChange={(event) => setAccount(event.target.value)}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</SelectInput></Field>
      : <Button onClick={onAccounts}>{f("Add a matching account", "افزودن حساب با ارز یکسان")}</Button>}
    <Field label={f("Payment date", "تاریخ پرداخت")}><DateInput required value={date} onChange={(value) => value && setDate(value)} /></Field>
  </div></Dialog>;
}

function HistoryDialog({ rule, onClose }: { rule: RecurringRule; onClose: () => void }) {
  const [history, setHistory] = useState<RecurringOccurrence[]>();
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(25);
  useEffect(() => { void recurringRepository().history(rule.id).then(setHistory).catch((error) => setError(String(error))); }, [rule.id]);
  return <Dialog open wide title={`${f("Payment history", "سابقه پرداخت")} · ${rule.name}`} onClose={onClose}>
    {error ? <p role="alert" className="finance-error">{error}</p> : !history ? <p role="status">{f("Loading…", "در حال بارگذاری…")}</p> : !history.length ? <p>{f("Nothing has been recorded yet.", "هنوز تراکنشی ثبت نشده است.")}</p>
      : <><ul className="recurring-history">{history.slice(0, limit).map((item) => <li key={item.dueDate}><span>{formatFullDate(item.dueDate)}</span><strong>{financeAmount(item.amountMinor, item.currency)}</strong>
        <span>{!item.transactionId ? f("Transaction removed", "تراکنش حذف شده") : formatFullDate(item.ledgerDate)}</span></li>)}</ul>
        {limit < history.length && <Button onClick={() => setLimit(limit + 25)}>{f("Show more", "نمایش بیشتر")}</Button>}</>}
  </Dialog>;
}
