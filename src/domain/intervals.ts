import type { Minutes } from "./types";

export interface Interval {
  start: Minutes;
  end: Minutes;
}

export const length = (i: Interval) => Math.max(0, i.end - i.start);

export const totalLength = (list: Interval[]) => list.reduce((sum, i) => sum + length(i), 0);

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Sorts and merges overlapping or touching intervals. */
export function merge(list: Interval[]): Interval[] {
  const sorted = list
    .filter((i) => i.end > i.start)
    .map((i) => ({ start: i.start, end: i.end }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else out.push(cur);
  }
  return out;
}

/** `window` minus every interval in `busy`. */
export function subtract(window: Interval, busy: Interval[]): Interval[] {
  const out: Interval[] = [];
  let cursor = window.start;
  for (const b of merge(busy)) {
    if (b.end <= cursor) continue;
    if (b.start >= window.end) break;
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, window.end) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= window.end) break;
  }
  if (cursor < window.end) out.push({ start: cursor, end: window.end });
  return out;
}

export function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}
