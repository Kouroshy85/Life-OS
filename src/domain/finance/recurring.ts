import { z } from "zod";
import { calendarParts, dateDistance, shiftCalendarMonth, shiftDate, type CalendarSystem } from "../calendar";
import { currencyScale } from "./money";
import { checkDate } from "./service";
import { currencySchema, type FinanceSnapshot } from "./types";

export const frequencies = ["daily", "weekly", "monthly", "yearly"] as const;
export const recurringDraft = z.strictObject({
  type: z.enum(["income", "expense"]), name: z.string().trim().min(1).max(160),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: currencySchema,
  frequency: z.enum(frequencies), interval: z.number().int().min(1).max(24), startDate: z.string(),
  calendar: z.enum(["persian", "gregory"]), accountId: z.string().nullable(), categoryId: z.string().nullable(),
  notes: z.string().max(2000),
});
export type RecurringDraft = z.infer<typeof recurringDraft>;
export type Frequency = RecurringDraft["frequency"];
export type RecurringRule = RecurringDraft & {
  id: string; originalStartDate: string; nextIndex: number; revision: number;
  status: "active" | "paused" | "archived"; createdAt: string;
  lastPosted: string | null;
};
export interface RecurringOccurrence {
  ruleId: string; dueDate: string; transactionId: string | null; postedAt: string;
  amountMinor: number; currency: string; ledgerDate: string;
}

export function validateRecurring(input: RecurringDraft, finance: FinanceSnapshot): RecurringDraft {
  const result = recurringDraft.safeParse(input);
  if (!result.success) throw new Error(result.error.issues[0].message);
  const draft = result.data;
  checkDate(draft.startDate);
  if (draft.startDate < "1900-01-01" || draft.startDate > "9998-12-31") throw new Error("Choose a date between 1900 and 9998.");
  const account = finance.accounts.find((candidate) => candidate.id === draft.accountId && !candidate.archived);
  if ((draft.type === "income" || draft.accountId) && (!account || account.currency !== draft.currency || account.scale !== currencyScale(draft.currency))) {
    throw new Error("Choose an active account in the same currency.");
  }
  if (draft.categoryId && !finance.categories.some((category) => category.id === draft.categoryId && category.type === draft.type && !category.archived)) {
    throw new Error("Choose an active category for this type of transaction.");
  }
  return draft;
}

type Timing = Pick<RecurringDraft, "startDate" | "frequency" | "interval" | "calendar">;
export function occurrenceDate(rule: Timing, index: number): string {
  const count = index * rule.interval;
  if (rule.frequency === "daily" || rule.frequency === "weekly") return shiftDate(rule.startDate, count * (rule.frequency === "weekly" ? 7 : 1));
  return shiftCalendarMonth(rule.startDate, count * (rule.frequency === "yearly" ? 12 : 1), rule.calendar);
}

/** Find the first occurrence after a posted date without walking years of history. */
export function firstAfter(rule: Timing, date: string): number {
  if (date < rule.startDate) return 0;
  if (rule.frequency === "daily" || rule.frequency === "weekly") {
    return Math.floor(dateDistance(rule.startDate, date) / (rule.interval * (rule.frequency === "weekly" ? 7 : 1))) + 1;
  }
  const start = calendarParts(rule.startDate, rule.calendar);
  const end = calendarParts(date, rule.calendar);
  const months = (end.year - start.year) * 12 + end.month - start.month;
  const index = Math.floor(months / (rule.interval * (rule.frequency === "yearly" ? 12 : 1)));
  return occurrenceDate(rule, index) > date ? index : index + 1;
}

export const scheduleUsesCalendar = (frequency: Frequency) => frequency === "monthly" || frequency === "yearly";
export const recurringCalendar = (rule: Timing | undefined, selected: CalendarSystem): CalendarSystem => rule?.calendar ?? selected;
