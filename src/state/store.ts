import { create } from "zustand";
import { compilePlan, type CompileOutcome } from "../ai/planProvider";
import { compileGoal, type CompiledPlan, type GoalRequest } from "../domain/goalCompiler";
import type { Trigger } from "../domain/explain";
import { planRevision, type RevisionPlan } from "../domain/revision";
import { prependPart, encodeParts } from "../domain/explain";
import { replanGoalSessions, type GoalSession } from "../domain/goalPlanner";
import { getLang, setLang, weekStartDay, type Lang } from "../domain/locale";
import { dayBit, weekDates } from "../domain/plans";
import { hasLetters } from "../domain/text";
import { DEFAULT_THEME, themeById, themeTokens, type ThemeId } from "../domain/themes";
import { dateTimeKey, formatClock, formatDuration, minutesOfDay, toDateKey } from "../domain/time";
import { explain, t } from "../i18n";
import type {
  DateKey,
  Dream,
  Playlist,
  Song,
  Goal,
  Milestone,
  Note,
  Plan,
  Preferences,
  Task,
  TaskStatus,
} from "../domain/types";
import { audioStore } from "../persistence/audioStore";
import { isTauri, openDefaultDriver, type SqlStatement } from "../persistence/driver";
import { migrate } from "../persistence/migrations";
import { makePlan, makeTask, newId, nowIso, Repository, type AiSettings, type Snapshot } from "../persistence/repository";
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

export type View = "today" | "week" | "goals" | "planner" | "dreams" | "settings";
export type PlannerMode = "plans" | "day";

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
  plannerMode: PlannerMode;
  /** A note whose reminder just came due, shown as a popup. */
  reminderNote: Note | null;
  relaxPickerOpen: boolean;
  relaxSession: { title: string; minutes: number } | null;
  relaxClosing: boolean;
  lang: Lang;
  theme: ThemeId;
}

const LANG_KEY = "life-os.lang";

/** Applies a language to the formatters and the document (reading direction and font). */
function applyLang(lang: Lang) {
  setLang(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Only a first-paint convenience; the database holds the real setting.
  }
}

const THEME_KEY = "life-os.theme";

/** Fills every colour token from a theme and tells the window whether it's light or dark. */
function applyTheme(id: ThemeId) {
  const theme = themeById(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.classList.toggle("scened", theme.id !== DEFAULT_THEME);
  root.classList.toggle("lit", theme.scheme === "light");
  root.style.colorScheme = theme.scheme;
  for (const [token, value] of Object.entries(themeTokens(theme))) root.style.setProperty(token, value);
  try {
    localStorage.setItem(THEME_KEY, theme.id);
  } catch {
    // Only a first-paint convenience; the database holds the real setting.
  }
  if (isTauri()) {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setTheme(theme.scheme)).catch(() => undefined);
  }
}

function initialTheme(): ThemeId {
  try {
    return themeById(localStorage.getItem(THEME_KEY)).id;
  } catch {
    return DEFAULT_THEME;
  }
}

function initialLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "fa" ? "fa" : "en";
  } catch {
    return "en";
  }
}

const emptySnapshot = (): Snapshot => ({
  goals: [],
  milestones: [],
  projects: [],
  tasks: [],
  plans: [],
  commitments: [],
  notes: [],
  dreams: [],
  playlists: [],
  songs: [],
  userQuotes: [],
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
    sleepStart: null,
    wakeTime: null,
    planGap: true,
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
  if (!repo) throw new Error(t.errDbNotReady);
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
  plannerMode: "plans",
  reminderNote: null,
  relaxPickerOpen: false,
  relaxSession: null,
  relaxClosing: false,
  lang: "en",
  theme: DEFAULT_THEME,
}));

