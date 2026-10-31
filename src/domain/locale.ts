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

export const toFaDigits = (text: string | number) => String(text).replace(/\d/g, (d) => FA_DIGITS[Number(d)]);

/** Numbers as the current language writes them. */
export const num = (value: string | number) => (current === "fa" ? toFaDigits(value) : String(value));

export const pct = (value: number) => (current === "fa" ? `${toFaDigits(value)}٪` : `${value}%`);

/** Accepts Persian and Arabic digits in typed input. */
export const toLatinDigits = (text: string) =>
  text.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

export const hasPersian = (text: string) => /[؀-ۿ]/.test(text);
