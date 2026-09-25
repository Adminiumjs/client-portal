/**
 * An amount as a person types it into the record-payment sheet, read as the
 * decimal text Adminium takes — and the checks the sheet makes before it
 * asks (Adminium makes them again, and its answer is the one that counts).
 *
 *   readAmount     "1,200.50", "1.200,50", "1200,5", " 300 " → "1200.50",
 *                  "1200.50", "1200.5", "300"; anything else → null
 *   compare        two decimals' order, exactly (in whole ten-thousandths)
 *   half           half a stored balance, to the currency's minor units (the
 *                  sheet's "Half" chip fills the field with it; the person
 *                  records what the field says)
 */
import type { Decimal } from "../../data/types.ts";
import { minorUnits, sumDecimals } from "../../lib/money.ts";

/** The page language's decimal mark ("." or ","). */
export const decimalMark = (locale: string): "." | "," => (new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal")?.value === "," ? "," : ".");

/**
 * Typed text as a decimal, or null when it is not one. With both marks, the
 * later is the decimal point; with one mark used more than once, it groups
 * thousands; with one mark used once, it is the decimal point — unless it is
 * not the page language's and three digits follow it ("1,200" in English).
 */
export function readAmount(typed: string, locale = "en-US"): Decimal | null {
  const text = typed.replace(/[\s\u00a0\u202f'’]/g, "");
  if (!/^[\d.,]*\d[\d.,]*$/.test(text)) return null;
  const dots = text.split(".").length - 1;
  const commas = text.split(",").length - 1;
  let point: "." | "," | null = null;
  if (dots > 0 && commas > 0) point = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";
  else if (dots + commas === 1) {
    const mark = dots === 1 ? "." : ",";
    const after = text.length - text.indexOf(mark) - 1;
    point = mark === decimalMark(locale) || after !== 3 ? mark : null;
  }
  const [whole = "", fraction = "", ...rest] = point === null ? [text] : text.split(point);
  if (rest.length > 0) return null;
  const digits = whole.replace(/[.,]/g, "");
  if (!/^\d*$/.test(digits) || !/^\d*$/.test(fraction)) return null;
  const head = digits === "" ? "0" : digits.replace(/^0+(?=\d)/, "");
  return fraction === "" ? head : `${head}.${fraction}`;
}

/** -1, 0 or 1 as `a` is below, equal to or above `b`. */
export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const diff = sumDecimals([a, b.startsWith("-") ? b.slice(1) : `-${b}`], 4);
  return diff.startsWith("-") ? -1 : /^[0.]+$/.test(diff) ? 0 : 1;
}

/** Half a balance, to the currency's minor units (half a cent rounds up). */
export function half(balance: Decimal, currency: string | null): Decimal {
  const scale = minorUnits(currency);
  const units = BigInt(sumDecimals([balance], scale).replace(".", "").replace(/^(-?)0+(?=\d)/, "$1"));
  const halved = units / 2n + (units % 2n === 0n ? 0n : 1n);
  const text = halved.toString().padStart(scale + 1, "0");
  return scale === 0 ? text : `${text.slice(0, -scale)}.${text.slice(-scale)}`;
}

/** The balance as the field's first value: the stored decimal at the currency's places. */
export const asTyped = (balance: Decimal | null, currency: string | null): string => (balance === null ? "" : sumDecimals([balance], minorUnits(currency)));

// ── what the record-payment sheet checks, and how it words a refusal ─────────

export type PaymentProblem =
  | { field: "amount"; kind: "zero" | "over" }
  | { field: "on"; kind: "day" | "future" | "before" };

/**
 * What is wrong with a payment as typed, before it is asked for: an amount
 * that is not above zero or is more than the stored balance, a missing day, a
 * day after today or before the invoice was issued.
 */
export function paymentProblem(input: { amount: Decimal | null; balance: Decimal | null; on: string; today: string; issued: string | null }): PaymentProblem | null {
  if (input.amount === null || compare(input.amount, "0") <= 0) return { field: "amount", kind: "zero" };
  if (input.balance !== null && compare(input.amount, input.balance) > 0) return { field: "amount", kind: "over" };
  if (input.on === "") return { field: "on", kind: "day" };
  if (input.on > input.today) return { field: "on", kind: "future" };
  if (input.issued !== null && input.on < input.issued) return { field: "on", kind: "before" };
  return null;
}

/** Where a refused payment's words go, and which: the balance cap, a moved invoice, a refused day or amount. */
export type PaymentRefusal = { field: "amount" | "on" | null; words: "balance" | "moved" | "range" | "zero" | "shared" };

export function paymentRefusal(reason: string, field: string | null): PaymentRefusal {
  if (reason === "balance") return { field: "amount", words: "balance" };
  if (reason === "moved") return { field: null, words: "moved" };
  if (reason === "invalid" && field === "paid_on") return { field: "on", words: "range" };
  if (reason === "invalid" && field === "amount") return { field: "amount", words: "zero" };
  return { field: null, words: "shared" };
}
