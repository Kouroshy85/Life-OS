/**
 * Adaptive Day Planner — deterministic scheduling engine.
 *
 * Pure function of its input: no clock reads, no randomness, no I/O. The UI and
 * persistence layers feed it a snapshot and store whatever it returns. Every
 * placement and every omission carries a human-readable explanation.
 *
 * Strategy (greedy, priority-first):
 *   1. Build the planning window from working hours (clipped to "now" for today).
 *   2. Subtract fixed commitments, breaks and blocks that must stay where they are.
 *   3. Rank tasks by urgency (deadline) and priority — fully deterministic tie-breaks.
 *   4. Each task claims the earliest slot that suits it: deep-focus work prefers the
 *      focus hours, low-energy work stays out of them. Breaks are inserted after long
 *      runs of continuous work; a buffer follows every task.
 *   5. Tasks too long for any single gap are split into sessions when possible.
 *   6. Anything that still does not fit is returned as unscheduled with a reason.
 */

import { intersect, length, merge, subtract, totalLength, type Interval } from "./intervals";
import { daysBetween, formatClock, formatDuration, formatShortDate, roundUpTo } from "./time";
import type {
  BlockState,
  DateKey,
  Energy,
  Minutes,
  Preferences,
  Priority,
  TaskStatus,
  UnscheduledNote,
  UnscheduledReason,
} from "./types";

export interface SchedulableTask {
  id: string;
  title: string;
  priority: Priority;
  /** Total estimate; already-completed minutes are given separately. */
  estimateMin: Minutes;
  progressMin?: Minutes;
  deadline: DateKey | null;
  deadlineTime: Minutes | null;
  energy: Energy | null;
  status: TaskStatus;
  sortOrder: number;
  createdAt: string;
}

/** Time that is already spoken for: commitments, fixed breaks, kept task blocks. */
export interface BusyBlock {
  start: Minutes;
  end: Minutes;
  title: string;
  kind: "commitment" | "break" | "task";
  taskId?: string | null;
  state?: BlockState;
}

export interface ScheduleInput {
  date: DateKey;
  /** The real current date; dates before it cannot be planned. */
  today: DateKey;
  /** Current minute of the day; only used when `date === today`. */
  nowMin: Minutes | null;
  prefs: Preferences;
  busy: BusyBlock[];
  tasks: SchedulableTask[];
  /** Tasks the user skipped for this date — kept out of the plan, with a note. */
  skippedToday?: string[];
  /** Start times from the plan being replaced, to explain moves. */
  previousStarts?: Record<string, Minutes>;
  /** Why the plan is being recalculated, e.g. `"Write report" ran 20 min over`. */
  trigger?: string;
}

export interface PlannedBlock {
  taskId: string | null;
  kind: "task" | "break";
  start: Minutes;
  end: Minutes;
  part: number;
  partCount: number;
  reason: string;
}

export interface ScheduleResult {
  window: Interval | null;
  blocks: PlannedBlock[];
  unscheduled: UnscheduledNote[];
  /** Free time inside the window before any task was placed. */
  availableMin: Minutes;
  scheduledMin: Minutes;
  /** Free time left after planning. */
  freeAfter: Interval[];
  /** Task ids in the order the engine considered them. */
  order: string[];
}

const SNAP = 5;

type Urgency = "overdue" | "today" | "soon" | "week" | "later";

interface Ranked {
  task: SchedulableTask;
  remaining: Minutes;
  urgency: Urgency;
  score: number;
  /** Latest minute the task should end by on this date (deadline today), else window end. */
  cutoff: Minutes;
}

interface WorkSpan {
  start: Minutes;
  end: Minutes;
}

const URGENCY_BONUS: Record<Urgency, number> = {
  overdue: 35,
  today: 30,
  soon: 18,
  week: 8,
  later: 0,
};

export function urgencyOf(task: Pick<SchedulableTask, "deadline">, date: DateKey): Urgency {
  if (!task.deadline) return "later";
  const days = daysBetween(date, task.deadline);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 2) return "soon";
  if (days <= 7) return "week";
  return "later";
}

/** Deterministic ranking score. Higher means "schedule first". */
export function scoreTask(task: SchedulableTask, date: DateKey): number {
  return (
    task.priority * 10 +
    URGENCY_BONUS[urgencyOf(task, date)] +
    (task.status === "in_progress" ? 5 : 0)
  );
}

