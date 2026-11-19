import type { DateKey } from "./types";

export type CalendarSystem = "persian" | "gregory";
export const APP_TIME_ZONE = "Asia/Tehran";
let preferredCalendar: CalendarSystem = "persian";
export const getCalendar = () => preferredCalendar;
export const setCalendar = (calendar: CalendarSystem) => { preferredCalendar = calendar; };

const DAY = 86_400_000;
const utc = (key: DateKey) => new Date(`${key}T12:00:00Z`);
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");
export const shiftDate = (key: DateKey, days: number): DateKey => keyOf(utc(key).getTime() + days * DAY);
export const dateDistance = (a: DateKey, b: DateKey) => (utc(b).getTime() - utc(a).getTime()) / DAY;
export const calendarWeekday = (key: DateKey) => utc(key).getUTCDay();

function parts(format: Intl.DateTimeFormat, date: Date) {
  const fields = Object.fromEntries(format.formatToParts(date).map(({ type, value }) => [type, Number(value)]));
  return { year: fields.year, month: fields.month, day: fields.day, hour: fields.hour, minute: fields.minute };
}
const tehranClock = new Intl.DateTimeFormat("en-US", { timeZone: APP_TIME_ZONE, calendar: "gregory", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" });
export function appClock(date = new Date()) {
  const { year, month, day, hour, minute } = parts(tehranClock, date);
  return { today: `${year}-${pad(month)}-${pad(day)}`, nowMin: hour * 60 + minute };
}

const persianParts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", calendar: "persian", year: "numeric", month: "numeric", day: "numeric" });
export function calendarParts(key: DateKey, calendar: CalendarSystem) {
  if (calendar === "gregory") {
    const date = utc(key);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  }
  const { year, month, day } = parts(persianParts, utc(key));
  return { year, month, day };
}

const monthStarts = new Map<string, DateKey>();
/** Intl is also the display calendar, so month calculations and labels agree. */
function monthStart(year: number, month: number, calendar: CalendarSystem): DateKey {
  if (calendar === "gregory") return `${String(year).padStart(4, "0")}-${pad(month)}-01`;
  const cacheKey = `${year}/${month}`;
  const cached = monthStarts.get(cacheKey);
  if (cached) return cached;
  const newYear = Date.UTC(year + 621, 2, 15, 12);
  let low = 0;
  let high = 376;
  const target = year * 12 + month;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const value = calendarParts(keyOf(newYear + middle * DAY), calendar);
    if (value.year * 12 + value.month >= target) high = middle;
    else low = middle + 1;
  }
  const key = keyOf(newYear + low * DAY);
  if (monthStarts.size > 2048) monthStarts.clear();
  monthStarts.set(cacheKey, key);
  return key;
}

function offsetMonth(year: number, month: number, count: number, calendar: CalendarSystem) {
  const index = year * 12 + month - 1 + count;
  return monthStart(Math.floor(index / 12), index % 12 + 1, calendar);
}
export function calendarMonth(key: DateKey, calendar: CalendarSystem = getCalendar()) {
  const { year, month, day } = calendarParts(key, calendar);
  return { start: shiftDate(key, 1 - day), end: shiftDate(offsetMonth(year, month, 1, calendar), -1) };
}
/** Each offset is relative to the original date, so clamping never drifts. */
export function shiftCalendarMonth(key: DateKey, count: number, calendar: CalendarSystem): DateKey {
  if (count === 0) return key;
  const { year, month, day } = calendarParts(key, calendar);
  const first = offsetMonth(year, month, count, calendar);
  const next = offsetMonth(year, month, count + 1, calendar);
  return shiftDate(first, Math.min(day, dateDistance(first, next)) - 1);
}
export function calendarQuarter(key: DateKey, calendar: CalendarSystem = getCalendar()) {
  const { year, month } = calendarParts(key, calendar);
  const first = month - (month - 1) % 3;
  return { start: offsetMonth(year, first, 0, calendar), end: shiftDate(offsetMonth(year, first, 3, calendar), -1) };
}
export function displayDate(key: DateKey, locale: string, options: Intl.DateTimeFormatOptions, calendar = getCalendar()) {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC", calendar, numberingSystem: "latn" }).format(utc(key));
}
