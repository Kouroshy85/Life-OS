/**
 * Builds a weekly session plan for a goal out of the user's real free time.
 *
 * Sessions never touch default or goal plans. Free time is used first; if that runs
 * out they may sit on top of an event, because goal plans outrank events.
 */

import { freeTimes } from "./availability";
import { intersect, length, overlaps, subtract, totalLength, type Interval } from "./intervals";
import { nextWeekday, occursOn } from "./plans";
import type { DateKey, Minutes, Plan, Preferences } from "./types";

export interface GoalSession {
  weekday: number;
  start: Minutes;
  end: Minutes;
  /** True when the session takes time from an event. */
  overEvent: boolean;
}

export interface GoalPlanResult {
  ok: boolean;
  sessions: GoalSession[];
  placedMin: Minutes;
  neededMin: Minutes;
}

const SESSION_GAP = 15;
const SHORTEST = 30;
const SNAP = 15;

function sessionLength(targetMin: Minutes): Minutes {
  if (targetMin <= 300) return 60;
  return targetMin <= 540 ? 90 : 120;
}

export function planGoalSessions(input: {
  hoursMin: number;
  hoursMax: number;
  plans: Plan[];
  prefs: Preferences;
  today: DateKey;
  anchorMin?: Minutes;
}): GoalPlanResult {
  const { plans, prefs, today } = input;
  const targetMin = Math.round(input.hoursMax * 60);
  const neededMin = Math.round(input.hoursMin * 60);
  const dates = Array.from({ length: 7 }, (_, w) => nextWeekday(today, w));
  const placedByDay: Interval[][] = dates.map(() => []);
  const sessions: GoalSession[] = [];

  /** Open time on a weekday. Sessions repeat by calendar day, so they end by midnight. */
  const openOn = (w: number, overEvents: boolean): Interval[] => {
    const raw = freeTimes(dates[w], plans, prefs, overEvents ? { ignore: (p) => p.type === "event" } : {});
    const taken = placedByDay[w].map((s) => ({ start: s.start - SESSION_GAP, end: s.end + SESSION_GAP }));
    return raw.flatMap((f) => {
      const today = intersect(f, { start: 0, end: 1440 });
      return today ? subtract(today, taken) : [];
    });
  };

  let anchor = input.anchorMin ?? prefs.focusStart;
  let hasAnchor = false;

  const place = (dur: Minutes, overEvents: boolean): boolean => {
    const days = dates
      .map((_, w) => ({ w, open: openOn(w, overEvents) }))
      .filter((d) => d.open.some((g) => length(g) >= dur))
      .sort((a, b) => placedByDay[a.w].length - placedByDay[b.w].length || totalLength(b.open) - totalLength(a.open) || a.w - b.w);
    const day = days[0];
    if (!day) return false;
    const fits = day.open.filter((g) => length(g) >= dur);
    const distance = (g: Interval) => (anchor < g.start ? g.start - anchor : anchor > g.end - dur ? anchor - (g.end - dur) : 0);
    const gap = [...fits].sort((a, b) => distance(a) - distance(b) || a.start - b.start)[0];
    let start = Math.min(Math.max(anchor, gap.start), gap.end - dur);
    const snapped = Math.ceil(start / SNAP) * SNAP;
    if (snapped + dur <= gap.end) start = snapped;
    const slot = { start, end: start + dur };
    placedByDay[day.w].push(slot);
    const date = dates[day.w];
    sessions.push({
      weekday: day.w,
      ...slot,
      overEvent: plans.some((p) => p.type === "event" && occursOn(p, date) && overlaps(p, slot)),
    });
    if (!hasAnchor) {
      anchor = start;
      hasAnchor = true;
    }
    return true;
  };

  const preferred = sessionLength(targetMin);
  let placedMin = 0;
  while (placedMin < targetMin) {
    const remaining = targetMin - placedMin;
    const dur = Math.min(preferred, remaining);
    const lengths = [...new Set([dur, Math.min(dur, 60), Math.min(dur, 45), Math.min(dur, SHORTEST)])];
    let done = 0;
    for (const overEvents of [false, true]) {
      for (const len of lengths) {
        if (len < Math.min(SHORTEST, remaining)) continue;
        if (place(len, overEvents)) {
          done = len;
          break;
        }
      }
      if (done) break;
    }
    if (!done) break;
    placedMin += done;
  }

  sessions.sort((a, b) => a.weekday - b.weekday || a.start - b.start);
  return { ok: placedMin >= neededMin, sessions, placedMin, neededMin };
}

/** Plans a goal again at new hours, freeing the time its current sessions hold first. */
export function replanGoalSessions(input: { goalId: string; hours: number; plans: Plan[]; prefs: Preferences; today: DateKey }): GoalPlanResult {
  return planGoalSessions({
    hoursMin: input.hours,
    hoursMax: input.hours,
    plans: input.plans.filter((p) => p.goalId !== input.goalId),
    prefs: input.prefs,
    today: input.today,
  });
}
