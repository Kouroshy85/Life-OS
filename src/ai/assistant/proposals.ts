/**
 * Turns checked operations into a change set the user can review. Every time and
 * placement comes from Life OS's own planning code: the goal compiler's sanitiser
 * and effort check, the weekly goal-session planner, and the day scheduler. The model
 * never decides when anything happens.
 */

import { effortCheck, sanitizePlan, type CompiledPlan } from "../../domain/goalCompiler";
import { planGoalSessions, type GoalSession } from "../../domain/goalPlanner";
import { getLang, weekStartDay } from "../../domain/locale";
import { dayBit, occursOn, weekDates } from "../../domain/plans";
import { overlaps } from "../../domain/intervals";
import { addDays, weekdayOf } from "../../domain/time";
import type { Commitment, DateKey, Goal, Milestone, Plan, Preferences, Project, ScheduleBlock, Task } from "../../domain/types";
import { explain, t } from "../../i18n";
import { makePlan, newId, nowIso } from "../../persistence/repository";
import { earliestSlot, isKept, liveBlocks, prefsForTimeOfDay, proposeWeek, type Clock, type PlanningState } from "../../state/planning";
import type { Rejection, ResolvedOperation, ResolvedTask } from "./parse";

export interface ProposalState {
  goals: Goal[];
  milestones: Milestone[];
  projects: Project[];
  tasks: Task[];
  plans: Plan[];
  blocks: ScheduleBlock[];
  commitments: Commitment[];
  skips: Record<DateKey, string[]>;
  prefs: Preferences;
}

export interface SlotView {
  date: DateKey;
  start: number;
  end: number;
}

export type ChangeItem =
  | { kind: "goal"; plan: CompiledPlan; hoursPerWeek: number; sessions: GoalSession[]; placedMin: number; neededMin: number }
  | { kind: "milestone"; goalId: string; goalTitle: string; title: string; description: string; deadline: DateKey | null; tasks: ResolvedTask[] }
  | { kind: "task"; parent: { kind: "goal" | "milestone"; id: string } | null; parentTitle: string | null; task: ResolvedTask }
  | { kind: "task_update"; taskId: string; title: string; before: Partial<ResolvedTask>; after: Partial<ResolvedTask> }
  | { kind: "week"; taskIds: string[]; days: { date: DateKey; blocks: ScheduleBlock[] }[]; unscheduled: { taskId: string; title: string; reason: string }[] }
  | { kind: "reschedule"; taskId: string; title: string; from: SlotView[]; to: ScheduleBlock[] }
  | { kind: "event"; plan: Plan };

export interface ChangeSet {
  version: 1;
  summary: string;
  /** The checked operations, kept so the set can be rebuilt if the data changes before it's applied. */
  operations: ResolvedOperation[];
  items: ChangeItem[];
  warnings: string[];
  rejected: Rejection[];
  /** True when applying it would move or replace something that already exists. */
  touchesExisting: boolean;
  /** A digest of the data it was built from, to spot changes before applying. */
  fingerprint: string;
  model: string | null;
}

export interface ChangeCounts {
  events: number;
  goals: string[];
  milestones: number;
  tasks: number;
  updated: number;
  sessions: number;
  rescheduled: number;
}

/** What applying a change set would add or change, counted the way the "saved" note counts it. */
export function changeCounts(cs: ChangeSet): ChangeCounts {
  const c: ChangeCounts = { events: 0, goals: [], milestones: 0, tasks: 0, updated: 0, sessions: 0, rescheduled: 0 };
  for (const item of cs.items) {
    if (item.kind === "goal") {
      c.goals.push(item.plan.title);
      c.milestones += item.plan.milestones.length;
      c.tasks += item.plan.milestones.reduce((n, m) => n + m.projects.reduce((n2, p) => n2 + p.tasks.length, 0), 0);
      c.sessions += item.sessions.length;
    } else if (item.kind === "milestone") {
      c.milestones += 1;
      c.tasks += item.tasks.length;
    } else if (item.kind === "task") c.tasks += 1;
    else if (item.kind === "task_update") c.updated += 1;
    else if (item.kind === "event") c.events += 1;
    else if (item.kind === "week") c.sessions += item.days.reduce((n, d) => n + d.blocks.filter((b) => b.kind === "task").length, 0);
    else c.rescheduled += 1;
  }
  return c;
}

