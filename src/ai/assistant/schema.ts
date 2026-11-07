/**
 * The shape every assistant answer must have. One zod schema serves three jobs:
 * TypeScript types, validation of the model's output, and the JSON schema that the
 * desktop engine turns into a grammar so the model can only write this shape.
 *
 * Operations name things by context aliases (g1, m2, t3), never database ids, and
 * carry scheduling preferences, never clock times. Life OS's own planner decides
 * where things go.
 */

import { z } from "zod";

export const SCHEMA_VERSION = "2";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const goalRef = z.string().regex(/^g\d{1,4}$/, "unknown goal reference");
const taskRef = z.string().regex(/^t\d{1,4}$/, "unknown task reference");
const parentRef = z.string().regex(/^[gm]\d{1,4}$/, "unknown goal or milestone reference");
const title = z.string().trim().min(1).max(160);
const energy = z.enum(["low", "medium", "high"]).nullable();
const timeOfDay = z.enum(["any", "morning", "afternoon", "evening", "focus"]);

const taskDraft = z.strictObject({
  title,
  notes: z.string().max(200),
  estimate_min: z.number().int().min(5).max(480),
  priority: z.number().int().min(1).max(4),
  energy,
  deadline: date.nullable(),
});

export const createGoal = z.strictObject({
  type: z.literal("create_goal"),
  title,
  description: z.string().max(200),
  target_date: date.nullable(),
  // Whole hours, so the grammar can enforce the range (it can't for decimals).
  hours_per_week: z.number().int().min(1).max(40),
  milestones: z
    .array(
      z.strictObject({
        title,
        description: z.string().max(200),
        deadline: date.nullable(),
        tasks: z.array(taskDraft).min(1).max(5),
      }),
    )
    .min(1)
    .max(4),
});

export const createMilestone = z.strictObject({
  type: z.literal("create_milestone"),
  goal_ref: goalRef,
  title,
  description: z.string().max(200),
  deadline: date.nullable(),
  tasks: z.array(taskDraft).max(5),
});

export const createTask = taskDraft.extend({
  type: z.literal("create_task"),
  /** A goal or milestone alias, or null for a standalone task in the planner. */
  parent_ref: parentRef.nullable(),
});

export const updateTask = z.strictObject({
  type: z.literal("update_task"),
  task_ref: taskRef,
  /** Each field is null when it shouldn't change. Status is never changed here. */
  changes: z.strictObject({
    title: title.nullable(),
    notes: z.string().max(200).nullable(),
    estimate_min: z.number().int().min(5).max(480).nullable(),
    priority: z.number().int().min(1).max(4).nullable(),
    energy,
    deadline: date.nullable(),
  }),
});

export const proposeWeeklySchedule = z.strictObject({
  type: z.literal("propose_weekly_schedule"),
  week: z.enum(["this", "next"]),
  task_refs: z.array(taskRef).min(1).max(30),
  time_of_day: timeOfDay,
  /** Weekdays to use (0 = Sunday … 6 = Saturday); empty means any day. */
  days: z.array(z.number().int().min(0).max(6)).max(7),
});

export const proposeReschedule = z.strictObject({
  type: z.literal("propose_reschedule"),
  task_ref: taskRef,
  target_date: date,
  time_of_day: timeOfDay,
});

export const operation = z.discriminatedUnion("type", [createGoal, createMilestone, createTask, updateTask, proposeWeeklySchedule, proposeReschedule]);

export const assistantResponse = z.strictObject({
  intent: z.enum(["advice", "clarification", "propose_changes", "out_of_scope"]),
  // Short on purpose: Life OS shows the details itself, and long answers are slow on a CPU.
  reply: z.string().trim().min(1).max(600),
  needs_clarification: z.boolean(),
  clarification: z.string().max(200).nullable(),
  /** Up to four short answers the user can tap instead of typing. */
  choices: z.array(z.string().trim().min(1).max(60)).max(4),
  proposal: z.strictObject({ summary: z.string().max(120) }).nullable(),
  operations: z.array(operation).max(5),
});

export type Operation = z.infer<typeof operation>;
export type AssistantResponse = z.infer<typeof assistantResponse>;
export type OperationType = Operation["type"];
export type TaskDraft = z.infer<typeof taskDraft>;
export type TimeOfDayPref = z.infer<typeof timeOfDay>;

/**
 * The JSON schema handed to the engine for its grammar. Regex patterns are left out
 * because grammar engines support them unevenly; they're checked by zod afterwards.
 */
export function responseJsonSchema(): string {
  const schema = z.toJSONSchema(assistantResponse, { target: "draft-7" }) as Record<string, unknown>;
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) if (k !== "pattern" && k !== "format") out[k] = strip(v);
      return out;
    }
    return node;
  };
  return JSON.stringify(strip(schema));
}
