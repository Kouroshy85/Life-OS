/**
 * When the app may recommend anything, and when the user is free.
 *
 * A "logical day" runs from 04:00 until 01:00 the next morning, written as minutes
 * 240–1500, so late evenings stay on the day they belong to. 01:00–04:00 is never
 * recommended, whatever the settings say.
 */

import { intersect, length, merge, subtract, type Interval } from "./intervals";
import { occursOn } from "./plans";
import { addDays } from "./time";
import type { DateKey, Minutes, Plan, Preferences } from "./types";

export const HARD_BLOCK: Interval = { start: 60, end: 240 };
export const DAY_OPEN: Minutes = 240;
export const DAY_CLOSE: Minutes = 1500;
/** Where the day starts when no waking time is set. */
export const DEFAULT_WAKE: Minutes = 360;
export const DEFAULT_PLAN_GAP: Minutes = 60;
export const MIN_FREE: Minutes = 15;

type SleepPrefs = Pick<Preferences, "sleepStart" | "wakeTime">;

/** The parts of a logical day where plans may be recommended. */
export function recommendWindows({ sleepStart, wakeTime }: SleepPrefs): Interval[] {
  const blocked: Interval[] = [];
  if (sleepStart != null && wakeTime != null) {
    const sleep = sleepStart % 1440;
    const wake = wakeTime % 1440;
    if (sleep < wake) {
      blocked.push({ start: sleep, end: wake }, { start: sleep + 1440, end: wake + 1440 });
    } else {
      blocked.push({ start: sleep, end: wake + 1440 }, { start: sleep - 1440, end: wake });
    }
  } else {
    // With only a bedtime, nothing closes early: the day just runs until the 01:00 limit.
    blocked.push({ start: DAY_OPEN, end: wakeTime ?? DEFAULT_WAKE });
  }
  return subtract({ start: DAY_OPEN, end: DAY_CLOSE }, blocked);
}

/** The same rule on a calendar day (00:00–24:00): the minutes the scheduler must not use. */
export function blockedOnCalendarDay(prefs: SleepPrefs): Interval[] {
  const open: Interval[] = [];
  for (const w of recommendWindows(prefs)) {
    const day = intersect(w, { start: 0, end: 1440 });
    if (day) open.push(day);
    const night = intersect(w, { start: 1440, end: DAY_CLOSE });
    if (night) open.push({ start: night.start - 1440, end: night.end - 1440 });
  }
  return subtract({ start: 0, end: 1440 }, merge(open));
}

export interface FreeOptions {
  /** Hide time that has already gone by. */
  today?: DateKey;
  nowMin?: Minutes;
  /** Leave these plans out, as if they weren't there. */
  ignore?: (plan: Plan) => boolean;
}

/** Free time on `date`, in logical-day minutes (values above 1440 are after midnight). */
export function freeTimes(date: DateKey, plans: Plan[], prefs: Preferences, opts: FreeOptions = {}): Interval[] {
  const considered = opts.ignore ? plans.filter((p) => !opts.ignore!(p)) : plans;
  const gap = prefs.planGap ? DEFAULT_PLAN_GAP : 0;
  const pad = (p: Plan, shift: number): Interval => {
    const margin = p.type === "default" ? gap : 0;
    return { start: p.start + shift - margin, end: p.end + shift + margin };
  };
  const busy: Interval[] = [];
  for (const p of considered) if (occursOn(p, date)) busy.push(pad(p, 0));
  const next = addDays(date, 1);
  for (const p of considered) if (occursOn(p, next)) busy.push(pad(p, 1440));

  let free = recommendWindows(prefs).flatMap((w) => subtract(w, busy));
  if (opts.today && date === opts.today && opts.nowMin != null) {
    const now = opts.nowMin;
    free = free.map((f) => ({ start: Math.max(f.start, now), end: f.end })).filter((f) => f.end > f.start);
  }
  if (opts.today && date < opts.today) free = [];
  return free.filter((f) => length(f) >= MIN_FREE);
}
