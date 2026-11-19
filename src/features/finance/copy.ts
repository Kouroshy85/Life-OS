import { getLang } from "../../domain/locale";
import type { Category } from "../../domain/finance/types";
export const f = (en: string, fa: string) => getLang() === "fa" ? fa : en;
const seededNames: Record<string, [string, string]> = {
  salary: ["Salary", "حقوق"], freelance: ["Freelance", "کار آزاد"], gifts: ["Gifts", "هدیه"],
  "other-income": ["Other income", "سایر درآمدها"], food: ["Food", "خوراک"], transport: ["Transportation", "حمل‌ونقل"],
  shopping: ["Shopping", "خرید"], education: ["Education", "آموزش"], entertainment: ["Entertainment", "تفریح"],
  subscriptions: ["Subscriptions", "اشتراک‌ها"], housing: ["Housing", "مسکن"], "other-expense": ["Other expenses", "سایر هزینه‌ها"],
};
export function categoryLabel(category: Category) {
  const seeded = category.id.startsWith("finance-") ? seededNames[category.id.slice(8)] : undefined;
  return seeded?.[0] === category.name ? f(...seeded) : category.name;
}
export const sectionNames = () => ({ overview: f("Overview", "نمای کلی"), transactions: f("Transactions", "تراکنش‌ها"), recurring: f("Fixed income and expenses", "درآمد و هزینه ثابت"), accounts: f("Accounts", "حساب‌ها"), budgets: f("Budgets", "بودجه‌ها"), goals: f("Savings goals", "اهداف پس‌انداز"), reports: f("Reports", "گزارش‌ها"), settings: f("Categories", "دسته‌بندی‌ها") });
export const typeName = (type: string) => ({ income: f("Income", "درآمد"), expense: f("Expense", "هزینه"), transfer: f("Transfer", "انتقال"), cash: f("Cash", "نقدی"), bank: f("Bank", "بانکی"), savings: f("Savings", "پس‌انداز"), wallet: f("Digital wallet", "کیف پول دیجیتال"), other: f("Other", "سایر"), active: f("Active", "فعال"), completed: f("Completed", "تکمیل‌شده"), archived: f("Archived", "بایگانی‌شده") }[type] ?? type);
