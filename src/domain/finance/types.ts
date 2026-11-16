import { z } from "zod";
import { CURRENCIES } from "./money";

const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(160);
const text = z.string().max(2000);
const minor = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const positive = minor.refine((n) => n > 0, "Amount must be positive");
export const currencySchema = z.enum(Object.keys(CURRENCIES) as [keyof typeof CURRENCIES, ...(keyof typeof CURRENCIES)[]]);
const money = { currency: currencySchema, scale: z.number().int().min(0).max(3) };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const base = { id: id.nullable() };
export const accountDraft = z.strictObject({ ...base, name, type: z.enum(["cash", "bank", "savings", "wallet", "other"]), ...money, openingMinor: minor, description: text, archived: z.boolean() });
export const categoryDraft = z.strictObject({ ...base, name, type: z.enum(["income", "expense"]), icon: z.string().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(), archived: z.boolean() });
export const transactionDraft = z.strictObject({ ...base, type: z.enum(["income", "expense", "transfer"]), amountMinor: positive, ...money, description: name, categoryId: id.nullable(), accountId: id, destinationId: id.nullable(), date, notes: text });
export const budgetDraft = z.strictObject({ ...base, categoryId: id, limitMinor: positive, ...money, period: z.literal("monthly"), startDate: date, endDate: date.nullable() });
export const goalDraft = z.strictObject({ ...base, name, targetMinor: positive, ...money, targetDate: date.nullable(), description: text, status: z.enum(["active", "completed", "archived"]), accountId: id.nullable() });
export const contributionDraft = z.strictObject({ ...base, goalId: id, amountMinor: minor.refine((n) => n !== 0, "Contribution cannot be zero"), date, notes: text });
export const financeCommand = z.discriminatedUnion("entity", [
  z.strictObject({ entity: z.literal("account"), value: accountDraft }),
  z.strictObject({ entity: z.literal("category"), value: categoryDraft }),
  z.strictObject({ entity: z.literal("transaction"), value: transactionDraft }),
  z.strictObject({ entity: z.literal("budget"), value: budgetDraft }),
  z.strictObject({ entity: z.literal("goal"), value: goalDraft }),
  z.strictObject({ entity: z.literal("contribution"), value: contributionDraft }),
  z.strictObject({ entity: z.literal("delete_transaction"), id }),
  z.strictObject({ entity: z.literal("delete_budget"), id }),
  z.strictObject({ entity: z.literal("preferences"), currency: z.literal("IRR") }),
]);
export type FinanceCommand = z.infer<typeof financeCommand>;
type RecordOf<S extends z.ZodType> = Omit<z.infer<S>, "id"> & { id: string; createdAt: string; updatedAt: string };
export type Account = RecordOf<typeof accountDraft>;
export type Category = RecordOf<typeof categoryDraft>;
export type Transaction = RecordOf<typeof transactionDraft>;
export type Budget = RecordOf<typeof budgetDraft>;
export type SavingsGoal = RecordOf<typeof goalDraft>;
export type Contribution = RecordOf<typeof contributionDraft>;
export interface FinanceSnapshot {
  accounts: Account[]; categories: Category[]; transactions: Transaction[];
  budgets: Budget[]; goals: SavingsGoal[]; contributions: Contribution[];
  currency: keyof typeof CURRENCIES;
}
export const emptyFinance = (): FinanceSnapshot => ({ accounts: [], categories: [], transactions: [], budgets: [], goals: [], contributions: [], currency: "IRR" });
