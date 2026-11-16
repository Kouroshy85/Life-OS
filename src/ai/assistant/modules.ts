import type { FinanceSnapshot } from "../../domain/finance/types";
import { buildFinanceContext, financeInstructions, matchesFinance } from "./finance";

/** Small extension point: each capability owns its instructions and bounded context. */
export interface AssistantModule {
  id: string;
  matches: (text: string) => boolean;
  instructions: string;
  context: (source: { finance?: FinanceSnapshot; today: string }) => { text: string; aliases: Record<string, string> } | null;
}
export const assistantModules: AssistantModule[] = [{ id: "finance", matches: matchesFinance, instructions: financeInstructions, context: (source) => source.finance ? buildFinanceContext(source.finance, source.today) : null }];
export const matchingModules = (text: string) => assistantModules.filter((m) => m.matches(text));
