import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { checkBackup, type BackupCheck } from "./backup";
import type { SqlDriver, SqlParam, SqlStatement } from "./driver";

/**
 * SQLite compiled to WebAssembly. Used when the UI runs in a plain browser
 * (`npm run dev`) and by the persistence tests. The browser variant saves the
 * database file to IndexedDB after every write.
 */
export function createSqlJsDriver(
  db: Database,
  opts: { persist?: (bytes: Uint8Array) => Promise<void>; engine?: string; location?: string } = {},
): SqlDriver {
  let saving: Promise<void> = Promise.resolve();
  const persist = () => {
    if (!opts.persist || frozen) return Promise.resolve();
    const bytes = db.export();
    // export() reopens the database, which resets per-connection pragmas.
    db.run("PRAGMA foreign_keys = ON;");
    saving = saving.then(() => opts.persist!(bytes)).catch((e) => console.error("Persist failed", e));
    lastSave = saving;
    return saving;
  };
  db.run("PRAGMA foreign_keys = ON;");

  return {
    engine: opts.engine ?? "SQLite (WebAssembly)",
    async execute(sql: string, params: SqlParam[] = []) {
      db.run(sql, params);
      await persist();
    },
    async select<T>(sql: string, params: SqlParam[] = []) {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(params);
        const rows: T[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
        return rows;
      } finally {
        stmt.free();
      }
    },
    async batch(statements: SqlStatement[]) {
      db.run("BEGIN");
      try {
        for (const s of statements) db.run(s.sql, s.params ?? []);
        db.run("COMMIT");
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
      await persist();
    },
    async location() {
      return opts.location ?? "In memory";
    },
  };
}

let sqlPromise: Promise<SqlJsStatic> | null = null;
let lastSave: Promise<void> = Promise.resolve();
/** Set while a backup is being restored, so the open database can't save over it. */
let frozen = false;

const IDB_NAME = "life-os";
const IDB_STORE = "files";
const IDB_KEY = "life-os.db";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(): Promise<Uint8Array | null> {
  const dbh = await idb();
  return new Promise((resolve, reject) => {
    const req = dbh.transaction(IDB_STORE).objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve((req.result as Uint8Array | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(bytes: Uint8Array): Promise<void> {
  const dbh = await idb();
  return new Promise((resolve, reject) => {
    const tx = dbh.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function browserSql(): Promise<SqlJsStatic> {
  const wasmUrl = (await import("sql.js/dist/sql-wasm.wasm?url")).default;
  sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl });
  return sqlPromise;
}

/** The saved database file, once any save in progress has finished. */
export async function exportBrowserDatabase(): Promise<Uint8Array | null> {
  await lastSave;
  return idbGet();
}

/** Checks a backup file and, if it's usable, makes it the saved database. The page must reload afterwards. */
export async function restoreBrowserDatabase(bytes: Uint8Array): Promise<BackupCheck> {
  const result = checkBackup(bytes, await browserSql());
  if (result !== "ok") return result;
  frozen = true;
  await lastSave;
  await idbPut(bytes);
  return "ok";
}

export async function createBrowserDriver(): Promise<SqlDriver> {
  const SQL = await browserSql();
  const existing = await idbGet().catch(() => null);
  const db = existing ? new SQL.Database(existing) : new SQL.Database();
  return createSqlJsDriver(db, {
    persist: idbPut,
    engine: "SQLite (WebAssembly)",
    location: "This browser (IndexedDB)",
  });
}

export async function createMemoryDriver(): Promise<SqlDriver> {
  sqlPromise ??= initSqlJs();
  const SQL = await sqlPromise;
  return createSqlJsDriver(new SQL.Database());
}
