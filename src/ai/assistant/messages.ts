/**
 * Messages Life OS writes into the chat itself (saved, failed, stopped…) are stored
 * as small codes rather than finished sentences, so they read in whatever language
 * the app is in when they're shown, and in plain English when told to the model.
 */

import type { Dict } from "../../i18n/en";
import type { ChatMessage } from "../../persistence/repository";

export type AppNote =
  | { k: "saved"; goals: string[]; goalIds: string[]; milestones: number; tasks: number; updated: number; sessions: number; rescheduled: number; events?: number }
  | { k: "saveFailed"; why: string }
  | { k: "invalid" }
  | { k: "error"; code: "unavailable" | "model_missing" | "insufficient_memory" | "load_failed" | "generation_failed" }
  | { k: "stale" }
  | { k: "stopped" };

export const encodeNote = (note: AppNote) => JSON.stringify(note);

/** The note inside a message, or null for ordinary text (including messages saved before notes were codes). */
export function decodeNote(content: string): AppNote | null {
  if (!content.startsWith('{"k":')) return null;
  try {
    const value = JSON.parse(content) as AppNote;
    return value && typeof value === "object" && typeof value.k === "string" ? value : null;
  } catch {
    return null;
  }
}

export function noteText(note: AppNote, d: Dict): string {
  switch (note.k) {
    case "saved":
      return d.aiSaved(note.goals, note.milestones, note.tasks, note.updated, note.sessions, note.rescheduled, note.events ?? 0);
    case "saveFailed":
      return d.aiSaveFailed(note.why);
    case "invalid":
      return d.aiInvalidAnswer;
    case "stale":
      return d.aiStaleRebuilt;
    case "stopped":
      return d.aiStopped;
    case "error":
      return {
        unavailable: d.aiErrUnavailable,
        model_missing: d.aiErrModelMissing,
        insufficient_memory: d.aiErrMemory,
        load_failed: d.aiErrLoad,
        generation_failed: d.aiErrGeneration,
      }[note.code];
  }
}

/** A message's text in the given language. */
export function messageText(m: Pick<ChatMessage, "content">, d: Dict): string {
  const note = decodeNote(m.content);
  return note ? noteText(note, d) : m.content;
}
