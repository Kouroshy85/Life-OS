import { create } from "zustand";
import { compilePlan, type CompileOutcome } from "../ai/planProvider";
import { compileGoal, type CompiledPlan, type GoalRequest } from "../domain/goalCompiler";
import { planRevision, type RevisionPlan } from "../domain/revision";
import { formatClock, formatDuration, minutesOfDay, toDateKey } from "../domain/time";
import type {
  Commitment,
  DateKey,
  Goal,
  Milestone,
  Preferences,
  Task,
  TaskStatus,
} from "../domain/types";
import { openDefaultDriver, type SqlStatement } from "../persistence/driver";
import { migrate } from "../persistence/migrations";
import { makeTask, newId, nowIso, Repository, type AiSettings, type Snapshot } from "../persistence/repository";
import {
  acceptChanges,
  commitmentsOn,
  earliestSlot,
  needsReflow,
  PlanningError,
  proposePlan,
  reflowDay,
  validateMove,
  type BlockChanges,
  type Clock,
} from "./planning";

export type View = "today" | "goals" | "planner" | "settings";

export interface Toast {
  id: string;
  kind: "info" | "success" | "error";
  message: string;
}

interface AppState extends Snapshot {
  status: "loading" | "ready" | "error";
  fatal: string | null;
  engine: string;
  location: string;
  clock: Clock;
  view: View;
  selectedGoalId: string | null;
  plannerDate: DateKey;
  toasts: Toast[];
  composerOpen: boolean;
}

const emptySnapshot = (): Snapshot => ({
  goals: [],
  milestones: [],
  projects: [],
  tasks: [],
  commitments: [],
  blocks: [],
  dayPlans: {},
  skips: {},
  events: [],
  prefs: {
    workStart: 540,
    workEnd: 1080,
    focusStart: 540,
    focusEnd: 720,
    bufferMin: 5,
    breakAfterMin: 90,
    breakLengthMin: 15,
    minSessionMin: 25,
    defaultEstimateMin: 45,
  },
  ai: { provider: "none", apiKey: "", model: "claude-opus-5-5" },
  flags: {},
});

const readClock = (): Clock => {
  const now = new Date();
  return { today: toDateKey(now), nowMin: minutesOfDay(now) };
};

let repo: Repository | null = null;
const R = () => {
  if (!repo) throw new Error("Database is not ready yet.");
  return repo;
};

export const useApp = create<AppState>(() => ({
  ...emptySnapshot(),
  status: "loading",
  fatal: null,
  engine: "",
  location: "",
  clock: readClock(),
  view: "today",
  selectedGoalId: null,
  plannerDate: readClock().today,
  toasts: [],
  composerOpen: false,
}));

const set = useApp.setState;
const get = useApp.getState;

// ---- infrastructure ------------------------------------------------------------------

export function toast(message: string, kind: Toast["kind"] = "info") {
  const id = newId();
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 7000 : 4200);
}

