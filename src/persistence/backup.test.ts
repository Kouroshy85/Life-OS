import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { backupFileName, checkBackup } from "./backup";
import { LATEST_VERSION, MIGRATIONS } from "./migrations";

async function database(version: number) {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  for (const m of MIGRATIONS) for (const sql of m.statements) db.run(sql);
  db.run(`PRAGMA user_version = ${version}`);
  db.run("INSERT INTO settings (key, value) VALUES ('flag.language', 'fa')");
  const bytes = db.export();
  db.close();
  return { SQL, bytes };
}

describe("backups", () => {
  it("accepts a Life OS database", async () => {
    const { SQL, bytes } = await database(LATEST_VERSION);
    expect(checkBackup(bytes, SQL)).toBe("ok");
  });

  it("refuses a database from a newer version", async () => {
    const { SQL, bytes } = await database(LATEST_VERSION + 1);
    expect(checkBackup(bytes, SQL)).toBe("newer");
  });

  it("refuses files that aren't Life OS databases", async () => {
    const SQL = await initSqlJs();
    expect(checkBackup(new TextEncoder().encode("hello, this is not a database at all".repeat(10)), SQL)).toBe("notBackup");
    const other = new SQL.Database();
    other.run("CREATE TABLE notes (id TEXT)");
    expect(checkBackup(other.export(), SQL)).toBe("notBackup");
  });

  it("names backups by date", () => {
    expect(backupFileName("2026-11-04")).toBe("life-os-backup-2026-11-04.sqlite");
  });
});
