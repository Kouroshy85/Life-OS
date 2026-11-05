import { describe, expect, it } from "vitest";
import { overlaps } from "../../domain/intervals";
import { occursOn } from "../../domain/plans";
import { createMemoryDriver } from "../../persistence/sqljsDriver";
import { migrate } from "../../persistence/migrations";
import { Repository } from "../../persistence/repository";
import { changeSetStatements } from "./apply";
import { block, CLOCK, sampleState } from "./fixtures";
import type { ResolvedOperation } from "./parse";
import { buildChangeSet, fingerprint, isStale, type ChangeSet } from "./proposals";

const build = (ops: ResolvedOperation[], state = sampleState()) => buildChangeSet(ops, state, CLOCK, { summary: "test", model: "Qwen3.5-2B" });

const goalOp = (extra: Partial<Extract<ResolvedOperation, { type: "create_goal" }>> = {}): ResolvedOperation => ({
  type: "create_goal",
  title: "Run a 10K",
  description: "",
  targetDate: null,
  hoursPerWeek: 3,
  milestones: [
    {
      title: "Base fitness",
      description: "",
      deadline: null,
      tasks: [
        { title: "Run 3 km easy", notes: "", estimateMin: 30, priority: 2, energy: "medium", deadline: null },
        { title: "Run 5 km easy", notes: "", estimateMin: 40, priority: 2, energy: null, deadline: null },
      ],
    },
  ],
  ...extra,
});

