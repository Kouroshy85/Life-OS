import { describe, expect, it } from "vitest";
import { explain } from "../i18n";
import {
  findOverlaps,
  nearestFreeStart,
  rankTasks,
  schedule,
  type BusyBlock,
  type ScheduleInput,
  type SchedulableTask,
} from "./scheduler";
import { DEFAULT_PREFERENCES, type Preferences } from "./types";

const DATE = "2026-11-02";
const h = (hours: number, minutes = 0) => hours * 60 + minutes;

let seq = 0;
function task(partial: Partial<SchedulableTask> = {}): SchedulableTask {
  seq += 1;
  return {
    id: partial.id ?? `t${seq}`,
    title: partial.title ?? `Task ${seq}`,
    priority: 2,
    estimateMin: 60,
    deadline: null,
    deadlineTime: null,
    energy: null,
    status: "todo",
    sortOrder: seq,
    createdAt: `2026-10-01T00:00:${String(seq % 60).padStart(2, "0")}`,
    ...partial,
  };
}

function prefs(p: Partial<Preferences> = {}): Preferences {
  return { ...DEFAULT_PREFERENCES, bufferMin: 0, breakAfterMin: 0, ...p };
}

function input(p: Partial<ScheduleInput>): ScheduleInput {
  return {
    date: DATE,
    today: DATE,
    nowMin: null,
    prefs: prefs(),
    busy: [],
    tasks: [],
    ...p,
  };
}

const commitment = (start: number, end: number, title = "Meeting"): BusyBlock => ({
  start,
  end,
  title,
  kind: "commitment",
});

function taskBlocks(result: ReturnType<typeof schedule>) {
  return result.blocks.filter((b) => b.kind === "task");
}

describe("schedule — time constraints", () => {
  it("never overlaps commitments or other tasks", () => {
    const busy = [commitment(h(10), h(11)), commitment(h(13), h(14), "Lunch"), commitment(h(15, 30), h(16))];
    const tasks = Array.from({ length: 8 }, (_, i) => task({ estimateMin: 30 + i * 10, priority: ((i % 4) + 1) as 1 }));
    const result = schedule(input({ busy, tasks, prefs: prefs({ bufferMin: 5, breakAfterMin: 90 }) }));
    expect(findOverlaps(result.blocks, busy)).toEqual([]);
    for (const b of result.blocks) {
      expect(b.start).toBeGreaterThanOrEqual(h(9));
      expect(b.end).toBeLessThanOrEqual(h(18));
    }
  });

  it("keeps the configured buffer between consecutive tasks", () => {
    const tasks = [task({ estimateMin: 30 }), task({ estimateMin: 30 }), task({ estimateMin: 30 })];
    const result = schedule(input({ tasks, prefs: prefs({ bufferMin: 10 }) }));
    const blocks = taskBlocks(result);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].start - blocks[i - 1].end).toBeGreaterThanOrEqual(10);
    }
  });

  it("does not schedule anything before the current time on today", () => {
    const result = schedule(input({ nowMin: h(13, 7), tasks: [task(), task()] }));
    expect(result.window).toEqual({ start: h(13, 10), end: h(18) });
    for (const b of result.blocks) expect(b.start).toBeGreaterThanOrEqual(h(13, 10));
  });

  it("plans future days from the start of working hours regardless of the clock", () => {
    const result = schedule(input({ date: "2026-11-03", nowMin: h(16), tasks: [task()] }));
    expect(result.blocks[0].start).toBe(h(9));
  });

  it("respects kept blocks (pinned / in progress) as busy time", () => {
    const pinned: BusyBlock = { start: h(9), end: h(10), title: "Pinned", kind: "task", taskId: "p", state: "planned" };
    const result = schedule(input({ busy: [pinned], tasks: [task({ estimateMin: 45 })] }));
    expect(result.blocks[0].start).toBe(h(10));
  });

  it("does not double-schedule minutes already covered by a kept block of the same task", () => {
    const t = task({ id: "split", estimateMin: 120 });
    const kept: BusyBlock = { start: h(9), end: h(10), title: "Part 1", kind: "task", taskId: "split", state: "planned" };
    const result = schedule(input({ busy: [kept], tasks: [t] }));
    expect(taskBlocks(result)).toHaveLength(1);
    expect(taskBlocks(result)[0].end - taskBlocks(result)[0].start).toBe(60);
  });

  it("accounts for minutes already completed in earlier sessions", () => {
    const result = schedule(input({ tasks: [task({ estimateMin: 90, progressMin: 60 })] }));
    expect(result.blocks[0].end - result.blocks[0].start).toBe(30);
  });

  it("inserts a break after long continuous work", () => {
    const tasks = [task({ estimateMin: 60 }), task({ estimateMin: 60 }), task({ estimateMin: 60 })];
    const result = schedule(input({ tasks, prefs: prefs({ breakAfterMin: 90, breakLengthMin: 15 }) }));
    const breaks = result.blocks.filter((b) => b.kind === "break");
    expect(breaks.length).toBeGreaterThanOrEqual(1);
    // No continuous run of task blocks longer than 90 minutes.
    let run = 0;
    let lastEnd = -1;
    for (const b of result.blocks) {
      if (b.kind === "break") {
        run = 0;
        lastEnd = b.end;
        continue;
      }
      run = b.start === lastEnd ? run + (b.end - b.start) : b.end - b.start;
      lastEnd = b.end;
      expect(run).toBeLessThanOrEqual(90);
    }
    expect(findOverlaps(result.blocks)).toEqual([]);
  });
});

