/**
 * Turns the model's raw text into a checked answer. Nothing from the model is
 * trusted: the JSON must match the schema, aliases must name things that were in
 * the context, and dates must be real and not in the past. A broken answer returns
 * errors (used for one repair attempt); a single bad operation is rejected with a
 * reason while the rest of the answer is kept.
 */

import { addDays, isValidDateKey } from "../../domain/time";
import type { DateKey, Energy, Minutes, Priority } from "../../domain/types";
import type { AliasMap } from "./context";
import { assistantResponse, type AssistantResponse, type Operation, type TaskDraft, type TimeOfDayPref } from "./schema";

export interface ResolvedTask {
  title: string;
  notes: string;
  estimateMin: Minutes;
  priority: Priority;
  energy: Energy | null;
  deadline: DateKey | null;
}

export type ResolvedOperation =
  | {
      type: "create_goal";
      title: string;
      description: string;
      targetDate: DateKey | null;
      hoursPerWeek: number;
      milestones: { title: string; description: string; deadline: DateKey | null; tasks: ResolvedTask[] }[];
    }
  | { type: "create_milestone"; goalId: string; title: string; description: string; deadline: DateKey | null; tasks: ResolvedTask[] }
  | { type: "create_task"; parent: { kind: "goal" | "milestone"; id: string } | null; task: ResolvedTask }
  | { type: "update_task"; taskId: string; changes: Partial<ResolvedTask> }
  | { type: "propose_weekly_schedule"; week: "this" | "next"; taskIds: string[]; timeOfDay: TimeOfDayPref; days: number[] }
  | { type: "propose_reschedule"; taskId: string; targetDate: DateKey; timeOfDay: TimeOfDayPref };

export type RejectionCode =
  | "unknown_ref"
  | "bad_date"
  | "past_date"
  | "wrong_intent"
  | "protected_task"
  | "pinned_block"
  | "started_block"
  | "no_slot"
  | "after_target"
  | "nothing_to_plan"
  | "no_milestone"
  | "invalid_task"
  | "duplicate";

export interface Rejection {
  type: string;
  code: RejectionCode;
  /** What the rejection is about, such as an alias or a date. */
  detail: string;
}

export type ParseResult =
  | { ok: true; response: AssistantResponse; operations: ResolvedOperation[]; rejected: Rejection[] }
  | { ok: false; errors: string[] };

/** How far ahead the assistant may set dates. */
const MAX_DAYS_AHEAD = 3 * 365;

