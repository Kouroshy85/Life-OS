/** Current display language. Lives in the domain so formatters stay dependency-free. */
export type Lang = "en" | "fa";

let current: Lang = "en";

export const getLang = () => current;

/** First day of the week: Saturday in Persian, Sunday in English. */
export const weekStartDay = () => (current === "fa" ? 6 : 0);
export const setLang = (lang: Lang) => {
  current = lang;
};

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Accepts Persian and Arabic digits in typed input. */
export const toLatinDigits = (text: string) =>
  text.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/** Life OS uses Western digits in both display languages. */
export const num = (value: string | number) => toLatinDigits(String(value));
export const pct = (value: number) => `${value}${current === "fa" ? "٪" : "%"}`;

export const hasPersian = (text: string) => /[؀-ۿ]/.test(text);
