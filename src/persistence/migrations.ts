import type { SqlDriver } from "./driver";

/**
 * Versioned schema. Each migration runs in a single transaction together with
 * the `PRAGMA user_version` bump, so a failed migration leaves the database at
 * its previous version. Never edit a shipped migration — append a new one.
 */
export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    statements: [
      `CREATE TABLE goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(title) > 0),
        description TEXT NOT NULL DEFAULT '',
        target_date TEXT,
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('template','ai','manual')),
        source_model TEXT,
        is_sample INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE milestones (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) > 0),
        description TEXT NOT NULL DEFAULT '',
        deadline TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) > 0),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        goal_id TEXT REFERENCES goals(id) ON DELETE CASCADE,
        milestone_id TEXT REFERENCES milestones(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) > 0),
        notes TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
        estimate_min INTEGER NOT NULL DEFAULT 45 CHECK (estimate_min BETWEEN 5 AND 960),
        deadline TEXT,
        deadline_time INTEGER CHECK (deadline_time IS NULL OR deadline_time BETWEEN 0 AND 1440),
        energy TEXT CHECK (energy IS NULL OR energy IN ('low','medium','high')),
        status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','skipped')),
        in_planner INTEGER NOT NULL DEFAULT 0,
        progress_min INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('generated','manual')),
        edited INTEGER NOT NULL DEFAULT 0,
        is_sample INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      )`,
      `CREATE INDEX idx_tasks_goal ON tasks(goal_id)`,
      `CREATE INDEX idx_tasks_status ON tasks(status, in_planner)`,
      `CREATE TABLE commitments (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(title) > 0),
        kind TEXT NOT NULL DEFAULT 'commitment' CHECK (kind IN ('commitment','break')),
        date TEXT,
        weekdays INTEGER NOT NULL DEFAULT 0,
        start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1440),
        end_min INTEGER NOT NULL CHECK (end_min BETWEEN 0 AND 1440),
        created_at TEXT NOT NULL,
        CHECK (end_min > start_min),
        CHECK (date IS NOT NULL OR weekdays > 0)
      )`,
      `CREATE TABLE schedule_blocks (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task','break')),
        start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1440),
        end_min INTEGER NOT NULL CHECK (end_min BETWEEN 0 AND 1440),
        state TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','in_progress','done','skipped')),
        proposed INTEGER NOT NULL DEFAULT 0,
        pinned INTEGER NOT NULL DEFAULT 0,
        part INTEGER NOT NULL DEFAULT 1,
        part_count INTEGER NOT NULL DEFAULT 1,
        reason TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        CHECK (end_min > start_min)
      )`,
      `CREATE INDEX idx_blocks_date ON schedule_blocks(date, proposed)`,
      `CREATE TABLE day_plans (
        date TEXT PRIMARY KEY,
        generated_at TEXT,
        accepted_at TEXT,
        notes TEXT NOT NULL DEFAULT '[]',
        proposal_notes TEXT NOT NULL DEFAULT '[]',
        proposal_summary TEXT NOT NULL DEFAULT ''
      )`,
      `CREATE TABLE day_skips (
        date TEXT NOT NULL,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        PRIMARY KEY (date, task_id)
      )`,
      `CREATE TABLE task_events (
        id TEXT PRIMARY KEY,
        task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        task_title TEXT NOT NULL DEFAULT '',
        goal_id TEXT,
        type TEXT NOT NULL,
        date TEXT NOT NULL,
        minutes INTEGER,
        at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_events_date ON task_events(date)`,
      `CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    name: "plans and notes",
    statements: [
      `CREATE TABLE plans (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('default','goal','event')),
        title TEXT NOT NULL CHECK (length(title) > 0),
        description TEXT NOT NULL DEFAULT '',
        weekdays INTEGER NOT NULL DEFAULT 0,
        dates TEXT,
        valid_from TEXT,
        start_min INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1440),
        end_min INTEGER NOT NULL CHECK (end_min BETWEEN 0 AND 1440),
        goal_id TEXT REFERENCES goals(id) ON DELETE CASCADE,
        is_break INTEGER NOT NULL DEFAULT 0,
        is_sample INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (end_min > start_min),
        CHECK (dates IS NOT NULL OR weekdays > 0)
      )`,
      `INSERT INTO plans (id, type, title, weekdays, dates, start_min, end_min, is_break, is_sample, created_at, updated_at)
       SELECT id,
              CASE WHEN date IS NULL THEN 'default' ELSE 'event' END,
              title,
              weekdays,
              CASE WHEN date IS NULL THEN NULL ELSE '["' || date || '"]' END,
              start_min,
              end_min,
              kind = 'break',
              id LIKE 'sample-%',
              created_at,
              created_at
       FROM commitments`,
      `DROP TABLE commitments`,
      `CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(title) > 0),
        description TEXT NOT NULL DEFAULT '',
        urgency INTEGER NOT NULL DEFAULT 1 CHECK (urgency BETWEEN 1 AND 3),
        remind_at TEXT,
        reminded INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 3,
    name: "dreams, relax music and quotes",
    statements: [
      `CREATE TABLE dreams (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL CHECK (length(title) > 0),
        body TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL CHECK (length(name) > 0),
        icon TEXT NOT NULL DEFAULT 'music',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE songs (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        title TEXT NOT NULL CHECK (length(title) > 0),
        artist TEXT NOT NULL DEFAULT '',
        ext TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        duration_sec REAL NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_songs_playlist ON songs(playlist_id, sort_order)`,
      `CREATE TABLE quotes (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL CHECK (length(text) > 0),
        created_at TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 4,
    name: "plan and goal colours",
    statements: [
      `ALTER TABLE goals ADD COLUMN color INTEGER CHECK (color IS NULL OR color BETWEEN 1 AND 4)`,
      `ALTER TABLE plans ADD COLUMN color INTEGER CHECK (color IS NULL OR color BETWEEN 1 AND 4)`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export async function currentVersion(driver: SqlDriver): Promise<number> {
  const rows = await driver.select<{ user_version: number }>("PRAGMA user_version");
  return Number(rows[0]?.user_version ?? 0);
}

export async function migrate(driver: SqlDriver): Promise<{ from: number; to: number }> {
  const from = await currentVersion(driver);
  if (from > LATEST_VERSION) {
    throw new Error(
      `This database was created by a newer version of Life OS (schema v${from}). Update the app to open it.`,
    );
  }
  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    await driver.batch([
      ...m.statements.map((sql) => ({ sql })),
      { sql: `PRAGMA user_version = ${m.version}` },
    ]);
  }
  return { from, to: LATEST_VERSION };
}
