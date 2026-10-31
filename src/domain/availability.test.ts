import { describe, expect, it } from "vitest";
import { blockedOnCalendarDay, freeTimes, recommendWindows } from "./availability";
import { planGoalSessions } from "./goalPlanner";
import { overlaps } from "./intervals";
import { ALL_DAYS, classifyConflicts, dayBit, findConflicts, layoutLanes, occursOn, planTimeProblem, plansToCommitments, weekDates } from "./plans";
import { schedule } from "./scheduler";
import { digitsOnly, textProblem, timeChars } from "./text";
import { DEFAULT_PREFERENCES, type Plan, type Preferences } from "./types";

const SUNDAY = "2026-11-01";
const h = (n: number, m = 0) => n * 60 + m;

let seq = 0;
function plan(p: Partial<Plan> = {}): Plan {
  seq += 1;
  return {
    id: `p${seq}`,
    type: "default",
    title: "Plan",
    description: "",
    weekdays: dayBit(0),
    dates: null,
    validFrom: null,
    start: h(9),
    end: h(10),
    goalId: null,
    isBreak: false,
    isSample: false,
    createdAt: "x",
    updatedAt: "x",
    ...p,
  };
}

const prefs = (p: Partial<Preferences> = {}): Preferences => ({ ...DEFAULT_PREFERENCES, ...p });

describe("recommendation windows", () => {
  it("skips the sleep gap when both sleep and wake are set", () => {
    expect(recommendWindows({ sleepStart: 0, wakeTime: h(10) })).toEqual([{ start: h(10), end: h(24) }]);
  });

  it("runs past a midnight bedtime when no waking time is set, up to 01:00", () => {
    expect(recommendWindows({ sleepStart: 0, wakeTime: null })).toEqual([{ start: h(6), end: h(25) }]);
  });

  it("starts at the waking time when only that is set", () => {
    expect(recommendWindows({ sleepStart: null, wakeTime: h(8) })).toEqual([{ start: h(8), end: h(25) }]);
  });

  it("handles sleeping through the day", () => {
    expect(recommendWindows({ sleepStart: h(10), wakeTime: h(16) })).toEqual([
      { start: h(4), end: h(10) },
      { start: h(16), end: h(25) },
    ]);
  });

  it("never includes 01:00–04:00, whatever the settings", () => {
    const options = [null, 0, h(1), h(2), h(3), h(5), h(10), h(16), h(23)];
    for (const sleepStart of options) {
      for (const wakeTime of options) {
        for (const w of recommendWindows({ sleepStart, wakeTime })) {
          expect(w.start).toBeGreaterThanOrEqual(h(4));
          expect(w.end).toBeLessThanOrEqual(h(25));
        }
        const blocked = blockedOnCalendarDay({ sleepStart, wakeTime });
        const coveredMinutes = new Set(blocked.flatMap((b) => Array.from({ length: b.end - b.start }, (_, i) => b.start + i)));
        for (let m = h(1); m < h(4); m++) expect(coveredMinutes.has(m)).toBe(true);
      }
    }
  });
});

describe("free time", () => {
  const work = plan({ title: "Work", start: h(11), end: h(16) });
  const lesson = plan({ title: "Class", start: h(21), end: h(22) });

  it("matches the example: work 11–16 and class 21–22, with the one-hour gap", () => {
    expect(freeTimes(SUNDAY, [work, lesson], prefs({ planGap: true }))).toEqual([
      { start: h(6), end: h(10) },
      { start: h(17), end: h(20) },
      { start: h(23), end: h(25) },
    ]);
  });

  it("matches the example with the gap switched off", () => {
    expect(freeTimes(SUNDAY, [work, lesson], prefs({ planGap: false }))).toEqual([
      { start: h(6), end: h(11) },
      { start: h(16), end: h(21) },
      { start: h(22), end: h(25) },
    ]);
  });

  it("only pads default plans, not goals or events", () => {
    const event = plan({ type: "event", start: h(12), end: h(13) });
    expect(freeTimes(SUNDAY, [event], prefs({ planGap: true }))).toEqual([
      { start: h(6), end: h(12) },
      { start: h(13), end: h(25) },
    ]);
  });

  it("counts plans just after midnight against the night before", () => {
    const late = plan({ weekdays: dayBit(1), start: 0, end: h(0, 30) });
    expect(freeTimes(SUNDAY, [late], prefs({ planGap: false }))).toEqual([
      { start: h(6), end: h(24) },
      { start: h(24, 30), end: h(25) },
    ]);
  });

  it("drops the past: earlier today and earlier days", () => {
    expect(freeTimes(SUNDAY, [], prefs(), { today: SUNDAY, nowMin: h(15) })).toEqual([{ start: h(15), end: h(25) }]);
    expect(freeTimes(SUNDAY, [], prefs(), { today: "2026-11-02", nowMin: h(15) })).toEqual([]);
  });

  it("leaves out gaps too short to use", () => {
    const a = plan({ start: h(6), end: h(7) });
    const b = plan({ start: h(7, 10), end: h(24) });
    expect(freeTimes(SUNDAY, [a, b], prefs({ planGap: false }))).toEqual([{ start: h(24), end: h(25) }]);
  });
});

