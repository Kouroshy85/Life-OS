/**
 * State for the local planning assistant: the conversation, streaming text, the
 * model's status, and the confirm/cancel flow for proposals. Only a confirmed
 * proposal ever reaches the database, and the chat only says something was saved
 * after the save succeeded.
 */

import { create } from "zustand";
import { buildChangeSet, type ChangeSet } from "../ai/assistant/proposals";
import { classifyRequest, type ContextSource, type RequestKind } from "../ai/assistant/context";
import { confirmationIntent } from "../ai/assistant/confirm";
import { runTurn } from "../ai/assistant/conversation";
import type { ResolvedOperation } from "../ai/assistant/parse";
import { encodeNote, messageText, type AppNote } from "../ai/assistant/messages";
import { PROMPT_VERSION } from "../ai/assistant/systemPrompt";
import { getProvider } from "../ai/providers";
import { ProviderError, type ModelInfo, type ProviderStatus } from "../ai/providers/types";
import { getLang, hasPersian } from "../domain/locale";
import { t } from "../i18n";
import { en } from "../i18n/en";
import { newId, nowIso, type ChatMessage, type ProposalStatus } from "../persistence/repository";
import { applyAssistantChangeSet, proposalState, repository, toast, useApp } from "./store";

export const DEFAULT_MODEL = "qwen3.5-2b-q4_k_m";

interface AssistantState {
  ready: boolean;
  conversationId: string | null;
  messages: ChatMessage[];
  /** The reply as it streams in, or null when nothing is being generated. */
  streaming: string | null;
  busy: boolean;
  status: ProviderStatus | null;
  models: ModelInfo[];
  download: { modelId: string; received: number; total: number } | null;
  modelBusy: boolean;
  /** Tap-to-answer buttons under the latest reply. Kept only for the latest one, and not saved. */
  choices: { messageId: string; items: string[] } | null;
}

export const useAssistant = create<AssistantState>(() => ({
  ready: false,
  conversationId: null,
  messages: [],
  streaming: null,
  busy: false,
  status: null,
  models: [],
  download: null,
  modelBusy: false,
  choices: null,
}));

const set = useAssistant.setState;
const get = useAssistant.getState;
let controller: AbortController | null = null;

export const selectedModel = () => useApp.getState().flags["ai.model"] || DEFAULT_MODEL;

/** The chosen model, re-rendering when it changes. */
export const useSelectedModel = () => useApp((s) => s.flags["ai.model"] || DEFAULT_MODEL);

function contextSource(): ContextSource {
  const s = useApp.getState();
  return {
    goals: s.goals,
    milestones: s.milestones,
    tasks: s.tasks,
    plans: s.plans,
    blocks: s.blocks,
    events: s.events,
    prefs: s.prefs,
    today: s.clock.today,
    nowMin: s.clock.nowMin,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
  };
}

async function save(message: ChatMessage) {
  set((s) => ({ messages: s.messages.some((m) => m.id === message.id) ? s.messages.map((m) => (m.id === message.id ? message : m)) : [...s.messages, message] }));
  await repository().saveMessage(message);
}

function message(role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: newId(),
    conversationId: get().conversationId!,
    role,
    content,
    intent: null,
    model: null,
    promptVersion: null,
    proposal: null,
    proposalStatus: null,
    createdAt: nowIso(),
    ...extra,
  };
}

export async function openAssistant() {
  if (!get().ready) {
    const found = await repository().loadConversation();
    set({ ready: true, conversationId: found?.conversation.id ?? null, messages: found?.messages ?? [] });
  }
  await refreshStatus();
}

export async function refreshStatus() {
  const provider = getProvider();
  try {
    const [status, models] = await Promise.all([provider.status(), provider.listModels()]);
    set({ status, models });
  } catch {
    set({ status: { available: false, state: "idle", runtime: null, loaded: null, ramTotalMb: 0, ramAvailableMb: 0, idleUnloadMin: 10 }, models: [] });
  }
}