if (typeof document !== "undefined") {
  const lang = initialLang();
  applyLang(lang);
  const theme = initialTheme();
  applyTheme(theme);
  useApp.setState({ lang, theme });
}

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
async function mutate<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const out = await fn();
    await refresh();
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    toast(e instanceof PlanningError ? msg : t.errSave(msg), "error");
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
    const lang: Lang = snap.flags.language === "fa" ? "fa" : snap.flags.language === "en" ? "en" : getLang();
    applyLang(lang);
    const theme = snap.flags.theme ? themeById(snap.flags.theme).id : get().theme;
    applyTheme(theme);
    set({ ...snap, lang, theme, status: "ready", engine: repo.engine, location, clock: readClock() });
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
  void checkReminders();
}

async function checkReminders() {
  const s = get();
  if (s.status !== "ready" || s.reminderNote) return;
  const nowKey = dateTimeKey(s.clock.today, s.clock.nowMin);
  const due = s.notes.find((n) => n.remindAt && !n.reminded && n.remindAt <= nowKey);
  if (!due) return;
  set({ reminderNote: due });
  await mutate(() => R().saveNote({ ...due, reminded: true }));
  if (isTauri()) {
    // Flashes the taskbar so a reminder isn't missed behind other windows.
    const { getCurrentWindow, UserAttentionType } = await import("@tauri-apps/api/window");
    await getCurrentWindow().requestUserAttention(UserAttentionType.Informational).catch(() => undefined);
  }
}

export const dismissReminder = () => set({ reminderNote: null });

export async function saveNote(note: Note) {
  const ok = await mutate(async () => {
    await R().saveNote(note);
    return true;
  });
  return !!ok;
}

// ---- dreams

export async function saveDream(dream: Dream) {
  const ok = await mutate(async () => {
    await R().saveDream(dream);
    return true;
  });
  return !!ok;
}

export async function deleteDream(id: string) {
  await mutate(() => R().deleteDream(id));
  toast(t.toastDreamDeleted);
}

// ---- relax

export const openRelaxPicker = () => set({ relaxPickerOpen: true });

export function startRelax(title: string, minutes: number) {
  set({ relaxPickerOpen: false, relaxClosing: false, relaxSession: { title, minutes } });
}

/** Plays the exit animation, then removes the screen (which stops the music). */
export function leaveRelax() {
  if (get().relaxClosing) return;
  set({ relaxClosing: true });
  setTimeout(() => set({ relaxSession: null, relaxClosing: false }), 460);
}

export const savePlaylist = (playlist: Playlist) => mutate(() => R().savePlaylist(playlist));

export const addSong = (song: Song) => mutate(() => R().saveSong(song));

export async function deleteSong(song: Song) {
  await mutate(() => R().deleteSong(song.id));
  await audioStore().remove(song.id, song.ext).catch(() => undefined);
}

export async function deletePlaylist(id: string) {
  const songs = get().songs.filter((x) => x.playlistId === id);
  await mutate(() => R().deletePlaylist(id));
  await Promise.all(songs.map((x) => audioStore().remove(x.id, x.ext).catch(() => undefined)));
}

// ---- quotes

