import { getLang, num, toLatinDigits } from "./locale";
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
  return num(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
}

/** Parses "HH:MM" into minutes; returns null for invalid input. */
export function parseClock(text: string): Minutes | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(toLatinDigits(text).trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

export function formatDuration(min: Minutes): string {
  const m = Math.round(min);
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (getLang() === "fa") {
    if (m < 60) return `${num(m)} دقیقه`;
    return rest ? `${num(h)} ساعت و ${num(rest)} دقیقه` : `${num(h)} ساعت`;
  }
  if (m < 60) return `${m}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function roundUpTo(min: Minutes, step: number): Minutes {
  return Math.ceil(min / step) * step;
}

/** Persian uses the Solar Hijri calendar and Persian digits, the way dates are normally read in Iran. */
const dateLocale = () => (getLang() === "fa" ? "fa-IR" : "en-US");

export function formatLongDate(key: DateKey): string {
  return new Intl.DateTimeFormat(dateLocale(), { weekday: "long", month: "long", day: "numeric" }).format(parseDateKey(key));
}

export function formatShortDate(key: DateKey): string {
  return new Intl.DateTimeFormat(dateLocale(), { month: getLang() === "fa" ? "long" : "short", day: "numeric" }).format(parseDateKey(key));
}

export function formatFullDate(key: DateKey): string {
  return new Intl.DateTimeFormat(dateLocale(), { year: "numeric", month: getLang() === "fa" ? "long" : "short", day: "numeric" }).format(parseDateKey(key));
}

/** "today", "tomorrow", "in 3 days", "2 days ago", or a short date. */
export function relativeDay(key: DateKey, today: DateKey): string {
  const diff = daysBetween(today, key);
  const fa = getLang() === "fa";
  if (diff === 0) return fa ? "امروز" : "today";
  if (diff === 1) return fa ? "فردا" : "tomorrow";
  if (diff === -1) return fa ? "دیروز" : "yesterday";
  if (diff > 1 && diff < 7) return fa ? `${num(diff)} روز دیگه` : `in ${diff} days`;
  if (diff < -1 && diff > -7) return fa ? `${num(-diff)} روز پیش` : `${-diff} days ago`;
  return formatShortDate(key);
}

export function formatMonthYear(key: DateKey): string {
  return new Intl.DateTimeFormat(dateLocale(), { month: "long", year: "numeric" }).format(parseDateKey(key));
}

/** A logical-day minute as a clock time: 1500 reads as 01:00. */
export const formatDayClock = (min: Minutes) => formatClock(min === 1440 ? 0 : min % 1440);

/** Local date and time as a sortable key, always in Latin digits. */
export function dateTimeKey(date: DateKey, min: Minutes): string {
  return `${date}T${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export function parseDateTimeKey(key: string): { date: DateKey; min: Minutes } {
  const [date, time] = key.split("T");
  const [h, m] = time.split(":").map(Number);
  return { date, min: h * 60 + m };
}
