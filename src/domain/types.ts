/**
 * Core domain types for Life OS.
 *
 * Times of day are stored as minutes after local midnight (0–1440).
 * Calendar dates are local `YYYY-MM-DD` strings ("date keys").
 */

export type DateKey = string;
export type Minutes = number;

export type Priority = 1 | 2 | 3 | 4;
export type Energy = "low" | "medium" | "high";
export type TaskStatus = "todo" | "in_progress" | "done" | "skipped";

/** Where a plan (or a task) came from. Never claim "ai" unless a model actually answered. */
export type PlanSource = "template" | "ai" | "manual";

/** One of the current theme's four plan colours, so a choice follows the theme. */
export type PlanColor = 1 | 2 | 3 | 4;
export const PLAN_COLORS: PlanColor[] = [1, 2, 3, 4];

export interface Goal {
  id: string;
  /** Colour of this goal's sessions in the week. Null keeps the usual goal colour. */
  color: PlanColor | null;
  title: string;
  description: string;
  targetDate: DateKey | null;
  source: PlanSource;
  sourceModel: string | null;
  isSample: boolean;
  archived: boolean;
  sortOrder: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  goalId: string;
  title: string;
  description: string;
  deadline: DateKey | null;
  sortOrder: number;
  createdAt: string;
}

export interface Project {
  id: string;
  milestoneId: string;
  title: string;
  sortOrder: number;
  createdAt: string;
}

export interface Task {
  id: string;
  goalId: string | null;
  milestoneId: string | null;
  projectId: string | null;
  title: string;
  notes: string;
  priority: Priority;
  estimateMin: Minutes;
  deadline: DateKey | null;
  /** Optional time on the deadline date; null means end of day. */
  deadlineTime: Minutes | null;
  energy: Energy | null;
  status: TaskStatus;
  /** Tasks in the planner pool are eligible for day planning (goal tasks join it on request). */
  inPlanner: boolean;
  /** Minutes already completed in earlier sessions of a split task. */
  progressMin: Minutes;
  sortOrder: number;
  /** "generated" items may be replaced when a plan is revised, unless the user edited them. */
  origin: "generated" | "manual";
  edited: boolean;
  isSample: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type CommitmentKind = "commitment" | "break";

export type PlanType = "default" | "goal" | "event";

/** Something locked into the user's week. See domain/plans.ts for the priority rules. */
export interface Plan {
  id: string;
  type: PlanType;
  title: string;
  description: string;
  /** Bitmask for repeating plans: bit 0 = Sunday … bit 6 = Saturday. */
  weekdays: number;
  /** Specific dates for one-time plans; null means it repeats on `weekdays`. */
  dates: DateKey[] | null;
  /** A repeating plan doesn't apply to weeks before this date. */
  validFrom: DateKey | null;
  start: Minutes;
  end: Minutes;
  goalId: string | null;
  isBreak: boolean;
  isSample: boolean;
  /** Null keeps the usual colour for this type. A goal's sessions follow the goal instead. */
  color: PlanColor | null;
  createdAt: string;
  updatedAt: string;
}

export type NoteUrgency = 1 | 2 | 3;

export interface Note {
  id: string;
  title: string;
  description: string;
  urgency: NoteUrgency;
  /** Local date and time as YYYY-MM-DDTHH:MM, or null for no reminder. */
  remindAt: string | null;
  reminded: boolean;
  createdAt: string;
}

export interface Dream {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

export interface Playlist {
  id: string;
  name: string;
  icon: string;
  createdAt: string;
}

export interface Song {
  id: string;
  playlistId: string;
  title: string;
  artist: string;
  /** File extension; the audio itself is stored on disk under the song's id. */
  ext: string;
  sizeBytes: number;
  durationSec: number;
  sortOrder: number;
  createdAt: string;
}

export interface UserQuote {
  id: string;
  text: string;
  createdAt: string;
}

export interface Commitment {
  id: string;
  title: string;
  kind: CommitmentKind;
  /** One-off date, or null when the commitment repeats on `weekdays`. */
  date: DateKey | null;
  /** Bitmask: bit 0 = Sunday … bit 6 = Saturday. Used when `date` is null. */
  weekdays: number;
  /** A repeating commitment doesn't apply before this date. */
  from?: DateKey | null;
  start: Minutes;
  end: Minutes;
  createdAt: string;
}

export interface Preferences {
  workStart: Minutes;
  workEnd: Minutes;
  /** Preferred hours for demanding work. */
  focusStart: Minutes;
  focusEnd: Minutes;
  /** Gap kept after every scheduled task. */
  bufferMin: Minutes;
  /** Insert a break after this much continuous scheduled work (0 disables). */
  breakAfterMin: Minutes;
  breakLengthMin: Minutes;
  /** Tasks longer than any free slot may be split into sessions of at least this length. */
  minSessionMin: Minutes;
  defaultEstimateMin: Minutes;
  /** Optional sleep schedule; nothing is recommended inside it. */
  sleepStart: Minutes | null;
  wakeTime: Minutes | null;
  /** Keep an hour clear around default plans when working out free time. */
  planGap: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  workStart: 9 * 60,
  workEnd: 18 * 60,
  focusStart: 9 * 60,
  focusEnd: 12 * 60,
  bufferMin: 5,
  breakAfterMin: 90,
  breakLengthMin: 15,
  minSessionMin: 25,
  defaultEstimateMin: 45,
  sleepStart: null,
  wakeTime: null,
  planGap: true,
};

export type BlockState = "planned" | "in_progress" | "done" | "skipped";
export type BlockKind = "task" | "break";

export interface ScheduleBlock {
  id: string;
  date: DateKey;
  taskId: string | null;
  kind: BlockKind;
  start: Minutes;
  end: Minutes;
  state: BlockState;
  /** proposed blocks await accept/reject; accepted blocks are the live plan. */
  proposed: boolean;
  /** Pinned blocks were placed by hand and are never moved by the engine. */
  pinned: boolean;
  /** Part index when a long task is split into several sessions (1-based). */
  part: number;
  partCount: number;
  reason: string;
  createdAt: string;
}

export interface DayPlanMeta {
  date: DateKey;
  generatedAt: string | null;
  acceptedAt: string | null;
  /** JSON-encoded engine notes for unscheduled tasks, kept so explanations survive restarts. */
  notes: UnscheduledNote[];
}

export type UnscheduledReason =
  | "no_time"
  | "too_long"
  | "deadline_unreachable"
  | "day_over"
  | "skipped_today"
  | "no_working_hours";

export interface UnscheduledNote {
  taskId: string;
  reason: UnscheduledReason;
  message: string;
  /** Minutes still unplaced (for partially scheduled tasks). */
  remainingMin: Minutes;
}

export type TaskEventType =
  | "completed"
  | "skipped"
  | "started"
  | "reopened"
  | "overran"
  | "skipped_today";

export interface TaskEvent {
  id: string;
  taskId: string;
  type: TaskEventType;
  date: DateKey;
  minutes: number | null;
  at: string;
}
