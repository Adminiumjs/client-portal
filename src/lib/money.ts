/**
 * Money on screen — DISPLAY ONLY.
 *
 * Adminium stores every amount and hands it back as a decimal string
 * ("1950.00", "12.5"): the line amounts, totals, tax, paid and balance are its
 * formulas and rollups, never the browser's. So nothing here computes a figure
 * that is then saved. There are exactly two jobs:
 *
 *   formatMoney   an amount in the page's language, with its currency's own
 *                 number of minor units (JPY none, KWD three, most two);
 *   sumDecimals   add stored amounts for a figure that is only ever SHOWN
 *                 (Home's "Outstanding", a statement's "Paid"), exactly — in
 *                 whole minor units, never floats.
 */
import type { Decimal } from "../data/types.ts";

/** Currencies whose minor units are not two. Everything else has two. */
const MINOR_UNITS: Readonly<Record<string, number>> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

/** How many digits after the point a currency shows. */
export function minorUnits(currency: string | null | undefined): number {
  return MINOR_UNITS[(currency ?? "").toUpperCase()] ?? 2;
}

/** A stored amount as a number, for display only. Null, empty or junk reads as null. */
export function decimalValue(value: Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * An amount in the page's language, e.g. "$1,950.00", "1.950,00 €",
 * "¥1,950", "KWD 12.500". A missing amount shows as an empty string, never
 * as "0" — a draft with no total has no total.
 */
export function formatMoney(value: Decimal | number | null | undefined, currency: string, locale: string): string {
  const n = decimalValue(value);
  if (n === null) return "";
  const digits = minorUnits(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    // An unknown code: the number, then the code.
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)} ${currency}`;
  }
}

/** A decimal string as a whole number of units at `scale` places, exactly. */
function toUnits(value: Decimal, scale: number): bigint {
  const text = value.trim();
  const match = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(text);
  if (match === null || (match[2] === "" && (match[3] ?? "") === "")) throw new Error(`not a decimal: "${value}"`);
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2] === "" ? "0" : match[2]!);
  const fraction = (match[3] ?? "").padEnd(scale + 1, "0");
  let units = whole * 10n ** BigInt(scale) + BigInt(fraction.slice(0, scale) === "" ? "0" : fraction.slice(0, scale));
  // Round half away from zero on the first dropped digit, as Adminium rounds.
  if (Number(fraction.charAt(scale)) >= 5) units += 1n;
  return sign * units;
}

function fromUnits(units: bigint, scale: number): Decimal {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const text = abs.toString().padStart(scale + 1, "0");
  const body = scale === 0 ? text : `${text.slice(0, -scale)}.${text.slice(-scale)}`;
  return negative ? `-${body}` : body;
}

/**
 * The sum of stored amounts, for a figure that is only shown. Empty and null
 * values count as nothing. The result has `scale` places (the currency's).
 */
export function sumDecimals(values: readonly (Decimal | null | undefined)[], scale = 2): Decimal {
  let total = 0n;
  for (const value of values) {
    if (value === null || value === undefined || value.trim() === "") continue;
    total += toUnits(value, scale);
  }
  return fromUnits(total, scale);
}

/** Whether a stored amount is more than nothing ("0.00" and null are not). */
export function isPositive(value: Decimal | null | undefined): boolean {
  const n = decimalValue(value);
  return n !== null && n > 0;
}
