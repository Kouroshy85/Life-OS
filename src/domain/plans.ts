/**
 * Plans: everything the user locks into their week.
 *
 * Priority decides who wins a time slot: default plans, then goal plans, then
 * events, then free time. A plan can't take time from an equal or higher priority,
 * and can take it from a lower one.
 */

import { overlaps } from "./intervals";
import { addDays, weekdayOf } from "./time";
import { PLAN_COLORS, type Commitment, type DateKey, type Goal, type Minutes, type Plan, type PlanColor, type PlanType } from "./types";

export const PLAN_PRIORITY: Record<PlanType, number> = { default: 1, goal: 2, event: 3 };

export const ALL_DAYS = 0b1111111;

export const dayBit = (weekday: number) => 1 << weekday;

export function occursOn(plan: Plan, date: DateKey): boolean {
  if (plan.dates) return plan.dates.includes(date);
  return (plan.weekdays & dayBit(weekdayOf(date))) !== 0 && (!plan.validFrom || date >= plan.validFrom);
}

/** Every date in a week, starting on `weekStart` (0 = Sunday, 6 = Saturday). */
export function weekDates(anchor: DateKey, weekStart: number): DateKey[] {
  const first = addDays(anchor, -((weekdayOf(anchor) - weekStart + 7) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

/** The first date on or after `from` that falls on `weekday`. */
export const nextWeekday = (from: DateKey, weekday: number) => addDays(from, (weekday - weekdayOf(from) + 7) % 7);

export interface PlanConflict {
  plan: Plan;
  /** Where they meet: a specific date for events, a weekday for repeating plans. */
  date: DateKey | null;
  weekday: number;
}

function firstSharedDay(a: Plan, b: Plan): Pick<PlanConflict, "date" | "weekday"> | null {
  if (a.dates) {
    const date = a.dates.find((d) => occursOn(b, d));
    return date ? { date, weekday: weekdayOf(date) } : null;
  }
  if (b.dates) {
    const date = b.dates.find((d) => occursOn(a, d));
    return date ? { date, weekday: weekdayOf(date) } : null;
  }
  const shared = a.weekdays & b.weekdays;
  if (!shared) return null;
  for (let w = 0; w < 7; w++) if (shared & dayBit(w)) return { date: null, weekday: w };
  return null;
}

/** All other plans that would share time with `candidate`. */
export function findConflicts(candidate: Plan, plans: Plan[]): PlanConflict[] {
  const out: PlanConflict[] = [];
  for (const plan of plans) {
    if (plan.id === candidate.id || !overlaps(candidate, plan)) continue;
    const day = firstSharedDay(candidate, plan);
    if (day) out.push({ plan, ...day });
  }
  return out;
}

/** Splits conflicts into those that stop the plan and those it simply outranks. */
export function classifyConflicts(candidate: Plan, plans: Plan[]) {
  const conflicts = findConflicts(candidate, plans);
  const rank = PLAN_PRIORITY[candidate.type];
  return {
    blocking: conflicts.filter((c) => PLAN_PRIORITY[c.plan.type] <= rank),
    outranked: conflicts.filter((c) => PLAN_PRIORITY[c.plan.type] > rank),
  };
}

export type PlanTimeProblem = "missing" | "order" | "tooShort";

export function planTimeProblem(start: Minutes | null, end: Minutes | null): PlanTimeProblem | null {
  if (start == null || end == null) return "missing";
  if (end <= start) return "order";
  return end - start < 5 ? "tooShort" : null;
}

/** Plans as the fixed time the day scheduler has to work around. */
export function plansToCommitments(plans: Plan[]): Commitment[] {
  const out: Commitment[] = [];
  for (const p of plans) {
    const base = {
      id: p.id,
      title: p.title,
      kind: p.isBreak ? ("break" as const) : ("commitment" as const),
      start: p.start,
      end: p.end,
      createdAt: p.createdAt,
    };
    if (p.dates) for (const date of p.dates) out.push({ ...base, date, weekdays: 0 });
    else out.push({ ...base, date: null, weekdays: p.weekdays, from: p.validFrom });
  }
  return out;
}

/** Lays out one day's plans in lanes, highest priority first, so overlaps stay readable. */
export function layoutLanes(plans: Plan[]): { plan: Plan; lane: number; lanes: number }[] {
  const sorted = [...plans].sort((a, b) => PLAN_PRIORITY[a.type] - PLAN_PRIORITY[b.type] || a.start - b.start);
  const placed: { plan: Plan; lane: number }[] = [];
  for (const plan of sorted) {
    let lane = 0;
    while (placed.some((p) => p.lane === lane && overlaps(p.plan, plan))) lane++;
    placed.push({ plan, lane });
  }
  return placed.map((p) => {
    const touching = placed.filter((o) => overlaps(o.plan, p.plan));
    return { ...p, lanes: Math.max(...touching.map((o) => o.lane)) + 1 };
  });
}

/** The colour each type has until you choose another. */
export const TYPE_COLOR: Record<PlanType, PlanColor> = { default: 1, goal: 2, event: 3 };

/** A goal's sessions share one colour, so they read as one thing across the week. */
export function planColor(plan: Pick<Plan, "type" | "goalId" | "color">, goals: Pick<Goal, "id" | "color">[]): PlanColor {
  const linked = plan.goalId ? goals.find((g) => g.id === plan.goalId) : null;
  return linked?.color ?? plan.color ?? TYPE_COLOR[plan.type];
}

/** What's using each colour. A goal counts once however many sessions it has. */
export function colorUsage(plans: Plan[], goals: Pick<Goal, "id" | "title" | "color">[], exceptPlanId?: string): Record<PlanColor, string[]> {
  const usage: Record<PlanColor, string[]> = { 1: [], 2: [], 3: [], 4: [] };
  const seenGoals = new Set<string>();
  for (const plan of plans) {
    if (plan.id === exceptPlanId) continue;
    if (plan.goalId) {
      if (seenGoals.has(plan.goalId)) continue;
      seenGoals.add(plan.goalId);
    }
    const name = (plan.goalId && goals.find((g) => g.id === plan.goalId)?.title) || plan.title;
    usage[planColor(plan, goals)].push(name);
  }
  return usage;
}

/** For a new plan: the least used colour, so it stands out. The type's own colour wins a tie. */
export function suggestColor(type: PlanType, plans: Plan[], goals: Pick<Goal, "id" | "title" | "color">[]): PlanColor {
  const usage = colorUsage(plans, goals);
  return PLAN_COLORS.reduce((best, color) => (usage[color].length < usage[best].length ? color : best), TYPE_COLOR[type]);
}
