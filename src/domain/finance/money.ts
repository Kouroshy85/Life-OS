/** Money crosses the SQLite bridge as safe integers. Arithmetic uses bigint. */
const LEGACY_SCALES = { USD: 2, EUR: 2, GBP: 2, IRR: 0, JPY: 0, KRW: 0, KWD: 3, BHD: 3, OMR: 3, AED: 2, CAD: 2, AUD: 2, CHF: 2, CNY: 2, INR: 2, TRY: 2, SAR: 2 } as const;
export const CURRENCIES = { USD: 2, IRR: 0 } as const;
export type Currency = keyof typeof CURRENCIES;
export function currencyScale(currency: string): number {
  if (!Object.hasOwn(LEGACY_SCALES, currency)) throw new Error("Choose a supported currency.");
  return LEGACY_SCALES[currency as keyof typeof LEGACY_SCALES];
}
export function safeMoney(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("Amount exceeds the supported exact range.");
  return Number(value);
}
export function assertMinor(value: number, positive = false): void {
  if (!Number.isSafeInteger(value) || (positive && value <= 0)) throw new Error("Enter a positive, exact amount within the supported range.");
}
export function sumMoney(values: number[]): number {
  return safeMoney(values.reduce((sum, value) => { assertMinor(value); return sum + BigInt(value); }, 0n));
}
export const subtractMoney = (a: number, b: number) => sumMoney([a, -b]);
export function decimalMoney(minor: number | bigint, scale: number): string {
  if (typeof minor === "number") assertMinor(minor);
  const raw = BigInt(minor);
  const digits = (raw < 0n ? -raw : raw).toString().padStart(scale + 1, "0");
  return `${raw < 0n ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
}
export function parseMoney(text: string, currency: string, locale = "en-US", displayScale?: number): number {
  const scale = displayScale ?? currencyScale(currency);
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const group = parts.find((p) => p.type === "group")?.value ?? ",";
  let value = text.trim().replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
  value = value.split(decimal).join("|");
  // Accept native locale grouping and ordinary comma groups, but reject malformed groups.
  if (group !== ",") value = value.split(group).join(",");
  value = value.replaceAll("|", ".");
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) throw new Error("Enter an amount using digits and the locale decimal separator.");
  value = value.replaceAll(",", "");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  if (fraction.length > scale) throw new Error(`${currency} supports ${scale} decimal places. No rounding is applied.`);
  return safeMoney(BigInt(`${whole}${fraction.padEnd(scale, "0")}`) * (negative ? -1n : 1n));
}
export function formatMoney(minor: number | bigint, currency: string, locale = "en-US", iranUnit: "rial" | "toman" = "rial"): string {
  if (typeof minor === "number") assertMinor(minor);
  const scale = currency === "IRR" && iranUnit === "toman" ? 1 : currencyScale(currency);
  const raw = BigInt(minor), unit = 10n ** BigInt(scale), absolute = raw < 0n ? -raw : raw;
  const whole = absolute / unit;
  const fraction = (absolute % unit).toString().padStart(scale, "0");
  const digits = new Intl.NumberFormat(locale, { useGrouping: false }).format;
  const localizedFraction = [...fraction].map((d) => digits(Number(d))).join("");
  const value = raw < 0n ? (whole === 0n ? -0 : -whole) : whole;
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: scale, maximumFractionDigits: scale }).formatToParts(value)
    .map((p) => p.type === "currency" && currency === "IRR" ? (iranUnit === "toman" ? (locale.startsWith("fa") ? "تومان" : "tomans") : (locale.startsWith("fa") ? "ریال" : "rials")) : p.type === "fraction" ? localizedFraction : p.value).join("");
}
/** Percentages are display-only; monetary totals never use these ratios. */
export const percent = (amount: number, target: number) => target > 0 ? Number(BigInt(amount) * 10000n / BigInt(target)) / 100 : 0;
