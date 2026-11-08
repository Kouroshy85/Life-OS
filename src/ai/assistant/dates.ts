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

export interface FoundAppointment {
  date: DateKey;
  start: number;
  end: number;
  title: string;
}

const APPOINTMENT_WORDS: [RegExp, string | null][] = [
  [/کلاس\s+[^\s،,.؟?!]+/, null],
  [/وقت\s+(دکتر|دندون‌?پزشکی|دندانپزشکی|آرایشگاه)/, null],
  [/(قرار|جلسه|مهمونی|مهمانی|باشگاه|امتحان|کلاس|دکتر|مصاحبه)/, null],
  [/(dentist|doctor|haircut)( appointment)?/i, null],
  [/(meeting|appointment|class|lesson|interview|exam|gym|party|call)/i, null],
];

/**
 * A fixed appointment described in an annotated message: a resolved date and a time
 * range, such as "دوشنبه (2026-11-09) ساعت 9 شب (21:00) تا 10 شب (22:00)" or
 * "Tuesday (2026-11-10) from 4pm (16:00) to 5pm (17:00)". Null when there's no clear date and range.
 */
export function findAppointment(annotated: string, fallbackTitle: string): FoundAppointment | null {
  const date = annotated.match(/\((\d{4}-\d{2}-\d{2})\)/)?.[1];
  if (!date) return null;
  const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  // Both ends resolved: "... (21:00) تا|to ... (22:00)".
  const both = annotated.match(/\((\d{2}:\d{2})\)\s*(?:تا|to|until|till|-|–)\s*[^()]{0,20}?\((\d{2}:\d{2})\)/i);
  let start: number | null = null;
  let end: number | null = null;
  if (both) {
    start = toMin(both[1]);
    end = toMin(both[2]);
  } else {
    // Only the end resolved: "۷ تا ۸ صبح (08:00)" takes the end's part of day for the start too.
    const half = annotated.match(/(\d{1,2})(?::(\d{2}))?\s*(?:تا|to|until|-|–)\s*(\d{1,2})(?::(\d{2}))?[^()\d]{0,12}\((\d{2}:\d{2})\)/i);
    if (half) {
      end = toMin(half[5]);
      const shift = Math.floor(end / 60) - (Number(half[3]) % 24);
      start = (Number(half[1]) + shift) * 60 + Number(half[2] ?? 0);
    }
  }
  if (start == null || end == null) return null;
  if (end === 0) end = 24 * 60;
  if (start < 0 || end <= start || end - start > 12 * 60) return null;
  let title = fallbackTitle;
  for (const [re] of APPOINTMENT_WORDS) {
    const m = annotated.match(re);
    if (m) {
      title = m[0].trim();
      break;
    }
  }
  return { date, start, end, title: title.charAt(0).toUpperCase() + title.slice(1) };
}

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

  // Clock times with a part of day: "9 شب" → 21:00, "ساعت ۷ صبح", "عصر 5", "9pm", "9:30 am".
  const day = "صبح|ظهر|بعدازظهر|بعد از ظهر|بعد‌ازظهر|عصر|شب|am|pm|a\\.m\\.|p\\.m\\.";
  const clock = (h: number, m: number, part: string) => {
    let hour = h;
    if (/am|a\.m\.|صبح/.test(part)) hour = h === 12 ? 0 : h;
    else if (/pm|p\.m\.|ظهر|عصر/.test(part)) hour = h < 12 ? h + 12 : h;
    else if (part === "شب") hour = h === 12 ? 24 : h >= 6 && h < 12 ? h + 12 : h;
    if (hour > 24 || m > 59 || h > 12) return null;
    return `${pad(hour === 24 ? 0 : hour)}:${pad(m)}`;
  };
  const times: { at: number; len: number; text: string }[] = [];
  const time = (re: RegExp, pick: (m: RegExpExecArray) => [number, number, string]) => {
    for (const m of out.matchAll(re)) {
      const [h, min, part] = pick(m as RegExpExecArray);
      const text = clock(h, min, part.toLowerCase());
      if (text) times.push({ at: m.index ?? 0, len: m[0].length, text });
    }
  };
  time(new RegExp(`${B}(?:ساعت\\s*)?(\\d{1,2})(?::(\\d{2}))?\\s*(${day})${E}`, "giu"), (m) => [Number(m[1]), Number(m[2] ?? 0), m[3]]);
  time(new RegExp(`${B}(صبح|ظهر|عصر|شب)\\s*(?:ساعت\\s*)?(\\d{1,2})(?::(\\d{2}))?${E}`, "gu"), (m) => [Number(m[2]), Number(m[3] ?? 0), m[1]]);

  const all = [
    ...notes.map((n) => ({ at: n.at, len: n.len, text: n.date })),
    ...times.filter((x) => !notes.some((n) => x.at < n.at + n.len && n.at < x.at + x.len)),
  ];
  for (const n of all.sort((a, b) => b.at - a.at)) {
    out = `${out.slice(0, n.at + n.len)} (${n.text})${out.slice(n.at + n.len)}`;
  }
  return out;
}
