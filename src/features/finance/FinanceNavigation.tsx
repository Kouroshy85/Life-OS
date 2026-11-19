import { ArrowLeftRight, CalendarDays, House } from "lucide-react";
import { create } from "zustand";
import { f } from "./copy";

export type FinanceSection = "overview" | "transactions" | "recurring" | "accounts" | "budgets" | "goals" | "reports" | "settings";
export const useFinanceNavigation = create<{ section: FinanceSection; account: string }>(() => ({ section: "overview", account: "" }));
export function financeNavigate(section: FinanceSection, account = "") {
  useFinanceNavigation.setState({ section, account });
  document.querySelector(".main")?.scrollTo(0, 0);
}

export function FinanceNavigation({ compact = false, afterNavigate }: { compact?: boolean; afterNavigate?: () => void }) {
  const section = useFinanceNavigation((state) => state.section);
  const destinations = [
    { key: "overview", label: f("Overview", "نمای کلی"), Icon: House },
    { key: "transactions", label: f("Transactions", "تراکنش‌ها"), Icon: ArrowLeftRight },
    { key: "recurring", label: f("Fixed income and expenses", "درآمد و هزینه ثابت"), Icon: CalendarDays },
  ] as const;
  return <nav className={compact ? "finance-tabs finance-tabs--compact" : "finance-tabs finance-tabs--side"} aria-label={f("Finance sections", "بخش‌های مالی")}>
    {destinations.map(({ key, label, Icon }) => <button key={key} type="button" aria-current={section === key ? "page" : undefined}
      onClick={() => { financeNavigate(key); afterNavigate?.(); }}><Icon size={19} /><span>{label}</span></button>)}
  </nav>;
}
