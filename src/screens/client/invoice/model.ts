/**
 * An invoice as the client's page reads it: the payments so far with the
 * balance after each (shown only — the balance the page leads with is the
 * stored one), and the "I've sent a payment" note checked before it is sent.
 * Nothing the client types here moves money: the studio records a payment.
 */
import type { Day, Decimal, Tables } from "../../../data/types.ts";
import { minorUnits, sumDecimals } from "../../../lib/money.ts";
import type { MessageKey } from "../../../i18n/index.tsx";
import { paymentsOf } from "../shared/model.ts";

export interface LedgerRow {
  key: string;
  kind: "total" | "payment";
  day: Day | null;
  amount: Decimal | null;
  /** What was left after this row (shown only). */
  after: Decimal | null;
  method?: Tables["payments"]["method"];
  paymentId?: number;
}

/** The invoice's total, then each unvoided payment with what was left after it. */
export function ledger(inv: Tables["invoices"], payments: readonly Tables["payments"][]): LedgerRow[] {
  const scale = minorUnits(inv.currency);
  const rows: LedgerRow[] = [{ key: "total", kind: "total", day: inv.issued_on, amount: inv.total, after: inv.total }];
  const paid: Decimal[] = [];
  for (const p of paymentsOf(payments, inv.id)) {
    paid.push(p.amount);
    const after = inv.total === null ? null : sumDecimals([inv.total, ...paid.map((a) => `-${a}`)], scale);
    rows.push({ key: `p${p.id}`, kind: "payment", day: p.paid_on, amount: p.amount, after, method: p.method, paymentId: p.id });
  }
  return rows;
}

/**
 * An amount as typed ("1,250.50", "1.250,50", "$ 300"), as a plain decimal
 * string; `null` when nothing was typed, `"bad"` when it is not an amount.
 */
export function parseAmount(typed: string): string | null | "bad" {
  const text = typed.replace(/[^\d.,-]/g, "");
  if (text === "") return typed.trim() === "" ? null : "bad";
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  const decimalAt = Math.max(lastDot, lastComma);
  // One separator followed by one or two digits is the decimal point; any other is grouping.
  const tail = decimalAt === -1 ? "" : text.slice(decimalAt + 1);
  const hasDecimals = decimalAt !== -1 && tail.length > 0 && tail.length <= 2;
  const whole = (hasDecimals ? text.slice(0, decimalAt) : text).replace(/[.,]/g, "");
  const plain = hasDecimals ? `${whole}.${tail}` : whole;
  return /^-?\d+(\.\d{1,2})?$/.test(plain) ? plain : "bad";
}

export interface ClaimInput {
  amount: string;
  on: Day | "";
}

export type ClaimCheck = { ok: true; amount: string | null; on: Day } | { ok: false; field: "amount" | "on"; key: MessageKey };

/** "I've sent a payment", checked: an amount above zero or none; a day that has happened, not before the invoice was issued. */
export function checkClaim(input: ClaimInput, issuedOn: Day | null, today: Day): ClaimCheck {
  const amount = parseAmount(input.amount);
  if (amount === "bad" || (amount !== null && !(Number(amount) > 0))) return { ok: false, field: "amount", key: "client.invoice.claimAmountBad" };
  if (input.on === "") return { ok: false, field: "on", key: "client.invoice.claimPickDay" };
  if (input.on > today) return { ok: false, field: "on", key: "client.invoice.claimFuture" };
  if (issuedOn !== null && input.on < issuedOn) return { ok: false, field: "on", key: "client.invoice.claimBeforeIssue" };
  return { ok: true, amount, on: input.on };
}