export function parseResponse(text: string, aliases: AliasMap, today: DateKey): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["The answer was not valid JSON."] };
  }
  const checked = assistantResponse.safeParse(raw);
  if (!checked.success) {
    return { ok: false, errors: checked.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "answer"}: ${i.message}`) };
  }
  const response = { ...checked.data };
  const rejected: Rejection[] = [];

  // A question is a question, whatever the intent says.
  if (response.needs_clarification && response.intent !== "clarification") response.intent = "clarification";
  if (response.intent !== "clarification") {
    response.needs_clarification = false;
    response.clarification = null;
  }
  // Changes only ride along with an actual proposal.
  if (response.intent !== "propose_changes") {
    for (const op of response.operations) rejected.push({ type: op.type, code: "wrong_intent", detail: response.intent });
    response.operations = [];
    response.proposal = null;
  }

  const operations: ResolvedOperation[] = [];
  for (const op of response.operations) {
    const result = resolve(op, aliases, today);
    if ("code" in result) rejected.push(result);
    else operations.push(result);
  }
  if (response.intent === "propose_changes" && !operations.length) response.proposal = null;
  return { ok: true, response, operations, rejected };
}

function resolve(op: Operation, aliases: AliasMap, today: DateKey): ResolvedOperation | Rejection {
  const reject = (code: RejectionCode, detail: string): Rejection => ({ type: op.type, code, detail });
  const latest = addDays(today, MAX_DAYS_AHEAD);
  /** A usable future date, a rejection, or null when none was given. */
  const day = (value: string | null, allowToday = true): DateKey | null | Rejection => {
    if (value == null) return null;
    if (!isValidDateKey(value) || value > latest) return reject("bad_date", value);
    if (value < today || (!allowToday && value === today)) return reject("past_date", value);
    return value;
  };
  const isRejection = (v: unknown): v is Rejection => !!v && typeof v === "object" && "code" in v;
  const task = (d: TaskDraft): ResolvedTask | Rejection => {
    const deadline = day(d.deadline);
    if (isRejection(deadline)) return deadline;
    return { title: d.title.trim(), notes: d.notes.trim(), estimateMin: d.estimate_min, priority: d.priority as Priority, energy: d.energy, deadline };
  };

  switch (op.type) {
    case "create_goal": {
      const targetDate = day(op.target_date, false);
      if (isRejection(targetDate)) return targetDate;
      const milestones = [];
      for (const m of op.milestones) {
        const deadline = day(m.deadline);
        if (isRejection(deadline)) return deadline;
        if (deadline && targetDate && deadline > targetDate) return reject("after_target", deadline);
        const tasks = [];
        for (const d of m.tasks) {
          const r = task(d);
          if (isRejection(r)) return r;
          tasks.push(r);
        }
        milestones.push({ title: m.title.trim(), description: m.description.trim(), deadline, tasks });
      }
      return { type: op.type, title: op.title.trim(), description: op.description.trim(), targetDate, hoursPerWeek: op.hours_per_week, milestones };
    }
    case "create_milestone": {
      const goalId = aliases.goals[op.goal_ref];
      if (!goalId) return reject("unknown_ref", op.goal_ref);
      const deadline = day(op.deadline);
      if (isRejection(deadline)) return deadline;
      const tasks = [];
      for (const d of op.tasks) {
        const r = task(d);
        if (isRejection(r)) return r;
        tasks.push(r);
      }
      return { type: op.type, goalId, title: op.title.trim(), description: op.description.trim(), deadline, tasks };
    }
    case "create_task": {
      let parent: { kind: "goal" | "milestone"; id: string } | null = null;
      if (op.parent_ref) {
        const kind = op.parent_ref.startsWith("g") ? "goal" : "milestone";
        const id = kind === "goal" ? aliases.goals[op.parent_ref] : aliases.milestones[op.parent_ref];
        if (!id) return reject("unknown_ref", op.parent_ref);
        parent = { kind, id };
      }
      const r = task(op);
      if (isRejection(r)) return r;
      return { type: op.type, parent, task: r };
    }
    case "update_task": {
      const taskId = aliases.tasks[op.task_ref];
      if (!taskId) return reject("unknown_ref", op.task_ref);
      const c = op.changes;
      const changes: Partial<ResolvedTask> = {};
      if (c.title != null) changes.title = c.title.trim();
      if (c.notes != null) changes.notes = c.notes.trim();
      if (c.estimate_min != null) changes.estimateMin = c.estimate_min;
      if (c.priority != null) changes.priority = c.priority as Priority;
      if (c.energy != null) changes.energy = c.energy;
      if (c.deadline != null) {
        const deadline = day(c.deadline);
        if (isRejection(deadline)) return deadline;
        changes.deadline = deadline;
      }
      if (!Object.keys(changes).length) return reject("invalid_task", op.task_ref);
      return { type: op.type, taskId, changes };
    }
    case "propose_weekly_schedule": {
      const taskIds: string[] = [];
      for (const ref of op.task_refs) {
        const id = aliases.tasks[ref];
        if (!id) return reject("unknown_ref", ref);
        if (!taskIds.includes(id)) taskIds.push(id);
      }
      return { type: op.type, week: op.week, taskIds, timeOfDay: op.time_of_day, days: [...new Set(op.days)] };
    }
    case "propose_reschedule": {
      const taskId = aliases.tasks[op.task_ref];
      if (!taskId) return reject("unknown_ref", op.task_ref);
      const target = day(op.target_date);
      if (isRejection(target)) return target;
      if (!target) return reject("bad_date", op.target_date);
      if (target > addDays(today, 60)) return reject("bad_date", op.target_date);
      return { type: op.type, taskId, targetDate: target, timeOfDay: op.time_of_day };
    }
  }
}
