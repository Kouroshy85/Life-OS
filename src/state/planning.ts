/**
 * Planning service: turns the stored day state into scheduler input and the
 * scheduler's output back into block changes. No UI, no clock reads — callers
 * pass `today` and `nowMin` explicitly so every path is testable.
 */

import type { Interval } from "../domain/intervals";
import {
  conflictsFor,
  findOverlaps,
  nearestFreeStart,
  schedule,
  type BusyBlock,
  type PlannedBlock,
  type ScheduleResult,
  type SchedulableTask,
} from "../domain/scheduler";
import { encodeParts, type Trigger } from "../domain/explain";
import { formatClock, formatDuration, weekdayOf } from "../domain/time";
import type { Commitment, DateKey, Minutes, Preferences, ScheduleBlock, Task, UnscheduledNote } from "../domain/types";
import { t } from "../i18n";
import { newId, nowIso } from "../persistence/repository";

export interface PlanningState {
  tasks: Task[];
  commitments: Commitment[];
  blocks: ScheduleBlock[];
  skips: Record<DateKey, string[]>;
  prefs: Preferences;
}

export interface Clock {
  today: DateKey;
  nowMin: Minutes;
}

export function commitmentsOn(date: DateKey, commitments: Commitment[]): Commitment[] {
  const wd = weekdayOf(date);
  return commitments
    .filter((c) => (c.date ? c.date === date : (c.weekdays & (1 << wd)) !== 0 && (!c.from || date >= c.from)))
    .sort((a, b) => a.start - b.start);
}

export const liveBlocks = (state: PlanningState, date: DateKey) =>
  state.blocks.filter((b) => b.date === date && !b.proposed);

export const proposedBlocks = (state: PlanningState, date: DateKey) =>
  state.blocks.filter((b) => b.date === date && b.proposed);

/** Blocks the engine must not move: started, finished, or placed by hand. */
export function isKept(b: ScheduleBlock, date: DateKey, clock: Clock): boolean {
  if (b.state === "done" || b.state === "in_progress") return true;
  if (b.state === "skipped") return false;
  if (b.pinned) return !(date === clock.today && b.end <= clock.nowMin);
  return false;
}

/** Busy time for `date`: commitments plus kept task blocks. */
export function busyFor(state: PlanningState, date: DateKey, clock: Clock, excludeIds: Set<string> = new Set()): BusyBlock[] {
  const titleOf = (id: string | null) => state.tasks.find((x) => x.id === id)?.title ?? t.fallbackTask;
  const busy: BusyBlock[] = commitmentsOn(date, state.commitments).map((c) => ({
    start: c.start,
    end: c.end,
    title: c.title,
    kind: c.kind,
  }));
  for (const b of liveBlocks(state, date)) {
    if (excludeIds.has(b.id) || !isKept(b, date, clock)) continue;
    busy.push({ start: b.start, end: b.end, title: titleOf(b.taskId), kind: "task", taskId: b.taskId, state: b.state });
  }
  return busy;
}

export const toSchedulable = (t: Task): SchedulableTask => ({
  id: t.id,
  title: t.title,
  priority: t.priority,
  estimateMin: t.estimateMin,
  progressMin: t.progressMin,
  deadline: t.deadline,
  deadlineTime: t.deadlineTime,
  energy: t.energy,
  status: t.status,
  sortOrder: t.sortOrder,
  createdAt: t.createdAt,
});

export const isOpen = (t: Task) => t.status === "todo" || t.status === "in_progress";

/** Minutes of a task already planned on other current or future days. */
export function coveredElsewhere(state: PlanningState, taskId: string, date: DateKey, clock: Clock): Minutes {
  return state.blocks
    .filter(
      (b) =>
        b.taskId === taskId &&
        !b.proposed &&
        b.date !== date &&
        b.date >= clock.today &&
        (b.state === "planned" || b.state === "in_progress"),
    )
    .reduce((sum, b) => sum + (b.end - b.start), 0);
}

/** Minutes of a task with no session on any day yet, as seen from `date`. Drives the backlog. */
export function unplannedMinutes(state: PlanningState, task: Task, date: DateKey, clock: Clock): Minutes {
  const here = liveBlocks(state, date)
    .filter((b) => b.taskId === task.id && (b.state === "planned" || b.state === "in_progress"))
    .reduce((sum, b) => sum + (b.end - b.start), 0);
  return Math.max(0, task.estimateMin - task.progressMin - here - coveredElsewhere(state, task.id, date, clock));
}

