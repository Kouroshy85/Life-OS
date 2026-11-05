/**
 * Builds the Life OS context the assistant sees for one request: only what that kind
 * of request needs, in compact text, with short aliases instead of database ids.
 * Notes, dreams, music, quotes, keys and file paths are never included.
 */

import { freeTimes } from "../../domain/availability";
import { weekStartDay } from "../../domain/locale";
import { occursOn, weekDates } from "../../domain/plans";
import { addDays, weekdayOf } from "../../domain/time";
import type { DateKey, Goal, Milestone, Plan, Preferences, ScheduleBlock, Task, TaskEvent } from "../../domain/types";

export type RequestKind = "week" | "day" | "goal" | "study" | "overwhelmed" | "review" | "general";

export interface ContextSource {
  goals: Goal[];
  milestones: Milestone[];
  tasks: Task[];
  plans: Plan[];
  blocks: ScheduleBlock[];
  events: TaskEvent[];
  prefs: Preferences;
  today: DateKey;
  nowMin: number;
  timeZone: string;
}

/** Alias ↔ id, so the model never sees or invents database ids. */
export interface AliasMap {
  goals: Record<string, string>;
  milestones: Record<string, string>;
  tasks: Record<string, string>;
}

export interface BuiltContext {
  text: string;
  aliases: AliasMap;
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LIMITS = { goals: 8, milestones: 16, tasks: 40, blocks: 40, events: 20 };

/** A light guess at what a typed message is about, used only to choose context. */
export function classifyRequest(text: string): RequestKind {
  const t = text.toLowerCase();
  const has = (...words: string[]) => words.some((w) => t.includes(w));
  if (has("overwhelm", "stressed", "too much", "burn out", "burnout", "anxious", "خسته", "استرس", "نمی‌کشم", "نمیکشم", "زیادیه", "کلافه")) return "overwhelmed";
  if (has("exam", "study", "test ", "quiz", "university", "course", "امتحان", "درس", "کنکور", "دانشگاه", "آزمون")) return "study";
  if (has("progress", "review", "how am i doing", "پیشرفت", "مرور", "بررسی")) return "review";
  if (has("week", "هفته")) return "week";
  if (has("today", "my day", "tonight", "امروز", "امشب")) return "day";
  if (has("goal", "milestone", "هدف", "مرحله")) return "goal";
  return "general";
}

/** Always Latin digits, whatever the app language, so the model reads times reliably. */
function clock(m: number): string {
  const h = Math.floor((((m % 1440) + 1440) % 1440) / 60);
  const min = ((m % 60) + 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
const hours = (min: number) => (min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`);
const quote = (s: string) => JSON.stringify(s.replace(/\s+/g, " ").trim().slice(0, 120));

export function buildContext(src: ContextSource, kind: RequestKind): BuiltContext {
  const aliases: AliasMap = { goals: {}, milestones: {}, tasks: {} };
  const goalAlias = new Map<string, string>();
  const milestoneAlias = new Map<string, string>();
  const taskAlias = new Map<string, string>();
  const aliasGoal = (id: string) => {
    if (!goalAlias.has(id)) {
      const a = `g${goalAlias.size + 1}`;
      goalAlias.set(id, a);
      aliases.goals[a] = id;
    }
    return goalAlias.get(id)!;
  };
  const aliasMilestone = (id: string) => {
    if (!milestoneAlias.has(id)) {
      const a = `m${milestoneAlias.size + 1}`;
      milestoneAlias.set(id, a);
      aliases.milestones[a] = id;
    }
    return milestoneAlias.get(id)!;
  };
  const aliasTask = (id: string) => {
    if (!taskAlias.has(id)) {
      const a = `t${taskAlias.size + 1}`;
      taskAlias.set(id, a);
      aliases.tasks[a] = id;
    }
    return taskAlias.get(id)!;
  };

  const { prefs, today } = src;
  const lines: string[] = [];
  const week = weekDates(today, weekStartDay());

  // ---- always
  lines.push(`Today: ${today} (${WEEKDAY[weekdayOf(today)]}), time now ${clock(src.nowMin)}, time zone ${src.timeZone}.`);
  const sleep = prefs.sleepStart != null && prefs.wakeTime != null ? `; sleep ${clock(prefs.sleepStart)}–${clock(prefs.wakeTime)}` : "";
  lines.push(
    `Hours: work ${clock(prefs.workStart)}–${clock(prefs.workEnd)}; focus ${clock(prefs.focusStart)}–${clock(prefs.focusEnd)}${sleep}; ` +
      `${prefs.bufferMin} min buffer after tasks; ${prefs.breakAfterMin ? `${prefs.breakLengthMin} min break after ${prefs.breakAfterMin} min of work` : "no automatic breaks"}.`,
  );

  // ---- free time per day of this week
  const upcoming = week.filter((d) => d >= today);
  if (kind !== "review") {
    const free = upcoming.map((d) => {
      const total = freeTimes(d, src.plans, prefs, { today, nowMin: src.nowMin }).reduce((s, f) => s + (f.end - f.start), 0);
      return `${SHORT_DAY[weekdayOf(d)]} ${d.slice(5)} ${hours(total)}`;
    });
    lines.push(`Free time left this week: ${free.join(", ") || "none"}.`);
    if (kind === "week" || kind === "goal" || kind === "study") {
      const next = weekDates(addDays(week[0], 7), weekStartDay()).map((d) => {
        const total = freeTimes(d, src.plans, prefs, { today }).reduce((s, f) => s + (f.end - f.start), 0);
        return `${SHORT_DAY[weekdayOf(d)]} ${hours(total)}`;
      });
      lines.push(`Free time next week: ${next.join(", ")}.`);
    }
  }

  // ---- fixed weekly plans
  if (kind === "week" || kind === "day" || kind === "study" || kind === "general") {
    const dayPlans = upcoming.flatMap((d) =>
      src.plans
        .filter((p) => occursOn(p, d))
        .map((p) => `${SHORT_DAY[weekdayOf(d)]} ${clock(p.start)}–${clock(p.end)} ${quote(p.title)} (${p.type === "default" ? "fixed routine" : p.type === "goal" ? "goal time" : "event"})`),
    );
    if (dayPlans.length) lines.push(`Fixed plans this week:\n${dayPlans.slice(0, 30).map((l) => `- ${l}`).join("\n")}`);
  }

  // ---- goals and milestones
  const activeGoals = src.goals.filter((g) => !g.archived).slice(0, LIMITS.goals);
  if (activeGoals.length) {
    const goalLines = activeGoals.map((g) => {
      const tasks = src.tasks.filter((t) => t.goalId === g.id && t.status !== "skipped");
      const done = tasks.filter((t) => t.status === "done").length;
      const weekly = src.plans.filter((p) => p.goalId === g.id).reduce((s, p) => s + (p.end - p.start), 0);
      return `- ${aliasGoal(g.id)} ${quote(g.title)}${g.targetDate ? ` target ${g.targetDate}` : ""}, ${done}/${tasks.length} tasks done${weekly ? `, ${hours(weekly)} a week booked` : ""}`;
    });
    lines.push(`Goals:\n${goalLines.join("\n")}`);
    const ms = src.milestones
      .filter((m) => activeGoals.some((g) => g.id === m.goalId))
      .filter((m) => src.tasks.some((t) => t.milestoneId === m.id && t.status !== "done" && t.status !== "skipped") || !src.tasks.some((t) => t.milestoneId === m.id))
      .slice(0, LIMITS.milestones);
    if (ms.length) {
      lines.push(
        `Open milestones:\n${ms
          .map((m) => {
            const open = src.tasks.filter((t) => t.milestoneId === m.id && (t.status === "todo" || t.status === "in_progress")).length;
            return `- ${aliasMilestone(m.id)} in ${aliasGoal(m.goalId)} ${quote(m.title)}${m.deadline ? ` due ${m.deadline}` : ""}, ${open} open tasks`;
          })
          .join("\n")}`,
      );
    }
  }

  // ---- open tasks, most urgent first
  const open = src.tasks
    .filter((t) => t.status === "todo" || t.status === "in_progress")
    .sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || b.priority - a.priority || a.sortOrder - b.sortOrder);
  const taskLimit = kind === "overwhelmed" ? 10 : kind === "review" ? 15 : LIMITS.tasks;
  if (open.length) {
    lines.push(
      `Open tasks (${open.length} in total, most urgent first):\n${open
        .slice(0, taskLimit)
        .map((t) => {
          const where = t.milestoneId && milestoneAlias.has(t.milestoneId) ? ` in ${milestoneAlias.get(t.milestoneId)}` : t.goalId && goalAlias.has(t.goalId) ? ` in ${goalAlias.get(t.goalId)}` : "";
          const flags = [
            t.status === "in_progress" ? "STARTED" : null,
            t.progressMin > 0 ? `${t.progressMin} min done` : null,
            t.inPlanner ? "in planner" : null,
            t.deadline && t.deadline < today ? "OVERDUE" : null,
          ].filter(Boolean);
          return `- ${aliasTask(t.id)} ${quote(t.title)}${where}, ${t.estimateMin} min, priority ${t.priority}${t.deadline ? `, due ${t.deadline}` : ""}${flags.length ? `, ${flags.join(", ")}` : ""}`;
        })
        .join("\n")}`,
    );
  }

  // ---- scheduled sessions
  if (kind === "week" || kind === "day" || kind === "overwhelmed" || kind === "general") {
    const range = kind === "day" || kind === "overwhelmed" ? [today] : upcoming;
    const blocks = src.blocks
      .filter((b) => range.includes(b.date) && !b.proposed && b.kind === "task" && b.state !== "skipped")
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start)
      .slice(0, LIMITS.blocks);
    if (blocks.length) {
      lines.push(
        `Scheduled sessions:\n${blocks
          .map((b) => {
            const task = src.tasks.find((t) => t.id === b.taskId);
            const name = task ? `${aliasTask(task.id)} ${quote(task.title)}` : "task";
            const marks = [b.pinned ? "PINNED (placed by the user, never move)" : null, b.state === "in_progress" ? "STARTED" : null, b.state === "done" ? "DONE" : null].filter(Boolean);
            return `- ${SHORT_DAY[weekdayOf(b.date)]} ${b.date.slice(5)} ${clock(b.start)}–${clock(b.end)} ${name}${marks.length ? `, ${marks.join(", ")}` : ""}`;
          })
          .join("\n")}`,
      );
    }
  }

  // ---- recent history for reviews
  if (kind === "review" || kind === "overwhelmed") {
    const since = addDays(today, -7);
    const recent = src.events.filter((e) => e.date >= since).slice(0, LIMITS.events);
    const done = recent.filter((e) => e.type === "completed").length;
    const skipped = recent.filter((e) => e.type === "skipped" || e.type === "skipped_today").length;
    const overran = recent.filter((e) => e.type === "overran").length;
    lines.push(`Last 7 days: ${done} tasks completed, ${skipped} skipped, ${overran} ran over time.`);
  }

  return { text: lines.join("\n"), aliases };
}
