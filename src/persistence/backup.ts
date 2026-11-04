import type { SqlJsStatic } from "sql.js";
import { LATEST_VERSION } from "./migrations";

export type BackupCheck = "ok" | "notBackup" | "newer";

const HEADER = "SQLite format 3\u0000";

/** Whether a file is a Life OS database this version can open. */
export function checkBackup(bytes: Uint8Array, SQL: SqlJsStatic): BackupCheck {
  if (bytes.length < 100 || String.fromCharCode(...bytes.slice(0, 16)) !== HEADER) return "notBackup";
  let db;
  try {
    db = new SQL.Database(bytes);
    const version = Number(db.exec("PRAGMA user_version")[0]?.values[0]?.[0] ?? 0);
    const tables = new Set((db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []).map((row) => String(row[0])));
    if (version < 1 || !tables.has("goals") || !tables.has("settings")) return "notBackup";
    return version > LATEST_VERSION ? "newer" : "ok";
  } catch {
    return "notBackup";
  } finally {
    db?.close();
  }
}

/** "life-os-backup-2026-11-04.sqlite" */
export const backupFileName = (today: string) => `life-os-backup-${today}.sqlite`;