describe("plans", () => {
  it("repeats on chosen weekdays from its start, or only on its dates", () => {
    const repeating = plan({ weekdays: dayBit(0), validFrom: "2026-11-01" });
    expect(occursOn(repeating, "2026-11-08")).toBe(true);
    expect(occursOn(repeating, "2026-10-25")).toBe(false);
    expect(occursOn(repeating, "2026-11-02")).toBe(false);
    const event = plan({ type: "event", weekdays: 0, dates: ["2026-11-03"] });
    expect(occursOn(event, "2026-11-03")).toBe(true);
    expect(occursOn(event, "2026-11-10")).toBe(false);
  });

  it("builds a week from any day, for either week start", () => {
    expect(weekDates("2026-11-04", 0)[0]).toBe("2026-11-01");
    expect(weekDates("2026-11-04", 6)[0]).toBe("2026-10-31");
    expect(weekDates("2026-12-30", 0)[6]).toBe("2027-01-02");
  });

  it("finds a clash only when the day and the time both match", () => {
    const base = plan({ start: h(9), end: h(11) });
    expect(findConflicts(plan({ start: h(10), end: h(12) }), [base])).toHaveLength(1);
    expect(findConflicts(plan({ start: h(11), end: h(12) }), [base])).toHaveLength(0);
    expect(findConflicts(plan({ start: h(10), end: h(12), weekdays: dayBit(1) }), [base])).toHaveLength(0);
    expect(findConflicts(plan({ type: "event", weekdays: 0, dates: [SUNDAY], start: h(10), end: h(12) }), [base])).toHaveLength(1);
    expect(findConflicts(plan({ type: "event", weekdays: 0, dates: ["2026-11-02"], start: h(10), end: h(12) }), [base])).toHaveLength(0);
  });

  it("does not clash with itself when editing", () => {
    const base = plan();
    expect(findConflicts(base, [base])).toHaveLength(0);
  });

  it("applies the priority order: default, goal, event", () => {
    const def = plan({ type: "default" });
    const goal = plan({ type: "goal" });
    const event = plan({ type: "event" });
    expect(classifyConflicts(plan({ type: "default" }), [def, goal, event])).toMatchObject({ blocking: [{ plan: def }], outranked: [{ plan: goal }, { plan: event }] });
    expect(classifyConflicts(plan({ type: "goal" }), [def, goal, event])).toMatchObject({ blocking: [{ plan: def }, { plan: goal }], outranked: [{ plan: event }] });
    expect(classifyConflicts(plan({ type: "event" }), [def, goal, event]).blocking).toHaveLength(3);
  });

  it("rejects impossible times", () => {
    expect(planTimeProblem(null, 60)).toBe("missing");
    expect(planTimeProblem(600, 600)).toBe("order");
    expect(planTimeProblem(600, 540)).toBe("order");
    expect(planTimeProblem(600, 603)).toBe("tooShort");
    expect(planTimeProblem(600, 660)).toBeNull();
  });

  it("gives the day scheduler every plan as fixed time", () => {
    const out = plansToCommitments([plan({ validFrom: "2026-11-01" }), plan({ type: "event", weekdays: 0, dates: ["2026-11-03", "2026-11-04"] })]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ date: null, from: "2026-11-01" });
    expect(out[2]).toMatchObject({ date: "2026-11-04", weekdays: 0 });
  });

  it("puts the higher priority first when plans overlap in the grid", () => {
    const event = plan({ type: "event", start: h(9), end: h(10) });
    const def = plan({ type: "default", start: h(9), end: h(10) });
    const other = plan({ type: "goal", start: h(15), end: h(16) });
    const lanes = layoutLanes([event, def, other]);
    expect(lanes.find((l) => l.plan === def)).toMatchObject({ lane: 0, lanes: 2 });
    expect(lanes.find((l) => l.plan === event)).toMatchObject({ lane: 1, lanes: 2 });
    expect(lanes.find((l) => l.plan === other)).toMatchObject({ lane: 0, lanes: 1 });
  });
});

