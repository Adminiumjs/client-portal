/**
 * The client's statement: every invoice they were sent and every payment the
 * studio recorded, over a period on the studio's calendar — everything, this
 * year, or the last twelve months (counted back from the studio's today, so
 * the periods move with the clock).
 *
 * Invoiced is the totals of the period's invoices that are not void; Paid is
 * the period's unvoided payments on those invoices; Open is the stored
 * balances of those invoices. A void invoice is listed (it was sent) and
 * counts in none of the three.
 */
import type { Day, Decimal, Tables } from "../../../data/types.ts";
import { addDays } from "../../../data/venueTime.ts";
import { isPositive } from "../../../lib/money.ts";
import { byPaidOn, shownSum } from "../shared/model.ts";

export type Period = "all" | "year" | "12m";
export const PERIODS: readonly Period[] = ["all", "year", "12m"];

/** Whether a day falls in the period, on the studio's calendar. */
export function inPeriod(day: Day | null, period: Period, today: Day): boolean {
  if (period === "all") return true;
  if (day === null) return false;
  if (period === "year") return day.slice(0, 4) === today.slice(0, 4) && day <= today;
  return day > addDays(today, -365) && day <= today;
}

export interface Statement {
  invoices: Tables["invoices"][];
  payments: { payment: Tables["payments"]; invoice: Tables["invoices"]; toDate: Decimal }[];
  invoiced: Decimal;
  paid: Decimal;
  open: Decimal;
  overdueOpen: boolean;
  currency: string | null;
  /** When the client's first invoice was issued. */
  since: Day | null;
  counts: Record<Period, number>;
}

export function statement(allInvoices: readonly Tables["invoices"][], allPayments: readonly Tables["payments"][], period: Period, today: Day): Statement {
  const sent = allInvoices.filter((i) => i.status === "sent" || (i.status === "void" && i.issued_on !== null)).sort((a, b) => (b.issued_on ?? "").localeCompare(a.issued_on ?? "") || b.id - a.id);
  const live = new Map(sent.filter((i) => i.status === "sent").map((i) => [i.id, i]));
  const currency = sent[0]?.currency ?? null;
  const pays = allPayments.filter((p) => !p.voided && live.has(p.document_id));

  const invoices = sent.filter((i) => inPeriod(i.issued_on, period, today));
  const periodPays = pays.filter((p) => inPeriod(p.paid_on, period, today)).sort(byPaidOn);
  const running: Decimal[] = [];
  const withRun = periodPays.map((payment) => {
    running.push(payment.amount);
    return { payment, invoice: live.get(payment.document_id)!, toDate: shownSum(running, currency) };
  });

  const liveInPeriod = invoices.filter((i) => i.status === "sent");
  const counts = Object.fromEntries(
    PERIODS.map((p) => [p, sent.filter((i) => inPeriod(i.issued_on, p, today)).length + pays.filter((x) => inPeriod(x.paid_on, p, today)).length]),
  ) as Record<Period, number>;
  const issued = sent.map((i) => i.issued_on).filter((d): d is Day => d !== null).sort();

  return {
    invoices,
    payments: withRun.reverse(),
    invoiced: shownSum(liveInPeriod.map((i) => i.total), currency),
    paid: shownSum(periodPays.map((p) => p.amount), currency),
    open: shownSum(liveInPeriod.filter((i) => isPositive(i.balance)).map((i) => i.balance), currency),
    overdueOpen: liveInPeriod.some((i) => isPositive(i.balance) && i.due_on !== null && i.due_on < today),
    currency,
    since: issued[0] ?? null,
    counts,
  };
}