describe("schedule — prioritisation", () => {
  it("orders by urgency and priority deterministically", () => {
    const low = task({ id: "low", priority: 1 });
    const critical = task({ id: "critical", priority: 4 });
    const dueToday = task({ id: "dueToday", priority: 2, deadline: DATE });
    const ranked = rankTasks([low, critical, dueToday], DATE).map((t) => t.id);
    expect(ranked).toEqual(["dueToday", "critical", "low"]);
    // Same input → same output.
    const a = schedule(input({ tasks: [low, critical, dueToday] }));
    const b = schedule(input({ tasks: [dueToday, low, critical] }));
    expect(a.blocks).toEqual(b.blocks);
  });

  it("places deep-focus work in focus hours and low-energy work outside them", () => {
    const deep = task({ id: "deep", energy: "high", priority: 2 });
    const light = task({ id: "light", energy: "low", priority: 4 });
    const result = schedule(
      input({ tasks: [deep, light], prefs: prefs({ focusStart: h(9), focusEnd: h(12) }) }),
    );
    const byId = Object.fromEntries(result.blocks.map((b) => [b.taskId, b]));
    expect(byId.deep.start).toBeGreaterThanOrEqual(h(9));
    expect(byId.deep.end).toBeLessThanOrEqual(h(12));
    expect(byId.light.start).toBeGreaterThanOrEqual(h(12));
    expect(explain(byId.deep.reason)).toMatch(/focus hours/);
    expect(explain(byId.light.reason)).toMatch(/outside your focus hours/);
  });

  it("does not say 'today' when planning another day", () => {
    const result = schedule(input({ date: "2026-11-03", tasks: [task({ deadline: "2026-11-03" })] }));
    expect(explain(result.blocks[0].reason)).toMatch(/due that day/i);
    expect(explain(result.blocks[0].reason)).not.toMatch(/today/);
  });

  it("explains every scheduled block", () => {
    const result = schedule(input({ tasks: [task(), task({ priority: 4, deadline: "2026-11-03" })] }));
    for (const b of result.blocks) expect(b.reason.length).toBeGreaterThan(10);
    expect(explain(result.blocks[0].reason)).toMatch(/Critical priority, due tomorrow/);
  });
});