/** Scheduler input for a task, net of the time already planned on other days. */
function schedulableFor(state: PlanningState, task: Task, date: DateKey, clock: Clock): SchedulableTask {
  const base = toSchedulable(task);
  return { ...base, progressMin: task.progressMin + coveredElsewhere(state, task.id, date, clock) };
}

export function plannerPool(state: PlanningState): Task[] {
  return state.tasks.filter((t) => t.inPlanner && isOpen(t));
}

function toBlocks(date: DateKey, planned: PlannedBlock[], proposed: boolean): ScheduleBlock[] {
  const ts = nowIso();
  return planned.map((p) => ({
    id: newId(),
    date,
    taskId: p.taskId,
    kind: p.kind,
    start: p.start,
    end: p.end,
    state: "planned",
    proposed,
    pinned: false,
    part: p.part,
    partCount: p.partCount,
    reason: p.reason,
    createdAt: ts,
  }));
}

function previousStarts(state: PlanningState, date: DateKey): Record<string, Minutes> {
  const out: Record<string, Minutes> = {};
  for (const b of liveBlocks(state, date)) {
    if (b.kind === "task" && b.taskId && b.state === "planned" && out[b.taskId] == null) out[b.taskId] = b.start;
  }
  return out;
}

export interface BlockChanges {
  insert: ScheduleBlock[];
  update: { id: string; patch: Partial<ScheduleBlock> }[];
  remove: string[];
}

// ---- proposals ------------------------------------------------------------------

export interface Proposal {
  result: ScheduleResult;
  blocks: ScheduleBlock[];
  /** Existing live blocks the proposal would replace on accept. */
  replaces: string[];
  summary: string;
}

/** A fresh proposal for `date` from the whole planner pool. Kept blocks stay. */
export function proposePlan(state: PlanningState, date: DateKey, clock: Clock): Proposal {
  const busy = busyFor(state, date, clock);
  const result = schedule({
    date,
    today: clock.today,
    nowMin: clock.nowMin,
    prefs: state.prefs,
    busy,
    tasks: plannerPool(state).map((t) => schedulableFor(state, t, date, clock)),
    skippedToday: state.skips[date] ?? [],
    previousStarts: previousStarts(state, date),
  });
  const replaces = liveBlocks(state, date)
    .filter((b) => !isKept(b, date, clock) && b.state === "planned")
    .map((b) => b.id);
  const taskCount = result.blocks.filter((b) => b.kind === "task").length;
  const backlog = result.unscheduled.length;
  const summary = result.window
    ? encodeParts({ k: "proposal", sessions: taskCount, scheduled: result.scheduledMin, available: result.availableMin, backlog })
    : (result.unscheduled[0]?.message ?? "");
  return { result, blocks: toBlocks(date, result.blocks, true), replaces, summary };
}

/** Changes that turn the stored proposal into the live plan. */
export function acceptChanges(state: PlanningState, date: DateKey, clock: Clock): BlockChanges {
  const proposal = proposedBlocks(state, date);
  const replaced = liveBlocks(state, date).filter((b) => !isKept(b, date, clock) && b.state === "planned");
  const kept = liveBlocks(state, date).filter((b) => isKept(b, date, clock));
  const overlaps = findOverlaps(proposal, [...kept, ...commitmentsOn(date, state.commitments)]);
  if (overlaps.length) {
    throw new PlanningError(t.errDayChanged);
  }
  return {
    insert: [],
    update: proposal.map((b) => ({ id: b.id, patch: { proposed: false } })),
    remove: replaced.map((b) => b.id),
  };
}

// ---- reflow ----------------------------------------------------------------------

export interface Reflow {
  changes: BlockChanges;
  notes: UnscheduledNote[];
  moved: number;
  toBacklog: number;
}

/**
 * Recalculates the rest of `date` after something changed (overrun, new
 * commitment, edited hours). Only tasks already on the plan are reshuffled;
 * pinned blocks stay unless they now collide with a commitment.
 */
