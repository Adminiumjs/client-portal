/**
 * What the money screens WORK OUT for display from stored rows — never a
 * figure that is saved.
 *
 *   invoiceWord     the word a pill says of an invoice: Draft, Sent, Part
 *                   paid, Paid, Overdue, Void — from its stored status,
 *                   paid, balance and due day, on the studio's today
 *   matchesFilter   the Invoices list's filters, and `filterCondition` the
 *                   same filters as a server condition for a page read
 *   ledger          one invoice's payments as the ledger draws them: the
 *                   invoice total, each payment (a voided one struck through,
 *                   and left out of the running balance), then the stored
 *                   balance
 *   sumByCurrency   stored amounts added for a figure only ever shown, one
 *                   sum per currency (a studio rarely has two)
 *
 * Every total, paid and balance here is the one Adminium stored; the running
 * balance down the ledger is only the stored total less each unvoided
 * payment, added exactly in whole minor units, and the closing line is the
 * stored balance itself.
 */
import type { ListCondition } from "../../data/snapshotPort.ts";
import type { Day, Decimal, Id, Invoice, Payment } from "../../data/types.ts";
import { daysLate } from "../../lib/dates.ts";
import { isPositive, minorUnits, sumDecimals } from "../../lib/money.ts";
import { isOverdue } from "../../state/desk.ts";

export type InvoiceWord = "draft" | "sent" | "partPaid" | "paid" | "overdue" | "void";

/** Whether a sent invoice is settled: its stored balance is there and is nothing. */
export const isSettled = (invoice: Invoice): boolean => invoice.status === "sent" && invoice.balance !== null && !isPositive(invoice.balance);

/** Whether a sent invoice still has something owed on it. */
export const isOpen = (invoice: Invoice): boolean => invoice.status === "sent" && isPositive(invoice.balance);

/** A draft that was discarded: numbered, voided, and never issued (the client never saw it). */
export const isDiscarded = (invoice: Invoice): boolean => invoice.status === "void" && invoice.issued_on === null;

/** The word a pill says of an invoice, worked out from what is stored. */
export function invoiceWord(invoice: Invoice, day: Day): InvoiceWord {
  if (invoice.status === "void") return "void";
  if (invoice.status === "draft") return "draft";
  if (isSettled(invoice)) return "paid";
  if (isOverdue(invoice, day)) return "overdue";
  if (isPositive(invoice.paid)) return "partPaid";
  return "sent";
}

/** Whole days a sent, unpaid invoice is past its due day (0 when it is not overdue). */
export const daysOverdue = (invoice: Invoice, day: Day): number => (isOverdue(invoice, day) ? daysLate(invoice.due_on, day) : 0);

export const INVOICE_FILTERS = ["all", "open", "overdue", "draft", "paid", "void"] as const;
export type InvoiceFilter = (typeof INVOICE_FILTERS)[number];

/** Whether an invoice belongs under a filter of the Invoices list. */
export function matchesFilter(filter: InvoiceFilter, invoice: Invoice, day: Day): boolean {
  switch (filter) {
    case "all":
      return true;
    case "open":
      return isOpen(invoice);
    case "overdue":
      return isOverdue(invoice, day);
    case "draft":
      return invoice.status === "draft";
    case "paid":
      return isSettled(invoice);
    case "void":
      return invoice.status === "void";
  }
}

/** The same filter, as the server reads it (a page of the list, or its count). */
export function filterCondition(filter: InvoiceFilter, day: Day): ListCondition | undefined {
  const sent: ListCondition = { column: "status", op: "eq", value: "sent" };
  switch (filter) {
    case "all":
      return undefined;
    case "open":
      return { and: [sent, { column: "balance", op: "gt", value: 0 }] };
    case "overdue":
      return { and: [sent, { column: "balance", op: "gt", value: 0 }, { column: "due_on", op: "lt", value: day }] };
    case "draft":
      return { column: "status", op: "eq", value: "draft" };
    case "paid":
      return { and: [sent, { column: "balance", op: "lte", value: 0 }] };
    case "void":
      return { column: "status", op: "eq", value: "void" };
  }
}

/** Newest first, by the order Adminium numbered them. */
export const newestFirst = (a: Invoice, b: Invoice): number => (b.number_seq ?? 0) - (a.number_seq ?? 0) || b.id - a.id;

// ── the ledger ──────────────────────────────────────────────────────────────

export type LedgerRow =
  | { kind: "total"; day: Day | null; amount: Decimal | null; balance: Decimal | null }
  | { kind: "payment"; payment: Payment; balance: Decimal | null }
  | { kind: "closing"; balance: Decimal | null; settled: boolean; lastPaid: Day | null };

/** A payment's order down the ledger: the day it arrived, then the order it was recorded. */
const byDay = (a: Payment, b: Payment): number => (a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : a.id - b.id);

/** The payments of one invoice, in the ledger's order. */
export const paymentsOf = (payments: readonly Payment[], invoiceId: Id): Payment[] => payments.filter((p) => p.document_id === invoiceId).sort(byDay);

/**
 * One invoice's ledger. The running balance is the stored total less each
 * unvoided payment so far (blank beside a voided one); the closing line is the
 * stored balance, never a sum.
 */
export function ledger(invoice: Invoice, payments: readonly Payment[]): LedgerRow[] {
  const scale = minorUnits(invoice.currency);
  const rows: LedgerRow[] = [{ kind: "total", day: invoice.issued_on, amount: invoice.total, balance: invoice.total }];
  let running = invoice.total;
  const kept: Payment[] = [];
  for (const payment of paymentsOf(payments, invoice.id)) {
    if (payment.voided) {
      rows.push({ kind: "payment", payment, balance: null });
      continue;
    }
    kept.push(payment);
    running = running === null ? null : sumDecimals([running, `-${payment.amount}`], scale);
    rows.push({ kind: "payment", payment, balance: running });
  }
  const settled = invoice.status === "sent" && isSettled(invoice);
  rows.push({ kind: "closing", balance: invoice.balance, settled, lastPaid: kept.length === 0 ? null : kept[kept.length - 1]!.paid_on });
  return rows;
}

// ── sums for display ────────────────────────────────────────────────────────

export interface CurrencySum {
  currency: string | null;
  amount: Decimal;
}

/**
 * Stored amounts added for a figure only shown (a lead line, a client's
 * "Open"), one sum per currency, the studio's own first. Nothing to add is
 * one sum of nothing in the studio's currency.
 */
export function sumByCurrency<T extends { currency: string | null }>(rows: readonly T[], pick: (row: T) => Decimal | null, studio: string | null = null): CurrencySum[] {
  const groups = new Map<string | null, Decimal[]>();
  for (const row of rows) {
    const value = pick(row);
    if (value === null) continue;
    const key = row.currency ?? studio;
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  if (groups.size === 0) return [{ currency: studio, amount: sumDecimals([], minorUnits(studio)) }];
  return [...groups.entries()]
    .sort(([a], [b]) => (a === studio ? -1 : b === studio ? 1 : String(a).localeCompare(String(b))))
    .map(([currency, values]) => ({ currency, amount: sumDecimals(values, minorUnits(currency)) }));
}

/** Whether any of the sums is more than nothing. */
export const anyPositive = (sums: readonly CurrencySum[]): boolean => sums.some((s) => isPositive(s.amount));

/** Sums in words: "$1,200.00", or "$1,200.00 + €300.00" for two currencies. */
export const sumsLabel = (sums: readonly CurrencySum[], money: (value: Decimal, currency?: string | null) => string): string => sums.map((s) => money(s.amount, s.currency)).join(" + ");
