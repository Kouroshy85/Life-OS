/**
 * Recognizes a plain "yes" or "no" typed in reply to a pending proposal, in English
 * or Persian, so Life OS can apply or drop it right away without asking the model.
 * Anything longer or less clear goes to the model as a normal message.
 */

import { toLatinDigits } from "../../domain/locale";

const YES = [
  "yes", "y", "yeah", "yep", "yup", "sure", "ok", "okay", "k", "do it", "apply", "apply it", "go ahead", "confirm", "sounds good", "looks good", "add it", "save it", "please do",
  "آره", "اره", "آری", "بله", "بلی", "باشه", "اوکی", "اوکیه", "حله", "حتما", "حتماً", "انجامش بده", "انجام بده", "اعمال کن", "اعمالش کن", "اضافه کن", "اضافه‌ش کن", "اضافش کن", "ذخیره کن", "تایید", "تأیید", "موافقم", "عالیه", "خوبه", "بزن بریم",
];
const NO = ["no", "n", "nope", "nah", "cancel", "don't", "dont", "never mind", "نه", "نخیر", "نمی‌خوام", "نمیخوام", "بی‌خیال", "بیخیال", "لغو", "کنسل", "ولش کن"];

function clean(text: string): string {
  return toLatinDigits(text)
    .toLowerCase()
    .replace(/[.!?؟،,;:)(\u200f\u200e]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const YES_SET = new Set(YES.map(clean));
const NO_SET = new Set(NO.map(clean));
const half = (s: string) => s.replace(/\u200c/g, "");

/** "yes", "no", or null when the message is anything more than a plain answer. */
export function confirmationIntent(text: string): "yes" | "no" | null {
  const c = clean(text);
  if (!c || c.length > 30) return null;
  // "yes please", "آره لطفاً", "باشه مرسی": a yes or no followed by a polite word.
  const head = c.replace(/ (please|thanks|thank you|pls|لطفا|لطفاً|مرسی|ممنون|حتما|حتماً)$/, "");
  // Half-spaces are optional in casual typing ("اضافه‌ش کن" / "اضافهش کن").
  const forms = new Set([c, head].map(half));
  const has = (words: Set<string>) => [...words].some((w) => forms.has(half(w)));
  if (has(YES_SET)) return "yes";
  if (has(NO_SET)) return "no";
  return null;
}
