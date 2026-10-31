export type SqlParam = string | number | null;

export interface SqlStatement {
  sql: string;
  params?: SqlParam[];
}

/**
 * Minimal SQL surface the app needs. Two implementations share the same schema
 * and queries: the native SQLite bridge in the Tauri shell, and sql.js (SQLite
 * compiled to WebAssembly) for the browser preview and tests.
 */
export interface SqlDriver {
  readonly engine: string;
  execute(sql: string, params?: SqlParam[]): Promise<void>;
  select<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** Runs all statements in one transaction. */
  batch(statements: SqlStatement[]): Promise<void>;
  location(): Promise<string>;
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function openDefaultDriver(): Promise<SqlDriver> {
  if (isTauri()) {
    const { createTauriDriver } = await import("./tauriDriver");
    return createTauriDriver();
  }
  const { createBrowserDriver } = await import("./sqljsDriver");
  return createBrowserDriver();
}
