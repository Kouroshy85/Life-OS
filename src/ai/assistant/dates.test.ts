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

  it("turns clock times with a part of day into 24-hour times", () => {
    expect(a("دوشنبه ساعت 9 شب تا 10 شب قرار دارم")).toBe("دوشنبه (2026-11-09) ساعت 9 شب (21:00) تا 10 شب (22:00) قرار دارم");
    expect(a("ساعت ۷ صبح")).toBe("ساعت 7 صبح (07:00)");
    expect(a("عصر 5")).toBe("عصر 5 (17:00)");
    expect(a("12 شب")).toBe("12 شب (00:00)");
    expect(a("meeting 9pm to 10:30 pm")).toBe("meeting 9pm (21:00) to 10:30 pm (22:30)");
    expect(a("1 ظهر")).toBe("1 ظهر (13:00)");
    expect(a("5 شب‌ها")).toBe("5 شب‌ها");
  });

  it("finds an appointment with a date and a time range", async () => {
    const { findAppointment } = await import("./dates");
    const find = (text: string) => findAppointment(a(text), "Appointment");
    expect(find("دوشنبه ساعت 9 شب تا 10 شب قرار دارم. اضافش کن به برنامم")).toEqual({ date: "2026-11-09", start: 1260, end: 1320, title: "قرار" });
    expect(find("هر شنبه ساعت ۷ تا ۸ صبح کلاس زبان دارم")).toEqual({ date: "2026-11-07", start: 420, end: 480, title: "کلاس زبان" });
    expect(find("Add my dentist appointment on Tuesday from 4pm to 5pm")).toEqual({ date: "2026-11-10", start: 960, end: 1020, title: "Dentist appointment" });
    expect(find("meeting tomorrow 9 to 11:30 am")).toEqual({ date: "2026-11-06", start: 540, end: 690, title: "Meeting" });
    // Nothing to go on.
    expect(find("فردا وقت دکتر دارم")).toBeNull();
    expect(find("help me plan my week")).toBeNull();
  });

  it("doesn't touch words that only contain a date word", () => {
    expect(a("یکشنبه")).toBe("یکشنبه (2026-11-08)");
    expect(a("می‌خوام")).toBe("می‌خوام");
    expect(a("Mayday")).toBe("Mayday");
  });
});