/** What Life OS did since the assistant last answered, as plain facts for the model. */
function recentEvents(): string[] {
  const out: string[] = [];
  for (const m of [...get().messages].reverse()) {
    if (m.role === "assistant") break;
    if (m.role === "note") out.unshift(messageText(m, en));
  }
  return out;
}

/** The note for a model failure. */
function errorNote(e: ProviderError): AppNote {
  const known = ["unavailable", "model_missing", "insufficient_memory", "load_failed"] as const;
  return { k: "error", code: (known as readonly string[]).includes(e.code) ? (e.code as (typeof known)[number]) : "generation_failed" };
}

export function providerErrorText(e: ProviderError): string {
  switch (e.code) {
    case "unavailable":
      return t.aiErrUnavailable;
    case "model_missing":
      return t.aiErrModelMissing;
    case "insufficient_memory":
      return t.aiErrMemory;
    case "load_failed":
      return t.aiErrLoad;
    default:
      return t.aiErrGeneration;
  }
}

/** The newest proposal still waiting for a yes or no. */
const pendingProposal = () => [...get().messages].reverse().find((m) => m.role === "assistant" && m.proposalStatus === "pending");

export async function sendMessage(text: string, kind?: RequestKind) {
  const clean = text.trim();
  if (!clean || get().busy) return;
  set({ choices: null });
  // A plain "yes" or "no" to a waiting proposal is handled here, instantly, without the model.
  const pending = pendingProposal();
  const answer = pending ? confirmationIntent(clean) : null;
  if (pending && answer) {
    await save(message("user", clean));
    if (answer === "yes") await applyProposal(pending.id);
    else await cancelProposal(pending.id);
    return;
  }
  if (!get().conversationId) {
    const conversation = await repository().createConversation(clean.slice(0, 60));
    set({ conversationId: conversation.id, messages: [] });
  }
  const events = recentEvents();
  const history = get().messages;
  await save(message("user", clean));
  controller = new AbortController();
  set({ busy: true, streaming: "" });

  const provider = getProvider();
  const modelId = selectedModel();
  try {
    const status = await provider.status();
    if (!status.available) throw new ProviderError("unavailable", "unavailable");
    if (status.loaded?.id !== modelId) {
      set({ modelBusy: true });
      await provider.load(modelId);
      await refreshStatus();
    }
  } catch (e) {
    const err = e instanceof ProviderError ? e : new ProviderError("load_failed", String(e));
    await save(message("note", encodeNote(errorNote(err))));
    set({ busy: false, streaming: null, modelBusy: false });
    return;
  } finally {
    set({ modelBusy: false });
  }

  const lang = hasPersian(clean) ? "fa" : getLang() === "fa" && !/[a-z]{3,}/i.test(clean) ? "fa" : "en";
  const result = await runTurn({
    provider,
    history,
    userText: clean,
    kind: kind ?? classifyRequest(clean),
    source: contextSource(),
    lang,
    recentEvents: events,
    signal: controller.signal,
    onReply: (reply) => set({ streaming: reply }),
  });
  controller = null;
  const model = useAssistant.getState().status?.loaded?.name ?? modelId;
  const meta = { model, promptVersion: PROMPT_VERSION };

  if (result.status === "ok") {
    const { response } = result;
    let content = response.reply;
    // The question is usually the reply itself; add it only when the reply doesn't already ask something.
    if (response.needs_clarification && response.clarification && !content.includes(response.clarification) && !/[?؟]/.test(content)) content += `\n\n${response.clarification}`;
    let proposal: ChangeSet | null = null;
    if (result.operations.length || result.rejected.length) {
      const s = useApp.getState();
      proposal = buildChangeSet(result.operations, proposalState(), s.clock, {
        summary: response.proposal?.summary || response.reply.slice(0, 160),
        model,
        rejected: result.rejected,
      });
    }
    const hasItems = !!proposal?.items.length;
    // A new proposal replaces any earlier one that was never answered.
    if (hasItems) for (const m of get().messages) if (m.proposalStatus === "pending") await setStatus(m.id, "cancelled");
    const saved = message("assistant", content, { ...meta, intent: response.intent, proposal, proposalStatus: hasItems ? "pending" : null });
    await save(saved);
    if (!hasItems && response.choices.length) set({ choices: { messageId: saved.id, items: response.choices } });
  } else if (result.status === "cancelled") {
    await save(message("assistant", result.partial || encodeNote({ k: "stopped" }), { ...meta, proposalStatus: "interrupted" }));
  } else if (result.status === "invalid") {
    await save(message("note", encodeNote({ k: "invalid" })));
  } else {
    await save(message("note", encodeNote(errorNote(result.error))));
  }
  set({ busy: false, streaming: null });
  void refreshStatus();
}

