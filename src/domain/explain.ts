/**
 * Explanations the scheduler gives for its decisions, stored as data rather than
 * sentences. They are rendered in the current language when shown, so switching
 * language also translates plans that were made earlier.
 */

import type { DateKey, Minutes, Priority } from "./types";

export type DeadlineNote =
  | { kind: "overdue"; date: DateKey }
  | { kind: "today"; at: Minutes | null }
  | { kind: "thatDay"; at: Minutes | null }
  | { kind: "tomorrow"; at: Minutes | null }
  | { kind: "inDays"; n: number };

export type Trigger =
  | string
  | { t: "overrun"; title: string; dur: Minutes }
  | { t: "added"; title: string; at: Minutes }
  | { t: "changed"; title: string; at: Minutes }
  | { t: "manual" };

export type Part =
  | { k: "base"; priority: Priority | null; deadline: DeadlineNote | null; inProgress: boolean; rank: number }
  | { k: "placeFocus" }
  | { k: "placeOutsideFocus" }
  | { k: "placeFocusFull" }
  | { k: "placeOnlyFocus" }
  | { k: "placeEarliest" }
  | { k: "moved"; from: Minutes; to: Minutes; trigger?: Trigger }
  | { k: "late"; at: Minutes | null }
  | { k: "session"; i: number; n: number; dur: Minutes }
  | { k: "shortSession"; dur: Minutes }
  | { k: "breakReason"; after: Minutes }
  | { k: "skippedToday" }
  | { k: "noHours" }
  | { k: "dayPassed" }
  | { k: "hoursEnded"; end: Minutes }
  | { k: "partly"; placed: Minutes; rest: Minutes }
  | { k: "noFree"; need: Minutes }
  | { k: "notEnough"; need: Minutes; free: Minutes }
  | { k: "breakEats"; need: Minutes; longest: Minutes }
  | { k: "gapShort"; need: Minutes; longest: Minutes; min: Minutes }
  | { k: "overdueSuffix" }
  | { k: "dueDaySuffix" }
  | { k: "toBacklog"; trigger: Trigger }
  | { k: "byYouSlot" }
  | { k: "movedByYou"; at: Minutes }
  | { k: "resizedByYou"; dur: Minutes }
  | { k: "proposal"; sessions: number; scheduled: Minutes; available: Minutes; backlog: number };

export const encodeParts = (...parts: (Part | null | undefined)[]) => JSON.stringify(parts.filter(Boolean));

export function decodeParts(text: string): Part[] | null {
  if (!text.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Puts `extra` in front of an already encoded explanation. */
export function prependPart(extra: Part, encoded: string): string {
  return JSON.stringify([extra, ...(decodeParts(encoded) ?? [])]);
}