export function dismissToast(id: string) {
  set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

async function refresh() {
  await R().pruneOrphanBreaks();
  const snap = await R().loadSnapshot();
  set({ ...snap });
}

/** Runs a mutation, reloads state from the database, and reports failures. */
async function mutate<T>(fn: () => Promise<T>, errorPrefix = "Couldn't save"): Promise<T | undefined> {
  try {
    const out = await fn();
    await refresh();
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    toast(e instanceof PlanningError ? msg : `${errorPrefix}: ${msg}`, "error");
    await refresh().catch(() => undefined);
    return undefined;
  }
}

let opening: Promise<void> | null = null;

/** Idempotent: StrictMode runs effects twice, and two migrators must never race on one database. */
export function init() {
  return (opening ??= open());
}

async function open() {
  try {
    const driver = await openDefaultDriver();
    await migrate(driver);
    repo = new Repository(driver);
    const [snap, location] = await Promise.all([repo.loadSnapshot(), repo.location()]);
    set({ ...snap, status: "ready", engine: repo.engine, location, clock: readClock() });
  } catch (e) {
    set({ status: "error", fatal: e instanceof Error ? e.message : String(e) });
  }
}

export function tick() {
  const next = readClock();
  const prev = get().clock;
  if (next.today !== prev.today || next.nowMin !== prev.nowMin) {
    set((s) => ({
      clock: next,
      // Follow the day forward if the planner was showing "today".
      plannerDate: s.plannerDate === prev.today ? next.today : s.plannerDate,
    }));
  }
}

export const navigate = (view: View) => set({ view });
export const selectGoal = (id: string | null) => set({ selectedGoalId: id, view: "goals" });
export const setPlannerDate = (date: DateKey) => set({ plannerDate: date });
export const openComposer = (open: boolean) => set({ composerOpen: open, ...(open ? { view: "goals" as View } : {}) });

const planningState = () => {
  const s = get();
  return { tasks: s.tasks, commitments: s.commitments, blocks: s.blocks, skips: s.skips, prefs: s.prefs };
};

function blockStatements(changes: BlockChanges): SqlStatement[] {
  const r = R();
  return [
    ...changes.remove.map((id) => r.blockDelete(id)),
    ...changes.update.map((u) => r.blockUpdate(u.id, u.patch)),
    ...changes.insert.map((b) => r.blockInsert(b)),
  ];
}

// ---- goals --------------------------------------------------------------------------------

export function compilePreview(req: Omit<GoalRequest, "today">, useAi: boolean, description: string): Promise<CompileOutcome> {
  const s = get();
  return compilePlan({ ...req, today: s.clock.today }, s.ai, { useAi, description });
}

export async function createGoal(plan: CompiledPlan, description: string) {
  const id = await mutate(async () => {
    const order = get().goals.length;
    return R().createGoalFromPlan({ ...plan, description: description.trim() || plan.description }, { sortOrder: order });
  });
  if (id) {
    set({ selectedGoalId: id, composerOpen: false });
    toast("Goal created — every item is editable.", "success");
  }
  return id;
}

export async function createBlankGoal(title: string) {
  const plan: CompiledPlan = {
    title: title.trim(),
    description: "",
    targetDate: null,
    milestones: [{ title: "First milestone", description: "", deadline: null, projects: [{ title: "Tasks", tasks: [] }] }],
    source: "manual",
    model: null,
    archetype: "Manual",
    notes: [],
  };
  return createGoal(plan, "");
}

export const updateGoal = (id: string, patch: Partial<Pick<Goal, "title" | "description" | "targetDate" | "archived">>) =>
  mutate(() => R().updateGoal(id, patch));

export async function deleteGoal(id: string) {
  await mutate(() => R().deleteGoal(id));
  set((s) => ({ selectedGoalId: s.selectedGoalId === id ? null : s.selectedGoalId }));
  toast("Goal deleted.");
}

export interface RevisionPreview {
  outcome: CompileOutcome;
  revision: RevisionPlan;
}

export async function previewRevision(goalId: string, text: string, opts: { targetDate: DateKey | null; hoursPerWeek: number; useAi: boolean; description: string }): Promise<RevisionPreview> {
  const s = get();
  const outcome = await compilePlan(
    { text, targetDate: opts.targetDate, hoursPerWeek: opts.hoursPerWeek, today: s.clock.today },
    s.ai,
    { useAi: opts.useAi, description: opts.description },
  );
  const milestones = s.milestones.filter((m) => m.goalId === goalId);
  const mIds = new Set(milestones.map((m) => m.id));
  const revision = planRevision(
    {
      milestones,
      projects: s.projects.filter((p) => mIds.has(p.milestoneId)),
      tasks: s.tasks.filter((t) => t.goalId === goalId),
      scheduledTaskIds: new Set(s.blocks.filter((b) => b.taskId && b.state !== "skipped").map((b) => b.taskId!)),
    },
    outcome.plan,
  );
  return { outcome, revision };
}

export async function applyRevision(goalId: string, preview: RevisionPreview, newTitle: string) {
  await mutate(async () => {
    await R().reviseGoal(goalId, preview.revision, preview.outcome.plan);
    if (newTitle.trim()) await R().updateGoal(goalId, { title: newTitle.trim() });
  });
  toast(`Plan revised — kept ${preview.revision.summary.kept} item${preview.revision.summary.kept === 1 ? "" : "s"} you worked on.`, "success");
}

// ---- milestones & projects -------------------------------------------------------------------

export const addMilestone = (goalId: string, title: string) =>
  mutate(() => R().createMilestone(goalId, title.trim() || "New milestone", get().milestones.filter((m) => m.goalId === goalId).length));

export const updateMilestone = (id: string, patch: Partial<Pick<Milestone, "title" | "description" | "deadline">>) =>
  mutate(() => R().updateMilestone(id, patch));

export const deleteMilestone = (id: string) => mutate(() => R().deleteMilestone(id));

export const reorder = (table: "milestones" | "projects" | "tasks" | "goals", ids: string[]) =>
  mutate(() => R().reorder(table, ids));

export const addProject = (milestoneId: string, title: string) =>
  mutate(() => R().createProject(milestoneId, title.trim() || "New project", get().projects.filter((p) => p.milestoneId === milestoneId).length));

export const renameProject = (id: string, title: string) => mutate(() => R().renameProject(id, title));
export const deleteProject = (id: string) => mutate(() => R().deleteProject(id));

// ---- tasks ---------------------------------------------------------------------------------------

export async function addTask(partial: Partial<Task> & { title: string }) {
  const title = partial.title.trim();
  if (!title) {
    toast("A task needs a title.", "error");
    return;
  }
  const s = get();
  const siblings = s.tasks.filter((t) => t.projectId === (partial.projectId ?? null) && t.goalId === (partial.goalId ?? null));
  const task = makeTask({
    estimateMin: s.prefs.defaultEstimateMin,
    sortOrder: siblings.reduce((m, t) => Math.max(m, t.sortOrder + 1), 0),
    ...partial,
    title,
  });
  await mutate(() => R().createTask(task));
  return task.id;
}

const CONTENT_FIELDS: (keyof Task)[] = ["title", "notes", "priority", "estimateMin", "deadline", "deadlineTime", "energy"];

export function validateTaskPatch(patch: Partial<Task>): string | null {
  if (patch.title !== undefined && !patch.title.trim()) return "A task needs a title.";
  if (patch.estimateMin !== undefined && (!Number.isFinite(patch.estimateMin) || patch.estimateMin < 5 || patch.estimateMin > 960)) {
    return "Duration must be between 5 minutes and 16 hours.";
  }
  if (patch.deadlineTime != null && (patch.deadlineTime < 0 || patch.deadlineTime > 1440)) return "Invalid deadline time.";
  return null;
}

export async function updateTask(id: string, patch: Partial<Task>) {
  const error = validateTaskPatch(patch);
  if (error) {
    toast(error, "error");
    return;
  }
  const task = get().tasks.find((t) => t.id === id);
  if (!task) return;
  const touchesContent = CONTENT_FIELDS.some((k) => patch[k] !== undefined && patch[k] !== task[k]);
  const full: Partial<Task> = { ...patch, ...(touchesContent && task.origin === "generated" ? { edited: true } : {}) };
  if (patch.title !== undefined) full.title = patch.title.trim();
  await mutate(() => R().updateTask(id, full));
}

export const deleteTask = (id: string) => mutate(() => R().deleteTask(id));

/** Status changes from the goal outline or backlog (not from a specific block). */
export async function setTaskStatus(id: string, status: TaskStatus) {
  const s = get();
  const task = s.tasks.find((t) => t.id === id);
  if (!task || task.status === status) return;
  const r = R();
  const today = s.clock.today;
  const stmts: SqlStatement[] = [
    r.taskPatchStatement(id, { status, completedAt: status === "done" ? nowIso() : null }),
  ];
  if (status === "done" || status === "skipped") {
    // Future planned sessions are no longer needed.
    for (const b of s.blocks) {
      if (b.taskId === id && b.state === "planned") stmts.push(r.blockDelete(b.id));
      if (b.taskId === id && b.state === "in_progress") stmts.push(r.blockUpdate(b.id, { state: status === "done" ? "done" : "skipped" }));
    }
    stmts.push(r.eventStatement(task, status === "done" ? "completed" : "skipped", today, status === "done" ? task.estimateMin : null));
  } else if (task.status === "in_progress" && status === "todo") {
    for (const b of s.blocks) {
      if (b.taskId === id && b.state === "in_progress") stmts.push(r.blockUpdate(b.id, { state: "planned" }));
    }
  } else if (task.status === "done" || task.status === "skipped") {
    stmts.push(r.eventStatement(task, "reopened", today));
  } else if (status === "in_progress") {
    stmts.push(r.eventStatement(task, "started", today));
  }
  await mutate(() => r.run(stmts));
}

export async function sendToPlanner(ids: string[], inPlanner = true) {
  const r = R();
  const n = await mutate(async () => {
    await r.run(ids.map((id) => r.taskPatchStatement(id, { inPlanner })));
    return ids.length;
  });
  if (n && inPlanner) toast(`${n} task${n === 1 ? "" : "s"} added to the planner backlog.`, "success");
}

/** Converts a task into a scheduled block at the earliest free slot of `date`. */
export async function scheduleTask(taskId: string, date: DateKey) {
  const s = get();
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const result = earliestSlot(planningState(), task, date, s.clock);
  const r = R();
  const stmts: SqlStatement[] = [r.taskPatchStatement(taskId, { inPlanner: true })];
  const placed = result.blocks;
  if (!placed.some((b) => b.kind === "task")) {
    await mutate(() => r.run(stmts));
    toast(`Added to the backlog — ${result.unscheduled[0]?.message ?? "no free slot on that day."}`, "info");
    return;
  }
  for (const p of placed) {
    stmts.push(
      r.blockInsert({
        id: newId(),
        date,
        taskId: p.taskId,
        kind: p.kind,
        start: p.start,
        end: p.end,
        state: "planned",
        proposed: false,
        pinned: true,
        part: p.part,
        partCount: p.partCount,
        reason: p.kind === "task" ? `Scheduled by you into the earliest free slot. ${p.reason}` : p.reason,
        createdAt: nowIso(),
      }),
    );
  }
  stmts.push(r.dayPlanUpsert(date, { acceptedAt: nowIso() }));
  await mutate(() => r.run(stmts));
  const first = placed.find((b) => b.kind === "task")!;
  toast(`Scheduled “${task.title}” at ${formatClock(first.start)}${date === s.clock.today ? " today" : ""}.`, "success");
}

// ---- preferences, commitments, AI -----------------------------------------------------------------------

export function validatePrefs(p: Preferences): string | null {
  if (p.workEnd <= p.workStart) return "Working hours must end after they start.";
  if (p.focusEnd <= p.focusStart) return "Focus hours must end after they start.";
  if (p.bufferMin < 0 || p.bufferMin > 60) return "Buffer must be between 0 and 60 minutes.";
  if (p.breakAfterMin !== 0 && (p.breakAfterMin < 30 || p.breakAfterMin > 300)) return "Break interval must be 30–300 minutes, or 0 to disable.";
  if (p.breakLengthMin < 5 || p.breakLengthMin > 60) return "Breaks must be 5–60 minutes.";
  if (p.minSessionMin < 10 || p.minSessionMin > 180) return "Minimum session must be 10–180 minutes.";
  if (p.defaultEstimateMin < 5 || p.defaultEstimateMin > 480) return "Default duration must be 5–480 minutes.";
  return null;
}

export async function savePrefs(p: Preferences) {
  const error = validatePrefs(p);
  if (error) {
    toast(error, "error");
    return false;
  }
  await mutate(() => R().savePreferences(p));
  toast("Planning preferences saved.", "success");
  return true;
}

export function validateCommitment(c: Commitment): string | null {
  if (!c.title.trim()) return "Give the commitment a name.";
  if (c.end <= c.start) return "The end time must be after the start time.";
  if (!c.date && c.weekdays === 0) return "Choose at least one weekday, or a specific date.";
  return null;
}

/** Saves a commitment and recalculates any affected plan from today onward. */
export async function saveCommitment(c: Commitment) {
  const error = validateCommitment(c);
  if (error) {
    toast(error, "error");
    return false;
  }
  const isNew = !get().commitments.some((x) => x.id === c.id);
  const ok = await mutate(async () => {
    await R().saveCommitment({ ...c, title: c.title.trim() });
    return true;
  });
  if (!ok) return false;
  await reflowAffected(`“${c.title.trim()}” ${isNew ? "was added" : "changed"} at ${formatClock(c.start)}`);
  return true;
}

export async function deleteCommitment(id: string) {
  await mutate(() => R().deleteCommitment(id));
}

async function reflowAffected(trigger: string) {
  const s = get();
  const dates = [...new Set(s.blocks.filter((b) => !b.proposed && b.date >= s.clock.today).map((b) => b.date))];
  let moved = 0;
  let toBacklog = 0;
  const r = R();
  const stmts: SqlStatement[] = [];
  // Pending proposals were computed before this change; recompute them rather than risk an overlap.
  const proposalDates = [...new Set(s.blocks.filter((b) => b.proposed && b.date >= s.clock.today).map((b) => b.date))];
  for (const date of proposalDates) await proposeDay(date);
  for (const date of dates) {
    if (!needsReflow(planningState(), date, s.clock)) continue;
    const rf = reflowDay(planningState(), date, s.clock, trigger);
    stmts.push(...blockStatements(rf.changes), r.dayPlanUpsert(date, { notes: mergeNotes(date, rf.notes) }));
    moved += rf.moved;
    toBacklog += rf.toBacklog;
  }
  if (!stmts.length) return;
  await mutate(() => r.run(stmts));
  toast(reflowMessage(moved, toBacklog), toBacklog ? "info" : "success");
}

function mergeNotes(date: DateKey, fresh: Snapshot["dayPlans"][string]["notes"]) {
  const existing = get().dayPlans[date]?.notes ?? [];
  const ids = new Set(fresh.map((n) => n.taskId));
  return [...existing.filter((n) => !ids.has(n.taskId)), ...fresh];
}

function reflowMessage(moved: number, toBacklog: number) {
  const parts = [];
  if (moved) parts.push(`${moved} block${moved === 1 ? "" : "s"} moved`);
  if (toBacklog) parts.push(`${toBacklog} moved to the backlog`);
  return parts.length ? `Plan recalculated: ${parts.join(", ")}.` : "Plan recalculated — nothing needed to move.";
}

export async function saveAi(ai: AiSettings) {
  await mutate(() => R().saveAi(ai));
  toast(ai.provider === "anthropic" ? "AI settings saved on this device." : "AI disabled — the built-in planner will be used.", "success");
}

// ---- day planning -------------------------------------------------------------------------------------

export async function proposeDay(date: DateKey) {
  const s = get();
  const proposal = proposePlan(planningState(), date, s.clock);
  const r = R();
  const stmts: SqlStatement[] = [
    ...s.blocks.filter((b) => b.date === date && b.proposed).map((b) => r.blockDelete(b.id)),
    ...proposal.blocks.map((b) => r.blockInsert(b)),
    r.dayPlanUpsert(date, {
      generatedAt: nowIso(),
      proposalNotes: proposal.result.unscheduled,
      proposalSummary: proposal.summary,
    }),
  ];
  await mutate(() => r.run(stmts));
  if (!proposal.blocks.length) {
    toast(proposal.result.unscheduled[0]?.message ?? "Nothing to schedule — add tasks to the backlog first.", "info");
  }
}

export async function acceptProposal(date: DateKey) {
  const s = get();
  try {
    const changes = acceptChanges(planningState(), date, s.clock);
    const r = R();
    await mutate(() =>
      r.run([
        ...blockStatements(changes),
        r.dayPlanUpsert(date, {
          acceptedAt: nowIso(),
          notes: s.dayPlans[date]?.proposalNotes ?? [],
          proposalNotes: [],
          proposalSummary: "",
        }),
      ]),
    );
    toast("Plan accepted.", "success");
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
    await proposeDay(date);
  }
}

export async function rejectProposal(date: DateKey) {
  const s = get();
  const r = R();
  await mutate(() =>
    r.run([
      ...s.blocks.filter((b) => b.date === date && b.proposed).map((b) => r.blockDelete(b.id)),
      r.dayPlanUpsert(date, { proposalNotes: [], proposalSummary: "" }),
    ]),
  );
}

export async function moveBlock(id: string, start: number, duration?: number) {
  const s = get();
  const block = s.blocks.find((b) => b.id === id);
  if (!block) return;
  try {
    const dur = duration ?? block.end - block.start;
    const res = validateMove(planningState(), id, start, dur);
    if (res.start === block.start && res.end === block.end) return;
    const r = R();
    const what = duration != null && duration !== block.end - block.start ? `Resized by you to ${formatDuration(dur)}` : `Moved by you to ${formatClock(res.start)}`;
    await mutate(() =>
      r.run([r.blockUpdate(id, { start: res.start, end: res.end, pinned: true, reason: `${what}. The planner will keep it here.` })]),
    );
    if (res.message) toast(res.message, "info");
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), "error");
  }
}