export function stopGenerating() {
  controller?.abort();
}

export async function clearConversation() {
  stopGenerating();
  const id = get().conversationId;
  if (id) await repository().archiveConversation(id);
  set({ conversationId: null, messages: [], streaming: null, busy: false, choices: null });
}

async function setStatus(id: string, status: ProposalStatus, proposal?: ChangeSet) {
  const m = get().messages.find((x) => x.id === id);
  if (!m) return;
  await save({ ...m, proposalStatus: status, ...(proposal ? { proposal } : {}) });
}

/** Saves a proposal the user confirmed. Says it's saved only once the database confirms it. */
export async function applyProposal(id: string) {
  const m = get().messages.find((x) => x.id === id);
  if (!m?.proposal || m.proposalStatus !== "pending") return;
  const outcome = await applyAssistantChangeSet(m.proposal as ChangeSet);
  if (outcome.status === "applied") {
    await setStatus(id, "applied");
    const c = outcome.counts;
    await save(message("note", encodeNote({ k: "saved", ...c })));
  } else if (outcome.status === "stale") {
    await setStatus(id, "stale");
    const fresh = outcome.changeSet;
    await save(
      message("assistant", encodeNote({ k: "stale" }), { model: m.model, promptVersion: m.promptVersion, intent: "propose_changes", proposal: fresh, proposalStatus: fresh.items.length ? "pending" : null }),
    );
  } else {
    await setStatus(id, "failed");
    await save(message("note", encodeNote({ k: "saveFailed", why: outcome.message })));
  }
}

export const cancelProposal = (id: string) => setStatus(id, "cancelled");

/** Replaces a pending proposal with an edited version, checked again by the planner. */
export async function editProposal(id: string, operations: ResolvedOperation[]) {
  const m = get().messages.find((x) => x.id === id);
  if (!m?.proposal || m.proposalStatus !== "pending") return;
  const old = m.proposal as ChangeSet;
  const fresh = buildChangeSet(operations, proposalState(), useApp.getState().clock, { summary: old.summary, model: old.model });
  await setStatus(id, fresh.items.length ? "pending" : "cancelled", fresh);
}

// ---- model management ------------------------------------------------------------------

async function withModel<T>(fn: () => Promise<T>): Promise<T | null> {
  set({ modelBusy: true });
  try {
    return await fn();
  } catch (e) {
    const err = e instanceof ProviderError ? e : new ProviderError("load_failed", String(e));
    toast(providerErrorText(err), "error");
    return null;
  } finally {
    set({ modelBusy: false });
    await refreshStatus();
  }
}

export const loadModel = () => withModel(() => getProvider().load(selectedModel()));
export const unloadModel = () => withModel(() => getProvider().unload());
export const importModel = () => withModel(() => getProvider().importModel());
export const deleteModel = (id: string) => withModel(() => getProvider().deleteModel(id));
export const setIdleUnload = (minutes: number) => withModel(() => getProvider().setIdleUnload(minutes));

export async function downloadModel(modelId: string) {
  set({ download: { modelId, received: 0, total: 0 } });
  await withModel(() => getProvider().downloadModel(modelId, (received, total) => set({ download: { modelId, received, total } })));
  set({ download: null });
}
