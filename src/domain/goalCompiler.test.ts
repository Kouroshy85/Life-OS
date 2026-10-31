import { describe, expect, it } from "vitest";
import { compileGoal, detectArchetype, extractSubject, sanitizePlan, validateGoalText } from "./goalCompiler";
import { planRevision } from "./revision";
import type { Milestone, Project, Task } from "./types";

const TODAY = "2026-11-02";

describe("goal compiler (template)", () => {
  it("extracts the subject of common goal phrasings", () => {
    expect(extractSubject("Become a better backend developer")).toBe("backend developer");
    expect(extractSubject("Prepare for my university exams")).toBe("university exams");
    expect(extractSubject("I want to learn Spanish.")).toBe("Spanish");
    expect(extractSubject("Write a novel")).toBe("novel");
  });

  it("picks a fitting archetype", () => {
    expect(detectArchetype("Prepare for my university exams").id).toBe("exam");
    expect(detectArchetype("Become a better backend developer").id).toBe("skill");
    expect(detectArchetype("Run a half marathon").id).toBe("fitness");
    expect(detectArchetype("Get a job as a product designer").id).toBe("career");
    expect(detectArchetype("Launch my side project").id).toBe("build");
    expect(detectArchetype("Feel calmer on weekdays").id).toBe("general");
  });

  it("produces a structured, labelled plan", () => {
    const plan = compileGoal({ text: "Become a better backend developer", targetDate: null, hoursPerWeek: 5, today: TODAY });
    expect(plan.source).toBe("template");
    expect(plan.model).toBeNull();
    expect(plan.milestones.length).toBeGreaterThanOrEqual(3);
    for (const m of plan.milestones) {
      expect(m.projects.length).toBeGreaterThan(0);
      for (const p of m.projects) {
        for (const t of p.tasks) {
          expect(t.estimateMin).toBeGreaterThanOrEqual(5);
          expect([1, 2, 3, 4]).toContain(t.priority);
        }
      }
    }
    // Tech goals get tech-flavoured tasks.
    const titles = plan.milestones.flatMap((m) => m.projects.flatMap((p) => p.tasks.map((t) => t.title)));
    expect(titles.some((t) => /code review|repository|codebase/i.test(t))).toBe(true);
    expect(titles.some((t) => /where you are with backend development/.test(t))).toBe(true);
  });

  it("paces milestone deadlines up to the target date, in order", () => {
    const plan = compileGoal({ text: "Prepare for my university exams", targetDate: "2026-12-14", hoursPerWeek: 10, today: TODAY });
    const deadlines = plan.milestones.map((m) => m.deadline!);
    expect([...deadlines].sort()).toEqual(deadlines);
    expect(deadlines[deadlines.length - 1]).toBe("2026-12-14");
    expect(deadlines[0] > TODAY).toBe(true);
  });

  it("warns when the target date is too tight and ignores past target dates", () => {
    const tight = compileGoal({ text: "Write a book", targetDate: "2026-11-05", hoursPerWeek: 2, today: TODAY });
    expect(tight.notes.join(" ")).toMatch(/more than the 3 days/);
    const past = compileGoal({ text: "Write a book", targetDate: "2026-10-01", hoursPerWeek: 2, today: TODAY });
    expect(past.notes[0]).toMatch(/in the past/);
  });

  it("validates goal text", () => {
    expect(validateGoalText("  ")).toBeTruthy();
    expect(validateGoalText("Learn to cook")).toBeNull();
    expect(() => compileGoal({ text: "x", targetDate: null, hoursPerWeek: 5, today: TODAY })).toThrow();
  });

  it("sanitizes untrusted plans from a model", () => {
    const plan = sanitizePlan(
      {
        title: "Plan",
        milestones: [
          { title: "", projects: [] },
          {
            title: "M1",
            deadline: "not-a-date",
            projects: [{ title: "P", tasks: [{ title: "Do it", priority: 9, estimateMin: 9999, energy: "extreme" }, { title: "" }] }],
          },
        ],
      },
      { text: "Goal", targetDate: null, hoursPerWeek: 5, today: TODAY },
      "ai",
      "claude-opus-5-5",
    );
    expect(plan.milestones).toHaveLength(1);
    const t = plan.milestones[0].projects[0].tasks[0];
    expect(t).toMatchObject({ priority: 4, estimateMin: 480, energy: null });
    expect(plan.milestones[0].deadline).toBeNull();
    expect(plan.source).toBe("ai");
    expect(() => sanitizePlan({ milestones: [] }, { text: "g", targetDate: null, hoursPerWeek: 5, today: TODAY }, "ai", null)).toThrow();
  });
});

describe("plan revision", () => {
  const ts = "2026-10-01T00:00:00.000Z";
  const milestone = (id: string, title: string): Milestone => ({ id, goalId: "g", title, description: "", deadline: null, sortOrder: 0, createdAt: ts });
  const project = (id: string, milestoneId: string, title: string): Project => ({ id, milestoneId, title, sortOrder: 0, createdAt: ts });
  const task = (id: string, title: string, extra: Partial<Task> = {}): Task => ({
    id, goalId: "g", milestoneId: "m1", projectId: "p1", title, notes: "", priority: 2, estimateMin: 30,
    deadline: null, deadlineTime: null, energy: null, status: "todo", inPlanner: false, progressMin: 0,
    sortOrder: 0, origin: "generated", edited: false, isSample: false, createdAt: ts, updatedAt: ts, completedAt: null,
    ...extra,
  });

  it("keeps completed, edited, manual and planned work; replaces untouched generated tasks", () => {
    const existing = {
      milestones: [milestone("m1", "Map the syllabus"), milestone("m2", "Old milestone")],
      projects: [project("p1", "m1", "Scope"), project("p2", "m2", "Old project")],
      tasks: [
        task("done", "Finished thing", { status: "done" }),
        task("edited", "Edited thing", { edited: true }),
        task("manual", "My own thing", { origin: "manual" }),
        task("planned", "Planned thing", { inPlanner: true }),
        task("untouched", "Untouched generated"),
        task("old", "Old task", { milestoneId: "m2", projectId: "p2" }),
      ],
      scheduledTaskIds: new Set<string>(),
    };
    const next = compileGoal({ text: "Prepare for my exams", targetDate: null, hoursPerWeek: 5, today: TODAY });
    const rev = planRevision(existing, next);
    expect(rev.keepTaskIds.sort()).toEqual(["done", "edited", "manual", "planned"]);
    expect(rev.removeTaskIds.sort()).toEqual(["old", "untouched"]);
    expect(rev.summary.completedKept).toBe(1);
    // Matching milestone is reused, the stale one removed.
    expect(rev.newTasks.some((t) => "existingId" in t.milestone && t.milestone.existingId === "m1")).toBe(true);
    expect(rev.removeMilestoneIds).toEqual(["m2"]);
    expect(rev.removeProjectIds).toEqual(["p2"]);
  });

  it("does not duplicate tasks the user already kept", () => {
    const next = compileGoal({ text: "Prepare for my exams", targetDate: null, hoursPerWeek: 5, today: TODAY });
    const firstTitle = next.milestones[0].projects[0].tasks[0].title;
    const rev = planRevision(
      {
        milestones: [milestone("m1", "Map the syllabus")],
        projects: [project("p1", "m1", "Scope")],
        tasks: [task("d", firstTitle, { status: "done" })],
        scheduledTaskIds: new Set(),
      },
      next,
    );
    expect(rev.newTasks.some((n) => n.task.title === firstTitle)).toBe(false);
    expect(rev.summary.skippedDuplicates).toBe(1);
  });
});
