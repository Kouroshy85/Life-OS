import { invoke } from "@tauri-apps/api/core";
import type { SqlDriver, SqlParam, SqlStatement } from "./driver";

/** Native SQLite via the Rust bridge in `src-tauri/src/db.rs`. */
export function createTauriDriver(): SqlDriver {
  let infoCache: { path: string; sqlite_version: string } | null = null;
  const info = async () => (infoCache ??= await invoke<{ path: string; sqlite_version: string }>("db_info"));
  return {
    engine: "SQLite (native)",
    async execute(sql: string, params: SqlParam[] = []) {
      await invoke("db_execute", { sql, params });
    },
    async select<T>(sql: string, params: SqlParam[] = []) {
      return invoke<T[]>("db_select", { sql, params });
    },
    async batch(statements: SqlStatement[]) {
      await invoke("db_batch", {
        statements: statements.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
      });
    },
    async location() {
      const i = await info();
      return `${i.path} (SQLite ${i.sqlite_version})`;
    },
  };
}
