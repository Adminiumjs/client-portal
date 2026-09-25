/**
 * The composer's figures while a document is being typed — DISPLAY ONLY.
 *
 * Adminium works out every stored figure (a line's amount, the subtotal, the
 * tax, the total) the moment a draft is saved; the document's page then shows
 * those. While the studio is still typing, the rail shows what those figures
 * will be, worked out the same way: exactly, in fractions rather than floats,
 * each figure rounded once, half away from zero, to the currency's minor
 * units. Nothing here is ever sent to Adminium.
 *
 * Also here: reading what a person typed into an amount field (`1,250.50`,
 * `1250,5`, `$90`) as a decimal the server accepts, and a stage's share of a
 * proposal's subtotal for the "Start the project" sheet.
 */
import type { Decimal } from "../../data/types.ts";

/** A decimal as an exact fraction: `num / 10^places`. */
interface Exact {
  num: bigint;
  places: number;
}

const TEN = 10n;
const pow10 = (n: number): bigint => TEN ** BigInt(n);

/**
 * What a person typed into an amount field, as a plain decimal ("1250.50"),
 * or null when it is not a number. Spaces, a currency sign and thousands
 * separators are dropped; a lone comma is read as the decimal point
 * ("1250,5" → "1250.5"), as most of the page's languages write it.
 */
export function readAmount(typed: string | null | undefined): Decimal | null {
  if (typed === null || typed === undefined) return null;
  let text = typed.replace(/[\s  ]/g, "").replace(/[^\d.,-]/g, "");
  if (text === "") return null;
  const commas = (text.match(/,/g) ?? []).length;
  const dots = (text.match(/\./g) ?? []).length;
  if (commas > 0 && dots > 0) {
    // Both: the later one is the decimal point, the other groups thousands.
    const decimalIsComma = text.lastIndexOf(",") > text.lastIndexOf(".");
    text = decimalIsComma ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (commas === 1 && dots === 0) {
    // "1,250" groups thousands; "12,5" and "1,25" are decimals.
    text = /^-?\d{1,3},\d{3}$/.test(text) ? text.replace(",", "") : text.replace(",", ".");
  } else if (commas > 1) {
    text = text.replace(/,/g, "");
  } else if (dots > 1) {
    // "1.250.000" groups thousands.
    text = text.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(text) && !/^-?\.\d+$/.test(text)) return null;
  if (text.startsWith(".")) text = `0${text}`;
  if (text.startsWith("-.")) text = `-0${text.slice(1)}`;
  return text;
}

function exact(value: Decimal): Exact {
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const num = BigInt(`${whole}${fraction}` === "" ? "0" : `${whole}${fraction}`);
  return { num: negative ? -num : num, places: fraction.length };
}

function toPlaces(e: Exact, places: number): bigint {
  return places >= e.places ? e.num * pow10(places - e.places) : e.num / pow10(e.places - places);
}

/** Round an exact value to `scale` places, half away from zero. */
function round(num: bigint, places: number, scale: number): bigint {
  if (places <= scale) return num * pow10(scale - places);
  const divisor = pow10(places - scale);
  const negative = num < 0n;
  const abs = negative ? -num : num;
  let q = abs / divisor;
  if ((abs % divisor) * 2n >= divisor) q += 1n;
  return negative ? -q : q;
}

function asDecimal(units: bigint, scale: number): Decimal {
  const negative = units < 0n;
  const abs = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const body = scale === 0 ? abs : `${abs.slice(0, -scale)}.${abs.slice(-scale)}`;
  return negative ? `-${body}` : body;
}

/** One line's amount: quantity × rate less the discount, never below zero. */
export function lineAmount(qty: Decimal | null, rate: Decimal | null, discount: Decimal | null, scale = 2): Decimal {
  if (qty === null || rate === null) return asDecimal(0n, scale);
  const q = exact(qty);
  const r = exact(rate);
  const d = exact(discount ?? "0");
  const places = q.places + r.places;
  const gross = q.num * r.num;
  const off = toPlaces(d, places);
  const net = gross - off > 0n ? gross - off : 0n;
  return asDecimal(round(net, places, scale), scale);
}

export interface Figures {
  /** Each line's amount, in the lines' order. */
  amounts: Decimal[];
  subtotal: Decimal;
  /** Null when the tax rate is not known yet. */
  tax: Decimal | null;
  total: Decimal;
}

/** A document's figures from its typed lines and its tax rate (a percentage). */
export function documentFigures(lines: readonly { qty: Decimal | null; rate: Decimal | null; discount: Decimal | null }[], taxRate: Decimal | null, scale = 2): Figures {
  const amounts = lines.map((l) => lineAmount(l.qty, l.rate, l.discount, scale));
  const subtotal = amounts.reduce((sum, a) => sum + exact(a).num, 0n);
  if (taxRate === null) return { amounts, subtotal: asDecimal(subtotal, scale), tax: null, total: asDecimal(subtotal, scale) };
  const rate = exact(taxRate);
  // subtotal (scale places) × rate (rate.places) ÷ 100.
  const tax = round(subtotal * rate.num, scale + rate.places + 2, scale);
  return { amounts, subtotal: asDecimal(subtotal, scale), tax: asDecimal(tax, scale), total: asDecimal(subtotal + tax, scale) };
}

/** A share of an amount: `amount × pct ÷ 100`, rounded to `scale` places. */
export function shareOf(amount: Decimal | null, pct: Decimal, scale = 2): Decimal | null {
  if (amount === null) return null;
  const a = exact(amount);
  const p = exact(pct);
  return asDecimal(round(a.num * p.num, a.places + p.places + 2, scale), scale);
}

/** Whether an exact decimal is above zero. */
export const aboveZero = (value: Decimal | null): boolean => value !== null && exact(value).num > 0n;

/** Whether `a` is more than `b` (both decimals). */
export function moreThan(a: Decimal, b: Decimal): boolean {
  const x = exact(a);
  const y = exact(b);
  const places = Math.max(x.places, y.places);
  return toPlaces(x, places) > toPlaces(y, places);
}

/** `a × b` exactly, as a decimal with every place kept. */
export function times(a: Decimal, b: Decimal): Decimal {
  const x = exact(a);
  const y = exact(b);
  return asDecimal(x.num * y.num, x.places + y.places);
}
