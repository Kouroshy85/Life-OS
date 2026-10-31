import { beforeEach, describe, expect, it } from "vitest";
import { compileGoal } from "../domain/goalCompiler";
import { planRevision } from "../domain/revision";
import type { SqlDriver } from "./driver";
import { currentVersion, LATEST_VERSION, migrate, MIGRATIONS } from "./migrations";
import { makePlan, makeTask, Repository } from "./repository";
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

describe("upgrading from version 1", () => {
  it("turns old commitments into plans and keeps everything else", async () => {
    const old = await createMemoryDriver();
    await old.batch(MIGRATIONS[0].statements.map((sql) => ({ sql })));
    await old.execute("PRAGMA user_version = 1");
    await old.execute("INSERT INTO commitments (id, title, kind, date, weekdays, start_min, end_min, created_at) VALUES ('w', 'Lunch', 'break', NULL, 62, 750, 795, 'x')");
    await old.execute("INSERT INTO commitments (id, title, kind, date, weekdays, start_min, end_min, created_at) VALUES ('o', 'Dentist', 'commitment', '2026-11-03', 0, 840, 900, 'x')");
    await old.execute("INSERT INTO settings (key, value) VALUES ('flag.language', 'fa')");
    expect(await migrate(old)).toEqual({ from: 1, to: LATEST_VERSION });

    const snap = await new Repository(old).loadSnapshot();
    expect(snap.flags.language).toBe("fa");
    expect(snap.plans.find((p) => p.id === "w")).toMatchObject({ type: "default", weekdays: 62, dates: null, isBreak: true });
    expect(snap.plans.find((p) => p.id === "o")).toMatchObject({ type: "event", dates: ["2026-11-03"], isBreak: false });
    expect(snap.commitments).toHaveLength(2);
  });
});

describe("dreams, music and quotes", () => {
  it("saves and edits dreams, newest first", async () => {
    await repo.saveDream({ id: "a", title: "See Japan", body: "Spring", createdAt: "2026-01-01" });
    await repo.saveDream({ id: "b", title: "Write a book", body: "", createdAt: "2026-02-01" });
    await repo.saveDream({ id: "a", title: "See Japan", body: "In spring", createdAt: "2026-01-01" });
    const { dreams } = await repo.loadSnapshot();
    expect(dreams.map((d) => d.id)).toEqual(["b", "a"]);
    expect(dreams[1].body).toBe("In spring");
    await repo.deleteDream("a");
    expect((await repo.loadSnapshot()).dreams).toHaveLength(1);
  });

  it("removes a playlist's songs with it", async () => {
    await repo.savePlaylist({ id: "p", name: "Focus", icon: "moon", createdAt: "x" });
    await repo.saveSong({ id: "s", playlistId: "p", title: "Rain", artist: "", ext: "mp3", sizeBytes: 10, durationSec: 60.5, sortOrder: 0, createdAt: "x" });
    let snap = await repo.loadSnapshot();
    expect(snap.songs[0]).toMatchObject({ title: "Rain", durationSec: 60.5, ext: "mp3" });
    await repo.deletePlaylist("p");
    snap = await repo.loadSnapshot();
    expect(snap.playlists).toHaveLength(0);
    expect(snap.songs).toHaveLength(0);
  });

  it("swaps a goal's sessions atomically and leaves other plans alone", async () => {
    const goalId = await repo.createGoalFromPlan(compileGoal({ text: "Learn Go", targetDate: null, hoursPerWeek: 4, today: "2026-11-02" }));
    const other = makePlan({ type: "default", title: "Work", weekdays: 2, start: 540, end: 600 });
    await repo.run([repo.planUpsert(other), repo.planUpsert(makePlan({ type: "goal", title: "Go", goalId, weekdays: 4, start: 600, end: 660 }))]);
    const next = makePlan({ type: "goal", title: "Go", goalId, weekdays: 8, start: 700, end: 760 });
    await repo.replaceGoalSessions(goalId, [next]);
    let plans = (await repo.loadSnapshot()).plans;
    expect(plans.map((p) => p.id).sort()).toEqual([other.id, next.id].sort());

    // A bad new session rolls back: the old ones must survive.
    await expect(repo.replaceGoalSessions(goalId, [makePlan({ type: "goal", title: "Go", goalId, weekdays: 8, start: 800, end: 700 })])).rejects.toThrow();
    plans = (await repo.loadSnapshot()).plans;
    expect(plans.some((p) => p.id === next.id)).toBe(true);
  });

  it("clears everything on reset", async () => {
    await repo.savePlaylist({ id: "p", name: "Focus", icon: "moon", createdAt: "x" });
    await repo.saveQuote({ id: "q", text: "Breathe", createdAt: "x" });
    await repo.saveDream({ id: "d", title: "Fly", body: "", createdAt: "x" });
    await repo.resetAll();
    const snap = await repo.loadSnapshot();
    expect([snap.playlists.length, snap.userQuotes.length, snap.dreams.length]).toEqual([0, 0, 0]);
  });
});

describe("plans and notes", () => {
  it("round-trips a plan and edits it in place", async () => {
    const plan = makePlan({ type: "default", title: "Work", description: "Office", weekdays: 62, validFrom: "2026-11-01", start: 540, end: 1020 });
    await repo.run([repo.planUpsert(plan)]);
    await repo.run([repo.planUpsert({ ...plan, title: "Remote work", start: 600 })]);
    const snap = await repo.loadSnapshot();
    expect(snap.plans).toHaveLength(1);
    expect(snap.plans[0]).toMatchObject({ id: plan.id, title: "Remote work", start: 600, description: "Office", validFrom: "2026-11-01" });
    await repo.deletePlan(plan.id);
    expect((await repo.loadSnapshot()).plans).toHaveLength(0);
  });

  it("rejects impossible plans at the database level", async () => {
    await expect(repo.run([repo.planUpsert(makePlan({ type: "default", title: "X", weekdays: 1, start: 600, end: 500 }))])).rejects.toThrow();
    await expect(repo.run([repo.planUpsert(makePlan({ type: "default", title: "X", weekdays: 0, start: 500, end: 600 }))])).rejects.toThrow();
  });

  it("removes a goal's sessions along with the goal", async () => {
    const goalId = await repo.createGoalFromPlan(compileGoal({ text: "Learn Go", targetDate: null, hoursPerWeek: 4, today: "2026-11-02" }));
    await repo.run([repo.planUpsert(makePlan({ type: "goal", title: "Learn Go", goalId, weekdays: 2, start: 540, end: 600 }))]);
    await repo.deleteGoal(goalId);
    expect((await repo.loadSnapshot()).plans).toHaveLength(0);
  });

  it("orders notes by urgency and keeps their reminders", async () => {
    await repo.saveNote({ id: "a", title: "Calm", description: "", urgency: 1, remindAt: null, reminded: false, createdAt: "2026-01-01" });
    await repo.saveNote({ id: "b", title: "Now", description: "Soon", urgency: 3, remindAt: "2026-11-02T09:30", reminded: false, createdAt: "2026-01-02" });
    let notes = (await repo.loadSnapshot()).notes;
    expect(notes.map((n) => n.id)).toEqual(["b", "a"]);
    expect(notes[0].remindAt).toBe("2026-11-02T09:30");
    await repo.saveNote({ ...notes[0], reminded: true });
    notes = (await repo.loadSnapshot()).notes;
    expect(notes[0].reminded).toBe(true);
    await repo.deleteNote("a");
    expect((await repo.loadSnapshot()).notes).toHaveLength(1);
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
