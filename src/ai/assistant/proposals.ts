/**
 * Turns checked operations into a change set the user can review. Every time and
 * placement comes from Life OS's own planning code: the goal compiler's sanitiser
 * and effort check, the weekly goal-session planner, and the day scheduler. The model
 * never decides when anything happens.
 */

import { effortCheck, sanitizePlan, type CompiledPlan } from "../../domain/goalCompiler";
import { planGoalSessions, type GoalSession } from "../../domain/goalPlanner";
import { getLang, weekStartDay } from "../../domain/locale";
import { weekDates } from "../../domain/plans";
import { addDays, weekdayOf } from "../../domain/time";
import type { Commitment, DateKey, Goal, Milestone, Plan, Preferences, Project, ScheduleBlock, Task } from "../../domain/types";
import { explain, t } from "../../i18n";
import { newId, nowIso } from "../../persistence/repository";
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
  | { kind: "reschedule"; taskId: string; title: string; from: SlotView[]; to: ScheduleBlock[] };

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

export function buildChangeSet(
  operations: ResolvedOperation[],
  state: ProposalState,
  clock: Clock,
  opts: { summary: string; model: string | null; rejected?: Rejection[] },
): ChangeSet {
  const items: ChangeItem[] = [];
  const warnings: string[] = [];
  const rejected: Rejection[] = [...(opts.rejected ?? [])];
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