export async function unscheduleBlock(id: string) {
  const r = R();
  await mutate(() => r.run([r.blockDelete(id)]));
}

export async function startBlock(id: string) {
  const s = get();
  const block = s.blocks.find((b) => b.id === id);
  const task = s.tasks.find((t) => t.id === block?.taskId);
  if (!block || !task) return;
  const other = s.blocks.find((b) => b.state === "in_progress" && b.id !== id);
  const r = R();
  const stmts: SqlStatement[] = [
    r.blockUpdate(id, { state: "in_progress" }),
    r.taskPatchStatement(task.id, { status: "in_progress" }),
    r.eventStatement(task, "started", block.date),
  ];
  if (other) {
    toast("Paused the other session that was in progress.", "info");
    stmts.push(r.blockUpdate(other.id, { state: "planned" }));
  }
  await mutate(() => r.run(stmts));
}

export async function completeBlock(id: string) {
  const s = get();
  const block = s.blocks.find((b) => b.id === id);
  const task = s.tasks.find((t) => t.id === block?.taskId);
  if (!block || !task) return;
  const r = R();
  const isToday = block.date === s.clock.today;
  // Finishing early frees the rest of the slot.
  const end = isToday && s.clock.nowMin > block.start && s.clock.nowMin < block.end ? Math.max(block.start + 5, Math.ceil(s.clock.nowMin / 5) * 5) : block.end;
  const minutes = end - block.start;
  // A session shorter than the remaining work leaves the task open, even with nothing else planned.
  const unfinished = task.estimateMin - task.progressMin > block.end - block.start;
  const laterParts = s.blocks.filter((b) => b.taskId === task.id && b.id !== id && b.state === "planned" && !b.proposed && (b.date > block.date || (b.date === block.date && b.start > block.start)));
  const stmts: SqlStatement[] = [r.blockUpdate(id, { state: "done", end })];
  if (laterParts.length || unfinished) {
    stmts.push(r.taskPatchStatement(task.id, { status: "todo", progressMin: task.progressMin + minutes }));
  } else {
    stmts.push(r.taskPatchStatement(task.id, { status: "done", completedAt: nowIso() }));
    stmts.push(r.eventStatement(task, "completed", block.date, minutes));
  }
  await mutate(() => r.run(stmts));
  toast(
    laterParts.length
      ? `Session done — ${laterParts.length} more planned.`
      : unfinished
        ? `Session done — the rest of “${task.title}” is in the backlog.`
        : `Completed “${task.title}”.`,
    "success",
  );
}

