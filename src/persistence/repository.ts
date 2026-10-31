/**
 * Repository: the only module that knows table and column names.
 * Reads return domain objects; writes are expressed as SQL statements and
 * executed in transactions so multi-row changes are all-or-nothing.
 */

import type { CompiledPlan } from "../domain/goalCompiler";
import { plansToCommitments } from "../domain/plans";
import type { RevisionPlan } from "../domain/revision";
import {
  DEFAULT_PREFERENCES,
  type Commitment,
  type Dream,
  type Playlist,
  type Song,
  type UserQuote,
  type DateKey,
  type Goal,
  type Milestone,
  type Note,
  type Plan,
  type Preferences,
  type Project,
  type ScheduleBlock,
  type Task,
  type TaskEvent,
  type TaskEventType,
  type UnscheduledNote,
} from "../domain/types";
import type { SqlDriver, SqlParam, SqlStatement } from "./driver";

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const nowIso = () => new Date().toISOString();

// ---- row mapping ---------------------------------------------------------------

type Row = Record<string, unknown>;
const b = (v: unknown) => Number(v) === 1;
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? null : Number(v));

const goalFrom = (r: Row): Goal => ({
  id: String(r.id),
  title: String(r.title),
  description: String(r.description ?? ""),
  targetDate: s(r.target_date),
  source: r.source as Goal["source"],
  sourceModel: s(r.source_model),
  isSample: b(r.is_sample),
  archived: b(r.archived),
  sortOrder: Number(r.sort_order),
  revision: Number(r.revision),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const milestoneFrom = (r: Row): Milestone => ({
  id: String(r.id),
  goalId: String(r.goal_id),
  title: String(r.title),
  description: String(r.description ?? ""),
  deadline: s(r.deadline),
  sortOrder: Number(r.sort_order),
  createdAt: String(r.created_at),
});

const projectFrom = (r: Row): Project => ({
  id: String(r.id),
  milestoneId: String(r.milestone_id),
  title: String(r.title),
  sortOrder: Number(r.sort_order),
  createdAt: String(r.created_at),
});

const taskFrom = (r: Row): Task => ({
  id: String(r.id),
  goalId: s(r.goal_id),
  milestoneId: s(r.milestone_id),
  projectId: s(r.project_id),
  title: String(r.title),
  notes: String(r.notes ?? ""),
  priority: Number(r.priority) as Task["priority"],
  estimateMin: Number(r.estimate_min),
  deadline: s(r.deadline),
  deadlineTime: n(r.deadline_time),
  energy: (r.energy as Task["energy"]) ?? null,
  status: r.status as Task["status"],
  inPlanner: b(r.in_planner),
  progressMin: Number(r.progress_min ?? 0),
  sortOrder: Number(r.sort_order),
  origin: r.origin as Task["origin"],
  edited: b(r.edited),
  isSample: b(r.is_sample),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  completedAt: s(r.completed_at),
});

function parseDates(v: unknown): string[] | null {
  if (v == null) return null;
  try {
    const parsed = JSON.parse(String(v));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const planFrom = (r: Row): Plan => ({
  id: String(r.id),
  type: r.type as Plan["type"],
  title: String(r.title),
  description: String(r.description ?? ""),
  weekdays: Number(r.weekdays),
  dates: parseDates(r.dates),
  validFrom: s(r.valid_from),
  start: Number(r.start_min),
  end: Number(r.end_min),
  goalId: s(r.goal_id),
  isBreak: b(r.is_break),
  isSample: b(r.is_sample),
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
});

const noteFrom = (r: Row): Note => ({
  id: String(r.id),
  title: String(r.title),
  description: String(r.description ?? ""),
  urgency: Number(r.urgency) as Note["urgency"],
  remindAt: s(r.remind_at),
  reminded: b(r.reminded),
  createdAt: String(r.created_at),
});

const blockFrom = (r: Row): ScheduleBlock => ({
  id: String(r.id),
  date: String(r.date),
  taskId: s(r.task_id),
  kind: r.kind as ScheduleBlock["kind"],
  start: Number(r.start_min),
  end: Number(r.end_min),
  state: r.state as ScheduleBlock["state"],
  proposed: b(r.proposed),
  pinned: b(r.pinned),
  part: Number(r.part),
  partCount: Number(r.part_count),
  reason: String(r.reason ?? ""),
  createdAt: String(r.created_at),
});

function parseNotes(v: unknown): UnscheduledNote[] {
  try {
    const parsed = JSON.parse(String(v ?? "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---- statement builders ----------------------------------------------------------

function insert(table: string, row: Record<string, SqlParam>): SqlStatement {
  const cols = Object.keys(row);
  return {
    sql: `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    params: cols.map((c) => row[c]),
  };
}

function update(table: string, id: string, row: Record<string, SqlParam>, key = "id"): SqlStatement {
  const cols = Object.keys(row);
  return {
    sql: `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${key} = ?`,
    params: [...cols.map((c) => row[c]), id],
  };
}

const bool = (v: boolean) => (v ? 1 : 0);

function taskRow(t: Task): Record<string, SqlParam> {
  return {
    id: t.id,
    goal_id: t.goalId,
    milestone_id: t.milestoneId,
    project_id: t.projectId,
    title: t.title,
    notes: t.notes,
    priority: t.priority,
    estimate_min: t.estimateMin,
    deadline: t.deadline,
    deadline_time: t.deadlineTime,
    energy: t.energy,
    status: t.status,
    in_planner: bool(t.inPlanner),
    progress_min: t.progressMin,
    sort_order: t.sortOrder,
    origin: t.origin,
    edited: bool(t.edited),
    is_sample: bool(t.isSample),
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    completed_at: t.completedAt,
  };
}

const TASK_PATCH_COLUMNS: Partial<Record<keyof Task, string>> = {
  title: "title",
  notes: "notes",
  priority: "priority",
  estimateMin: "estimate_min",
  deadline: "deadline",
  deadlineTime: "deadline_time",
  energy: "energy",
  status: "status",
  inPlanner: "in_planner",
  progressMin: "progress_min",
  sortOrder: "sort_order",
  edited: "edited",
  completedAt: "completed_at",
  milestoneId: "milestone_id",
  projectId: "project_id",
};

function blockRow(bl: ScheduleBlock): Record<string, SqlParam> {
  return {
    id: bl.id,
    date: bl.date,
    task_id: bl.taskId,
    kind: bl.kind,
    start_min: bl.start,
    end_min: bl.end,
    state: bl.state,
    proposed: bool(bl.proposed),
    pinned: bool(bl.pinned),
    part: bl.part,
    part_count: bl.partCount,
    reason: bl.reason,
    created_at: bl.createdAt,
  };
}

export function makePlan(partial: Partial<Plan> & Pick<Plan, "type" | "title" | "start" | "end">): Plan {
  const ts = nowIso();
  return {
    id: newId(),
    description: "",
    weekdays: 0,
    dates: null,
    validFrom: null,
    goalId: null,
    isBreak: false,
    isSample: false,
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}

export function makeTask(partial: Partial<Task> & { title: string }): Task {
  const ts = nowIso();
  return {
    id: newId(),
    goalId: null,
    milestoneId: null,
    projectId: null,
    notes: "",
    priority: 2,
    estimateMin: DEFAULT_PREFERENCES.defaultEstimateMin,
    deadline: null,
    deadlineTime: null,
    energy: null,
    status: "todo",
    inPlanner: false,
    progressMin: 0,
    sortOrder: 0,
    origin: "manual",
    edited: false,
    isSample: false,
    createdAt: ts,
    updatedAt: ts,
    completedAt: null,
    ...partial,
  };
}

// ---- snapshot ---------------------------------------------------------------------

export interface AiSettings {
  provider: "none" | "anthropic";
  apiKey: string;
  model: string;
}

export const DEFAULT_AI: AiSettings = { provider: "none", apiKey: "", model: "claude-opus-5-5" };

export interface DayPlanRow {
  date: DateKey;
  generatedAt: string | null;
  acceptedAt: string | null;
  notes: UnscheduledNote[];
  proposalNotes: UnscheduledNote[];
  proposalSummary: string;
}

export interface Snapshot {
  goals: Goal[];
  milestones: Milestone[];
  projects: Project[];
  tasks: Task[];
  plans: Plan[];
  /** Plans seen as fixed time, derived for the day scheduler. */
  commitments: Commitment[];
  notes: Note[];
  dreams: Dream[];
  playlists: Playlist[];
  songs: Song[];
  userQuotes: UserQuote[];
  blocks: ScheduleBlock[];
  dayPlans: Record<DateKey, DayPlanRow>;
  skips: Record<DateKey, string[]>;
  events: TaskEvent[];
  prefs: Preferences;
  ai: AiSettings;
  flags: Record<string, string>;
}

export class Repository {
  constructor(private readonly db: SqlDriver) {}

  get engine() {
    return this.db.engine;
  }

  location() {
    return this.db.location();
  }

  async loadSnapshot(): Promise<Snapshot> {
    const [goals, milestones, projects, tasks, planRows, noteRows, dreamRows, playlistRows, songRows, quoteRows, blocks, dayPlanRows, skips, events, settings] = await Promise.all([
      this.db.select<Row>("SELECT * FROM goals ORDER BY sort_order, created_at"),
      this.db.select<Row>("SELECT * FROM milestones ORDER BY sort_order, created_at"),
      this.db.select<Row>("SELECT * FROM projects ORDER BY sort_order, created_at"),
      this.db.select<Row>("SELECT * FROM tasks ORDER BY sort_order, created_at"),
      this.db.select<Row>("SELECT * FROM plans ORDER BY start_min"),
      this.db.select<Row>("SELECT * FROM notes ORDER BY urgency DESC, created_at DESC"),
      this.db.select<Row>("SELECT * FROM dreams ORDER BY created_at DESC"),
      this.db.select<Row>("SELECT * FROM playlists ORDER BY created_at"),
      this.db.select<Row>("SELECT * FROM songs ORDER BY sort_order, created_at"),
      this.db.select<Row>("SELECT * FROM quotes ORDER BY created_at"),
      this.db.select<Row>("SELECT * FROM schedule_blocks ORDER BY date, start_min"),
      this.db.select<Row>("SELECT * FROM day_plans"),
      this.db.select<Row>("SELECT * FROM day_skips"),
      this.db.select<Row>("SELECT * FROM task_events ORDER BY at DESC LIMIT 1000"),
      this.db.select<Row>("SELECT * FROM settings"),
    ]);
    const plans = planRows.map(planFrom);
    const settingsMap = Object.fromEntries(settings.map((r) => [String(r.key), String(r.value)]));
    const parseJson = <T,>(key: string, fallback: T): T => {
      try {
        return settingsMap[key] ? { ...fallback, ...JSON.parse(settingsMap[key]) } : fallback;
      } catch {
        return fallback;
      }
    };
    const skipMap: Record<string, string[]> = {};
    for (const r of skips) (skipMap[String(r.date)] ??= []).push(String(r.task_id));
    const flags: Record<string, string> = {};
    for (const [k, v] of Object.entries(settingsMap)) if (k.startsWith("flag.")) flags[k.slice(5)] = v;

    return {
      goals: goals.map(goalFrom),
      milestones: milestones.map(milestoneFrom),
      projects: projects.map(projectFrom),
      tasks: tasks.map(taskFrom),
      plans,
      commitments: plansToCommitments(plans),
      notes: noteRows.map(noteFrom),
      dreams: dreamRows.map((r) => ({ id: String(r.id), title: String(r.title), body: String(r.body ?? ""), createdAt: String(r.created_at) })),
      playlists: playlistRows.map((r) => ({ id: String(r.id), name: String(r.name), icon: String(r.icon), createdAt: String(r.created_at) })),
      songs: songRows.map((r) => ({
        id: String(r.id),
        playlistId: String(r.playlist_id),
        title: String(r.title),
        artist: String(r.artist ?? ""),
        ext: String(r.ext),
        sizeBytes: Number(r.size_bytes),
        durationSec: Number(r.duration_sec),
        sortOrder: Number(r.sort_order),
        createdAt: String(r.created_at),
      })),
      userQuotes: quoteRows.map((r) => ({ id: String(r.id), text: String(r.text), createdAt: String(r.created_at) })),
      blocks: blocks.map(blockFrom),
      dayPlans: Object.fromEntries(
        dayPlanRows.map((r) => [
          String(r.date),
          {
            date: String(r.date),
            generatedAt: s(r.generated_at),
            acceptedAt: s(r.accepted_at),
            notes: parseNotes(r.notes),
            proposalNotes: parseNotes(r.proposal_notes),
            proposalSummary: String(r.proposal_summary ?? ""),
          },
        ]),
      ),
      skips: skipMap,
      events: events.map((r) => ({
        id: String(r.id),
        taskId: String(r.task_id ?? ""),
        type: r.type as TaskEventType,
        date: String(r.date),
        minutes: n(r.minutes),
        at: String(r.at),
      })),
      prefs: parseJson("preferences", DEFAULT_PREFERENCES),
      ai: parseJson("ai", DEFAULT_AI),
      flags,
    };
  }

  // ---- settings -------------------------------------------------------------------

  async setSetting(key: string, value: unknown) {
    await this.db.execute(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, typeof value === "string" ? value : JSON.stringify(value)],
    );
  }

  savePreferences(p: Preferences) {
    return this.setSetting("preferences", p);
  }

  saveAi(ai: AiSettings) {
    return this.setSetting("ai", ai);
  }

  setFlag(name: string, value: string) {
    return this.setSetting(`flag.${name}`, value);
  }

  // ---- goals ------------------------------------------------------------------------

  /** Inserts a compiled plan as a new goal. Returns the goal id. */
  async createGoalFromPlan(plan: CompiledPlan, opts: { isSample?: boolean; sortOrder?: number } = {}): Promise<string> {
    const ts = nowIso();
    const goalId = newId();
    const sample = bool(!!opts.isSample);
    const stmts: SqlStatement[] = [
      insert("goals", {
        id: goalId,
        title: plan.title,
        description: plan.description,
        target_date: plan.targetDate,
        source: plan.source,
        source_model: plan.model,
        is_sample: sample,
        archived: 0,
        sort_order: opts.sortOrder ?? 0,
        revision: 1,
        created_at: ts,
        updated_at: ts,
      }),
    ];
    let order = 0;
    plan.milestones.forEach((m, mi) => {
      const milestoneId = newId();
      stmts.push(
        insert("milestones", {
          id: milestoneId,
          goal_id: goalId,
          title: m.title,
          description: m.description,
          deadline: m.deadline,
          sort_order: mi,
          created_at: ts,
        }),
      );
      m.projects.forEach((p, pi) => {
        const projectId = newId();
        stmts.push(insert("projects", { id: projectId, milestone_id: milestoneId, title: p.title, sort_order: pi, created_at: ts }));
        for (const t of p.tasks) {
          stmts.push(
            insert(
              "tasks",
              taskRow(
                makeTask({
                  ...t,
                  goalId,
                  milestoneId,
                  projectId,
                  origin: plan.source === "manual" ? "manual" : "generated",
                  isSample: !!opts.isSample,
                  sortOrder: order++,
                }),
              ),
            ),
          );
        }
      });
    });
    await this.db.batch(stmts);
    return goalId;
  }

  async updateGoal(id: string, patch: Partial<Pick<Goal, "title" | "description" | "targetDate" | "archived" | "sortOrder">>) {
    const row: Record<string, SqlParam> = { updated_at: nowIso() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.targetDate !== undefined) row.target_date = patch.targetDate;
    if (patch.archived !== undefined) row.archived = bool(patch.archived);
    if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
    const st = update("goals", id, row);
    await this.db.execute(st.sql, st.params);
  }

  async deleteGoal(id: string) {
    await this.db.execute("DELETE FROM goals WHERE id = ?", [id]);
  }

  async reviseGoal(goalId: string, rev: RevisionPlan, plan: CompiledPlan) {
    const ts = nowIso();
    const stmts: SqlStatement[] = [];
    for (const id of rev.removeTaskIds) stmts.push({ sql: "DELETE FROM tasks WHERE id = ?", params: [id] });
    for (const id of rev.removeProjectIds) stmts.push({ sql: "DELETE FROM projects WHERE id = ?", params: [id] });
    for (const id of rev.removeMilestoneIds) stmts.push({ sql: "DELETE FROM milestones WHERE id = ?", params: [id] });
    for (const u of rev.milestoneUpdates) {
      stmts.push(update("milestones", u.id, { deadline: u.deadline, description: u.description, sort_order: u.sortOrder }));
    }

    const usedNewMilestones = new Set<number>();
    const usedNewProjects = new Set<number>();
    for (const t of rev.newTasks) {
      if ("newIndex" in t.milestone) usedNewMilestones.add(t.milestone.newIndex);
      if ("newIndex" in t.project) usedNewProjects.add(t.project.newIndex);
    }
    const milestoneIds = rev.newMilestones.map(() => newId());
    const projectIds = rev.newProjects.map(() => newId());
    rev.newMilestones.forEach((m, i) => {
      if (!usedNewMilestones.has(i)) return;
      stmts.push(
        insert("milestones", {
          id: milestoneIds[i],
          goal_id: goalId,
          title: m.title,
          description: m.description,
          deadline: m.deadline,
          sort_order: m.sortOrder,
          created_at: ts,
        }),
      );
    });
    const resolveM = (ref: { existingId: string } | { newIndex: number }) =>
      "existingId" in ref ? ref.existingId : milestoneIds[ref.newIndex];
    rev.newProjects.forEach((p, i) => {
      if (!usedNewProjects.has(i)) return;
      stmts.push(insert("projects", { id: projectIds[i], milestone_id: resolveM(p.milestone), title: p.title, sort_order: p.sortOrder, created_at: ts }));
    });
    for (const nt of rev.newTasks) {
      stmts.push(
        insert(
          "tasks",
          taskRow(
            makeTask({
              ...nt.task,
              goalId,
              milestoneId: resolveM(nt.milestone),
              projectId: "existingId" in nt.project ? nt.project.existingId : projectIds[nt.project.newIndex],
              origin: "generated",
              sortOrder: nt.sortOrder,
            }),
          ),
        ),
      );
    }
    stmts.push({
      sql: "UPDATE goals SET revision = revision + 1, updated_at = ?, source = ?, source_model = ?, target_date = COALESCE(?, target_date) WHERE id = ?",
      params: [ts, plan.source, plan.model, plan.targetDate, goalId],
    });
    await this.db.batch(stmts);
  }

  // ---- milestones & projects -------------------------------------------------------

  async createMilestone(goalId: string, title: string, sortOrder: number): Promise<string> {
    const id = newId();
    const ts = nowIso();
    const projectId = newId();
    await this.db.batch([
      insert("milestones", { id, goal_id: goalId, title, description: "", deadline: null, sort_order: sortOrder, created_at: ts }),
      insert("projects", { id: projectId, milestone_id: id, title: "Tasks", sort_order: 0, created_at: ts }),
    ]);
    return id;
  }

  async updateMilestone(id: string, patch: Partial<Pick<Milestone, "title" | "description" | "deadline">>) {
    const row: Record<string, SqlParam> = {};
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.deadline !== undefined) row.deadline = patch.deadline;
    if (!Object.keys(row).length) return;
    const st = update("milestones", id, row);
    await this.db.execute(st.sql, st.params);
  }

  async deleteMilestone(id: string) {
    await this.db.execute("DELETE FROM milestones WHERE id = ?", [id]);
  }

  async reorder(table: "milestones" | "projects" | "tasks" | "goals", ids: string[]) {
    await this.db.batch(ids.map((id, i) => ({ sql: `UPDATE ${table} SET sort_order = ? WHERE id = ?`, params: [i, id] })));
  }

  async createProject(milestoneId: string, title: string, sortOrder: number): Promise<string> {
    const id = newId();
    await this.db.execute(
      "INSERT INTO projects (id, milestone_id, title, sort_order, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, milestoneId, title, sortOrder, nowIso()],
    );
    return id;
  }

  async renameProject(id: string, title: string) {
    await this.db.execute("UPDATE projects SET title = ? WHERE id = ?", [title, id]);
  }

  async deleteProject(id: string) {
    await this.db.execute("DELETE FROM projects WHERE id = ?", [id]);
  }

  // ---- tasks ---------------------------------------------------------------------------

  async createTask(task: Task) {
    const st = insert("tasks", taskRow(task));
    await this.db.execute(st.sql, st.params);
  }

  taskPatchStatement(id: string, patch: Partial<Task>): SqlStatement {
    const row: Record<string, SqlParam> = { updated_at: nowIso() };
    for (const [k, col] of Object.entries(TASK_PATCH_COLUMNS)) {
      const v = patch[k as keyof Task];
      if (v === undefined) continue;
      row[col!] = typeof v === "boolean" ? bool(v) : (v as SqlParam);
    }
    return update("tasks", id, row);
  }

  async updateTask(id: string, patch: Partial<Task>) {
    const st = this.taskPatchStatement(id, patch);
    await this.db.execute(st.sql, st.params);
  }

  async deleteTask(id: string) {
    await this.db.execute("DELETE FROM tasks WHERE id = ?", [id]);
  }

  eventStatement(task: Pick<Task, "id" | "title" | "goalId">, type: TaskEventType, date: DateKey, minutes: number | null = null): SqlStatement {
    return insert("task_events", {
      id: newId(),
      task_id: task.id,
      task_title: task.title,
      goal_id: task.goalId,
      type,
      date,
      minutes,
      at: nowIso(),
    });
  }

  // ---- plans and notes ---------------------------------------------------------------

  planUpsert(p: Plan): SqlStatement {
    return {
      sql: `INSERT INTO plans (id, type, title, description, weekdays, dates, valid_from, start_min, end_min, goal_id, is_break, is_sample, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET type = excluded.type, title = excluded.title, description = excluded.description,
              weekdays = excluded.weekdays, dates = excluded.dates, valid_from = excluded.valid_from, start_min = excluded.start_min,
              end_min = excluded.end_min, goal_id = excluded.goal_id, updated_at = excluded.updated_at`,
      params: [
        p.id, p.type, p.title, p.description, p.weekdays, p.dates ? JSON.stringify(p.dates) : null, p.validFrom,
        p.start, p.end, p.goalId, bool(p.isBreak), bool(p.isSample), p.createdAt, nowIso(),
      ],
    };
  }

  async deletePlan(id: string) {
    await this.db.execute("DELETE FROM plans WHERE id = ?", [id]);
  }

  async saveNote(n: Note) {
    await this.db.execute(
      `INSERT INTO notes (id, title, description, urgency, remind_at, reminded, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, urgency = excluded.urgency,
         remind_at = excluded.remind_at, reminded = excluded.reminded`,
      [n.id, n.title, n.description, n.urgency, n.remindAt, bool(n.reminded), n.createdAt],
    );
  }

  /** Swaps a goal's weekly sessions for a new set in one transaction, so it's never left half done. */
  async replaceGoalSessions(goalId: string, sessions: Plan[]) {
    await this.db.batch([{ sql: "DELETE FROM plans WHERE goal_id = ?", params: [goalId] }, ...sessions.map((p) => this.planUpsert(p))]);
  }

  async saveDream(d: Dream) {
    await this.db.execute(
      `INSERT INTO dreams (id, title, body, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body`,
      [d.id, d.title, d.body, d.createdAt],
    );
  }

  async deleteDream(id: string) {
    await this.db.execute("DELETE FROM dreams WHERE id = ?", [id]);
  }

  async savePlaylist(p: Playlist) {
    await this.db.execute(
      `INSERT INTO playlists (id, name, icon, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon`,
      [p.id, p.name, p.icon, p.createdAt],
    );
  }

  async deletePlaylist(id: string) {
    await this.db.execute("DELETE FROM playlists WHERE id = ?", [id]);
  }

  async saveSong(s: Song) {
    await this.db.execute(
      `INSERT INTO songs (id, playlist_id, title, artist, ext, size_bytes, duration_sec, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [s.id, s.playlistId, s.title, s.artist, s.ext, s.sizeBytes, s.durationSec, s.sortOrder, s.createdAt],
    );
  }

  async deleteSong(id: string) {
    await this.db.execute("DELETE FROM songs WHERE id = ?", [id]);
  }

  async saveQuote(q: UserQuote) {
    await this.db.execute("INSERT INTO quotes (id, text, created_at) VALUES (?, ?, ?)", [q.id, q.text, q.createdAt]);
  }

  async deleteQuote(id: string) {
    await this.db.execute("DELETE FROM quotes WHERE id = ?", [id]);
  }

  async deleteNote(id: string) {
    await this.db.execute("DELETE FROM notes WHERE id = ?", [id]);
  }

  // ---- schedule blocks & day plans -------------------------------------------------------

  blockInsert(bl: ScheduleBlock): SqlStatement {
    return insert("schedule_blocks", blockRow(bl));
  }

  blockUpdate(id: string, patch: Partial<Pick<ScheduleBlock, "start" | "end" | "state" | "pinned" | "proposed" | "reason" | "part" | "partCount">>): SqlStatement {
    const row: Record<string, SqlParam> = {};
    if (patch.start !== undefined) row.start_min = patch.start;
    if (patch.end !== undefined) row.end_min = patch.end;
    if (patch.state !== undefined) row.state = patch.state;
    if (patch.pinned !== undefined) row.pinned = bool(patch.pinned);
    if (patch.proposed !== undefined) row.proposed = bool(patch.proposed);
    if (patch.reason !== undefined) row.reason = patch.reason;
    if (patch.part !== undefined) row.part = patch.part;
    if (patch.partCount !== undefined) row.part_count = patch.partCount;
    return update("schedule_blocks", id, row);
  }

  blockDelete(id: string): SqlStatement {
    return { sql: "DELETE FROM schedule_blocks WHERE id = ?", params: [id] };
  }

  dayPlanUpsert(date: DateKey, patch: Partial<Omit<DayPlanRow, "date">>): SqlStatement {
    const cols: Record<string, SqlParam> = {};
    if (patch.generatedAt !== undefined) cols.generated_at = patch.generatedAt;
    if (patch.acceptedAt !== undefined) cols.accepted_at = patch.acceptedAt;
    if (patch.notes !== undefined) cols.notes = JSON.stringify(patch.notes);
    if (patch.proposalNotes !== undefined) cols.proposal_notes = JSON.stringify(patch.proposalNotes);
    if (patch.proposalSummary !== undefined) cols.proposal_summary = patch.proposalSummary;
    const keys = Object.keys(cols);
    return {
      sql: `INSERT INTO day_plans (date${keys.map((k) => `, ${k}`).join("")}) VALUES (?${keys.map(() => ", ?").join("")})
            ON CONFLICT(date) DO UPDATE SET ${keys.length ? keys.map((k) => `${k} = excluded.${k}`).join(", ") : "date = excluded.date"}`,
      params: [date, ...keys.map((k) => cols[k])],
    };
  }

  skipStatement(date: DateKey, taskId: string, skip: boolean): SqlStatement {
    return skip
      ? { sql: "INSERT OR IGNORE INTO day_skips (date, task_id) VALUES (?, ?)", params: [date, taskId] }
      : { sql: "DELETE FROM day_skips WHERE date = ? AND task_id = ?", params: [date, taskId] };
  }

  run(statements: SqlStatement[]) {
    return this.db.batch(statements);
  }

  /** An automatic break exists only to precede a task; drop it once that task has moved or gone. */
  async pruneOrphanBreaks() {
    await this.db.execute(
      `DELETE FROM schedule_blocks
       WHERE kind = 'break' AND state = 'planned' AND NOT EXISTS (
         SELECT 1 FROM schedule_blocks t
         WHERE t.date = schedule_blocks.date AND t.proposed = schedule_blocks.proposed
           AND t.kind = 'task' AND t.state != 'skipped' AND t.start_min = schedule_blocks.end_min
       )`,
    );
  }

  // ---- data management ------------------------------------------------------------------

  async deleteSampleData() {
    await this.db.batch([
      { sql: "DELETE FROM tasks WHERE is_sample = 1" },
      { sql: "DELETE FROM goals WHERE is_sample = 1" },
      { sql: "DELETE FROM plans WHERE is_sample = 1" },
      { sql: "DELETE FROM settings WHERE key = 'flag.sampleLoaded'" },
    ]);
  }

  async resetAll() {
    await this.db.batch(
      ["task_events", "day_skips", "day_plans", "schedule_blocks", "plans", "notes", "dreams", "songs", "playlists", "quotes", "tasks", "projects", "milestones", "goals", "settings"].map(
        (t) => ({ sql: `DELETE FROM ${t}` }),
      ),
    );
  }
}
