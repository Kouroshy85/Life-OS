import type { DateKey, Minutes } from "./types";

export const DAY_MINUTES = 24 * 60;

const pad = (n: number) => String(n).padStart(2, "0");

export function toDateKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateKey(key: DateKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isValidDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const d = parseDateKey(key);
  return toDateKey(d) === key;
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Whole calendar days from `a` to `b` (positive when b is later). */
export function daysBetween(a: DateKey, b: DateKey): number {
  const ms = parseDateKey(b).getTime() - parseDateKey(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function weekdayOf(key: DateKey): number {
  return parseDateKey(key).getDay();
}

export function minutesOfDay(d: Date): Minutes {
  return d.getHours() * 60 + d.getMinutes();
}

export function formatClock(min: Minutes): string {
  const m = Math.max(0, Math.min(DAY_MINUTES, Math.round(min)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Parses "HH:MM" into minutes; returns null for invalid input. */
export function parseClock(text: string): Minutes | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

export function formatDuration(min: Minutes): string {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function roundUpTo(min: Minutes, step: number): Minutes {
  return Math.ceil(min / step) * step;
}

const LONG_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function formatLongDate(key: DateKey): string {
  return LONG_DATE.format(parseDateKey(key));
}

export function formatShortDate(key: DateKey): string {
  return SHORT_DATE.format(parseDateKey(key));
}

/** "today", "tomorrow", "in 3 days", "2 days ago", or a short date. */
export function relativeDay(key: DateKey, today: DateKey): string {
  const diff = daysBetween(today, key);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  if (diff > 1 && diff < 7) return `in ${diff} days`;
  if (diff < -1 && diff > -7) return `${-diff} days ago`;
  return formatShortDate(key);
}