/** Task-level completion from a block: finishes the task and drops its other planned sessions. */
export async function completeTaskFromBlock(id: string) {
  const block = get().blocks.find((b) => b.id === id);
  if (!block?.taskId) return;
  await completeBlock(id);
  const task = get().tasks.find((t) => t.id === block.taskId);
  if (task && task.status !== "done") await setTaskStatus(task.id, "done");
}

export async function skipBlock(id: string) {
  const s = get();
  const block = s.blocks.find((b) => b.id === id);
  const task = s.tasks.find((t) => t.id === block?.taskId);
  if (!block || !task) return;
  const r = R();
  await mutate(() =>
    r.run([
      r.blockUpdate(id, { state: "skipped" }),
      r.taskPatchStatement(task.id, { status: "todo" }),
      r.skipStatement(block.date, task.id, true),
      r.eventStatement(task, "skipped_today", block.date),
    ]),
  );
  toast(`Skipped “${task.title}” — it stays in the backlog.`);
}

export async function reopenBlock(id: string) {
  const s = get();
  const block = s.blocks.find((b) => b.id === id);
  const task = s.tasks.find((t) => t.id === block?.taskId);
  if (!block || !task) return;
  const r = R();
  const stmts: SqlStatement[] = [r.blockUpdate(id, { state: "planned" }), r.skipStatement(block.date, task.id, false)];
  if (block.state === "done") {
    const minutes = block.end - block.start;
    stmts.push(
      task.status === "done"
        ? r.taskPatchStatement(task.id, { status: "todo", completedAt: null })
        : r.taskPatchStatement(task.id, { progressMin: Math.max(0, task.progressMin - minutes) }),
    );
    stmts.push(r.eventStatement(task, "reopened", block.date));
  }
  await mutate(() => r.run(stmts));
}

