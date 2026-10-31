/**
 * Plan revision: merges a freshly compiled plan into an existing goal without
 * losing anything the user has worked on.
 *
 * Kept untouched: tasks that are done, in progress, skipped, manually created,
 * edited, or sent to the planner. Replaced: generated tasks nobody has touched.
 */

import type { CompiledPlan, CompiledTask } from "./goalCompiler";
import type { Milestone, Project, Task } from "./types";

export interface RevisionInput {
  milestones: Milestone[];
  projects: Project[];
  tasks: Task[];
  /** Task ids currently placed on any day plan. */
  scheduledTaskIds: Set<string>;
}

export interface NewTaskPlacement {
  task: CompiledTask;
  /** Existing milestone id, or index into `newMilestones`. */
  milestone: { existingId: string } | { newIndex: number };
  /** Existing project id, or index into `newProjects`. */
  project: { existingId: string } | { newIndex: number };
  sortOrder: number;
}

export interface RevisionPlan {
  keepTaskIds: string[];
  removeTaskIds: string[];
  removeMilestoneIds: string[];
  removeProjectIds: string[];
  newMilestones: { title: string; description: string; deadline: string | null; sortOrder: number }[];
  newProjects: { title: string; milestone: { existingId: string } | { newIndex: number }; sortOrder: number }[];
  newTasks: NewTaskPlacement[];
  /** Existing milestones whose deadline/description is refreshed from the new plan. */
  milestoneUpdates: { id: string; deadline: string | null; description: string; sortOrder: number }[];
  summary: { kept: number; completedKept: number; replaced: number; added: number; skippedDuplicates: number };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function isProtected(task: Task, scheduled: Set<string>): boolean {
  return (
    task.status !== "todo" ||
    task.origin === "manual" ||
    task.edited ||
    task.inPlanner ||
    task.progressMin > 0 ||
    scheduled.has(task.id)
  );
}

export function planRevision(existing: RevisionInput, next: CompiledPlan): RevisionPlan {
  const keep = existing.tasks.filter((t) => isProtected(t, existing.scheduledTaskIds));
  const remove = existing.tasks.filter((t) => !isProtected(t, existing.scheduledTaskIds));
  const keptTitles = new Set(keep.map((t) => norm(t.title)));

  const milestoneByTitle = new Map(existing.milestones.map((m) => [norm(m.title), m]));
  const projectsByMilestone = new Map<string, Project[]>();
  for (const p of existing.projects) {
    const list = projectsByMilestone.get(p.milestoneId) ?? [];
    list.push(p);
    projectsByMilestone.set(p.milestoneId, list);
  }

  const plan: RevisionPlan = {
    keepTaskIds: keep.map((t) => t.id),
    removeTaskIds: remove.map((t) => t.id),
    removeMilestoneIds: [],
    removeProjectIds: [],
    newMilestones: [],
    newProjects: [],
    newTasks: [],
    milestoneUpdates: [],
    summary: {
      kept: keep.length,
      completedKept: keep.filter((t) => t.status === "done").length,
      replaced: remove.length,
      added: 0,
      skippedDuplicates: 0,
    },
  };

  const maxOrder = existing.milestones.reduce((m, x) => Math.max(m, x.sortOrder), -1);

  next.milestones.forEach((cm, mi) => {
    const match = milestoneByTitle.get(norm(cm.title));
    let mRef: NewTaskPlacement["milestone"];
    if (match) {
      mRef = { existingId: match.id };
      plan.milestoneUpdates.push({ id: match.id, deadline: cm.deadline, description: cm.description || match.description, sortOrder: mi });
    } else {
      plan.newMilestones.push({ title: cm.title, description: cm.description, deadline: cm.deadline, sortOrder: maxOrder + 1 + mi });
      mRef = { newIndex: plan.newMilestones.length - 1 };
    }

    cm.projects.forEach((cp, pi) => {
      let pRef: NewTaskPlacement["project"];
      const existingProject =
        "existingId" in mRef
          ? (projectsByMilestone.get(mRef.existingId) ?? []).find((p) => norm(p.title) === norm(cp.title))
          : undefined;
      if (existingProject) {
        pRef = { existingId: existingProject.id };
      } else {
        plan.newProjects.push({ title: cp.title, milestone: mRef, sortOrder: pi });
        pRef = { newIndex: plan.newProjects.length - 1 };
      }
      cp.tasks.forEach((ct, ti) => {
        if (keptTitles.has(norm(ct.title))) {
          plan.summary.skippedDuplicates += 1;
          return;
        }
        plan.newTasks.push({ task: ct, milestone: mRef, project: pRef, sortOrder: 1000 + mi * 100 + pi * 10 + ti });
      });
    });
  });
  plan.summary.added = plan.newTasks.length;

  // Containers that end up empty are removed — but never ones holding kept work.
  const keptByProject = new Set(keep.map((t) => t.projectId).filter(Boolean) as string[]);
  const keptByMilestone = new Set(keep.map((t) => t.milestoneId).filter(Boolean) as string[]);
  const newTaskProjects = new Set(
    plan.newTasks.map((n) => ("existingId" in n.project ? n.project.existingId : null)).filter(Boolean) as string[],
  );
  for (const p of existing.projects) {
    if (!keptByProject.has(p.id) && !newTaskProjects.has(p.id)) plan.removeProjectIds.push(p.id);
  }
  const newTaskMilestones = new Set(
    plan.newTasks.map((n) => ("existingId" in n.milestone ? n.milestone.existingId : null)).filter(Boolean) as string[],
  );
  for (const m of existing.milestones) {
    if (!keptByMilestone.has(m.id) && !newTaskMilestones.has(m.id)) plan.removeMilestoneIds.push(m.id);
  }
  const removed = new Set(plan.removeMilestoneIds);
  plan.milestoneUpdates = plan.milestoneUpdates.filter((u) => !removed.has(u.id));
  // New containers are only created when a new task lands in them (see repository).
  return plan;
}