describe("goal session planning", () => {
  const base = { today: SUNDAY, prefs: prefs() };
  const busyWeek = (start: number, end: number) => plan({ weekdays: ALL_DAYS, start, end });

  it("creates the requested hours, spread across the week", () => {
    const r = planGoalSessions({ ...base, hoursMin: 5, hoursMax: 5, plans: [] });
    expect(r.ok).toBe(true);
    expect(r.placedMin).toBe(300);
    expect(new Set(r.sessions.map((s) => s.weekday)).size).toBe(5);
  });

  it("uses the top of a range when there is room", () => {
    expect(planGoalSessions({ ...base, hoursMin: 12, hoursMax: 15, plans: [] }).placedMin).toBe(900);
  });

  it("never schedules between 01:00 and 04:00, or on a default plan", () => {
    const work = busyWeek(h(9), h(17));
    const r = planGoalSessions({ ...base, hoursMin: 15, hoursMax: 15, plans: [work] });
    expect(r.ok).toBe(true);
    for (const s of r.sessions) {
      expect(overlaps(s, { start: h(1), end: h(4) })).toBe(false);
      expect(overlaps(s, work)).toBe(false);
    }
  });

  it("respects sleep and the gap around default plans", () => {
    const work = busyWeek(h(9), h(17));
    const r = planGoalSessions({ ...base, prefs: prefs({ sleepStart: h(23), wakeTime: h(7) }), hoursMin: 7, hoursMax: 7, plans: [work] });
    for (const s of r.sessions) {
      expect(s.start).toBeGreaterThanOrEqual(h(7));
      expect(s.end).toBeLessThanOrEqual(h(23));
      expect(overlaps(s, { start: h(8), end: h(18) })).toBe(false);
    }
  });

  it("prefers free time and only takes event time when it has to", () => {
    const event = plan({ type: "event", weekdays: 0, dates: [SUNDAY], start: h(9), end: h(10) });
    const relaxed = planGoalSessions({ ...base, hoursMin: 3, hoursMax: 3, plans: [event] });
    expect(relaxed.sessions.every((s) => !s.overEvent)).toBe(true);

    // Only Sunday 09:00–10:00 is left, and an event is on it: priority lets the goal in.
    const full = [plan({ weekdays: ALL_DAYS - dayBit(0), start: h(6), end: h(24) }), plan({ start: h(6), end: h(9) }), plan({ start: h(10), end: h(24) })];
    const tight = planGoalSessions({ ...base, prefs: prefs({ planGap: false, sleepStart: 0, wakeTime: h(6) }), hoursMin: 1, hoursMax: 1, plans: [...full, event] });
    expect(tight.ok).toBe(true);
    expect(tight.sessions).toEqual([{ weekday: 0, start: h(9), end: h(10), overEvent: true }]);
  });

  it("reports failure with what would fit, so the user can go back", () => {
    const r = planGoalSessions({ ...base, prefs: prefs({ planGap: false, sleepStart: 0, wakeTime: h(6) }), hoursMin: 5, hoursMax: 5, plans: [busyWeek(h(6), h(23, 30))] });
    expect(r.ok).toBe(false);
    expect(r.neededMin).toBe(300);
    expect(r.placedMin).toBeLessThan(300);
  });

  it("does not overlap other goal plans", () => {
    const other = busyWeek(h(6), h(12));
    const r = planGoalSessions({ ...base, hoursMin: 3, hoursMax: 3, plans: [{ ...other, type: "goal" }] });
    for (const s of r.sessions) expect(overlaps(s, other)).toBe(false);
  });

  it("is deterministic", () => {
    const run = () => planGoalSessions({ ...base, hoursMin: 7, hoursMax: 7, plans: [busyWeek(h(9), h(17))] });
    expect(run()).toEqual(run());
  });
});

describe("the day scheduler respects the same limits", () => {
  const task = { id: "t", title: "T", priority: 2 as const, estimateMin: 60, deadline: null, deadlineTime: null, energy: null, status: "todo" as const, sortOrder: 0, createdAt: "x" };
  const input = (p: Partial<Preferences>) => ({ date: SUNDAY, today: SUNDAY, nowMin: null, busy: [], tasks: [task], prefs: { ...DEFAULT_PREFERENCES, bufferMin: 0, breakAfterMin: 0, ...p } });

  it("won't place work between 01:00 and 04:00, even in all-night working hours", () => {
    const r = schedule(input({ workStart: h(1), workEnd: h(5), sleepStart: 0, wakeTime: h(3) }));
    for (const b of r.blocks) expect(overlaps(b, { start: h(1), end: h(4) })).toBe(false);
    expect(r.blocks[0].start).toBe(h(4));
  });

  it("won't place work during sleep", () => {
    const r = schedule(input({ workStart: h(6), workEnd: h(12), sleepStart: 0, wakeTime: h(10) }));
    expect(r.blocks[0].start).toBe(h(10));
  });
});

describe("input cleaning", () => {
  it("refuses text with no letters", () => {
    expect(textProblem("")).toBe("empty");
    expect(textProblem("12345")).toBe("noLetters");
    expect(textProblem("۱۲۳")).toBe("noLetters");
    expect(textProblem("!!")).toBe("noLetters");
    expect(textProblem("a")).toBe("short");
    expect(textProblem("Gym")).toBeNull();
    expect(textProblem("باشگاه")).toBeNull();
    expect(textProblem("Gym 3")).toBeNull();
    expect(textProblem("", { required: false })).toBeNull();
  });

  it("keeps number fields to digits, in any script", () => {
    expect(digitsOnly("12abc")).toBe("12");
    expect(digitsOnly("۱۲ ساعت")).toBe("۱۲");
    expect(digitsOnly("-3.5")).toBe("35");
  });

  it("cleans time fields and adds the colon", () => {
    expect(timeChars("1430")).toBe("14:30");
    expect(timeChars("۱۴۳۰")).toBe("۱۴:۳۰");
    expect(timeChars("ab9:3x")).toBe("9:3");
  });
});