export function rankTasks<T extends SchedulableTask>(tasks: T[], date: DateKey): T[] {
  return [...tasks].sort((a, b) => {
    const s = scoreTask(b, date) - scoreTask(a, date);
    if (s !== 0) return s;
    const da = a.deadline ?? "9999-12-31";
    const db = b.deadline ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

function deadlinePhrase(task: SchedulableTask, date: DateKey, today: DateKey, urgency: Urgency): string | null {
  if (!task.deadline) return null;
  const at = task.deadlineTime != null ? ` at ${formatClock(task.deadlineTime)}` : "";
  switch (urgency) {
    case "overdue":
      return `deadline passed on ${formatShortDate(task.deadline)}`;
    case "today":
      return `due ${date === today ? "today" : "that day"}${at}`;
    default: {
      const days = daysBetween(date, task.deadline);
      return days === 1 ? `due tomorrow${at}` : `due in ${days} days`;
    }
  }
}

const PRIORITY_WORD: Record<Priority, string> = {
  1: "Low priority",
  2: "Medium priority",
  3: "High priority",
  4: "Critical priority",
};

export function computeWindow(input: Pick<ScheduleInput, "date" | "today" | "nowMin" | "prefs">):
  | { window: Interval; reason: null }
  | { window: null; reason: UnscheduledReason; message: string } {
  const { prefs, date, today } = input;
  if (prefs.workEnd <= prefs.workStart) {
    return {
      window: null,
      reason: "no_working_hours",
      message: "Working hours are empty — set a start and end time in Planner settings.",
    };
  }
  if (date < today) {
    return { window: null, reason: "day_over", message: "This day has already passed." };
  }
  let start = prefs.workStart;
  if (date === today && input.nowMin != null) {
    start = Math.max(start, roundUpTo(input.nowMin, SNAP));
  }
  if (start >= prefs.workEnd) {
    return {
      window: null,
      reason: "day_over",
      message: `Your working hours ended at ${formatClock(prefs.workEnd)}. Plan tomorrow instead.`,
    };
  }
  return { window: { start, end: prefs.workEnd }, reason: null };
}

export function schedule(input: ScheduleInput): ScheduleResult {
  const { prefs, date } = input;
  const skipped = new Set(input.skippedToday ?? []);
  const unscheduled: UnscheduledNote[] = [];
  const blocks: PlannedBlock[] = [];

  // Minutes already covered today by kept (not yet finished) blocks.
  const covered = new Map<string, number>();
  for (const b of input.busy) {
    if (b.kind === "task" && b.taskId && b.state !== "done" && b.state !== "skipped") {
      covered.set(b.taskId, (covered.get(b.taskId) ?? 0) + (b.end - b.start));
    }
  }

  const candidates: SchedulableTask[] = [];
  for (const t of input.tasks) {
    if (t.status === "done" || t.status === "skipped") continue;
    if (skipped.has(t.id)) {
      unscheduled.push({
        taskId: t.id,
        reason: "skipped_today",
        message: "You skipped this today, so it stays in the backlog.",
        remainingMin: remainingOf(t, covered),
      });
      continue;
    }
    if (remainingOf(t, covered) <= 0) continue;
    candidates.push(t);
  }

  const ranked = rankTasks(candidates, date);
  const order = ranked.map((t) => t.id);
  const win = computeWindow(input);

  if (!win.window) {
    for (const t of ranked) {
      unscheduled.push({
        taskId: t.id,
        reason: win.reason,
        message: win.message,
        remainingMin: remainingOf(t, covered),
      });
    }
    return {
      window: null,
      blocks,
      unscheduled,
      availableMin: 0,
      scheduledMin: 0,
      freeAfter: [],
      order,
    };
  }

  const window = win.window;
  const focus = intersect(window, { start: prefs.focusStart, end: prefs.focusEnd });

  // Occupied time includes the buffer after task blocks.
  const occupied: Interval[] = input.busy.map((b) => ({
    start: b.start,
    end: b.kind === "task" ? b.end + prefs.bufferMin : b.end,
  }));
  const work: WorkSpan[] = input.busy
    .filter((b) => b.kind === "task")
    .map((b) => ({ start: b.start, end: b.end }));

  const availableMin = totalLength(subtract(window, occupied));

  const items: Ranked[] = ranked.map((task) => {
    const urgency = urgencyOf(task, date);
    let cutoff = window.end;
    if (urgency === "today" && task.deadlineTime != null) {
      cutoff = Math.min(window.end, task.deadlineTime);
    }
    return { task, remaining: remainingOf(task, covered), urgency, score: scoreTask(task, date), cutoff };
  });

  const free = () => subtract(window, occupied);

  // ---- break / run helpers --------------------------------------------------
  const runBefore = (at: Minutes): Minutes => {
    let t = at;
    let run = 0;
    const sorted = [...work].sort((a, b) => b.end - a.end);
    for (const w of sorted) {
      if (w.end > t) continue;
      if (t - w.end <= prefs.bufferMin) {
        run += w.end - w.start;
        t = w.start;
      } else break;
    }
    return run;
  };
  const runAfter = (at: Minutes): Minutes => {
    let t = at;
    let run = 0;
    const sorted = [...work].sort((a, b) => a.start - b.start);
    for (const w of sorted) {
      if (w.start < t) continue;
      if (w.start - t <= prefs.bufferMin) {
        run += w.end - w.start;
        t = w.end;
      } else break;
    }
    return run;
  };

  /**
   * Tries to place `dur` minutes starting as early as possible inside `region`
   * (and inside one free gap). Returns the task start and whether a break must
   * precede it, or null if impossible.
   */
  const fit = (
    dur: Minutes,
    region: Interval,
    gaps: Interval[],
  ): { start: Minutes; breakBefore: boolean; gap: Interval } | null => {
    for (const gap of gaps) {
      const area = intersect(gap, region);
      if (!area || length(area) < dur) continue;
      const option = tryAt(area.start, dur, area);
      if (option) return { ...option, gap };
    }
    return null;
  };

  const tryAt = (
    s: Minutes,
    dur: Minutes,
    area: Interval,
  ): { start: Minutes; breakBefore: boolean } | null => {
    const limit = prefs.breakAfterMin;
    if (limit <= 0) return s + dur <= area.end ? { start: s, breakBefore: false } : null;
    const before = runBefore(s);
    const after = (start: Minutes) => runAfter(start + dur);
    if (before > 0 && before + dur > limit) {
      const shifted = s + prefs.breakLengthMin;
      if (shifted + dur > area.end) return null;
      if (dur + after(shifted) > limit && after(shifted) > 0) return null;
      return { start: shifted, breakBefore: true };
    }
    if (s + dur > area.end) return null;
    const fwd = after(s);
    if (fwd > 0 && before + dur + fwd > limit) return null;
    return { start: s, breakBefore: false };
  };

  const commit = (
    item: Ranked,
    start: Minutes,
    dur: Minutes,
    breakBefore: boolean,
    reason: string,
    part = 1,
  ) => {
    if (breakBefore) {
      const bStart = start - prefs.breakLengthMin;
      blocks.push({
        taskId: null,
        kind: "break",
        start: bStart,
        end: start,
        part: 1,
        partCount: 1,
        reason: `Short break — you would otherwise work more than ${formatDuration(prefs.breakAfterMin)} without a pause.`,
      });
      occupied.push({ start: bStart, end: start });
    }
    blocks.push({ taskId: item.task.id, kind: "task", start, end: start + dur, part, partCount: 1, reason });
    occupied.push({ start, end: start + dur + prefs.bufferMin });
    work.push({ start, end: start + dur });
  };

  items.forEach((item, index) => {
    const { task } = item;
    const dur = item.remaining;
    const base = baseReason(item, date, input.today, index);
    const gaps = free();
    const anywhere: Interval = { start: window.start, end: item.cutoff };

    // 1) Single slot honoring the energy preference.
    let placed: ReturnType<typeof fit> = null;
    let placement = "";
    if (task.energy === "high" && focus) {
      placed = fit(dur, { start: focus.start, end: Math.min(focus.end, item.cutoff) }, gaps);
      if (placed) placement = `Placed in your focus hours because it needs deep focus.`;
    } else if (task.energy === "low" && focus) {
      const outside = [
        { start: window.start, end: Math.min(focus.start, item.cutoff) },
        { start: focus.end, end: item.cutoff },
      ];
      for (const r of outside) {
        if (r.end <= r.start) continue;
        placed = fit(dur, r, gaps);
        if (placed) {
          placement = "Kept outside your focus hours since it needs little energy.";
          break;
        }
      }
    }

    // 2) Earliest single slot anywhere before the cutoff.
    if (!placed) {
      placed = fit(dur, anywhere, gaps);
      if (placed) {
        if (task.energy === "high" && focus) placement = "Focus hours were full, so it takes the earliest open slot.";
        else if (task.energy === "low" && focus) placement = "Only open slot was inside your focus hours.";
        else placement = "Earliest open slot that fits.";
      }
    }

    if (placed) {
      const late = item.urgency === "today" && placed.start + dur > item.cutoff;
      commit(
        item,
        placed.start,
        dur,
        placed.breakBefore,
        compose(base, placement, movedNote(task.id, placed.start, input), late ? lateNote(task) : null),
      );
      return;
    }

    // 3) Split into sessions across gaps (also allows finishing after a same-day deadline).
    const sessions = splitIntoSessions(dur, free(), { start: window.start, end: window.end });
    if (sessions.length > 0) {
      const placedMin = sessions.reduce((s, x) => s + x.dur, 0);
      const count = sessions.length;
      const firstIndex = blocks.length;
      sessions.forEach((sess, i) => {
        const last = i === count - 1;
        const late = item.urgency === "today" && last && placedMin === dur && sess.start + sess.dur > item.cutoff;
        commit(
          item,
          sess.start,
          sess.dur,
          sess.breakBefore,
          compose(
            base,
            count > 1
              ? `Session ${i + 1} of ${count} — no single gap fits ${formatDuration(dur)}.`
              : `Only a ${formatDuration(sess.dur)} session fits on this day.`,
            i === 0 ? movedNote(task.id, sess.start, input) : null,
            late ? lateNote(task) : null,
          ),
          i + 1,
        );
      });
      for (const b of blocks.slice(firstIndex)) if (b.kind === "task") b.partCount = count;
      if (placedMin < dur) {
        const rest = dur - placedMin;
        unscheduled.push({
          taskId: task.id,
          reason: "no_time",
          message: `Partly scheduled: ${formatDuration(placedMin)} on this day, ${formatDuration(rest)} still needs a slot.`,
          remainingMin: rest,
        });
      }
      return;
    }

    // 4) Nothing fits.
    unscheduled.push(explainUnscheduled(item, free(), input));
  });

  blocks.sort((a, b) => a.start - b.start || (a.kind === "break" ? -1 : 1));
  const scheduledMin = blocks.filter((b) => b.kind === "task").reduce((s, b) => s + (b.end - b.start), 0);

  return {
    window,
    blocks,
    unscheduled,
    availableMin,
    scheduledMin,
    freeAfter: free(),
    order,
  };

  // ---- local helpers that need closure state ---------------------------------
  function splitIntoSessions(total: Minutes, gaps: Interval[], region: Interval) {
    const out: { start: Minutes; dur: Minutes; breakBefore: boolean }[] = [];
    const min = Math.max(SNAP, prefs.minSessionMin);
    let remaining = total;
    const scratchOccupied: Interval[] = [];
    for (const gap0 of gaps) {
      if (remaining <= 0) break;
      const gap = intersect(gap0, region);
      if (!gap) continue;
      const usable = subtract(gap, scratchOccupied);
      for (const g of usable) {
        if (remaining <= 0) break;
        let s = g.start;
        let breakBefore = false;
        const before = prefs.breakAfterMin > 0 ? runBefore(s) : 0;
        if (prefs.breakAfterMin > 0 && before > 0 && before + min > prefs.breakAfterMin) {
          s += prefs.breakLengthMin;
          breakBefore = true;
        }
        let avail = g.end - s;
        if (prefs.breakAfterMin > 0) {
          const cap = prefs.breakAfterMin - (breakBefore ? 0 : before);
          avail = Math.min(avail, Math.max(0, cap));
        }
        if (avail < min) continue;
        let len = Math.min(remaining, avail);
        const left = remaining - len;
        if (left > 0 && left < min) {
          len = remaining - min;
          if (len < min) continue;
        }
        len = Math.floor(len / SNAP) * SNAP || len;
        if (len < min && len !== remaining) continue;
        if (prefs.breakAfterMin > 0) {
          const fwd = runAfter(s + len);
          if (fwd > 0 && (breakBefore ? 0 : before) + len + fwd > prefs.breakAfterMin) continue;
        }
        out.push({ start: s, dur: len, breakBefore });
        scratchOccupied.push({ start: breakBefore ? s - prefs.breakLengthMin : s, end: s + len + prefs.bufferMin });
        // Make run tracking aware of tentative sessions.
        work.push({ start: s, end: s + len });
        remaining -= len;
      }
    }
    // Roll back tentative work spans; `commit` re-adds them.
    for (let i = 0; i < out.length; i++) work.pop();
    return out;
  }
}

function remainingOf(t: SchedulableTask, covered: Map<string, number>): Minutes {
  return Math.max(0, t.estimateMin - (t.progressMin ?? 0) - (covered.get(t.id) ?? 0));
}

function baseReason(item: Ranked, date: DateKey, today: DateKey, index: number): string {
  const parts: string[] = [];
  const dl = deadlinePhrase(item.task, date, today, item.urgency);
  if (item.task.priority >= 3 || !dl) parts.push(PRIORITY_WORD[item.task.priority]);
  if (dl) parts.push(dl);
  if (item.task.status === "in_progress") parts.push("already in progress");
  const head = parts.join(", ");
  const rank = index === 0 ? "first in the day's order" : `#${index + 1} in the day's order`;
  return `${capitalize(head)} — ${rank}.`;
}

function movedNote(taskId: string, start: Minutes, input: ScheduleInput): string | null {
  const prev = input.previousStarts?.[taskId];
  if (prev == null || prev === start) return null;
  const why = input.trigger ? ` because ${input.trigger}` : "";
  return `Moved from ${formatClock(prev)} to ${formatClock(start)}${why}.`;
}

function lateNote(task: SchedulableTask): string {
  const at = task.deadlineTime != null ? `${formatClock(task.deadlineTime)} ` : "";
  return `Warning: ends after its ${at}deadline — consider trimming the scope.`;
}

function explainUnscheduled(item: Ranked, gaps: Interval[], input: ScheduleInput): UnscheduledNote {
  const { task, remaining } = item;
  const freeTotal = totalLength(gaps);
  const longest = gaps.reduce((m, g) => Math.max(m, length(g)), 0);
  const urgent = item.urgency === "overdue" || item.urgency === "today";
  let reason: UnscheduledReason;
  let message: string;
  if (freeTotal < remaining) {
    reason = urgent ? "deadline_unreachable" : "no_time";
    message =
      freeTotal === 0
        ? `No free time is left on this day; it needs ${formatDuration(remaining)}.`
        : `Needs ${formatDuration(remaining)}, but only ${formatDuration(freeTotal)} of free time remains.`;
  } else {
    reason = urgent ? "deadline_unreachable" : "too_long";
    message =
      longest >= remaining
        ? `Needs ${formatDuration(remaining)}. The longest free gap is ${formatDuration(longest)}, but a required break leaves too little of it.`
        : `Needs ${formatDuration(remaining)}, but the longest free gap is ${formatDuration(longest)} and it can't be split into sessions of ${formatDuration(input.prefs.minSessionMin)} or more.`;
  }
  if (urgent) {
    message += item.urgency === "overdue" ? " Its deadline has already passed." : " It is due that day — free up time or extend your hours.";
  }
  if (input.previousStarts?.[task.id] != null && input.trigger) {
    message = `Moved to the backlog because ${input.trigger}. ${message}`;
  }
  return { taskId: task.id, reason, message, remainingMin: remaining };
}

function compose(...parts: (string | null)[]): string {
  return parts.filter(Boolean).join(" ");
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// ---- manual adjustment helpers ------------------------------------------------

/** All busy intervals that overlap [start, end). */
export function conflictsFor(start: Minutes, end: Minutes, busy: BusyBlock[]): BusyBlock[] {
  return busy.filter((b) => b.start < end && start < b.end);
}

/**
 * Nearest start (by absolute distance from `desired`) where `dur` minutes fit
 * between 00:00 and 24:00 without touching any busy interval. Null if none.
 */
export function nearestFreeStart(
  desired: Minutes,
  dur: Minutes,
  busy: Interval[],
  bounds: Interval = { start: 0, end: 24 * 60 },
): Minutes | null {
  const gaps = subtract(bounds, merge(busy));
  let best: Minutes | null = null;
  for (const g of gaps) {
    if (length(g) < dur) continue;
    const s = Math.min(Math.max(desired, g.start), g.end - dur);
    if (best == null || Math.abs(s - desired) < Math.abs(best - desired)) best = s;
  }
  return best;
}

/** Verifies that no two blocks overlap each other or any busy interval. */
export function findOverlaps(blocks: Interval[], busy: Interval[] = []): [Interval, Interval][] {
  const all = [...blocks.map((b) => ({ b, fixed: false })), ...busy.map((b) => ({ b, fixed: true }))];
  const out: [Interval, Interval][] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (all[i].fixed && all[j].fixed) continue;
      const a = all[i].b;
      const c = all[j].b;
      if (a.start < c.end && c.start < a.end) out.push([a, c]);
    }
  }
  return out;
}