/** A running task needs more time: extend it and recalculate the rest of the day. */
export async function extendBlock(id: string, minutes: number) {
  const s = get();
  const block = s.blocks.find((b) => b.id === id);
  const task = s.tasks.find((t) => t.id === block?.taskId);
  if (!block || !task) return;
  const r = R();
  const newEnd = Math.min(24 * 60, block.end + minutes);
  const overlapsCommitment = commitmentsOn(block.date, s.commitments).find((c) => c.start < newEnd && block.end < c.end);
  if (overlapsCommitment) {
    toast(`Extending would run into “${overlapsCommitment.title}” at ${formatClock(overlapsCommitment.start)}. Extended up to it instead.`, "info");
  }
  const end = overlapsCommitment ? Math.max(block.end, overlapsCommitment.start) : newEnd;
  if (end === block.end) return;
  const extra = end - block.end;
  const ok = await mutate(async () => {
    await r.run([
      r.blockUpdate(id, { end, state: block.state === "planned" ? "in_progress" : block.state }),
      r.taskPatchStatement(task.id, { estimateMin: Math.min(960, task.estimateMin + extra), status: "in_progress" }),
      r.eventStatement(task, "overran", block.date, extra),
    ]);
    return true;
  });
  if (!ok) return;
  const s2 = get();
  const trigger = `“${task.title}” ran ${formatDuration(extra)} over`;
  const rf = reflowDay(planningState(), block.date, s2.clock, trigger);
  if (!rf.changes.remove.length) {
    toast(`Extended by ${formatDuration(extra)}.`, "success");
    return;
  }
  await mutate(() => r.run([...blockStatements(rf.changes), r.dayPlanUpsert(block.date, { notes: mergeNotes(block.date, rf.notes) })]));
  toast(reflowMessage(rf.moved, rf.toBacklog), rf.toBacklog ? "info" : "success");
}

