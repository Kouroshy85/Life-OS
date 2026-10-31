import { describe, expect, it } from "vitest";
import { explain } from "../i18n";
import { findOverlaps } from "../domain/scheduler";
import { DEFAULT_PREFERENCES, type Commitment, type ScheduleBlock, type Task } from "../domain/types";
import { makeTask } from "../persistence/repository";
import { acceptChanges, commitmentsOn, proposePlan, reflowDay, unplannedMinutes, validateMove, type PlanningState } from "./planning";

const DATE = "2026-11-02"; // a Monday
const clock = { today: DATE, nowMin: 8 * 60 };

function state(tasks: Task[], extra: Partial<PlanningState> = {}): PlanningState {
  return {
    tasks,
    commitments: [],
    blocks: [],
    skips: {},
    prefs: { ...DEFAULT_PREFERENCES, bufferMin: 0, breakAfterMin: 0 },
    ...extra,
  };
}

const commitment = (start: number, end: number, extra: Partial<Commitment> = {}): Commitment => ({
  id: `c${start}`,
  title: "Meeting",
  kind: "commitment",
  date: DATE,
  weekdays: 0,
  start,
  end,
  createdAt: "x",
  ...extra,
});

function apply(s: PlanningState, changes: { insert: ScheduleBlock[]; update: { id: string; patch: Partial<ScheduleBlock> }[]; remove: string[] }): PlanningState {
  const removed = new Set(changes.remove);
  const blocks = s.blocks
    .filter((b) => !removed.has(b.id))
    .map((b) => {
      const u = changes.update.find((x) => x.id === b.id);
      return u ? { ...b, ...u.patch } : b;
    });
  return { ...s, blocks: [...blocks, ...changes.insert] };
}

