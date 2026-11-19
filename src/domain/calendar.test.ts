import { describe, expect, it } from "vitest";
import { appClock, calendarMonth, calendarParts, calendarQuarter, calendarWeekday, displayDate, getCalendar, shiftCalendarMonth } from "./calendar";
import { firstAfter, occurrenceDate } from "./finance/recurring";

describe("Life OS calendar", () => {
  it("defaults to Jalali and groups the Persian new year and leap day", () => {
    expect(getCalendar()).toBe("persian");
    expect(calendarParts("2025-03-20", "persian")).toEqual({ year: 1403, month: 12, day: 30 });
    expect(calendarMonth("2025-03-20")).toEqual({ start: "2025-02-19", end: "2025-03-20" });
    expect(calendarMonth("2025-03-21")).toEqual({ start: "2025-03-21", end: "2025-04-20" });
    expect(calendarMonth("2026-03-19")).toEqual({ start: "2026-02-20", end: "2026-03-20" });
    expect(calendarQuarter("2025-03-21")).toEqual({ start: "2025-03-21", end: "2025-06-21" });
    expect(displayDate("2025-03-21", "fa-IR", { month: "long", day: "numeric" })).toContain("1 فروردین");
    expect(calendarWeekday("2025-03-21")).toBe(5);
  });

  it("supports Gregorian leap days and Tehran midnight independently of host time", () => {
    expect(calendarMonth("2024-02-27", "gregory")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(shiftCalendarMonth("2024-01-31", 1, "gregory")).toBe("2024-02-29");
    expect(shiftCalendarMonth("2024-01-31", 2, "gregory")).toBe("2024-03-31");
    expect(appClock(new Date("2026-11-19T20:29:59Z"))).toEqual({ today: "2026-11-19", nowMin: 1439 });
    expect(appClock(new Date("2026-11-19T20:30:00Z"))).toEqual({ today: "2026-11-20", nowMin: 0 });
  });
});

describe("recurring dates", () => {
  it("supports daily, weekly and monthly intervals without date drift", () => {
    const startDate = "2024-01-31";
    const gregory = { startDate, interval: 1, calendar: "gregory" as const };
    expect(occurrenceDate({ ...gregory, frequency: "daily" }, 2)).toBe("2024-02-02");
    expect(occurrenceDate({ ...gregory, frequency: "weekly" }, 2)).toBe("2024-02-14");
    expect(occurrenceDate({ ...gregory, frequency: "monthly", interval: 2 }, 1)).toBe("2024-03-31");
    const jalali = { startDate: "2025-04-20", calendar: "persian", frequency: "monthly", interval: 1 } as const;
    expect(occurrenceDate(jalali, 5)).toBe("2025-09-22");
    expect(calendarParts(occurrenceDate(jalali, 6), "persian")).toMatchObject({ month: 7, day: 30 });
    expect(calendarParts(occurrenceDate(jalali, 12), "persian")).toMatchObject({ month: 1, day: 31 });
  });

  it("clamps annual leap dates and finds the first occurrence after a posted day", () => {
    const jalali = { startDate: "2025-03-20", frequency: "yearly", interval: 1, calendar: "persian" } as const;
    expect(calendarParts(occurrenceDate(jalali, 1), "persian")).toEqual({ year: 1404, month: 12, day: 29 });
    const gregory = { startDate: "2024-02-29", frequency: "yearly", interval: 1, calendar: "gregory" } as const;
    expect(occurrenceDate(gregory, 1)).toBe("2025-02-28");
    expect(occurrenceDate(gregory, 4)).toBe("2028-02-29");
    expect(firstAfter(gregory, "2028-02-29")).toBe(5);
  });
});
