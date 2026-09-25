/**
 * What the Money screen WORKS OUT for display from stored rows — never a
 * figure that is saved.
 *
 * Every amount here is one Adminium stored: an invoice's `total` and
 * `balance` (the Invoices & Receipts add-on's formulas and rollups), a
 * payment's `amount`, a proposal's `total`, a running cost's
 * `monthly_amount`. The browser only groups and adds them for a figure it
 * shows (the six months, the aging, "Costs covered"), exactly, in whole
 * minor units — and writes none of it anywhere.
 *
 *   months          the six calendar months the chart covers, ending with
 *                   the studio's current one
 *   chart           per month: the totals of the invoices issued in it (sent
 *                   ones — a void or a draft invoiced nothing) and the
 *                   payments received in it (not voided, on an invoice that
 *                   is not void)
 *   drill           one month's invoices and payments, the rows its bars add
 *   figures         the lead's sums, the four figures at the top, the costs
 *   aging           the open balances by how late they are, against today
 */
import type { Day, Decimal, Id, Invoice, Payment, Proposal, RunningCost } from "../../data/types.ts";
import { daysBetween } from "../../data/venueTime.ts";
import { decimalValue, isPositive, minorUnits, sumDecimals } from "../../lib/money.ts";
import { isInDate, isOverdue } from "../../state/desk.ts";

export type AgingKey = "current" | "d30" | "d60" | "d61";
export const AGING_KEYS: readonly AgingKey[] = ["current", "d30", "d60", "d61"];

/** Which bucket an open balance is in: not yet due, up to 30 days late, 31–60, over 60. */
export const agingKeyOf = (daysPastDue: number): AgingKey => (daysPastDue <= 0 ? "current" : daysPastDue <= 30 ? "d30" : daysPastDue <= 60 ? "d60" : "d61");

/** `YYYY-MM` of a day. */
export const monthOf = (day: Day): string => day.slice(0, 7);

/** The first day of a `YYYY-MM` month. */
export const firstDayOf = (month: string): Day => `${month}-01`;

/** The six calendar months ending with today's, oldest first (`YYYY-MM`). */
export function sixMonths(today: Day): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return [5, 4, 3, 2, 1, 0].map((back) => new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 7));
}

/** Sent invoices with something still owed (a void or a draft owes nothing). */
export const openInvoices = (invoices: readonly Invoice[]): Invoice[] => invoices.filter((i) => i.status === "sent" && isPositive(i.balance));

/** The currency the screen's sums are in: the studio's, else the first a row names. */
export function currencyOf(studio: string | null, rows: readonly { currency: string | null }[]): string | null {
  return studio ?? rows.find((r) => r.currency !== null)?.currency ?? null;
}

/** A row counts in a sum in the screen's currency: its own is that one, or it names none. */
const inCurrency = (currency: string | null) => (row: { currency: string | null }) => row.currency === null || currency === null || row.currency === currency;

const sum = (values: readonly (Decimal | null)[], currency: string | null): Decimal => sumDecimals(values, minorUnits(currency));

/** Whether a payment counts as money received: not voided, and not on a void invoice. */
export function counts(payment: Payment, invoices: Readonly<Record<Id, Invoice>>): boolean {
  if (payment.voided) return false;
  return invoices[payment.document_id]?.status !== "void";
}

export interface MonthBar {
  month: string;
  invoiced: Decimal;
  collected: Decimal;
  invoices: number;
  payments: number;
}

export interface MoneyInputs {
  today: Day;
  /** The screen's currency (the studio's). */
  currency: string | null;
  /** Every invoice the desk holds: the open ones and the six months'. */
  invoices: Readonly<Record<Id, Invoice>>;
  /** The payments the desk holds (the six months' among them). */
  payments: readonly Payment[];
  proposals: readonly Proposal[];
  costs: readonly RunningCost[];
}

/** The invoices a month's bar adds: sent ones issued in it. */
export function invoicedIn(month: string, input: Pick<MoneyInputs, "invoices" | "currency">): Invoice[] {
  return Object.values(input.invoices)
    .filter((i) => i.status === "sent" && i.issued_on !== null && monthOf(i.issued_on) === month && inCurrency(input.currency)(i))
    .sort((a, b) => (a.issued_on! < b.issued_on! ? -1 : a.issued_on! > b.issued_on! ? 1 : a.id - b.id));
}

/** The payments a month's bar adds: received in it, counted. */
export function collectedIn(month: string, input: Pick<MoneyInputs, "invoices" | "payments" | "currency">): Payment[] {
  return input.payments
    .filter((p) => monthOf(p.paid_on) === month && counts(p, input.invoices) && inCurrency(input.currency)({ currency: p.currency ?? input.invoices[p.document_id]?.currency ?? null }))
    .sort((a, b) => (a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : a.id - b.id));
}

/** The six bars, oldest first. */
export function chart(input: MoneyInputs): MonthBar[] {
  return sixMonths(input.today).map((month) => {
    const invoiced = invoicedIn(month, input);
    const collected = collectedIn(month, input);
    return {
      month,
      invoiced: sum(invoiced.map((i) => i.total), input.currency),
      collected: sum(collected.map((p) => p.amount), input.currency),
      invoices: invoiced.length,
      payments: collected.length,
    };
  });
}