describe("building proposals", () => {
  it("turns a goal draft into a model-labelled plan with sessions from the planner, never the model", () => {
    const state = sampleState();
    const cs = build([goalOp()], state);
    const item = cs.items[0];
    expect(item.kind).toBe("goal");
    if (item.kind !== "goal") return;
    expect(item.plan.source).toBe("ai");
    expect(item.plan.model).toBe("Qwen3.5-2B");
    expect(item.placedMin).toBe(180);
    // Every session sits in free time: never on the gym routine.
    for (const s of item.sessions) {
      const gym = state.plans[0];
      const day = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"].find((d) => new Date(`${d}T12:00`).getDay() === s.weekday)!;
      if (occursOn(gym, day)) expect(overlaps(gym, s)).toBe(false);
    }
  });

  it("warns when a study plan can't fit before the exam", () => {
    const op = goalOp({ title: "Pass the exam", targetDate: "2026-11-07", hoursPerWeek: 1 });
    if (op.type === "create_goal") op.milestones[0].tasks = Array.from({ length: 10 }, (_, i) => ({ title: `Chapter ${i + 1}`, notes: "", estimateMin: 240, priority: 3, energy: "high", deadline: null }));
    const cs = build([op]);
    expect(cs.warnings.join(" ")).toMatch(/more work than fits/);
  });

  it("adds milestones and tasks only to goals that exist", () => {
    const cs = build([
      { type: "create_milestone", goalId: "goal-ielts", title: "Reading", description: "", deadline: "2026-12-01", tasks: [] },
      { type: "create_milestone", goalId: "nope", title: "Ghost", description: "", deadline: null, tasks: [] },
      { type: "create_task", parent: { kind: "milestone", id: "ms-listening" }, task: { title: "Shadow a podcast", notes: "", estimateMin: 25, priority: 2, energy: null, deadline: null } },
    ]);
    expect(cs.items.map((i) => i.kind)).toEqual(["milestone", "task"]);
    expect(cs.rejected[0].code).toBe("unknown_ref");
  });

  it("never edits completed or started tasks", () => {
    const cs = build([
      { type: "update_task", taskId: "task-done", changes: { title: "Rebook" } },
      { type: "update_task", taskId: "task-started", changes: { estimateMin: 30 } },
      { type: "update_task", taskId: "task-vocab", changes: { estimateMin: 45 } },
    ]);
    expect(cs.rejected.map((r) => r.code)).toEqual(["protected_task", "protected_task"]);
    expect(cs.items).toHaveLength(1);
    expect(cs.items[0]).toMatchObject({ kind: "task_update", before: { estimateMin: 30 }, after: { estimateMin: 45 } });
    expect(cs.touchesExisting).toBe(true);
  });

  it("plans the week around commitments, pinned and finished blocks, without overlaps", () => {
    const state = sampleState({
      blocks: [
        block("blk-pinned", "task-pinned", "2026-11-06", 10 * 60, 10 * 60 + 30, { pinned: true }),
        block("blk-done", "task-done", "2026-11-05", 9 * 60, 10 * 60, { state: "done" }),
      ],
    });
    const cs = build([{ type: "propose_weekly_schedule", week: "this", taskIds: ["task-listen", "task-vocab"], timeOfDay: "any", days: [] }], state);
    const item = cs.items[0];
    expect(item.kind).toBe("week");
    if (item.kind !== "week") return;
    const placed = item.days.flatMap((d) => d.blocks.map((b) => ({ ...b })));
    expect(placed.filter((b) => b.kind === "task").length).toBeGreaterThan(0);
    for (const b of placed) {
      for (const existing of state.blocks.filter((x) => x.date === b.date)) expect(overlaps(b, existing)).toBe(false);
      const gym = state.plans[0];
      if (occursOn(gym, b.date)) expect(overlaps(b, gym)).toBe(false);
      expect(b.date >= CLOCK.today).toBe(true);
    }
    // Nothing already there is moved.
    expect(cs.touchesExisting).toBe(false);
  });

  it("reports work that doesn't fit instead of forcing it in", () => {
    const state = sampleState();
    state.tasks = state.tasks.map((x) => (x.id === "task-listen" ? { ...x, estimateMin: 480 } : x));
    // Only Saturday, evening only: not enough room for a full working day of study.
    const cs = build([{ type: "propose_weekly_schedule", week: "this", taskIds: ["task-listen"], timeOfDay: "evening", days: [6] }], state);
    const item = cs.items.find((i) => i.kind === "week");
    expect(item?.kind === "week" && item.unscheduled.length).toBe(1);
    expect(cs.warnings.join(" ")).toMatch(/didn't fit/);
  });

  it("won't move a block the user placed or one that's in progress", () => {
    const state = sampleState({
      blocks: [
        block("blk-pinned", "task-pinned", "2026-11-06", 600, 630, { pinned: true }),
        block("blk-started", "task-started", "2026-11-05", 540, 600, { state: "in_progress" }),
      ],
    });
    const cs = build(
      [
        { type: "propose_reschedule", taskId: "task-pinned", targetDate: "2026-11-07", timeOfDay: "any" },
        { type: "propose_reschedule", taskId: "task-started", targetDate: "2026-11-07", timeOfDay: "any" },
      ],
      state,
    );
    expect(cs.rejected.map((r) => r.code)).toEqual(["pinned_block", "started_block"]);
    expect(cs.items).toHaveLength(0);
  });

  it("moves an engine-placed session to a free slot chosen by the scheduler", () => {
    const state = sampleState({ blocks: [block("blk-listen", "task-listen", "2026-11-05", 900, 960)] });
    const cs = build([{ type: "propose_reschedule", taskId: "task-listen", targetDate: "2026-11-06", timeOfDay: "morning" }], state);
    const item = cs.items[0];
    expect(item.kind).toBe("reschedule");
    if (item.kind !== "reschedule") return;
    expect(item.from).toEqual([{ date: "2026-11-05", start: 900, end: 960 }]);
    const moved = item.to.find((b) => b.kind === "task")!;
    expect(moved.date).toBe("2026-11-06");
    expect(moved.pinned).toBe(true);
    expect(moved.start).toBeLessThan(12 * 60);
    expect(cs.touchesExisting).toBe(true);
  });

  it("notices when the data changed after the preview was made", () => {
    const state = sampleState();
    const cs = build([goalOp()], state);
    expect(isStale(cs, state)).toBe(false);
    const moved = { ...state, blocks: state.blocks.map((b) => ({ ...b, start: b.start + 30, end: b.end + 30 })) };
    expect(isStale(cs, moved)).toBe(true);
    expect(fingerprint(moved)).not.toBe(cs.fingerprint);
  });
});

async function repoWithSample() {
  const driver = await createMemoryDriver();
  await migrate(driver);
  const repo = new Repository(driver);
  const { goalId, statements } = repo.goalPlanStatements({
    title: "IELTS",
    description: "",
    targetDate: "2026-12-20",
    milestones: [{ title: "Listening", description: "", deadline: null, projects: [{ title: "Tasks", tasks: [{ title: "Practise a listening test", notes: "", priority: 3, estimateMin: 60, energy: null, deadline: null }] }] }],
    source: "manual",
    model: null,
    archetype: "",
    notes: [],
  });
  await repo.run(statements);
  return { driver, repo, goalId };
}

describe("applying proposals", () => {
  it("saves a goal with its sessions, a milestone and a task in one go", async () => {
    const { repo, goalId } = await repoWithSample();
    const snap = await repo.loadSnapshot();
    const state = { ...snap, commitments: snap.commitments };
    const cs: ChangeSet = buildChangeSet(
      [
        goalOp(),
        { type: "create_milestone", goalId, title: "Reading", description: "", deadline: null, tasks: [{ title: "Skim an article", notes: "", estimateMin: 20, priority: 2, energy: null, deadline: null }] },
        { type: "create_task", parent: null, task: { title: "Buy running shoes", notes: "", estimateMin: 45, priority: 2, energy: null, deadline: null } },
      ],
      state,
      CLOCK,
      { summary: "", model: "Qwen3.5-2B" },
    );
    const { statements, counts } = changeSetStatements(repo, cs, state, CLOCK.today);
    await repo.run(statements);
    const after = await repo.loadSnapshot();
    const run = after.goals.find((g) => g.title === "Run a 10K")!;
    expect(run.source).toBe("ai");
    expect(run.sourceModel).toBe("Qwen3.5-2B");
    expect(after.plans.filter((p) => p.goalId === run.id).length).toBe(counts.sessions);
    expect(after.milestones.some((m) => m.title === "Reading" && m.goalId === goalId)).toBe(true);
    expect(after.tasks.find((x) => x.title === "Buy running shoes")?.inPlanner).toBe(true);
    expect(counts.goals).toEqual(["Run a 10K"]);
  });

  it("saves nothing at all when any part fails", async () => {
    const { repo } = await repoWithSample();
    const before = await repo.loadSnapshot();
    const state = { ...before };
    const cs = buildChangeSet([goalOp()], state, CLOCK, { summary: "", model: "m" });
    const { statements } = changeSetStatements(repo, cs, state, CLOCK.today);
    // A broken last statement stands in for a disk or constraint failure.
    await expect(repo.run([...statements, { sql: "INSERT INTO goals (id) VALUES (NULL)" }])).rejects.toThrow();
    const after = await repo.loadSnapshot();
    expect(after.goals.length).toBe(before.goals.length);
    expect(after.plans.length).toBe(before.plans.length);
    expect(after.tasks.length).toBe(before.tasks.length);
  });

  it("writes nothing while a proposal is only being previewed or is cancelled", async () => {
    const { repo } = await repoWithSample();
    const before = await repo.loadSnapshot();
    buildChangeSet([goalOp()], { ...before }, CLOCK, { summary: "", model: "m" });
    const after = await repo.loadSnapshot();
    expect(after.goals.length).toBe(before.goals.length);
  });
});