describe("schedule — deadlines", () => {
  it("schedules overdue tasks first and says the deadline passed", () => {
    const overdue = task({ id: "overdue", priority: 1, deadline: "2026-10-30" });
    const normal = task({ id: "normal", priority: 3 });
    const result = schedule(input({ tasks: [normal, overdue] }));
    expect(result.blocks[0].taskId).toBe("overdue");
    expect(explain(result.blocks[0].reason)).toMatch(/deadline passed on/i);
  });

  it("finishes a same-day task before its deadline time when possible", () => {
    const due = task({ id: "due", estimateMin: 60, deadline: DATE, deadlineTime: h(11) });
    const result = schedule(input({ busy: [commitment(h(9), h(9, 30))], tasks: [due] }));
    expect(result.blocks[0].end).toBeLessThanOrEqual(h(11));
  });

  it("warns instead of silently dropping when a same-day deadline cannot be met", () => {
    const due = task({ id: "due", estimateMin: 60, deadline: DATE, deadlineTime: h(10) });
    const result = schedule(input({ nowMin: h(9, 30), tasks: [due] }));
    expect(result.blocks[0].start).toBe(h(9, 30));
    expect(explain(result.blocks[0].reason)).toMatch(/after its 10:00 deadline/);
  });

  it("marks urgent tasks that cannot fit at all as deadline_unreachable", () => {
    const due = task({ id: "due", estimateMin: 120, deadline: DATE });
    const result = schedule(input({ nowMin: h(17), tasks: [due], prefs: prefs({ minSessionMin: 90 }) }));
    expect(result.blocks).toHaveLength(0);
    expect(result.unscheduled[0]).toMatchObject({ taskId: "due", reason: "deadline_unreachable" });
  });
});

describe("schedule — insufficient time", () => {
  it("keeps tasks that do not fit in the backlog with a reason", () => {
    const tasks = [task({ id: "a", estimateMin: 240 }), task({ id: "b", estimateMin: 240 }), task({ id: "c", estimateMin: 240 })];
    const result = schedule(input({ tasks, prefs: prefs({ minSessionMin: 300 }) }));
    const scheduledIds = new Set(result.blocks.map((b) => b.taskId));
    const unscheduledIds = result.unscheduled.map((u) => u.taskId);
    for (const t of tasks) expect(scheduledIds.has(t.id) || unscheduledIds.includes(t.id)).toBe(true);
    expect(result.unscheduled.find((u) => u.taskId === "c")?.reason).toBe("no_time");
    expect(explain(result.unscheduled[0].message)).toMatch(/only 1h of free time remains/);
  });

  it("returns everything as unscheduled once the working day is over", () => {
    const result = schedule(input({ nowMin: h(19), tasks: [task({ id: "x" })] }));
    expect(result.window).toBeNull();
    expect(result.unscheduled).toEqual([
      expect.objectContaining({ taskId: "x", reason: "day_over" }),
    ]);
  });

  it("refuses to plan days in the past", () => {
    const result = schedule(input({ date: "2026-11-01", tasks: [task({ id: "x" })] }));
    expect(result.unscheduled[0].reason).toBe("day_over");
  });

  it("reports empty working hours clearly", () => {
    const result = schedule(input({ tasks: [task()], prefs: prefs({ workStart: h(10), workEnd: h(10) }) }));
    expect(result.unscheduled[0].reason).toBe("no_working_hours");
  });

  it("splits a task longer than any free gap into sessions", () => {
    const busy = [commitment(h(11), h(12)), commitment(h(14), h(15))];
    const long = task({ id: "long", estimateMin: 240 });
    const result = schedule(input({ busy, tasks: [long] }));
    const parts = taskBlocks(result);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.reduce((s, b) => s + (b.end - b.start), 0)).toBe(240);
    expect(parts.every((p) => p.partCount === parts.length)).toBe(true);
    expect(explain(parts[0].reason)).toMatch(/Session 1 of/);
    expect(findOverlaps(parts, busy)).toEqual([]);
  });

  it("partially schedules a task longer than the remaining day and reports the rest", () => {
    const long = task({ id: "long", estimateMin: 300 });
    const result = schedule(input({ nowMin: h(16), tasks: [long] }));
    const placed = taskBlocks(result).reduce((s, b) => s + (b.end - b.start), 0);
    expect(placed).toBe(120);
    expect(result.unscheduled[0]).toMatchObject({ taskId: "long", remainingMin: 180 });
  });

  it("does not create sessions shorter than the minimum session length", () => {
    const busy = [commitment(h(9, 20), h(18))];
    const result = schedule(input({ busy, tasks: [task({ estimateMin: 60 })], prefs: prefs({ minSessionMin: 25 }) }));
    expect(result.blocks).toHaveLength(0);
    expect(result.unscheduled[0].reason).toBe("no_time");
  });

  it("keeps skipped tasks out of today's plan with a note", () => {
    const result = schedule(input({ tasks: [task({ id: "s" })], skippedToday: ["s"] }));
    expect(result.blocks).toHaveLength(0);
    expect(result.unscheduled[0].reason).toBe("skipped_today");
  });

  it("ignores completed and skipped tasks", () => {
    const result = schedule(input({ tasks: [task({ status: "done" }), task({ status: "skipped" })] }));
    expect(result.blocks).toHaveLength(0);
    expect(result.unscheduled).toHaveLength(0);
  });
});