/** Built-in quotes the user has removed. */
export function hiddenQuotes(flags: Record<string, string>): string[] {
  try {
    const parsed = JSON.parse(flags.hiddenQuotes ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function addQuote(text: string) {
  await mutate(() => R().saveQuote({ id: newId(), text: text.trim(), createdAt: nowIso() }));
}

export const deleteQuote = (id: string) => mutate(() => R().deleteQuote(id));

export const setHiddenQuotes = (list: string[]) => mutate(() => R().setFlag("hiddenQuotes", JSON.stringify(list)));

export async function deleteNote(id: string) {
  await mutate(() => R().deleteNote(id));
  toast(t.toastNoteDeleted);
}

export async function setLanguage(lang: Lang) {
  applyLang(lang);
  set({ lang });
  await mutate(() => R().setFlag("language", lang));
}

export async function setTheme(id: ThemeId) {
  // Colours glide instead of snapping, only during the switch so normal use stays snappy.
  const root = document.documentElement;
  root.classList.add("theme-changing");
  setTimeout(() => root.classList.remove("theme-changing"), 600);
  applyTheme(id);
  set({ theme: id });
  await mutate(() => R().setFlag("theme", id));
}

export const navigate = (view: View) => set({ view });
export const selectGoal = (id: string | null) => set({ selectedGoalId: id, view: "goals" });
export const setPlannerDate = (date: DateKey) => set({ plannerDate: date, plannerMode: "day" });
export const setPlannerMode = (plannerMode: PlannerMode) => set({ plannerMode });
export const openComposer = (open: boolean) => set({ composerOpen: open });

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
  return compilePlan({ ...req, today: s.clock.today, lang: getLang() }, s.ai, { useAi, description });
}

/** Creates a goal together with the weekly sessions planned for it. */
export async function createGoalWithSessions(plan: CompiledPlan, sessions: GoalSession[]) {
  const s = get();
  const validFrom = weekDates(s.clock.today, weekStartDay())[0];
  const id = await mutate(async () => {
    const r = R();
    const goalId = await r.createGoalFromPlan(plan, { sortOrder: s.goals.length });
    try {
      const rows = sessions.map((x) =>
        makePlan({ type: "goal", title: plan.title, description: plan.description, goalId, weekdays: dayBit(x.weekday), validFrom, start: x.start, end: x.end }),
      );
      await r.run(rows.map((p) => r.planUpsert(p)));
    } catch (e) {
      // A goal without its sessions would be half a plan.
      await r.deleteGoal(goalId);
      throw e;
    }
    return goalId;
  });
  if (id) set({ selectedGoalId: id });
  return id;
}

export const updateGoal = (id: string, patch: Partial<Pick<Goal, "title" | "description" | "targetDate" | "archived">>) =>
  mutate(() => R().updateGoal(id, patch));

/** Lowers a goal's weekly hours and re-plans its sessions. Returns a message if that isn't possible. */
export async function decreaseGoalHours(goal: Goal, hours: number): Promise<string | null> {
  const s = get();
  const result = replanGoalSessions({ goalId: goal.id, hours, plans: s.plans, prefs: s.prefs, today: s.clock.today });
  if (!result.ok) return t.goalFullText(formatDuration(result.neededMin), formatDuration(result.placedMin));
  const validFrom = weekDates(s.clock.today, weekStartDay())[0];
  const previous = s.plans.find((p) => p.goalId === goal.id);
  const rows = result.sessions.map((x) =>
    makePlan({
      type: "goal",
      title: previous?.title ?? goal.title,
      description: previous?.description ?? goal.description,
      goalId: goal.id,
      weekdays: dayBit(x.weekday),
      validFrom,
      start: x.start,
      end: x.end,
      isSample: goal.isSample,
    }),
  );
  const ok = await mutate(async () => {
    await R().replaceGoalSessions(goal.id, rows);
    return true;
  });
  if (!ok) return t.errReplan;
  toast(t.toastHoursDecreased(formatDuration(result.placedMin)), "success");
  return null;
}

export async function deleteGoal(id: string) {
  await mutate(() => R().deleteGoal(id));
  set((s) => ({ selectedGoalId: s.selectedGoalId === id ? null : s.selectedGoalId }));
  toast(t.toastGoalDeleted);
}

export interface RevisionPreview {
  outcome: CompileOutcome;
  revision: RevisionPlan;
}

export async function previewRevision(goalId: string, text: string, opts: { targetDate: DateKey | null; hoursPerWeek: number; useAi: boolean; description: string }): Promise<RevisionPreview> {
  const s = get();
  const outcome = await compilePlan(
    { text, targetDate: opts.targetDate, hoursPerWeek: opts.hoursPerWeek, today: s.clock.today, lang: getLang() },
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
  toast(t.toastRevised(preview.revision.summary.kept), "success");
}

// ---- milestones & projects -------------------------------------------------------------------

export const addMilestone = (goalId: string, title: string) =>
  mutate(() => R().createMilestone(goalId, title.trim() || t.newMilestone, get().milestones.filter((m) => m.goalId === goalId).length));

export const updateMilestone = (id: string, patch: Partial<Pick<Milestone, "title" | "description" | "deadline">>) =>
  mutate(() => R().updateMilestone(id, patch));

export const deleteMilestone = (id: string) => mutate(() => R().deleteMilestone(id));

export const reorder = (table: "milestones" | "projects" | "tasks" | "goals", ids: string[]) =>
  mutate(() => R().reorder(table, ids));

export const addProject = (milestoneId: string, title: string) =>
  mutate(() => R().createProject(milestoneId, title.trim() || t.newProject, get().projects.filter((p) => p.milestoneId === milestoneId).length));

export const renameProject = (id: string, title: string) => mutate(() => R().renameProject(id, title));
export const deleteProject = (id: string) => mutate(() => R().deleteProject(id));

// ---- tasks ---------------------------------------------------------------------------------------

export async function addTask(partial: Partial<Task> & { title: string }) {
  const title = partial.title.trim();
  if (!title || !hasLetters(title)) {
    toast(title ? t.textNoLetters : t.errTaskTitle, "error");
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
  if (patch.title !== undefined && !patch.title.trim()) return t.errTaskTitle;
  if (patch.title !== undefined && !hasLetters(patch.title)) return t.textNoLetters;
  if (patch.estimateMin !== undefined && (!Number.isFinite(patch.estimateMin) || patch.estimateMin < 5 || patch.estimateMin > 960)) {
    return t.errDuration;
  }
  if (patch.deadlineTime != null && (patch.deadlineTime < 0 || patch.deadlineTime > 1440)) return t.errDeadlineTime;
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
  if (n && inPlanner) toast(t.toastAddedToBacklog(n), "success");
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
    toast(t.toastBacklogFallback(explain(result.unscheduled[0]?.message) || t.noSlotThatDay), "info");
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
        reason: p.kind === "task" ? prependPart({ k: "byYouSlot" }, p.reason) : p.reason,
        createdAt: nowIso(),
      }),
    );
  }
  stmts.push(r.dayPlanUpsert(date, { acceptedAt: nowIso() }));
  await mutate(() => r.run(stmts));
  const first = placed.find((b) => b.kind === "task")!;
  toast(t.toastScheduled(task.title, formatClock(first.start), date === s.clock.today), "success");
}