export function reflowDay(state: PlanningState, date: DateKey, clock: Clock, trigger: Trigger): Reflow {
  const live = liveBlocks(state, date);
  const commitments = commitmentsOn(date, state.commitments);
  // A pinned block yields to commitments and to work that already happened or is running.
  const immovable = [...commitments, ...live.filter((b) => b.state === "in_progress" || b.state === "done")];
  const collides = (b: ScheduleBlock) => immovable.some((c) => c.start < b.end && b.start < c.end);
  const kept = live.filter((b) => isKept(b, date, clock) && !(b.pinned && b.state === "planned" && collides(b)));
  const keptIds = new Set(kept.map((b) => b.id));
  const movable = live.filter((b) => !keptIds.has(b.id) && b.state === "planned");
  const taskIds = new Set(movable.filter((b) => b.taskId).map((b) => b.taskId!));
  const tasks = state.tasks.filter((t) => taskIds.has(t.id) && isOpen(t));

  // Busy: commitments + kept blocks (computed against the kept set, not isKept, to honour unpinning).
  const busy: BusyBlock[] = commitments.map((c) => ({ start: c.start, end: c.end, title: c.title, kind: c.kind }));
  for (const b of kept) busy.push({ start: b.start, end: b.end, title: "", kind: "task", taskId: b.taskId, state: b.state });

  const prev: Record<string, Minutes> = {};
  for (const b of movable) if (b.taskId && prev[b.taskId] == null) prev[b.taskId] = b.start;

  const result = schedule({
    date,
    today: clock.today,
    nowMin: clock.nowMin,
    prefs: state.prefs,
    busy,
    tasks: tasks.map((t) => schedulableFor(state, t, date, clock)),
    skippedToday: state.skips[date] ?? [],
    previousStarts: prev,
    trigger,
  });
  const inserted = toBlocks(date, result.blocks, false);
  const moved = inserted.filter((b) => b.taskId && prev[b.taskId] != null && prev[b.taskId] !== b.start).length;
  return {
    changes: { insert: inserted, update: [], remove: movable.map((b) => b.id) },
    notes: result.unscheduled,
    moved,
    toBacklog: result.unscheduled.length,
  };
}

/** Does the live plan for `date` currently contain overlaps or blocks outside commitments? */
export function needsReflow(state: PlanningState, date: DateKey, clock: Clock): boolean {
  const live = liveBlocks(state, date).filter((b) => b.state !== "skipped" && b.state !== "done");
  if (!live.length) return false;
  const commitments = commitmentsOn(date, state.commitments);
  const upcoming = live.filter((b) => !(date === clock.today && b.end <= clock.nowMin));
  return findOverlaps(upcoming, commitments).length > 0;
}

// ---- manual adjustments -------------------------------------------------------------

export class PlanningError extends Error {}

export interface MoveResult {
  start: Minutes;
  end: Minutes;
  snapped: boolean;
  message: string | null;
}

/**
 * Validates moving/resizing a live block. Overlaps are never allowed: the block
 * snaps to the nearest valid position, or the change is refused.
 */
export function validateMove(
  state: PlanningState,
  blockId: string,
  desiredStart: Minutes,
  duration: Minutes,
): MoveResult {
  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) throw new PlanningError(t.errBlockGone);
  if (duration < 5) throw new PlanningError(t.errBlockShort);
  const others: (Interval & { title: string })[] = [
    ...commitmentsOn(block.date, state.commitments).map((c) => ({ start: c.start, end: c.end, title: c.title })),
    ...state.blocks
      .filter((b) => {
        if (b.date !== block.date || b.id === block.id || b.state === "skipped") return false;
        if (b.proposed === block.proposed) return true;
        // A proposed block also has to clear live blocks the proposal won't replace.
        return block.proposed && (b.state !== "planned" || b.pinned);
      })
      .map((b) => ({ start: b.start, end: b.end, title: state.tasks.find((x) => x.id === b.taskId)?.title ?? t.breakLabel })),
  ];
  const start = Math.max(0, Math.min(24 * 60 - duration, Math.round(desiredStart / 5) * 5));
  const clash = conflictsFor(start, start + duration, others.map((o) => ({ ...o, kind: "commitment" as const })));
  if (!clash.length) return { start, end: start + duration, snapped: false, message: null };
  const alt = nearestFreeStart(start, duration, others);
  if (alt == null) {
    throw new PlanningError(t.errNoSlot(formatDuration(duration)));
  }
  return {
    start: alt,
    end: alt + duration,
    snapped: true,
    message: t.snapMsg(clash[0].title, formatClock(clash[0].start), formatClock(clash[0].end), formatClock(alt)),
  };
}

