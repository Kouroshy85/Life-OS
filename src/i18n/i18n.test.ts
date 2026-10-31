import { afterEach, describe, expect, it } from "vitest";
import { encodeParts, type Part } from "../domain/explain";
import { setLang, toLatinDigits } from "../domain/locale";
import { formatClock, formatDuration, formatLongDate, parseClock } from "../domain/time";
import { en } from "./en";
import { fa } from "./fa";
import { explain, t } from "./index";

afterEach(() => setLang("en"));

const ALL_PARTS: Part[] = [
  { k: "base", priority: 4, deadline: { kind: "today", at: 600 }, inProgress: true, rank: 0 },
  { k: "base", priority: null, deadline: { kind: "overdue", date: "2026-10-30" }, inProgress: false, rank: 2 },
  { k: "placeFocus" },
  { k: "placeOutsideFocus" },
  { k: "placeFocusFull" },
  { k: "placeOnlyFocus" },
  { k: "placeEarliest" },
  { k: "moved", from: 540, to: 600, trigger: { t: "overrun", title: "X", dur: 30 } },
  { k: "late", at: 600 },
  { k: "session", i: 1, n: 2, dur: 180 },
  { k: "shortSession", dur: 40 },
  { k: "breakReason", after: 90 },
  { k: "skippedToday" },
  { k: "noHours" },
  { k: "dayPassed" },
  { k: "hoursEnded", end: 1080 },
  { k: "partly", placed: 60, rest: 30 },
  { k: "noFree", need: 60 },
  { k: "notEnough", need: 60, free: 30 },
  { k: "breakEats", need: 45, longest: 55 },
  { k: "gapShort", need: 120, longest: 50, min: 25 },
  { k: "overdueSuffix" },
  { k: "dueDaySuffix" },
  { k: "toBacklog", trigger: { t: "added", title: "X", at: 600 } },
  { k: "byYouSlot" },
  { k: "movedByYou", at: 600 },
  { k: "resizedByYou", dur: 30 },
  { k: "proposal", sessions: 3, scheduled: 120, available: 300, backlog: 1 },
];

describe("translations", () => {
  it("defines every string in Persian, and actually translates it", () => {
    const sameOnPurpose = new Set(["part", "languageSwitch", "languageSwitchTitle"]);
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(fa[key], key).toBeDefined();
      expect(typeof fa[key], key).toBe(typeof en[key]);
      if (typeof en[key] === "string" && !sameOnPurpose.has(key)) expect(fa[key], key).not.toBe(en[key]);
    }
  });

  it("avoids the stiff, formal wording this translation is meant to avoid", () => {
    const text = JSON.stringify(fa, (_, v) => (typeof v === "function" ? String(v) : v));
    for (const stiff of ["لطفا", "لطفاً", "می‌باشد", "میباشد", "نمایید", "جهت ", "گردید", "بفرمایید"]) {
      expect(text.includes(stiff), stiff).toBe(false);
    }
  });

  it("renders every explanation in both languages", () => {
    for (const lang of ["en", "fa"] as const) {
      setLang(lang);
      for (const p of ALL_PARTS) {
        const text = explain(encodeParts(p));
        expect(text.length, p.k).toBeGreaterThan(3);
        expect(text, p.k).not.toMatch(/undefined|null|NaN/);
        if (lang === "fa") expect(text, p.k).not.toMatch(/\d/);
      }
    }
  });

  it("follows the language when an explanation is shown, not when it was made", () => {
    const stored = encodeParts({ k: "dayPassed" });
    expect(explain(stored)).toBe("This day has already passed.");
    setLang("fa");
    expect(explain(stored)).toBe("این روز دیگه گذشته.");
    expect(t.navHome).toBe("خانه");
  });

  it("shows explanations saved by the previous version unchanged", () => {
    expect(explain("High priority — first in today's order.")).toBe("High priority — first in today's order.");
    expect(explain("")).toBe("");
  });
});

describe("Persian formatting", () => {
  it("uses Persian digits and words for times and durations", () => {
    setLang("fa");
    expect(formatClock(570)).toBe("۰۹:۳۰");
    expect(formatDuration(45)).toBe("۴۵ دقیقه");
    expect(formatDuration(120)).toBe("۲ ساعت");
    expect(formatDuration(90)).toBe("۱ ساعت و ۳۰ دقیقه");
  });

  it("uses the Solar Hijri calendar", () => {
    setLang("fa");
    expect(formatLongDate("2026-10-31")).toContain("آبان");
    setLang("en");
    expect(formatLongDate("2026-10-31")).toContain("October");
  });

  it("accepts Persian digits when typing a time", () => {
    expect(toLatinDigits("۱۴:۳۰")).toBe("14:30");
    expect(parseClock("۱۴:۳۰")).toBe(870);
    expect(parseClock("14:30")).toBe(870);
    expect(parseClock("۲۵:۰۰")).toBeNull();
  });
});