describe("planning service", () => {
  it("resolves recurring and one-off commitments for a date", () => {
    const list = [
      commitment(600, 630, { id: "weekly", date: null, weekdays: 1 << 1 }), // Mondays
      commitment(700, 730, { id: "other-day", date: "2026-11-03" }),
      commitment(800, 830, { id: "today" }),
    ];
    expect(commitmentsOn(DATE, list).map((c) => c.id)).toEqual(["weekly", "today"]);
  });

  it("only plans tasks that were sent to the planner", () => {
    const s = state([makeTask({ title: "Pool", inPlanner: true }), makeTask({ title: "Goal only" })]);
    const p = proposePlan(s, DATE, clock);
    expect(p.blocks.filter((b) => b.kind === "task")).toHaveLength(1);
  });

  it("proposals replace the old plan only on accept and never overlap kept blocks", () => {
    const a = makeTask({ title: "A", inPlanner: true, estimateMin: 60 });
    const b = makeTask({ title: "B", inPlanner: true, estimateMin: 60 });
    let s = state([a, b]);
    const first = proposePlan(s, DATE, clock);
    s = { ...s, blocks: first.blocks };
    s = apply(s, acceptChanges(s, DATE, clock));
    expect(s.blocks.every((x) => !x.proposed)).toBe(true);

    // Start A, then propose again: A's block is kept, B is re-proposed.
    s = { ...s, blocks: s.blocks.map((x) => (x.taskId === a.id ? { ...x, state: "in_progress" as const } : x)) };
    const second = proposePlan(s, DATE, clock);
    expect(second.blocks.some((x) => x.taskId === a.id)).toBe(false);
    s = { ...s, blocks: [...s.blocks, ...second.blocks] };
    s = apply(s, acceptChanges(s, DATE, clock));
    expect(findOverlaps(s.blocks.filter((x) => x.date === DATE))).toEqual([]);
    expect(s.blocks.filter((x) => x.taskId === b.id)).toHaveLength(1);
  });

  it("reflows the remaining plan after an overrun without overlaps", () => {
    const a = makeTask({ title: "A", inPlanner: true, estimateMin: 60, priority: 4 });
    const b = makeTask({ title: "B", inPlanner: true, estimateMin: 60, priority: 3 });
    const c = makeTask({ title: "C", inPlanner: true, estimateMin: 420, priority: 1 });
    let s = state([a, b, c], { prefs: { ...DEFAULT_PREFERENCES, bufferMin: 0, breakAfterMin: 0, minSessionMin: 420 } });
    const p = proposePlan(s, DATE, clock);
    s = apply({ ...s, blocks: p.blocks }, acceptChanges({ ...s, blocks: p.blocks }, DATE, clock));
    expect(s.blocks.find((x) => x.taskId === c.id)).toBeTruthy(); // 11:00–18:00 fills the day

    // A overruns by 30 min.
    s = { ...s, blocks: s.blocks.map((x) => (x.taskId === a.id ? { ...x, state: "in_progress" as const, end: x.end + 30 } : x)) };
    const rf = reflowDay(s, DATE, { today: DATE, nowMin: 10 * 60 + 30 }, "“A” ran 30m over");
    s = apply(s, rf.changes);
    const day = s.blocks.filter((x) => x.date === DATE);
    expect(findOverlaps(day)).toEqual([]);
    expect(explain(day.find((x) => x.taskId === b.id)!.reason)).toMatch(/Moved from 10:00 to 10:30 because “A” ran 30m over/);
    // C no longer fits in one sitting and minimum session is 7h → backlog with an explanation.
    expect(explain(rf.notes.find((n) => n.taskId === c.id)?.message)).toMatch(/Moved to the backlog because/);
  });

  it("moves a pinned block that collides with a new commitment", () => {
    const a = makeTask({ title: "A", inPlanner: true, estimateMin: 60 });
    const pinned: ScheduleBlock = {
      id: "p", date: DATE, taskId: a.id, kind: "task", start: 600, end: 660, state: "planned", proposed: false,
      pinned: true, part: 1, partCount: 1, reason: "", createdAt: "x",
    };
    const s = state([a], { blocks: [pinned], commitments: [commitment(570, 630)] });
    const rf = reflowDay(s, DATE, clock, "“Meeting” was added");
    const moved = rf.changes.insert.find((x) => x.taskId === a.id)!;
    expect(moved.start).toBeGreaterThanOrEqual(630);
  });

  it("snaps manual moves away from commitments instead of overlapping", () => {
    const a = makeTask({ title: "A", inPlanner: true, estimateMin: 60 });
    const block: ScheduleBlock = {
      id: "b", date: DATE, taskId: a.id, kind: "task", start: 540, end: 600, state: "planned", proposed: false,
      pinned: false, part: 1, partCount: 1, reason: "", createdAt: "x",
    };
    const s = state([a], { blocks: [block], commitments: [commitment(660, 720)] });
    const res = validateMove(s, "b", 690, 60);
    expect(res.snapped).toBe(true);
    expect(res.start === 600 || res.start === 720).toBe(true);
    expect(validateMove(s, "b", 780, 60)).toMatchObject({ start: 780, snapped: false });
  });

  const liveBlock = (id: string, taskId: string, date: string, start: number, end: number, extra: Partial<ScheduleBlock> = {}): ScheduleBlock => ({
    id, date, taskId, kind: "task", start, end, state: "planned", proposed: false, pinned: false, part: 1, partCount: 1, reason: "", createdAt: "x", ...extra,
  });

  it("does not schedule a task again when it is already planned on another day", () => {
    const a = makeTask({ title: "A", inPlanner: true, estimateMin: 60 });
    const s = state([a], { blocks: [liveBlock("elsewhere", a.id, "2026-11-03", 540, 600)] });
    expect(proposePlan(s, DATE, clock).blocks).toHaveLength(0);
    expect(unplannedMinutes(s, a, DATE, clock)).toBe(0);
  });

  it("only schedules the part of a task not yet covered on other days", () => {
    const a = makeTask({ title: "A", inPlanner: true, estimateMin: 90 });
    const s = state([a], { blocks: [liveBlock("elsewhere", a.id, "2026-11-03", 540, 600)] });
    const p = proposePlan(s, DATE, clock);
    expect(p.blocks[0].end - p.blocks[0].start).toBe(30);
  });

  it("ignores missed sessions on past days when working out what is left", () => {
    const a = makeTask({ title: "A", inPlanner: true, estimateMin: 60 });
    const s = state([a], { blocks: [liveBlock("missed", a.id, "2026-11-01", 540, 600)] });
    expect(unplannedMinutes(s, a, DATE, clock)).toBe(60);
  });

  it("keeps the remainder of a partly scheduled task visible", () => {
    const a = makeTask({ title: "A", inPlanner: true, estimateMin: 90 });
    const s = state([a], { blocks: [liveBlock("part", a.id, DATE, 540, 605)] });
    expect(unplannedMinutes(s, a, DATE, clock)).toBe(25);
  });

  it("moves a pinned block that an overrunning task now collides with", () => {
    const a = makeTask({ title: "A", inPlanner: true, estimateMin: 90, status: "in_progress" });
    const b = makeTask({ title: "B", inPlanner: true, estimateMin: 30 });
    const s = state([a, b], {
      blocks: [
        liveBlock("run", a.id, DATE, 540, 630, { state: "in_progress" }),
        liveBlock("pin", b.id, DATE, 600, 630, { pinned: true }),
      ],
    });
    const rf = reflowDay(s, DATE, clock, "“A” ran over");
    expect(rf.changes.remove).toContain("pin");
    const next = apply(s, rf.changes).blocks;
    expect(findOverlaps(next)).toEqual([]);
  });

  it("refuses to accept a proposal that a later commitment now overlaps", () => {
    const a = makeTask({ title: "A", inPlanner: true, estimateMin: 60 });
    const proposed = liveBlock("p", a.id, DATE, 540, 600, { proposed: true });
    const s = state([a], { blocks: [proposed], commitments: [commitment(570, 630)] });
    expect(() => acceptChanges(s, DATE, clock)).toThrow(/changed since/);
  });

  it("lets a proposed block be moved, but not onto kept work", () => {
    const a = makeTask({ title: "A", inPlanner: true, estimateMin: 60 });
    const b = makeTask({ title: "B", inPlanner: true, estimateMin: 60, status: "in_progress" });
    const s = state([a, b], {
      blocks: [
        liveBlock("p", a.id, DATE, 600, 660, { proposed: true }),
        liveBlock("run", b.id, DATE, 720, 780, { state: "in_progress" }),
        liveBlock("old", a.id, DATE, 800, 860),
      ],
    });
    expect(validateMove(s, "p", 900, 60)).toMatchObject({ start: 900, snapped: false });
    expect(validateMove(s, "p", 730, 60).snapped).toBe(true);
    // A live block the proposal will replace doesn't get in the way.
    expect(validateMove(s, "p", 800, 60)).toMatchObject({ start: 800, snapped: false });
  });
});