// ---- preferences, commitments, AI -----------------------------------------------------------------------

export function validatePrefs(p: Preferences): string | null {
  if (p.sleepStart != null && p.wakeTime != null && p.sleepStart % 1440 === p.wakeTime % 1440) return t.errSleepSame;
  if (p.workEnd <= p.workStart) return t.errWorkHours;
  if (p.focusEnd <= p.focusStart) return t.errFocusHours;
  if (p.bufferMin < 0 || p.bufferMin > 60) return t.errBuffer;
  if (p.breakAfterMin !== 0 && (p.breakAfterMin < 30 || p.breakAfterMin > 300)) return t.errBreakAfter;
  if (p.breakLengthMin < 5 || p.breakLengthMin > 60) return t.errBreakLength;
  if (p.minSessionMin < 10 || p.minSessionMin > 180) return t.errMinSession;
  if (p.defaultEstimateMin < 5 || p.defaultEstimateMin > 480) return t.errDefaultDuration;
  return null;
}

export async function savePrefs(p: Preferences) {
  const error = validatePrefs(p);
  if (error) {
    toast(error, "error");
    return false;
  }
  await mutate(() => R().savePreferences(p));
  toast(t.toastPrefsSaved, "success");
  return true;
}

/** Saves a plan and recalculates any day plan it now collides with. */
export async function savePlan(plan: Plan, isNew: boolean) {
  const ok = await mutate(async () => {
    await R().run([R().planUpsert(plan)]);
    return true;
  });
  if (!ok) return false;
  await reflowAffected({ t: isNew ? "added" : "changed", title: plan.title, at: plan.start });
  return true;
}

export async function deletePlan(id: string) {
  await mutate(() => R().deletePlan(id));
  toast(t.toastPlanDeleted);
}

async function reflowAffected(trigger: Trigger) {
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
  if (moved) parts.push(t.reflowMoved(moved));
  if (toBacklog) parts.push(t.reflowBacklog(toBacklog));
  return parts.length ? t.reflowMsg(parts.join(t.reflowJoin)) : t.reflowNothing;
}

