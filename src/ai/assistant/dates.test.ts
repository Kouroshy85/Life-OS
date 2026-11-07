import { describe, expect, it } from "vitest";
import { annotateDates } from "./dates";

// Thursday 5 November 2026 (15 Aban 1405).
const TODAY = "2026-11-05";
const a = (text: string) => annotateDates(text, TODAY);

describe("annotateDates", () => {
  it("resolves Persian month phrases", () => {
    expect(a("می‌خوام تا آخر دی ماه ۵ کیلو کم کنم")).toBe("می‌خوام تا آخر دی ماه (2027-01-20) 5 کیلو کم کنم");
    expect(a("اوایل بهمن")).toBe("اوایل بهمن (2027-01-21)");
    expect(a("۲۰ دی")).toBe("20 دی (2027-01-10)");
    expect(a("تا اسفند ماه")).toBe("تا اسفند ماه (2027-03-20)");
    // The current month counts too.
    expect(a("آخر آبان")).toBe("آخر آبان (2026-11-21)");
  });

  it("leaves bare month names alone, since they're ordinary words too", () => {
    expect(a("با مهر و محبت")).toBe("با مهر و محبت");
    expect(a("تیر خورد")).toBe("تیر خورد");
  });

  it("resolves Gregorian dates in English and Persian", () => {
    expect(a("exam on November 26")).toBe("exam on November 26 (2026-11-26)");
    expect(a("امتحان ۲۰ نوامبر")).toBe("امتحان 20 نوامبر (2026-11-20)");
    expect(a("by 3 January")).toBe("by 3 January (2027-01-03)");
    expect(a("on 1 November")).toBe("on 1 November (2027-11-01)");
  });

  it("resolves relative days and weekdays", () => {
    expect(a("Move it to tomorrow evening")).toBe("Move it to tomorrow (2026-11-06) evening");
    expect(a("پس‌فردا")).toBe("پس‌فردا (2026-11-07)");
    expect(a("بنداز شنبه")).toBe("بنداز شنبه (2026-11-07)");
    expect(a("دوشنبه و چهارشنبه عصر")).toBe("دوشنبه (2026-11-09) و چهارشنبه (2026-11-11) عصر");
    expect(a("سه شنبه")).toBe("سه شنبه (2026-11-10)");
    expect(a("on Saturday")).toBe("on Saturday (2026-11-07)");
  });

  it("doesn't touch words that only contain a date word", () => {
    expect(a("یکشنبه")).toBe("یکشنبه (2026-11-08)");
    expect(a("می‌خوام")).toBe("می‌خوام");
    expect(a("Mayday")).toBe("Mayday");
  });
});