describe("schedule — rescheduling", () => {
  it("moves remaining tasks later when a task overruns and explains why", () => {
    // Original plan: A 9:00–10:00, B 10:00–11:00.
    const a = task({ id: "A", priority: 4 });
    const b = task({ id: "B", priority: 3 });
    const first = schedule(input({ tasks: [a, b] }));
    const prevB = first.blocks.find((x) => x.taskId === "B")!;
    expect(prevB.start).toBe(h(10));

    // A ran 30 min over and is now kept until 10:30; replan the rest at 10:30.
    const kept: BusyBlock = { start: h(9), end: h(10, 30), title: "A", kind: "task", taskId: "A", state: "in_progress" };
    const second = schedule(
      input({
        nowMin: h(10, 30),
        busy: [kept],
        tasks: [{ ...a, status: "in_progress" }, b],
        previousStarts: { B: prevB.start },
        trigger: "“A” ran 30 min over",
      }),
    );
    const newB = second.blocks.find((x) => x.taskId === "B")!;
    expect(newB.start).toBe(h(10, 30));
    expect(explain(newB.reason)).toMatch(/Moved from 10:00 to 10:30 because “A” ran 30 min over/);
    expect(second.blocks.some((x) => x.taskId === "A")).toBe(false);
  });

  it("moves tasks to the backlog when a new commitment leaves no room", () => {
    const t = task({ id: "T", estimateMin: 120 });
    const first = schedule(input({ nowMin: h(15), tasks: [t], prefs: prefs({ minSessionMin: 120 }) }));
    expect(first.blocks[0].start).toBe(h(15));
    const second = schedule(
      input({
        nowMin: h(15),
        busy: [commitment(h(15, 30), h(17))],
        tasks: [t],
        prefs: prefs({ minSessionMin: 120 }),
        previousStarts: { T: h(15) },
        trigger: "“Call” was added at 15:30",
      }),
    );
    expect(second.blocks).toHaveLength(0);
    expect(explain(second.unscheduled[0].message)).toMatch(/^Moved to the backlog because “Call” was added/);
  });
});

describe("manual adjustment helpers", () => {
  it("finds the nearest valid start around busy time", () => {
    const busy = [{ start: h(10), end: h(11) }];
    expect(nearestFreeStart(h(10, 15), 30, busy)).toBe(h(9, 30));
    expect(nearestFreeStart(h(10, 45), 30, busy)).toBe(h(11));
    expect(nearestFreeStart(h(12), 30, busy)).toBe(h(12));
  });

  it("returns null when nothing fits", () => {
    expect(nearestFreeStart(h(9), 60, [{ start: 0, end: 24 * 60 }])).toBeNull();
  });
});
