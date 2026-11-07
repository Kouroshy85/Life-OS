/**
 * Small models are unreliable at calendar maths, especially with Persian (Solar Hijri)
 * months. Before a message goes to the model, date words in it get the real date
 * written next to them: "آخر دی" → "آخر دی (2027-01-20)", "tomorrow" → "tomorrow (2026-11-06)".
 * The model then only has to copy a date, not work one out.
 */

import { toLatinDigits } from "../../domain/locale";
import { addDays } from "../../domain/time";
import type { DateKey } from "../../domain/types";

const PERSIAN_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const GREGORIAN_MONTHS: string[][] = [
  ["january", "jan", "ژانویه", "ژانویهٔ"],
  ["february", "feb", "فوریه"],
  ["march", "mar", "مارس"],
  ["april", "apr", "آوریل"],
  ["may", "مه", "می"],
  ["june", "jun", "ژوئن"],
  ["july", "jul", "ژوئیه", "جولای"],
  ["august", "aug", "اوت", "آگوست"],
  ["september", "sep", "sept", "سپتامبر"],
  ["october", "oct", "اکتبر"],
  ["november", "nov", "نوامبر"],
  ["december", "dec", "دسامبر"],
];
const WEEKDAYS: string[][] = [
  ["sunday", "یکشنبه", "یک‌شنبه"],
  ["monday", "دوشنبه", "دو‌شنبه"],
  ["tuesday", "سه‌شنبه", "سه شنبه", "سشنبه"],
  ["wednesday", "چهارشنبه", "چهار‌شنبه"],
  ["thursday", "پنجشنبه", "پنج‌شنبه", "پنج شنبه"],
  ["friday", "جمعه"],
  ["saturday", "شنبه"],
];

const persianParts = new Intl.DateTimeFormat("en-u-ca-persian-nu-latn", { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" });

/** Solar Hijri year, month (1–12) and day of a Gregorian date. */
function persianOf(d: DateKey): { y: number; m: number; d: number } {
  const parts = persianParts.formatToParts(new Date(`${d}T12:00:00Z`));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** First and last Gregorian day of the next (or current) occurrence of a Persian month. */
function persianMonthRange(month: number, today: DateKey): { start: DateKey; end: DateKey; days: Map<number, DateKey> } | null {
  let day = today;
  let start: DateKey | null = null;
  const days = new Map<number, DateKey>();
  for (let i = 0; i < 400; i++) {
    const p = persianOf(day);
    if (p.m === month) {
      if (!start) start = day;
      days.set(p.d, day);
    } else if (start) {
      break;
    }
    day = addDays(day, 1);
  }
  if (!start) return null;
  // Fill in the days of the current month that have already passed.
  let back = addDays(start, -1);
  while (persianOf(back).m === month) {
    days.set(persianOf(back).d, back);
    start = back;
    back = addDays(back, -1);
  }
  return { start, end: addDays(start, days.size - 1), days };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The next date with this month and day, this year or next. */
function gregorian(month: number, day: number, today: DateKey): DateKey | null {
  if (day < 1 || day > 31) return null;
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    const key = `${y}-${pad(month)}-${pad(day)}`;
    const check = new Date(`${key}T12:00:00Z`);
    if (check.getUTCMonth() + 1 !== month) return null;
    if (key >= today) return key;
  }
  return null;
}

function weekdayOf(d: DateKey): number {
  return new Date(`${d}T12:00:00Z`).getUTCDay();
}

const alt = (words: string[]) => words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
// Persian has no word boundaries in \b's sense, so "not a letter" is spelled out.
const B = "(?<![\\p{L}\\u200c])";
const E = "(?![\\p{L}\\u200c])";

/** The message with real dates added in parentheses after date words. Unknown phrases are left alone. */
export function annotateDates(text: string, today: DateKey): string {
  let out = toLatinDigits(text);
  const notes: { at: number; len: number; date: DateKey }[] = [];
  const mark = (re: RegExp, toDate: (m: RegExpExecArray) => DateKey | null) => {
    for (const m of out.matchAll(re)) {
      const date = toDate(m as RegExpExecArray);
      const at = m.index ?? 0;
      if (date && !notes.some((n) => at < n.at + n.len && n.at < at + m[0].length)) notes.push({ at, len: m[0].length, date });
    }
  };

  // Persian months: "آخر دی", "اوایل بهمن", "۲۰ دی", "دی ماه" (a bare month name is too ambiguous: "مهر", "تیر").
  const pm = alt(PERSIAN_MONTHS);
  mark(new RegExp(`${B}(\\d{1,2})\\s*(?:ام\\s*)?(${pm})(?:\\s*ماه)?${E}`, "gu"), (m) => persianMonthRange(PERSIAN_MONTHS.indexOf(m[2]) + 1, today)?.days.get(Number(m[1])) ?? null);
  mark(new RegExp(`${B}(آخر|اواخر|ته|اول|اوایل|وسط|اواسط|نیمه)(?:\\s*ی|\\u200cی)?\\s*(?:ماه\\s*)?(${pm})(?:\\s*ماه)?${E}`, "gu"), (m) => {
    const r = persianMonthRange(PERSIAN_MONTHS.indexOf(m[2]) + 1, today);
    if (!r) return null;
    if (/آخر|اواخر|ته/.test(m[1])) return r.end;
    if (/اول|اوایل/.test(m[1])) return r.start;
    return r.days.get(15) ?? null;
  });
  mark(new RegExp(`${B}(${pm})\\s*ماه${E}`, "gu"), (m) => persianMonthRange(PERSIAN_MONTHS.indexOf(m[1]) + 1, today)?.end ?? null);

  // Gregorian months with a day: "20 November", "November 26", "۲۰ نوامبر".
  const monthIndex = (word: string) => GREGORIAN_MONTHS.findIndex((names) => names.includes(word.toLowerCase())) + 1;
  const gm = alt(GREGORIAN_MONTHS.flat());
  mark(new RegExp(`${B}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${gm})${E}`, "giu"), (m) => gregorian(monthIndex(m[2]), Number(m[1]), today));
  mark(new RegExp(`${B}(${gm})\\s+(\\d{1,2})(?:st|nd|rd|th)?${E}`, "giu"), (m) => gregorian(monthIndex(m[1]), Number(m[2]), today));

  // Relative days and weekdays.
  mark(new RegExp(`${B}(day after tomorrow|پس[\\s\\u200c]?فردا)${E}`, "giu"), () => addDays(today, 2));
  mark(new RegExp(`${B}(tomorrow|فردا)${E}`, "giu"), () => addDays(today, 1));
  mark(new RegExp(`${B}(today|امروز)${E}`, "giu"), () => today);
  mark(new RegExp(`${B}(${alt(WEEKDAYS.flat())})${E}`, "giu"), (m) => {
    const target = WEEKDAYS.findIndex((names) => names.includes(m[1].toLowerCase()));
    if (target < 0) return null;
    return addDays(today, (target - weekdayOf(today) + 7) % 7);
  });

  for (const n of notes.sort((a, b) => b.at - a.at)) {
    out = `${out.slice(0, n.at + n.len)} (${n.date})${out.slice(n.at + n.len)}`;
  }
  return out;
}