/** A short digest of everything a change set depends on. */
export function fingerprint(state: ProposalState): string {
  const parts = [
    state.goals.map((g) => g.id).join(","),
    state.milestones.map((m) => `${m.id}:${m.deadline}`).join(","),
    state.tasks.map((x) => `${x.id}:${x.status}:${x.estimateMin}:${x.progressMin}:${x.updatedAt}`).join(","),
    state.plans.map((p) => `${p.id}:${p.start}:${p.end}:${p.weekdays}:${p.dates?.join("|") ?? ""}`).join(","),
    state.blocks.map((b) => `${b.id}:${b.date}:${b.start}:${b.end}:${b.state}:${b.pinned ? 1 : 0}:${b.proposed ? 1 : 0}`).join(","),
    JSON.stringify(state.prefs),
  ].join("#");
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const planning = (s: ProposalState): PlanningState => ({ tasks: s.tasks, commitments: s.commitments, blocks: s.blocks, skips: s.skips, prefs: s.prefs });
const isProtectedTask = (task: Task) => task.status === "done" || task.status === "skipped" || task.status === "in_progress" || task.progressMin > 0;

/** Titles compared loosely: case, spacing, punctuation, Persian letter forms and one-letter typos don't matter. */
function normalTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\u064a/g, "\u06cc")
    .replace(/\u0643/g, "\u06a9")
    .replace(/[\s\u200c\p{P}]+/gu, "");
}

export function sameTitle(a: string, b: string): boolean {
  const x = normalTitle(a);
  const y = normalTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const longest = Math.max(x.length, y.length);
  if (Math.abs(x.length - y.length) > longest * 0.15) return false;
  // Levenshtein distance, two rows.
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[y.length] / longest >= 0.85;
}

/**
 * Small models like to re-create things that already exist. Copies of open tasks, of
 * active goals, and a milestone that repeats a goal created in the same answer are left out.
 */
function withoutDuplicates(operations: ResolvedOperation[], state: ProposalState, rejected: Rejection[]): ResolvedOperation[] {
  const openTasks = state.tasks.filter((x) => x.status !== "done" && x.status !== "skipped").map((x) => x.title);
  const isOpenTask = (title: string) => openTasks.some((x) => sameTitle(x, title));
  const newGoals = operations.flatMap((op) => (op.type === "create_goal" ? [op.title] : []));
  const out: ResolvedOperation[] = [];
  for (const op of operations) {
    const drop = (title: string) => rejected.push({ type: op.type, code: "duplicate", detail: title });
    if (op.type === "create_goal") {
      if (state.goals.some((g) => !g.archived && sameTitle(g.title, op.title))) drop(op.title);
      else out.push(op);
    } else if (op.type === "create_milestone") {
      const existing = state.milestones.some((m) => m.goalId === op.goalId && sameTitle(m.title, op.title));
      if (existing || newGoals.some((g) => sameTitle(g, op.title))) {
        drop(op.title);
        continue;
      }
      const tasks = op.tasks.filter((x) => {
        if (!isOpenTask(x.title)) return true;
        drop(x.title);
        return false;
      });
      // A milestone that only held copies has nothing left to add.
      if (op.tasks.length && !tasks.length) continue;
      out.push({ ...op, tasks });
    } else if (op.type === "create_task") {
      if (isOpenTask(op.task.title)) drop(op.task.title);
      else out.push(op);
    } else {
      out.push(op);
    }
  }
  return out;
}