export async function saveAi(ai: AiSettings) {
  await mutate(() => R().saveAi(ai));
  toast(ai.provider === "anthropic" ? t.toastAiSaved : t.toastAiOff, "success");
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
    toast(explain(proposal.result.unscheduled[0]?.message) || t.nothingToSchedule, "info");
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
    toast(t.toastAccepted, "success");
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
    const what = encodeParts(duration != null && duration !== block.end - block.start ? { k: "resizedByYou", dur } : { k: "movedByYou", at: res.start });
    await mutate(() =>
      r.run([r.blockUpdate(id, { start: res.start, end: res.end, pinned: true, reason: what })]),
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
    toast(t.toastPausedOther, "info");
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
      ? t.toastSessionDone(laterParts.length)
      : unfinished
        ? t.toastSessionRest(task.title)
        : t.toastCompleted(task.title),
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
  toast(t.toastSkipped(task.title));
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
    toast(t.toastExtendClamp(overlapsCommitment.title, formatClock(overlapsCommitment.start)), "info");
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
  const trigger: Trigger = { t: "overrun", title: task.title, dur: extra };
  const rf = reflowDay(planningState(), block.date, s2.clock, trigger);
  if (!rf.changes.remove.length) {
    toast(t.toastExtended(formatDuration(extra)), "success");
    return;
  }
  await mutate(() => r.run([...blockStatements(rf.changes), r.dayPlanUpsert(block.date, { notes: mergeNotes(block.date, rf.notes) })]));
  toast(reflowMessage(rf.moved, rf.toBacklog), rf.toBacklog ? "info" : "success");
}

/** Re-flows the remaining blocks of a day in place (used after manual changes). */
export async function reflowNow(date: DateKey) {
  const s = get();
  const rf = reflowDay(planningState(), date, s.clock, { t: "manual" });
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
    const lang = getLang();
    const a = compileGoal({ text: t.sampleGoals[0], targetDate: null, hoursPerWeek: 6, today, lang });
    const b = compileGoal({ text: t.sampleGoals[1], targetDate: null, hoursPerWeek: 8, today, lang });
    await r.createGoalFromPlan({ ...a, title: `${a.title}` }, { isSample: true, sortOrder: s.goals.length });
    await r.createGoalFromPlan({ ...b, title: `${b.title}` }, { isSample: true, sortOrder: s.goals.length + 1 });
    const standalone = [
      makeTask({ title: t.sampleTasks[0], estimateMin: 30, priority: 2, energy: "low", inPlanner: true, isSample: true }),
      makeTask({ title: t.sampleTasks[1], estimateMin: 45, priority: 3, energy: "medium", inPlanner: true, isSample: true, deadline: today }),
      makeTask({ title: t.sampleTasks[2], estimateMin: 120, priority: 4, energy: "high", inPlanner: true, isSample: true }),
    ];
    for (const t of standalone) await r.createTask(t);
    const validFrom = weekDates(today, weekStartDay())[0];
    await r.run([
      r.planUpsert(makePlan({ type: "default", title: t.sampleLunch, weekdays: 0b0111110, validFrom, start: 750, end: 795, isBreak: true, isSample: true })),
      r.planUpsert(makePlan({ type: "default", title: t.sampleSync, weekdays: 0b0101010, validFrom, start: 600, end: 630, isSample: true })),
    ]);
    await r.setFlag("sampleLoaded", "1");
    return true;
  });
  if (ok) toast(t.toastSampleLoaded, "success");
}

export async function removeSampleData() {
  await mutate(() => R().deleteSampleData());
  toast(t.toastSampleRemoved);
}

export async function resetAll() {
  // The language is a device preference, not data, so it survives a reset.
  const lang = getLang();
  const theme = get().theme;
  await mutate(async () => {
    await R().resetAll();
    await R().setFlag("language", lang);
    await R().setFlag("theme", theme);
  });
  await audioStore().clear();
  set({ selectedGoalId: null });
  toast(t.toastAllDeleted);
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
