import { create } from "zustand";
import { emptyFinance, type FinanceCommand, type FinanceSnapshot } from "../domain/finance/types";
import { FinanceRepository } from "../persistence/financeRepository";
import type { SqlDriver } from "../persistence/driver";
import { DurableSaveError } from "../persistence/driver";

interface FinanceState { data: FinanceSnapshot; ready: boolean; busy: boolean; error: string | null; needsSaveRetry: boolean }
export const useFinance = create<FinanceState>(() => ({ data: emptyFinance(), ready: false, busy: false, error: null, needsSaveRetry: false }));
let repo: FinanceRepository | null = null;
export const financeRepository = () => { if (!repo) throw new Error("Finance database is not ready."); return repo; };
export async function initFinance(driver: SqlDriver) {
  repo = new FinanceRepository(driver);
  await refreshFinance();
}
export async function refreshFinance() {
  try { useFinance.setState({ data: await financeRepository().load(), ready: true }); }
  catch (e) { useFinance.setState({ error: e instanceof Error ? e.message : String(e) }); throw e; }
}
let pending = 0;
export async function saveFinance(command: FinanceCommand | FinanceCommand[], fingerprint?: string) {
  pending++; useFinance.setState({ busy: true, error: null });
  try {
    const data = await financeRepository().commit(Array.isArray(command) ? command : [command], fingerprint);
    useFinance.setState({ data, ready: true, needsSaveRetry: false });
    return data;
  } catch (e) {
    // A browser storage failure can occur after SQLite committed in memory.
    const data = await financeRepository().load().catch(() => useFinance.getState().data);
    useFinance.setState({ data, error: e instanceof Error ? e.message : String(e), needsSaveRetry: e instanceof DurableSaveError || useFinance.getState().needsSaveRetry }); throw e;
  }
  finally { pending--; useFinance.setState({ busy: pending > 0 }); }
}
export async function retryFinanceStorage() {
  useFinance.setState({ busy: true });
  try { const { retryBrowserPersistence } = await import("../persistence/sqljsDriver"); await retryBrowserPersistence(); useFinance.setState({ needsSaveRetry: false, error: null }); }
  catch (e) { useFinance.setState({ error: e instanceof Error ? e.message : String(e) }); }
  finally { useFinance.setState({ busy: false }); }
}