export function buildChangeSet(
  operations: ResolvedOperation[],
  state: ProposalState,
  clock: Clock,
  opts: { summary: string; model: string | null; rejected?: Rejection[] },
): ChangeSet {
  const items: ChangeItem[] = [];
  const warnings: string[] = [];
  const rejected: Rejection[] = [...(opts.rejected ?? [])];
  operations = withoutDuplicates(operations, state, rejected);
  const kept: ResolvedOperation[] = [];
  let touchesExisting = false;
  const fa = getLang() === "fa";

  for (const op of operations) {
    const reject = (code: Rejection["code"], detail: string) => rejected.push({ type: op.type, code, detail });

    switch (op.type) {
      case "create_goal": {
        const raw = {
          title: op.title,
          description: op.description,
          notes: [],
          milestones: op.milestones.map((m) => ({
            title: m.title,
            description: m.description,
            deadline: m.deadline,
            projects: [{ title: m.title, tasks: m.tasks.map((x) => ({ ...x })) }],
          })),
        };
        let plan: CompiledPlan;
        try {
          plan = sanitizePlan(raw, { text: op.title, targetDate: op.targetDate, hoursPerWeek: op.hoursPerWeek, today: clock.today }, "ai", opts.model);
        } catch {
          reject("invalid_task", op.title);
          continue;
        }
        const totalMin = plan.milestones.reduce((s, m) => s + m.projects.reduce((s2, p) => s2 + p.tasks.reduce((s3, x) => s3 + x.estimateMin, 0), 0), 0);
        const effort = effortCheck({ totalMin, hoursPerWeek: op.hoursPerWeek, targetDate: op.targetDate, today: clock.today, fa });
        plan.notes = effort.notes;
        if (effort.tooMuch) warnings.push(t.aiWarnTooMuch(op.title));
        const result = planGoalSessions({ hoursMin: op.hoursPerWeek, hoursMax: op.hoursPerWeek, plans: state.plans, prefs: state.prefs, today: clock.today });
        if (!result.ok) warnings.push(t.aiWarnGoalHours(op.title, result.placedMin, result.neededMin));
        if (result.sessions.some((x) => x.overEvent)) warnings.push(t.aiWarnOverEvent);
        items.push({ kind: "goal", plan, hoursPerWeek: op.hoursPerWeek, sessions: result.sessions, placedMin: result.placedMin, neededMin: result.neededMin });
        kept.push(op);
        break;
      }

      case "create_milestone": {
        const goal = state.goals.find((g) => g.id === op.goalId && !g.archived);
        if (!goal) {
          reject("unknown_ref", op.goalId);
          continue;
        }
        if (op.deadline && goal.targetDate && op.deadline > goal.targetDate) {
          reject("after_target", op.deadline);
          continue;
        }
        items.push({ kind: "milestone", goalId: goal.id, goalTitle: goal.title, title: op.title, description: op.description, deadline: op.deadline, tasks: op.tasks });
        kept.push(op);
        break;
      }

      case "create_task": {
        let parentTitle: string | null = null;
        if (op.parent?.kind === "goal") {
          const goal = state.goals.find((g) => g.id === op.parent!.id && !g.archived);
          if (!goal) {
            reject("unknown_ref", op.parent.id);
            continue;
          }
          parentTitle = goal.title;
        } else if (op.parent?.kind === "milestone") {
          const milestone = state.milestones.find((m) => m.id === op.parent!.id);
          if (!milestone) {
            reject("unknown_ref", op.parent.id);
            continue;
          }
          parentTitle = milestone.title;
        }
        items.push({ kind: "task", parent: op.parent, parentTitle, task: op.task });
        kept.push(op);
        break;
      }

      case "update_task": {
        const task = state.tasks.find((x) => x.id === op.taskId);
        if (!task) {
          reject("unknown_ref", op.taskId);
          continue;
        }
        if (isProtectedTask(task)) {
          reject("protected_task", task.title);
          continue;
        }
        const before: Partial<ResolvedTask> = {};
        const after: Partial<ResolvedTask> = {};
        for (const key of Object.keys(op.changes) as (keyof ResolvedTask)[]) {
          if (op.changes[key] === task[key]) continue;
          (before as Record<string, unknown>)[key] = task[key];
          (after as Record<string, unknown>)[key] = op.changes[key];
        }
        if (!Object.keys(after).length) continue;
        items.push({ kind: "task_update", taskId: task.id, title: task.title, before, after });
        touchesExisting = true;
        kept.push(op);
        break;
      }

      case "propose_weekly_schedule": {
        const anchor = op.week === "next" ? addDays(weekDates(clock.today, weekStartDay())[0], 7) : clock.today;
        const dates = weekDates(anchor, weekStartDay()).filter((d) => d >= clock.today && (!op.days.length || op.days.includes(weekdayOf(d))));
        const usable = op.taskIds.filter((id) => {
          const task = state.tasks.find((x) => x.id === id);
          if (!task) {
            reject("unknown_ref", id);
            return false;
          }
          if (task.status === "done" || task.status === "skipped") {
            reject("protected_task", task.title);
            return false;
          }
          return true;
        });
        if (!usable.length || !dates.length) {
          reject("nothing_to_plan", op.week);
          continue;
        }
        const week = proposeWeek(planning(state), dates, clock, { taskIds: usable, timeOfDay: op.timeOfDay });
        if (!week.days.length && !week.unscheduled.length) {
          reject("nothing_to_plan", op.week);
          continue;
        }
        const unscheduled = week.unscheduled.map((n) => ({
          taskId: n.taskId,
          title: state.tasks.find((x) => x.id === n.taskId)?.title ?? "",
          reason: explain(n.message) || t.aiNoRoom,
        }));
        if (unscheduled.length) warnings.push(t.aiWarnUnscheduled(unscheduled.length));
        items.push({ kind: "week", taskIds: usable, days: week.days, unscheduled });
        kept.push(op);
        break;
      }

      case "create_event": {
        const repeating = op.repeatDays.length > 0;
        const plan = makePlan({
          type: "event",
          title: op.title,
          start: op.start,
          end: op.end,
          dates: repeating ? null : [op.date],
          weekdays: op.repeatDays.reduce((bits, d) => bits | dayBit(d), 0),
          validFrom: repeating ? op.date : null,
        });
        const clash = state.plans.find((p) => occursOn(p, op.date) && overlaps(p, plan));
        if (clash) warnings.push(t.aiWarnEventClash(op.title, clash.title));
        items.push({ kind: "event", plan });
        kept.push(op);
        break;
      }

      case "propose_reschedule": {
        const task = state.tasks.find((x) => x.id === op.taskId);
        if (!task) {
          reject("unknown_ref", op.taskId);
          continue;
        }
        if (task.status === "done" || task.status === "skipped") {
          reject("protected_task", task.title);
          continue;
        }
        const own = state.blocks.filter((b) => b.taskId === task.id && !b.proposed && b.date >= clock.today && (b.state === "planned" || b.state === "in_progress"));
        if (own.some((b) => b.state === "in_progress")) {
          reject("started_block", task.title);
          continue;
        }
        if (own.some((b) => b.pinned)) {
          reject("pinned_block", task.title);
          continue;
        }
        // Plan it as if its current sessions were already gone.
        const ownIds = new Set(own.map((b) => b.id));
        const sim: PlanningState = { ...planning(state), blocks: state.blocks.filter((b) => !ownIds.has(b.id)), prefs: prefsForTimeOfDay(state.prefs, op.timeOfDay) };
        const result = earliestSlot(sim, task, op.targetDate, clock);
        if (!result.blocks.some((b) => b.kind === "task")) {
          reject("no_slot", explain(result.unscheduled[0]?.message) || op.targetDate);
          continue;
        }
        const to: ScheduleBlock[] = result.blocks.map((p) => ({
          id: newId(),
          date: op.targetDate,
          taskId: p.taskId,
          kind: p.kind,
          start: p.start,
          end: p.end,
          state: "planned",
          proposed: false,
          pinned: true,
          part: p.part,
          partCount: p.partCount,
          reason: p.reason,
          createdAt: nowIso(),
        }));
        items.push({ kind: "reschedule", taskId: task.id, title: task.title, from: own.map((b) => ({ date: b.date, start: b.start, end: b.end })), to });
        if (own.length) touchesExisting = true;
        kept.push(op);
        break;
      }
    }
  }

  return {
    version: 1,
    summary: opts.summary,
    operations: kept,
    items,
    warnings: [...new Set(warnings)],
    rejected,
    touchesExisting,
    fingerprint: fingerprint(state),
    model: opts.model,
  };
}

/** True when the change set no longer matches the data and must be rebuilt before applying. */
export const isStale = (cs: ChangeSet, state: ProposalState) => cs.fingerprint !== fingerprint(state);

/** Live blocks on `date` that a set would never move, for showing alongside a preview. */
export const keptBlocks = (state: ProposalState, date: DateKey, clock: Clock) => liveBlocks(planning(state), date).filter((b) => isKept(b, date, clock));
