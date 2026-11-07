/**
 * One turn of the assistant conversation: build the request, stream the reply,
 * check the answer, and try once more if it can't be used. Saving messages and
 * building previews happen in the caller; this stays free of app state so it can be
 * tested with a scripted model.
 */

import { toLatinDigits } from "../../domain/locale";
import { en } from "../../i18n/en";
import type { ChatMessage } from "../../persistence/repository";
import { messageText } from "./messages";
import { ProviderError, type ChatTurn, type LocalModelProvider } from "../providers/types";
import { annotateDates } from "./dates";
import { buildContext, type AliasMap, type ContextSource, type RequestKind } from "./context";
import { parseResponse, type Rejection, type ResolvedOperation } from "./parse";
import { responseJsonSchema, type AssistantResponse } from "./schema";
import { partialReply } from "./streamReply";
import { systemPrompt } from "./systemPrompt";

export interface TurnInput {
  provider: LocalModelProvider;
  /** Earlier messages in this conversation, oldest first. */
  history: ChatMessage[];
  userText: string;
  kind: RequestKind;
  source: ContextSource;
  lang: "en" | "fa";
  /** Things Life OS did since the last turn, such as a saved proposal, told to the model as facts. */
  recentEvents?: string[];
  signal?: AbortSignal;
  /** Called with the reply text so far while it streams. */
  onReply?: (text: string) => void;
}

export type TurnResult =
  | { status: "ok"; response: AssistantResponse; operations: ResolvedOperation[]; rejected: Rejection[]; aliases: AliasMap; attempts: number }
  | { status: "invalid"; errors: string[]; attempts: number }
  | { status: "cancelled"; partial: string }
  | { status: "error"; error: ProviderError };

const MAX_TOKENS = 1800;
const TEMPERATURE = 0.3;
const HISTORY_MESSAGES = 10;
const HISTORY_CHARS = 6000;

/** Earlier messages as chat turns, newest kept when space runs out. Life OS notes are left out (they go into the context as facts). */
export function historyTurns(history: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let used = 0;
  for (const m of history.filter((x) => x.role !== "note").slice(-HISTORY_MESSAGES).reverse()) {
    let content = messageText(m, en);
    if (m.role === "assistant" && m.proposal && typeof m.proposal === "object" && "summary" in m.proposal) {
      content += `\n(Proposed changes: ${String((m.proposal as { summary: unknown }).summary)}; status: ${m.proposalStatus ?? "pending"})`;
    }
    if (used + content.length > HISTORY_CHARS) break;
    used += content.length;
    turns.unshift({ role: m.role === "user" ? "user" : "assistant", content });
  }
  // A conversation must start with the user.
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

/** The user's message wrapped with the context. Their words are marked as data, never instructions. */
export function userTurn(text: string, contextText: string, events: string[] = []): string {
  // Persian and Arabic digits become ordinary ones, so "۲۰ نوامبر" reads as a date.
  const safe = toLatinDigits(text.replace(/<\/?(user_message|lifeos_context)>/gi, ""));
  const recent = events.length ? `\nRecent Life OS events:\n${events.map((e) => `- ${e}`).join("\n")}` : "";
  return `<lifeos_context>\n${contextText}${recent}\n</lifeos_context>\n<user_message>\n${safe}\n</user_message>`;
}

export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const { provider, signal } = input;
  const context = buildContext(input.source, input.kind);
  const system = systemPrompt(input.lang, input.source.today);
  const jsonSchema = responseJsonSchema();
  const messages: ChatTurn[] = [...historyTurns(input.history), { role: "user", content: userTurn(annotateDates(input.userText, input.source.today), context.text, input.recentEvents) }];

  let errors: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    let text = "";
    let result;
    try {
      result = await provider.generate({ system, messages, jsonSchema, maxTokens: MAX_TOKENS, temperature: TEMPERATURE }, (piece) => {
        text += piece;
        input.onReply?.(partialReply(text));
      }, signal);
    } catch (e) {
      if (e instanceof ProviderError && e.code === "cancelled") return { status: "cancelled", partial: partialReply(text) };
      return { status: "error", error: e instanceof ProviderError ? e : new ProviderError("generation_failed", e instanceof Error ? e.message : String(e)) };
    }
    if (result.stopReason === "cancelled" || signal?.aborted) return { status: "cancelled", partial: partialReply(result.text || text) };

    const raw = result.text || text;
    if (result.stopReason === "length" || result.stopReason === "timeout") {
      errors = ["The answer was cut off before it was complete. Keep it shorter."];
    } else {
      const parsed = parseResponse(raw, context.aliases, input.source.today);
      // Small models sometimes ask "Shall I make a plan?" without the plan. There's nothing to
      // approve then, so ask once for the operations, and otherwise show the reply as advice.
      const empty = parsed.ok && parsed.response.intent === "propose_changes" && !parsed.operations.length && !parsed.rejected.length;
      if (parsed.ok && empty && attempt === 2) {
        return { status: "ok", response: { ...parsed.response, intent: "advice", proposal: null }, operations: [], rejected: [], aliases: context.aliases, attempts: attempt };
      }
      if (parsed.ok && !empty) {
        return { status: "ok", response: parsed.response, operations: parsed.operations, rejected: parsed.rejected, aliases: context.aliases, attempts: attempt };
      }
      errors = parsed.ok ? ["intent is propose_changes but operations is empty. Put the complete change in operations now; the user approves it with a button"] : parsed.errors;
    }
    if (attempt === 2) break;
    // One repair attempt, telling the model exactly what was wrong.
    input.onReply?.("");
    messages.push({ role: "assistant", content: raw.slice(0, 4000) });
    messages.push({
      role: "user",
      content: `Your answer could not be used: ${errors.join("; ")}. Reply again with one JSON object that follows the schema exactly.`,
    });
  }
  return { status: "invalid", errors, attempts: 2 };
}
