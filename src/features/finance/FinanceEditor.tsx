import { calendarMonth } from "../../domain/calendar";
import { useState } from "react";
import { currencyScale, CURRENCIES, formatMoneyInput, parseMoneyInput } from "../../domain/finance/money";
import { type FinanceCommand, type FinanceSnapshot } from "../../domain/finance/types";
import { num } from "../../domain/locale";
import { newId } from "../../persistence/repository";
import { DurableSaveError } from "../../persistence/driver";
import { saveFinance } from "../../state/finance";
import { toast, useApp } from "../../state/store";
import { DateInput, SelectInput, TextArea, TextInput } from "../../ui/fields";
import { Button, Dialog, Field } from "../../ui/primitives";
import { IranUnitSwitch, useIranUnit } from "./IranUnitSwitch";
import { categoryLabel, f, typeName } from "./copy";

export type EditorEntity = "account" | "transaction" | "category" | "budget" | "goal" | "contribution";
export interface EditorRequest { entity: EditorEntity; row?: Record<string, unknown>; defaults?: Record<string, string> }
const names = () => ({ account: f("Account", "حساب"), transaction: f("Transaction", "تراکنش"), category: f("Category", "دسته‌بندی"), budget: f("Monthly budget", "بودجه ماهانه"), goal: f("Savings goal", "هدف پس‌انداز"), contribution: f("Savings allocation", "تخصیص پس‌انداز") });
const valueOf = (row: Record<string, unknown>, key: string) => String(row[key] ?? "");
export function FinanceEditor({ request, data, onClose }: { request: EditorRequest; data: FinanceSnapshot; onClose: () => void }) {
  const { unit } = useIranUnit();
  const today = useApp((s) => s.clock.today);
  const { entity, row } = request;
  const [values, setValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = { name: "", description: "", notes: "", amount: "", opening: "0", target: "", limit: "", date: today, startDate: calendarMonth(today).start, endDate: "", targetDate: "", type: entity === "account" ? "bank" : "expense", accountId: data.accounts.find((a) => !a.archived)?.id ?? "", destinationId: "", categoryId: data.categories.find((c) => c.type === "expense" && !c.archived)?.id ?? "", goalId: data.goals.find((g) => g.status === "active")?.id ?? "", status: "active", icon: "wallet", color: "#a78bfa", archived: "false", ...request.defaults, currency: "IRR" };
    if (row) {
      for (const key of Object.keys(row)) defaults[key] = valueOf(row, key);
      for (const [field, key] of [["amount", "amountMinor"], ["opening", "openingMinor"], ["target", "targetMinor"], ["limit", "limitMinor"]]) if (row[key] != null) defaults[field] = formatMoneyInput(Number(row[key]), (String(row.currency ?? data.goals.find((g) => g.id === row.goalId)?.currency) === "IRR" && unit === "toman" ? 1 : Number(row.scale ?? data.goals.find((g) => g.id === row.goalId)?.scale ?? 0)));
    }
    if (entity === "transaction") defaults.currency = data.accounts.find((a) => a.id === defaults.accountId)?.currency ?? data.currency;
    if (entity === "goal" && !row) defaults.accountId = request.defaults?.accountId ?? "";
    return defaults;
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string) => setValues((s) => ({ ...s, [key]: value }));
  const currency = entity === "transaction" ? data.accounts.find((a) => a.id === values.accountId)?.currency ?? values.currency : entity === "contribution" ? data.goals.find((g) => g.id === values.goalId)?.currency ?? values.currency : values.currency;
  const entryScale = currency === "IRR" && unit === "toman" ? 1 : currencyScale(currency);
  const formatAmount = (key: string) => {
    try { set(key, formatMoneyInput(parseMoneyInput(values[key], currency, entryScale), entryScale, currency === "IRR")); }
    catch { /* Keep an incomplete input visible for correction. */ }
  };
  const input = (key: string, label: string, options: { money?: boolean; date?: boolean; optional?: boolean; disabled?: boolean } = {}) => <Field key={key} label={label} hint={options.money ? `${currency === "IRR" ? (unit === "toman" ? f("Tomans", "تومان") : f("Rials", "ریال")) : currency} · ${currency === "IRR" && unit === "toman" ? 1 : currencyScale(currency)} ${f("decimal places; exact, without rounding", "رقم اعشار؛ دقیق و بدون گرد کردن")}` : undefined}>{options.date ? <DateInput value={values[key] || null} required={!options.optional} onChange={(value) => set(key, value ?? "")} /> : <TextInput value={values[key]} onChange={(e) => set(key, options.money ? num(e.target.value) : e.target.value)} inputMode={options.money ? "decimal" : undefined} onBlur={options.money ? () => formatAmount(key) : undefined} required={!options.optional} disabled={options.disabled} maxLength={2000} />}</Field>;
  const select = (key: string, label: string, options: { value: string; label: string }[], optional = false) => <Field key={key} label={label}><SelectInput value={values[key]} required={!optional} onChange={(e) => set(key, e.target.value)}>{optional && <option value="">{f("None", "هیچ‌کدام")}</option>}{!optional && <option value="" disabled>{f("Choose…", "انتخاب…")}</option>}{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</SelectInput></Field>;
  const currencies = Object.keys(CURRENCIES).map((value) => ({ value, label: value }));
  const accounts = data.accounts.filter((a) => !a.archived || a.id === values.accountId || a.id === values.destinationId).map((a) => ({ value: a.id, label: `${a.name} · ${a.currency}${a.archived ? ` · ${typeName("archived")}` : ""}` }));
  const amount = (key: string) => parseMoneyInput(values[key], currency, entryScale);
  const submit = async () => {
    setError(null); setBusy(true);
    try {
      const id = row ? String(row.id) : null, scale = currencyScale(currency), money = { currency: currency as FinanceSnapshot["currency"], scale };
      let command: FinanceCommand;
      switch (entity) {
        case "account": command = { entity, value: { id, name: values.name, type: values.type as "bank", ...money, openingMinor: amount("opening"), description: values.description, archived: values.archived === "true" } }; break;
        case "category": command = { entity, value: { id, name: values.name, type: values.type as "expense", icon: values.icon, color: values.color || null, archived: values.archived === "true" } }; break;
        case "transaction": command = { entity, value: { id, type: values.type as "expense", ...money, amountMinor: amount("amount"), description: values.description, notes: values.notes, accountId: values.accountId, destinationId: values.type === "transfer" ? values.destinationId || null : null, categoryId: values.type === "transfer" ? null : values.categoryId || null, date: values.date } }; break;
        case "budget": command = { entity, value: { id, categoryId: values.categoryId, ...money, limitMinor: amount("limit"), period: "monthly", startDate: values.startDate, endDate: values.endDate || null } }; break;
        case "goal": command = { entity, value: { id, name: values.name, ...money, targetMinor: amount("target"), targetDate: values.targetDate || null, description: values.description, status: values.status as "active", accountId: values.accountId || null } }; break;
        case "contribution": command = { entity, value: { id, goalId: values.goalId, amountMinor: amount("amount"), date: values.date, notes: values.notes } }; break;
      }
      await saveFinance(command);
      toast(f("Finance changes saved.", "تغییرات مالی ذخیره شد."), "success"); onClose();
    } catch (e) {
      if (e instanceof DurableSaveError) { toast(e.message, "error"); onClose(); }
      else setError(e instanceof Error ? e.message : String(e));
    }
    finally { setBusy(false); }
  };
  const locked = entity === "account" && !!row && (data.transactions.some((t) => t.accountId === row.id || t.destinationId === row.id) || data.goals.some((g) => g.accountId === row.id));
  return <Dialog open onClose={() => { if (!busy) onClose(); }} title={`${row ? f("Edit", "ویرایش") : f("Add", "افزودن")} ${entity === "transaction" ? typeName(values.type) : names()[entity]}`} footer={<><Button disabled={busy} variant="ghost" onClick={onClose}>{f("Cancel", "انصراف")}</Button><Button type="submit" form="finance-editor" variant="primary" disabled={busy}>{busy ? f("Saving…", "در حال ذخیره…") : f("Save", "ذخیره")}</Button></>}>
    <form id="finance-editor" className="finance-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <IranUnitSwitch beforeChange={(next) => { if (currency !== "IRR") return; const converted = { ...values }; for (const key of ["amount", "opening", "target", "limit"]) if (values[key]) converted[key] = formatMoneyInput(parseMoneyInput(values[key], "IRR", unit === "toman" ? 1 : 0), next === "toman" ? 1 : 0); setValues(converted); }} />
      {error && <p className="finance-error" role="alert">{error}</p>}
      {(entity === "account" || entity === "goal" || entity === "category") && input("name", f("Name", "نام"))}
      {(entity === "transaction" || entity === "account" || entity === "category") && <Field label={f("Type", "نوع")}><SelectInput value={values.type} onChange={(e) => { const type = e.target.value; setValues((s) => ({ ...s, type, categoryId: data.categories.find((c) => c.type === type && !c.archived)?.id ?? "" })); }}>{(entity === "account" ? ["cash", "bank", "savings", "wallet", "other"] : entity === "category" ? ["income", "expense"] : ["expense", "income", "transfer"]).map((type) => <option key={type} value={type}>{typeName(type)}</option>)}</SelectInput></Field>}
      {(entity === "account" || entity === "budget" || entity === "goal") && (locked ? <p className="muted">{currency} · {f("Opening balance and currency are locked by account history.", "مانده اولیه و ارز به‌دلیل سوابق حساب قفل هستند.")}</p> : select("currency", f("Currency", "ارز"), currencies))}
      {entity === "transaction" && <>{select("accountId", f("Account", "حساب"), accounts)}{values.type === "transfer" ? select("destinationId", f("Destination account", "حساب مقصد"), accounts.filter((a) => a.value !== values.accountId && data.accounts.find((x) => x.id === a.value)?.currency === currency)) : select("categoryId", f("Category", "دسته‌بندی"), data.categories.filter((c) => c.type === values.type && (!c.archived || c.id === row?.categoryId)).map((c) => ({ value: c.id, label: categoryLabel(c) })))}{input("amount", f("Amount", "مبلغ"), { money: true })}{input("description", f("Description", "شرح"))}{input("date", f("Date", "تاریخ"), { date: true })}</>}
      {entity === "account" && <>{input("opening", f("Opening balance", "مانده اولیه"), { money: true, disabled: locked })}{input("description", f("Description (optional)", "توضیحات (اختیاری)"), { optional: true })}</>}
      {entity === "category" && <>{select("icon", f("Icon", "نماد"), ["wallet", "utensils", "car", "home", "book", "gift", "laptop", "film", "briefcase", "repeat", "shopping-bag", "plus"].map((value) => ({ value, label: value })))}<Field label={f("Color", "رنگ")}><TextInput type="color" value={values.color} onChange={(e) => set("color", e.target.value)} /></Field></>}
      {entity === "budget" && <>{select("categoryId", f("Expense category", "دسته‌بندی هزینه"), data.categories.filter((c) => c.type === "expense" && !c.archived).map((c) => ({ value: c.id, label: categoryLabel(c) })))}{input("limit", f("Monthly limit", "سقف ماهانه"), { money: true })}{input("startDate", f("Starts on", "شروع از"), { date: true })}{input("endDate", f("Ends on (optional)", "پایان (اختیاری)"), { date: true, optional: true })}<p className="muted">{f("Uses months in the selected calendar. Only expenses in the active date range count; the limit is not prorated.", "ماه‌ها طبق تقویم انتخاب‌شده محاسبه می‌شوند. فقط هزینه‌های بازه فعال محاسبه می‌شوند؛ سقف به نسبت روزها تغییر نمی‌کند.")}</p></>}
      {entity === "goal" && <>{input("target", f("Target amount", "مبلغ هدف"), { money: true })}{input("targetDate", f("Target date (optional)", "تاریخ هدف (اختیاری)"), { date: true, optional: true })}{input("description", f("Description (optional)", "توضیحات (اختیاری)"), { optional: true })}{select("status", f("Status", "وضعیت"), ["active", "completed", "archived"].map((value) => ({ value, label: typeName(value) })))}{select("accountId", f("Linked account (optional)", "حساب مرتبط (اختیاری)"), accounts.filter((a) => data.accounts.find((x) => x.id === a.value)?.currency === currency), true)}<p className="muted">{f("Linking is a label only. Allocations track your intention and never move money or change account balances.", "ارتباط با حساب صرفاً برای مشخص کردن آن است. تخصیص پس‌انداز پولی جابه‌جا نمی‌کند و مانده حساب را تغییر نمی‌دهد.")}</p></>}
      {entity === "contribution" && <>{select("goalId", f("Savings goal", "هدف پس‌انداز"), data.goals.filter((g) => g.status !== "archived").map((g) => ({ value: g.id, label: `${g.name} · ${g.currency}` })))}{input("amount", f("Allocation amount (negative to withdraw)", "مبلغ تخصیص (منفی برای برداشت)"), { money: true })}{input("date", f("Date", "تاریخ"), { date: true })}<p className="muted">{f("Tracking only. This does not create a transfer, income, or expense.", "فقط برای پیگیری است. تراکنش انتقال، درآمد یا هزینه ایجاد نمی‌کند.")}</p></>}
      {(entity === "transaction" || entity === "contribution") && <Field label={f("Notes (optional)", "یادداشت (اختیاری)")}><TextArea value={values.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} /></Field>}
    </form>
  </Dialog>;
}
export const editorKey = () => newId();
