import { toLatinDigits } from "../locale";

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
export function formatMoneyInput(minor: number | bigint, scale: number, trimFraction = false) {
  const [whole, fraction] = decimalMoney(minor, scale).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fraction && !(trimFraction && /^0+$/.test(fraction)) ? `${grouped},${fraction}` : grouped;
}

/** Period groups and a decimal comma are canonical for Finance entry. Also accept pasted legacy amounts. */
export function parseMoneyInput(text: string, currency: string, scale = currencyScale(currency)): number {
  const normalized = toLatinDigits(text.trim()).replaceAll("٬", ".").replaceAll("٫", ",");
  const displayed = /^-?(?:\d+|[1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d+))?$/.exec(normalized);
  if (displayed && (displayed[1]?.length ?? 0) <= scale) {
    return parseMoney(normalized.replaceAll(".", "").replace(",", "."), currency, "en-US", scale);
  }
  return parseMoney(normalized, currency, "en-US", scale);
}

export function formatMoney(minor: number | bigint, currency: string, locale = "en-US", iranUnit: "rial" | "toman" = "rial"): string {
  const toman = currency === "IRR" && iranUnit === "toman";
  const amount = formatMoneyInput(minor, toman ? 1 : currencyScale(currency), toman);
  if (currency === "IRR") {
    const unit = locale.startsWith("fa") ? (toman ? "تومان" : "ریال") : (toman ? "tomans" : "rials");
    return `${amount} ${unit}`;
  }
  if (currency === "USD") return amount.startsWith("-") ? `-$${amount.slice(1)}` : `$${amount}`;
  return `${amount} ${currency}`;
}
/** Percentages are display-only; monetary totals never use these ratios. */
export const percent = (amount: number, target: number) => target > 0 ? Number(BigInt(amount) * 10000n / BigInt(target)) / 100 : 0;
