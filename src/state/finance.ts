import { create } from "zustand";
import { emptyFinance, type FinanceCommand, type FinanceSnapshot } from "../domain/finance/types";
import { FinanceRepository } from "../persistence/financeRepository";
import type { SqlDriver } from "../persistence/driver";
import { DurableSaveError } from "../persistence/driver";
import { RecurringRepository } from "../persistence/recurringRepository";
import { appClock } from "../domain/calendar";
import type { RecurringRule } from "../domain/finance/recurring";

interface FinanceState { data: FinanceSnapshot; ready: boolean; busy: boolean; error: string | null; needsSaveRetry: boolean }
export const useFinance = create<FinanceState>(() => ({ data: emptyFinance(), ready: false, busy: false, error: null, needsSaveRetry: false }));
let repo: FinanceRepository | null = null;
let recurring: RecurringRepository | null = null;
export const useRecurring = create<{ rules: RecurringRule[]; errors: Record<string, string>; processing: boolean }>(() => ({ rules: [], errors: {}, processing: false }));
export const recurringRepository = () => { if (!recurring) throw new Error("Finance database is not ready."); return recurring; };
export const financeRepository = () => { if (!repo) throw new Error("Finance database is not ready."); return repo; };
export async function initFinance(driver: SqlDriver) {
  repo = new FinanceRepository(driver);
  recurring = new RecurringRepository(driver, repo);
  await refreshFinance();
  useRecurring.setState({ rules: await recurring.rules() });
}
let incomeWork: Promise<void> | null = null;
let incomeRequested = false;
export function processRecurringIncome() {
  if (!recurring || useFinance.getState().needsSaveRetry) return incomeWork;
  if (incomeWork) { incomeRequested = true; return incomeWork; }
  useRecurring.setState({ processing: true });
  incomeWork = (async () => {
    let more: boolean;
    do {
      incomeRequested = false;
      const result = await recurringRepository().processIncome(appClock().today);
      // Refresh after queued writes, rather than publishing an earlier projected snapshot.
      if (result.posted) await refreshFinance();
      useRecurring.setState({ rules: result.rules, errors: result.errors });
      more = result.more;
      if (more) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } while (more || incomeRequested);
  })().catch(async (error: unknown) => {
    await refreshFinance().catch(() => undefined);
    useFinance.setState({ error: String(error), needsSaveRetry: error instanceof DurableSaveError });
  }).finally(() => { incomeWork = null; useRecurring.setState({ processing: false }); });
  return incomeWork;
}

export async function changeRecurring<T>(change: (repository: RecurringRepository) => Promise<T>): Promise<T> {
  if (useFinance.getState().needsSaveRetry) throw new Error("Retry saving to this device first.");
  try {
    const result = await change(recurringRepository());
    await refreshFinance();
    useRecurring.setState({ rules: await recurringRepository().rules() });
    return result;
  } catch (error) {
    if (error instanceof DurableSaveError) {
      await refreshFinance().catch(() => undefined);
      useRecurring.setState({ rules: await recurringRepository().rules() });
      useFinance.setState({ error: error.message, needsSaveRetry: true });
    }
    throw error;
  }
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
