/** Validation for free-text fields: a title has to say something, not just be a number. */

export type TextProblem = "empty" | "short" | "noLetters";

export const hasLetters = (text: string) => /\p{L}/u.test(text);

export function textProblem(text: string, { min = 2, required = true }: { min?: number; required?: boolean } = {}): TextProblem | null {
  const value = text.trim();
  if (!value) return required ? "empty" : null;
  if (!hasLetters(value)) return "noLetters";
  return value.length < min ? "short" : null;
}

/** Keeps only digits (Latin, Persian or Arabic) so number fields can't hold text. */
export const digitsOnly = (text: string) => text.replace(/[^\d۰-۹٠-٩]/g, "");

/** Keeps only what a time needs, and adds the colon once four digits are typed ("1430" becomes "14:30"). */
export function timeChars(text: string): string {
  const clean = text.replace(/[^\d۰-۹٠-٩:]/g, "").slice(0, 5);
  return /^[\d۰-۹٠-٩]{4}$/.test(clean) ? `${clean.slice(0, 2)}:${clean.slice(2)}` : clean;
}