/** Re-flows the remaining blocks of a day in place (used after manual changes). */
export async function reflowNow(date: DateKey) {
  const s = get();
  const rf = reflowDay(planningState(), date, s.clock, "you asked to recalculate the rest of the day");
  const r = R();
  await mutate(() => r.run([...blockStatements(rf.changes), r.dayPlanUpsert(date, { notes: mergeNotes(date, rf.notes) })]));
  toast(reflowMessage(rf.moved, rf.toBacklog));
}

// ---- data management ------------------------------------------------------------------------------------

export async function loadSampleData() {
  const s = get();
  const today = s.clock.today;
  const ok = await mutate(async () => {
    const r = R();
    const a = compileGoal({ text: "Become a better backend developer", targetDate: null, hoursPerWeek: 6, today });
    const b = compileGoal({ text: "Prepare for my university exams", targetDate: null, hoursPerWeek: 8, today });
    await r.createGoalFromPlan({ ...a, title: `${a.title}` }, { isSample: true, sortOrder: s.goals.length });
    await r.createGoalFromPlan({ ...b, title: `${b.title}` }, { isSample: true, sortOrder: s.goals.length + 1 });
    const standalone = [
      makeTask({ title: "Reply to pending emails", estimateMin: 30, priority: 2, energy: "low", inPlanner: true, isSample: true }),
      makeTask({ title: "Review this week's budget", estimateMin: 45, priority: 3, energy: "medium", inPlanner: true, isSample: true, deadline: today }),
      makeTask({ title: "Draft project proposal", estimateMin: 120, priority: 4, energy: "high", inPlanner: true, isSample: true }),
    ];
    for (const t of standalone) await r.createTask(t);
    const ts = nowIso();
    await r.saveCommitment({ id: "sample-lunch", title: "Lunch", kind: "break", date: null, weekdays: 0b0111110, start: 750, end: 795, createdAt: ts });
    await r.saveCommitment({ id: "sample-sync", title: "Team sync", kind: "commitment", date: null, weekdays: 0b0101010, start: 600, end: 630, createdAt: ts });
    await r.setFlag("sampleLoaded", "1");
    return true;
  });
  if (ok) toast("Sample data loaded. Remove it any time from Settings.", "success");
}

export async function removeSampleData() {
  await mutate(() => R().deleteSampleData());
  toast("Sample data removed.");
}

export async function resetAll() {
  await mutate(() => R().resetAll());
  set({ selectedGoalId: null });
  toast("All data deleted.");
}

export async function dismissWelcome() {
  await mutate(() => R().setFlag("welcomeDismissed", "1"));
}

// ---- selectors -----------------------------------------------------------------------------------------------

export function goalProgress(goalId: string, tasks: Task[]) {
  const list = tasks.filter((t) => t.goalId === goalId && t.status !== "skipped");
  const done = list.filter((t) => t.status === "done");
  const totalMin = list.reduce((s, t) => s + t.estimateMin, 0);
  const doneMin = done.reduce((s, t) => s + t.estimateMin, 0) + list.filter((t) => t.status !== "done").reduce((s, t) => s + Math.min(t.progressMin, t.estimateMin), 0);
  return {
    total: list.length,
    done: done.length,
    ratio: list.length ? done.length / list.length : 0,
    totalMin,
    doneMin,
  };
}
