import { beforeEach, describe, expect, it } from "vitest";
import { compileGoal } from "../domain/goalCompiler";
import { planRevision } from "../domain/revision";
import type { SqlDriver } from "./driver";
import { currentVersion, LATEST_VERSION, migrate } from "./migrations";
import { makeTask, Repository } from "./repository";
import { createMemoryDriver } from "./sqljsDriver";

let driver: SqlDriver;
let repo: Repository;

beforeEach(async () => {
  driver = await createMemoryDriver();
  await migrate(driver);
  repo = new Repository(driver);
});

describe("migrations", () => {
  it("brings a fresh database to the latest version and is idempotent", async () => {
    expect(await currentVersion(driver)).toBe(LATEST_VERSION);
    const again = await migrate(driver);
    expect(again).toEqual({ from: LATEST_VERSION, to: LATEST_VERSION });
  });

  it("refuses databases from a newer app version", async () => {
    await driver.execute(`PRAGMA user_version = ${LATEST_VERSION + 1}`);
    await expect(migrate(driver)).rejects.toThrow(/newer version/);
  });

  it("enforces constraints at the database level", async () => {
    await expect(repo.createTask(makeTask({ title: "x", priority: 9 as never }))).rejects.toThrow();
    await expect(repo.createTask(makeTask({ title: "x", estimateMin: 0 }))).rejects.toThrow();
  });
});

describe("repository", () => {
  it("round-trips a compiled goal with its full hierarchy", async () => {
    const plan = compileGoal({ text: "Run a half marathon", targetDate: null, hoursPerWeek: 4, today: "2026-11-02" });
    const goalId = await repo.createGoalFromPlan(plan);
    const snap = await repo.loadSnapshot();
    expect(snap.goals).toHaveLength(1);
    expect(snap.goals[0]).toMatchObject({ id: goalId, source: "template", sourceModel: null });
    expect(snap.milestones).toHaveLength(plan.milestones.length);
    const taskCount = plan.milestones.reduce((s, m) => s + m.projects.reduce((s2, p) => s2 + p.tasks.length, 0), 0);
    expect(snap.tasks).toHaveLength(taskCount);
    expect(snap.tasks.every((t) => t.origin === "generated" && t.goalId === goalId)).toBe(true);
  });

  it("cascades deletes from goals to tasks and blocks", async () => {
    const goalId = await repo.createGoalFromPlan(compileGoal({ text: "Learn Spanish", targetDate: null, hoursPerWeek: 4, today: "2026-11-02" }));
    const snap = await repo.loadSnapshot();
    const t = snap.tasks[0];
    await repo.run([
      repo.blockInsert({
        id: "b1", date: "2026-11-02", taskId: t.id, kind: "task", start: 540, end: 600, state: "planned",
        proposed: false, pinned: false, part: 1, partCount: 1, reason: "", createdAt: "x",
      }),
    ]);
    await repo.deleteGoal(goalId);
    const after = await repo.loadSnapshot();
    expect(after.tasks).toHaveLength(0);
    expect(after.blocks).toHaveLength(0);
    expect(after.milestones).toHaveLength(0);
  });

  it("rolls back a failing batch completely", async () => {
    const t = makeTask({ title: "Keep me" });
    await expect(
      repo.run([
        { sql: "INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", params: [t.id, t.title, "x", "x"] },
        { sql: "INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", params: [t.id, "duplicate", "x", "x"] },
      ]),
    ).rejects.toThrow();
    expect((await repo.loadSnapshot()).tasks).toHaveLength(0);
  });

  it("revises a goal without losing completed progress", async () => {
    const goalId = await repo.createGoalFromPlan(compileGoal({ text: "Prepare for my exams", targetDate: null, hoursPerWeek: 5, today: "2026-11-02" }));
    let snap = await repo.loadSnapshot();
    const done = snap.tasks[0];
    await repo.updateTask(done.id, { status: "done", completedAt: "2026-11-02T10:00:00Z" });
    snap = await repo.loadSnapshot();
    const next = compileGoal({ text: "Prepare for my exams", targetDate: "2026-12-20", hoursPerWeek: 8, today: "2026-11-02" });
    const rev = planRevision(
      { milestones: snap.milestones, projects: snap.projects, tasks: snap.tasks, scheduledTaskIds: new Set() },
      next,
    );
    await repo.reviseGoal(goalId, rev, next);
    const after = await repo.loadSnapshot();
    expect(after.tasks.find((t) => t.id === done.id)?.status).toBe("done");
    expect(after.goals[0].revision).toBe(2);
    // No task lost its milestone / project.
    const mIds = new Set(after.milestones.map((m) => m.id));
    const pIds = new Set(after.projects.map((p) => p.id));
    expect(after.tasks.every((t) => mIds.has(t.milestoneId!) && pIds.has(t.projectId!))).toBe(true);
    // The completed task is not duplicated by the new plan.
    expect(after.tasks.filter((t) => t.title === done.title)).toHaveLength(1);
  });

  it("prunes automatic breaks whose following task has gone", async () => {
    const t = makeTask({ title: "After break" });
    await repo.createTask(t);
    const block = { date: "2026-11-02", proposed: false, pinned: false, part: 1, partCount: 1, reason: "", createdAt: "x", state: "planned" as const };
    await repo.run([
      repo.blockInsert({ ...block, id: "brk", taskId: null, kind: "break", start: 600, end: 615 }),
      repo.blockInsert({ ...block, id: "tsk", taskId: t.id, kind: "task", start: 615, end: 660 }),
    ]);
    await repo.pruneOrphanBreaks();
    expect((await repo.loadSnapshot()).blocks).toHaveLength(2);
    await repo.deleteTask(t.id);
    await repo.pruneOrphanBreaks();
    expect((await repo.loadSnapshot()).blocks).toHaveLength(0);
  });

  it("persists preferences, AI settings and flags", async () => {
    const snap0 = await repo.loadSnapshot();
    await repo.savePreferences({ ...snap0.prefs, workStart: 480 });
    await repo.saveAi({ provider: "anthropic", apiKey: "k", model: "claude-opus-5-5" });
    await repo.setFlag("welcomeDismissed", "1");
    const snap = await repo.loadSnapshot();
    expect(snap.prefs.workStart).toBe(480);
    expect(snap.ai.provider).toBe("anthropic");
    expect(snap.flags.welcomeDismissed).toBe("1");
  });

  it("removes only sample data", async () => {
    await repo.createGoalFromPlan(compileGoal({ text: "Learn Go", targetDate: null, hoursPerWeek: 4, today: "2026-11-02" }), { isSample: true });
    await repo.createGoalFromPlan(compileGoal({ text: "Learn Rust", targetDate: null, hoursPerWeek: 4, today: "2026-11-02" }));
    await repo.createTask(makeTask({ title: "Mine" }));
    await repo.deleteSampleData();
    const snap = await repo.loadSnapshot();
    expect(snap.goals.map((g) => g.title)).toEqual(["Learn Rust"]);
    expect(snap.tasks.some((t) => t.title === "Mine")).toBe(true);
  });
});
