/**
 * Turns an approved change set into SQL statements that run as one transaction, so
 * either everything in it is saved or nothing is. Only existing repository
 * statement builders are used.
 */

import { weekStartDay } from "../../domain/locale";
import { dayBit, weekDates } from "../../domain/plans";
import type { DateKey } from "../../domain/types";
import { makePlan, makeTask, nowIso, type Repository } from "../../persistence/repository";
import type { SqlStatement } from "../../persistence/driver";
import type { ChangeSet, ProposalState } from "./proposals";
import type { ResolvedTask } from "./parse";

export interface AppliedCounts {
  goals: string[];
  /** Ids of goals created, so the chat can link to them. */
  goalIds: string[];
  milestones: number;
  tasks: number;
  updated: number;
  sessions: number;
  rescheduled: number;
}

const taskFields = (x: ResolvedTask) => ({
  title: x.title,
  notes: x.notes,
  estimateMin: x.estimateMin,
  priority: x.priority,
  energy: x.energy,
  deadline: x.deadline,
});

export function changeSetStatements(
  repo: Repository,
  cs: ChangeSet,
  state: ProposalState,
  today: DateKey,
): { statements: SqlStatement[]; counts: AppliedCounts } {
  const statements: SqlStatement[] = [];
  const counts: AppliedCounts = { goals: [], goalIds: [], milestones: 0, tasks: 0, updated: 0, sessions: 0, rescheduled: 0 };
  const validFrom = weekDates(today, weekStartDay())[0];
  let goalOrder = state.goals.length;
  const nextTaskOrder = (() => {
    let order = state.tasks.reduce((max, x) => Math.max(max, x.sortOrder), 0) + 1;
    return () => order++;
  })();
  const plannedDates = new Set<DateKey>();
  const toPlanner = new Set<string>();

  for (const item of cs.items) {
    switch (item.kind) {
      case "goal": {
        const { goalId, statements: goalStatements } = repo.goalPlanStatements(item.plan, { sortOrder: goalOrder++ });
        statements.push(...goalStatements);
        for (const s of item.sessions) {
          statements.push(
            repo.planUpsert(
              makePlan({ type: "goal", title: item.plan.title, description: item.plan.description, goalId, weekdays: dayBit(s.weekday), validFrom, start: s.start, end: s.end }),
            ),
          );
        }
        counts.goals.push(item.plan.title);
        counts.goalIds.push(goalId);
        counts.milestones += item.plan.milestones.length;
        counts.tasks += item.plan.milestones.reduce((n, m) => n + m.projects.reduce((n2, p) => n2 + p.tasks.length, 0), 0);
        counts.sessions += item.sessions.length;
        break;
      }

      case "milestone": {
        const order = state.milestones.filter((m) => m.goalId === item.goalId).length;
        const m = repo.milestoneStatements({ goalId: item.goalId, title: item.title, description: item.description, deadline: item.deadline, sortOrder: order });
        statements.push(...m.statements);
        for (const x of item.tasks) {
          statements.push(
            repo.taskInsert(
              makeTask({ ...taskFields(x), deadline: x.deadline ?? item.deadline, goalId: item.goalId, milestoneId: m.milestoneId, projectId: m.projectId, origin: "manual", sortOrder: nextTaskOrder() }),
            ),
          );
        }
        counts.milestones += 1;
        counts.tasks += item.tasks.length;
        break;
      }

      case "task": {
        let goalId: string | null = null;
        let milestoneId: string | null = null;
        let projectId: string | null = null;
        if (item.parent) {
          // A task under a goal joins its first milestone that still has open work, else its last one.
          const milestone =
            item.parent.kind === "milestone"
              ? state.milestones.find((m) => m.id === item.parent!.id)
              : (() => {
                  const ms = state.milestones.filter((m) => m.goalId === item.parent!.id).sort((a, b) => a.sortOrder - b.sortOrder);
                  return ms.find((m) => state.tasks.some((x) => x.milestoneId === m.id && (x.status === "todo" || x.status === "in_progress"))) ?? ms[ms.length - 1];
                })();
          goalId = milestone?.goalId ?? (item.parent.kind === "goal" ? item.parent.id : null);
          if (milestone) {
            milestoneId = milestone.id;
            const project = state.projects.filter((p) => p.milestoneId === milestone.id).sort((a, b) => a.sortOrder - b.sortOrder)[0];
            if (project) projectId = project.id;
            else {
              const p = repo.projectStatement({ milestoneId: milestone.id, title: "Tasks", sortOrder: 0 });
              statements.push(p.statement);
              projectId = p.projectId;
            }
          } else if (goalId) {
            const m = repo.milestoneStatements({ goalId, title: item.task.title, description: "", deadline: item.task.deadline, sortOrder: 0 });
            statements.push(...m.statements);
            milestoneId = m.milestoneId;
            projectId = m.projectId;
          }
        }
        statements.push(
          repo.taskInsert(makeTask({ ...taskFields(item.task), goalId, milestoneId, projectId, inPlanner: !item.parent, origin: "manual", sortOrder: nextTaskOrder() })),
        );
        counts.tasks += 1;
        break;
      }

      case "task_update": {
        const task = state.tasks.find((x) => x.id === item.taskId);
        statements.push(repo.taskPatchStatement(item.taskId, { ...item.after, ...(task?.origin === "generated" ? { edited: true } : {}) }));
        counts.updated += 1;
        break;
      }

      case "week": {
        for (const day of item.days) {
          for (const b of day.blocks) statements.push(repo.blockInsert({ ...b, proposed: false, createdAt: nowIso() }));
          plannedDates.add(day.date);
          counts.sessions += day.blocks.filter((b) => b.kind === "task").length;
        }
        for (const id of item.taskIds) toPlanner.add(id);
        break;
      }

      case "reschedule": {
        const old = state.blocks.filter(
          (b) => b.taskId === item.taskId && !b.proposed && b.date >= today && b.state === "planned" && !b.pinned,
        );
        for (const b of old) statements.push(repo.blockDelete(b.id));
        for (const b of item.to) statements.push(repo.blockInsert({ ...b, createdAt: nowIso() }));
        plannedDates.add(item.to[0].date);
        toPlanner.add(item.taskId);
        counts.rescheduled += 1;
        break;
      }
    }
  }

  for (const id of toPlanner) statements.push(repo.taskPatchStatement(id, { inPlanner: true }));
  for (const date of plannedDates) statements.push(repo.dayPlanUpsert(date, { acceptedAt: nowIso() }));
  return { statements, counts };
}
