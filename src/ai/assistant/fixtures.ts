/** Shared test data for the assistant tests. Not used by the app. */

import { DEFAULT_PREFERENCES, type Goal, type Milestone, type Plan, type Project, type ScheduleBlock, type Task } from "../../domain/types";
import { makePlan, makeTask } from "../../persistence/repository";
import { plansToCommitments } from "../../domain/plans";
import type { ContextSource } from "./context";
import type { ProposalState } from "./proposals";
import type { AssistantResponse } from "./schema";

/** Thursday 5 November 2026, 08:00. */
export const CLOCK = { today: "2026-11-05", nowMin: 8 * 60 };

const ts = "2026-11-01T00:00:00.000Z";

export function goal(id: string, title: string, extra: Partial<Goal> = {}): Goal {
  return { id, title, description: "", color: null, targetDate: null, source: "manual", sourceModel: null, isSample: false, archived: false, sortOrder: 0, revision: 1, createdAt: ts, updatedAt: ts, ...extra };
}

export function milestone(id: string, goalId: string, title: string, extra: Partial<Milestone> = {}): Milestone {
  return { id, goalId, title, description: "", deadline: null, sortOrder: 0, createdAt: ts, ...extra };
}

export function project(id: string, milestoneId: string): Project {
  return { id, milestoneId, title: "Tasks", sortOrder: 0, createdAt: ts };
}

export function task(id: string, title: string, extra: Partial<Task> = {}): Task {
  return makeTask({ id, title, estimateMin: 60, createdAt: ts, updatedAt: ts, ...extra });
}

export function block(id: string, taskId: string | null, date: string, start: number, end: number, extra: Partial<ScheduleBlock> = {}): ScheduleBlock {
  return { id, date, taskId, kind: "task", start, end, state: "planned", proposed: false, pinned: false, part: 1, partCount: 1, reason: "", createdAt: ts, ...extra };
}

/** A small, realistic life: one goal with a milestone, a fixed gym routine, a few tasks and blocks. */
export function sampleState(overrides: Partial<ProposalState> = {}): ProposalState {
  const plans: Plan[] = [
    makePlan({ id: "plan-gym", type: "default", title: "Gym", weekdays: 0b0111110, start: 7 * 60, end: 8 * 60, createdAt: ts }),
  ];
  const state: ProposalState = {
    goals: [goal("goal-ielts", "IELTS", { targetDate: "2026-12-20" })],
    milestones: [milestone("ms-listening", "goal-ielts", "Listening")],
    projects: [project("proj-listening", "ms-listening")],
    tasks: [
      task("task-listen", "Practise a listening test", { goalId: "goal-ielts", milestoneId: "ms-listening", projectId: "proj-listening", priority: 3 }),
      task("task-vocab", "Learn 30 new words", { goalId: "goal-ielts", milestoneId: "ms-listening", projectId: "proj-listening", estimateMin: 30 }),
      task("task-done", "Book the exam", { status: "done", goalId: "goal-ielts" }),
      task("task-started", "Write an essay", { status: "in_progress", progressMin: 20 }),
      task("task-pinned", "Call the tutor", { inPlanner: true, estimateMin: 30 }),
    ],
    plans,
    blocks: [block("blk-pinned", "task-pinned", "2026-11-06", 10 * 60, 10 * 60 + 30, { pinned: true })],
    commitments: plansToCommitments(plans),
    skips: {},
    prefs: { ...DEFAULT_PREFERENCES },
    ...overrides,
  };
  if (overrides.plans && !overrides.commitments) state.commitments = plansToCommitments(overrides.plans);
  return state;
}

export function sampleContext(state: ProposalState = sampleState()): ContextSource {
  return {
    goals: state.goals,
    milestones: state.milestones,
    tasks: state.tasks,
    plans: state.plans,
    blocks: state.blocks,
    events: [],
    prefs: state.prefs,
    today: CLOCK.today,
    nowMin: CLOCK.nowMin,
    timeZone: "Asia/Tehran",
  };
}

/** A valid answer with sensible defaults; override what a test cares about. */
export function answer(overrides: Partial<AssistantResponse> = {}): string {
  return JSON.stringify({
    intent: "advice",
    reply: "Here's an idea.",
    needs_clarification: false,
    clarification: null,
    proposal: null,
    operations: [],
    ...overrides,
  });
}

export const goalOperation = (extra: Record<string, unknown> = {}) => ({
  type: "create_goal",
  title: "Run a 10K",
  description: "Build up to running 10 km.",
  target_date: null,
  hours_per_week: 3,
  milestones: [
    {
      title: "Base fitness",
      description: "",
      deadline: null,
      tasks: [
        { title: "Run 3 km easy", notes: "", estimate_min: 30, priority: 2, energy: "medium", deadline: null },
        { title: "Run 5 km easy", notes: "", estimate_min: 40, priority: 2, energy: "medium", deadline: null },
      ],
    },
  ],
  ...extra,
});