/** Earliest free slot for a single task on `date` (used by "Schedule" buttons). */
export function earliestSlot(state: PlanningState, task: Task, date: DateKey, clock: Clock) {
  const busy = busyFor(state, date, clock);
  // Every live planned block is busy for a one-off insertion — nothing gets displaced.
  for (const b of liveBlocks(state, date)) {
    if (b.state === "planned" && !isKept(b, date, clock)) {
      busy.push({ start: b.start, end: b.end, title: "", kind: "task", taskId: b.taskId, state: b.state });
    }
  }
  const result = schedule({
    date,
    today: clock.today,
    nowMin: clock.nowMin,
    prefs: state.prefs,
    busy,
    tasks: [schedulableFor(state, task, date, clock)],
  });
  return result;
}

// ---- weekly proposals -------------------------------------------------------------

export type TimeOfDay = "any" | "morning" | "afternoon" | "evening" | "focus";

/** Narrows the working hours to a part of the day, without ever widening them past sleep. */
export function prefsForTimeOfDay(prefs: Preferences, when: TimeOfDay): Preferences {
  const ranges: Record<Exclude<TimeOfDay, "any">, [Minutes, Minutes]> = {
    morning: [Math.min(prefs.workStart, 8 * 60), 12 * 60],
    afternoon: [12 * 60, 17 * 60],
    evening: [17 * 60, 21 * 60 + 30],
    focus: [prefs.focusStart, prefs.focusEnd],
  };
  if (when === "any") return prefs;
  const [start, end] = ranges[when];
  return { ...prefs, workStart: start, workEnd: Math.max(start + 30, end) };
}

export interface WeekDayProposal {
  date: DateKey;
  blocks: ScheduleBlock[];
}

export interface WeekProposal {
  days: WeekDayProposal[];
  /** Tasks with time still unplaced after every day was tried, with the scheduler's reason from the last day. */
  unscheduled: UnscheduledNote[];
}

/**
 * Places the given tasks into the free time of several days, one day after another.
 * Existing live blocks are all treated as busy, so nothing already planned moves:
 * this only adds sessions around what's there. Each day sees the sessions placed on
 * earlier days, so a task's time isn't planned twice.
 */
export function proposeWeek(
  state: PlanningState,
  dates: DateKey[],
  clock: Clock,
  opts: { taskIds: string[]; timeOfDay?: TimeOfDay },
): WeekProposal {
  const ids = new Set(opts.taskIds);
  let sim: PlanningState = state;
  const days: WeekDayProposal[] = [];
  let lastNotes = new Map<string, UnscheduledNote>();
  const prefs = prefsForTimeOfDay(state.prefs, opts.timeOfDay ?? "any");

  for (const date of dates) {
    if (date < clock.today) continue;
    const tasks = sim.tasks.filter((t) => ids.has(t.id) && isOpen(t)).filter((t) => unplannedMinutes(sim, t, date, clock) > 0);
    if (!tasks.length) break;
    const busy = busyFor(sim, date, clock);
    for (const b of liveBlocks(sim, date)) {
      if (b.state === "planned" && !isKept(b, date, clock)) busy.push({ start: b.start, end: b.end, title: "", kind: "task", taskId: b.taskId, state: b.state });
    }
    const result = schedule({
      date,
      today: clock.today,
      nowMin: clock.nowMin,
      prefs,
      busy,
      // Only what has no session anywhere yet, today included, so nothing is planned twice.
      tasks: tasks.map((t) => ({ ...toSchedulable(t), progressMin: t.estimateMin - unplannedMinutes(sim, t, date, clock) })),
      skippedToday: sim.skips[date] ?? [],
    });
    const blocks = toBlocks(date, result.blocks, false);
    lastNotes = new Map(result.unscheduled.map((n) => [n.taskId, n]));
    if (blocks.some((b) => b.kind === "task")) {
      days.push({ date, blocks });
      sim = { ...sim, blocks: [...sim.blocks, ...blocks] };
    }
  }

  const unscheduled: UnscheduledNote[] = [];
  for (const task of sim.tasks.filter((t) => ids.has(t.id) && isOpen(t))) {
    const last = dates[dates.length - 1];
    const remaining = last ? unplannedMinutes(sim, task, last, clock) : 0;
    if (remaining > 0) unscheduled.push(lastNotes.get(task.id) ?? { taskId: task.id, reason: "no_time", message: "", remainingMin: remaining });
  }
  return { days, unscheduled };
}
