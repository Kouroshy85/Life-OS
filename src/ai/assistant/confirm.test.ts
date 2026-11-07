import { describe, expect, it } from "vitest";
import { confirmationIntent } from "./confirm";
import { sameTitle } from "./proposals";

describe("confirmationIntent", () => {
  it("recognizes a plain yes in English and Persian", () => {
    for (const s of ["yes", "Yes!", "ok", "Sure.", "go ahead", "yes please", "آره", "آره!", "باشه", "اوکی", "حله", "بله لطفاً", "اضافه‌ش کن", "اضافهش کن", "اعمالش کن", "باشه مرسی"]) {
      expect(confirmationIntent(s), s).toBe("yes");
    }
  });

  it("recognizes a plain no", () => {
    for (const s of ["no", "Nope", "cancel", "نه", "نه.", "بی‌خیال", "بیخیال", "لغو"]) {
      expect(confirmationIntent(s), s).toBe("no");
    }
  });

  it("leaves anything more than a plain answer to the model", () => {
    for (const s of ["", "yes but make it 3 hours", "نه، فقط پنجشنبه‌ها", "آره ولی صبح‌ها", "plan my week", "no I meant next week", "یه کاری برام بکن"]) {
      expect(confirmationIntent(s), s).toBeNull();
    }
  });
});

describe("sameTitle", () => {
  it("treats small differences as the same task", () => {
    expect(sameTitle("Practise a listening test", "Practice a listening test")).toBe(true);
    expect(sameTitle("Learn 30 new words", "learn 30 new words.")).toBe(true);
    expect(sameTitle("یادگیری ۳۰ کلمه‌ی جدید", "یادگیری ۳۰ کلمه ی جدید")).toBe(true);
    expect(sameTitle("تمرین تست شنیداري", "تمرین تست شنیداری")).toBe(true);
  });

  it("keeps different tasks apart", () => {
    expect(sameTitle("Write an essay", "Write a cover letter")).toBe(false);
    expect(sameTitle("Run 3 km", "Run 5 km easy")).toBe(false);
  });
});