/** One row of a month's drill-down: an invoice issued, or a payment received. */
export type DrillRow = { kind: "invoice"; invoice: Invoice; day: Day; amount: Decimal | null } | { kind: "payment"; payment: Payment; invoice: Invoice | undefined; day: Day; amount: Decimal };

/** A month's rows, in the order they happened (an invoice before a payment on the same day). */
export function drill(month: string, input: MoneyInputs): DrillRow[] {
  const rows: DrillRow[] = [
    ...invoicedIn(month, input).map((invoice) => ({ kind: "invoice" as const, invoice, day: invoice.issued_on!, amount: invoice.total })),
    ...collectedIn(month, input).map((payment) => ({ kind: "payment" as const, payment, invoice: input.invoices[payment.document_id], day: payment.paid_on, amount: payment.amount })),
  ];
  return rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.kind === b.kind ? 0 : a.kind === "invoice" ? -1 : 1));
}

export interface Figures {
  currency: string | null;
  /** Received in the six months, and the monthly average of it (display only). */
  sixMonths: Decimal;
  average: Decimal;
  /** Received and invoiced this month. */
  collectedThisMonth: Decimal;
  invoicedThisMonth: Decimal;
  /** Open balances, and the overdue part of them. */
  open: Decimal;
  openCount: number;
  overdue: Decimal;
  /** Sent proposals the client can still accept: their totals, how many, the first day one runs out. */
  outForSignature: Decimal;
  proposalsOut: number;
  holdsUntil: Day | null;
  /** What opening the door costs each month. */
  costs: Decimal;
  /** Open balances ÷ monthly costs, to one place; null with no costs. */
  monthsCovered: number | null;
  /** Invoices issued this month still open: why a month reads thin. */
  openThisMonth: number;
  /** Whether this month collected less than the six months' average. */
  thin: boolean;
}

export function figures(input: MoneyInputs): Figures {
  const { today, currency } = input;
  const bars = chart(input);
  const scale = minorUnits(currency);
  const six = sum(bars.map((b) => b.collected), currency);
  // The average is shown only: the six months' sum over six, to the currency's minor units.
  const units = 10 ** scale;
  const average = (Math.round(Math.round((decimalValue(six) ?? 0) * units) / 6) / units).toFixed(scale);
  const all = Object.values(input.invoices).filter(inCurrency(currency));
  const open = openInvoices(all);
  const overdue = open.filter((i) => isOverdue(i, today));
  const out = input.proposals.filter((p) => isInDate(p, today) && inCurrency(currency)(p));
  const costs = sum(input.costs.map((c) => c.monthly_amount), currency);
  const openTotal = sum(open.map((i) => i.balance), currency);
  const costsValue = decimalValue(costs) ?? 0;
  const thisMonth = bars[bars.length - 1]!;
  return {
    currency,
    sixMonths: six,
    average,
    collectedThisMonth: thisMonth.collected,
    invoicedThisMonth: thisMonth.invoiced,
    open: openTotal,
    openCount: open.length,
    overdue: sum(overdue.map((i) => i.balance), currency),
    outForSignature: sum(out.map((p) => p.total), currency),
    proposalsOut: out.length,
    holdsUntil: out.map((p) => p.valid_until).filter((d): d is Day => d !== null).sort()[0] ?? null,
    costs,
    monthsCovered: costsValue > 0 ? Math.round(((decimalValue(openTotal) ?? 0) / costsValue) * 10) / 10 : null,
    openThisMonth: open.filter((i) => i.issued_on !== null && monthOf(i.issued_on) === monthOf(today)).length,
    thin: (decimalValue(thisMonth.collected) ?? 0) < (decimalValue(average) ?? 0),
  };
}

export interface AgingBucket {
  key: AgingKey;
  amount: Decimal;
  count: number;
}

/** The open balances by how late they are, measured against today (never stored). */
export function aging(input: Pick<MoneyInputs, "invoices" | "today" | "currency">): AgingBucket[] {
  const open = openInvoices(Object.values(input.invoices).filter(inCurrency(input.currency)));
  return AGING_KEYS.map((key) => {
    const inBucket = open.filter((i) => agingKeyOf(i.due_on === null ? 0 : daysBetween(i.due_on, input.today)) === key);
    return { key, amount: sum(inBucket.map((i) => i.balance), input.currency), count: inBucket.length };
  });
}

/** Each bar's height as a share of the tallest figure in the chart (0–100; at least 2 so an empty month still shows). */
export function barHeights(bars: readonly MonthBar[]): { invoiced: number; collected: number }[] {
  const max = Math.max(0, ...bars.flatMap((b) => [decimalValue(b.invoiced) ?? 0, decimalValue(b.collected) ?? 0]));
  const pct = (value: Decimal) => (max <= 0 ? 2 : Math.max(2, Math.round(((decimalValue(value) ?? 0) / max) * 100)));
  return bars.map((b) => ({ invoiced: pct(b.invoiced), collected: pct(b.collected) }));
}
