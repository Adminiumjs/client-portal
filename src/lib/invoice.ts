/**
 * The invoicing engine.
 *
 * All arithmetic is in INTEGER CENTS. Line totals round once, at the line;
 * tax rounds once, on the subtotal. Doing it in that order and only that order
 * is what makes the studio's total and the client's total agree to the cent —
 * and a client portal that disagrees with its own invoice by a penny is a
 * client portal nobody trusts.
 *
 * Overdue is DERIVED here from a `now` that is always passed in, never stored
 * on the record. Pure and React-free, so the vitest suite exercises the real
 * thing.
 */

import type {
  Deliverable,
  Invoice,
  LineItem,
  Payment,
  Project,
  Proposal,
} from "../data/types.ts";

/* --------------------------------------------------------------- line math */

/** qty × rate, less any line discount, rounded to the cent. */
export function lineTotal(item: LineItem): number {
  const gross = item.qty * item.rate;
  const net = gross * (1 - (item.disc || 0) / 100);
  return Math.round(net);
}

export interface Totals {
  subtotal: number;
  tax: number;
  total: number;
}

/**
 * Document totals. Tax is applied to the ROUNDED subtotal, not to each line,
 * so the printed lines always add up to the printed subtotal.
 */
export function docTotals(items: LineItem[], taxRate: number): Totals {
  const subtotal = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const tax = Math.round((subtotal * (taxRate || 0)) / 100);
  return { subtotal, tax, total: subtotal + tax };
}

/* ---------------------------------------------------------------- payments */

export function paid(invoice: Invoice): number {
  return invoice.payments.reduce((sum, p) => sum + p.amt, 0);
}

/** What is still owed. Never negative — an overpayment is refused, not stored. */
export function balance(invoice: Invoice): number {
  return Math.max(0, docTotals(invoice.items, invoice.taxRate).total - paid(invoice));
}

export function isSettled(invoice: Invoice): boolean {
  return balance(invoice) === 0;
}

/**
 * A running-balance ledger: an opening "invoice total" row followed by each
 * payment, with the balance carried down the right. This is the shape the
 * invoice page renders directly.
 */
export interface LedgerRow {
  kind: "opening" | "payment";
  at: number;
  amount: number;
  method?: Payment["method"];
  /** Balance remaining AFTER this row. */
  balance: number;
}

export function ledger(invoice: Invoice): LedgerRow[] {
  const total = docTotals(invoice.items, invoice.taxRate).total;
  const rows: LedgerRow[] = [
    { kind: "opening", at: invoice.issued, amount: total, balance: total },
  ];

  let running = total;
  for (const payment of [...invoice.payments].sort((a, b) => a.at - b.at)) {
    running = Math.max(0, running - payment.amt);
    rows.push({
      kind: "payment",
      at: payment.at,
      amount: payment.amt,
      method: payment.method,
      balance: running,
    });
  }
  return rows;
}

export type PaymentCheck =
  | { ok: true; amount: number }
  | { ok: false; reason: "empty" | "negative" | "overpay"; max?: number };

/**
 * Validate a payment before it is recorded. Overpaying is REFUSED with the
 * maximum attached, rather than silently clamped — a studio that quietly
 * accepts $500 against a $300 balance has just created a reconciliation
 * problem for somebody.
 */
export function checkPayment(invoice: Invoice, cents: number): PaymentCheck {
  if (!Number.isFinite(cents) || cents === 0) return { ok: false, reason: "empty" };
  if (cents < 0) return { ok: false, reason: "negative" };
  const max = balance(invoice);
  if (cents > max) return { ok: false, reason: "overpay", max };
  return { ok: true, amount: Math.round(cents) };
}

/* --------------------------------------------------------------- lifecycle */

/**
 * Whether an invoice is past its due date, against `now`.
 *
 * A draft is never overdue (it has not been sent), and neither is a settled
 * one. This is the only place the question is answered.
 */
export function isOverdue(invoice: Invoice, now: number): boolean {
  if (invoice.status === "draft") return false;
  if (isSettled(invoice)) return false;
  return invoice.due < now;
}

/** Whole days past due; 0 when not overdue. */
export function daysOverdue(invoice: Invoice, now: number): number {
  return isOverdue(invoice, now) ? now - invoice.due : 0;
}

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61plus";

export const AGING_BUCKETS: AgingBucket[] = ["current", "d1_30", "d31_60", "d61plus"];

export function agingBucket(invoice: Invoice, now: number): AgingBucket {
  const days = daysOverdue(invoice, now);
  if (days === 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  return "d61plus";
}

export interface AgingRow {
  bucket: AgingBucket;
  count: number;
  /** Outstanding cents in this bucket. */
  amount: number;
}

/**
 * The aging chip row. Every bucket is returned even when empty, so the strip
 * has a stable shape and an empty bucket can be dimmed rather than vanishing
 * and reflowing the row.
 */
export function aging(invoices: Invoice[], now: number): AgingRow[] {
  const rows: AgingRow[] = AGING_BUCKETS.map((bucket) => ({
    bucket,
    count: 0,
    amount: 0,
  }));

  for (const invoice of open(invoices)) {
    const row = rows.find((r) => r.bucket === agingBucket(invoice, now));
    if (row === undefined) continue;
    row.count += 1;
    row.amount += balance(invoice);
  }
  return rows;
}

/** Invoices that have been sent and still owe something. */
export function open(invoices: Invoice[]): Invoice[] {
  return invoices.filter((i) => i.status !== "draft" && !isSettled(i));
}

/** Total outstanding across every open invoice. */
export function outstanding(invoices: Invoice[]): number {
  return open(invoices).reduce((sum, i) => sum + balance(i), 0);
}

export function overdueInvoices(invoices: Invoice[], now: number): Invoice[] {
  return invoices
    .filter((i) => isOverdue(i, now))
    .sort((a, b) => a.due - b.due);
}

/** The oldest overdue invoice's age in days, or 0 when nothing is late. */
export function oldestOverdueDays(invoices: Invoice[], now: number): number {
  return overdueInvoices(invoices, now).reduce(
    (max, i) => Math.max(max, daysOverdue(i, now)),
    0,
  );
}

/* --------------------------------------------------------------- documents */

/** Mint the next document number from the highest already issued. */
export function nextNumber(prefix: string, existing: string[]): string {
  const highest = existing.reduce((max, num) => {
    const n = Number.parseInt(num.replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `${prefix}-${highest + 1}`;
}

/** A proposal past its validity date, against `now`. Decided ones never expire. */
export function isExpired(proposal: Proposal, now: number): boolean {
  if (proposal.status === "accepted" || proposal.status === "declined") return false;
  return proposal.validUntil < now;
}

/* ---------------------------------------------------------------- projects */

/** Completed milestones ÷ total, 0–1. Empty is 0, not NaN. */
export function projectProgress(project: Project): number {
  if (project.milestones.length === 0) return 0;
  return project.milestones.filter((m) => m.done).length / project.milestones.length;
}

/** Deliverables still waiting on the client. */
export function awaitingClient(projects: Project[]): {
  project: Project;
  deliverable: Deliverable;
}[] {
  return projects.flatMap((project) =>
    project.deliverables
      .filter((d) => d.status === "pending")
      .map((deliverable) => ({ project, deliverable })),
  );
}

/** Milestones due inside the next `days` days, soonest first. */
export function upcomingMilestones(
  projects: Project[],
  now: number,
  days = 14,
): { project: Project; milestone: Project["milestones"][number] }[] {
  return projects
    .flatMap((project) =>
      project.milestones
        .filter((m) => !m.done && m.due >= now && m.due <= now + days)
        .map((milestone) => ({ project, milestone })),
    )
    .sort((a, b) => a.milestone.due - b.milestone.due);
}

export function activeProjects(projects: Project[]): Project[] {
  return projects.filter((p) => p.status === "active");
}

/* ----------------------------------------------------------- portal lookup */

export type LookupResult =
  | { ok: true; kind: "proposal"; num: string }
  | { ok: true; kind: "invoice"; num: string }
  | { ok: false; reason: "unknownNumber" | "wrongEmail" | "notSent" };

/**
 * The client portal's "find your documents" gate: an email plus the document
 * number printed on the paperwork.
 *
 * Each failure has its OWN reason, because "not found" for a document that
 * exists but was sent to a different address is a different problem from a
 * number that was never issued — and a draft the studio has not sent yet is a
 * third thing again.
 */
export function lookup(
  email: string,
  number: string,
  proposals: Proposal[],
  invoices: Invoice[],
  clients: { id: string; email: string }[],
): LookupResult {
  const num = number.trim().toUpperCase();
  const mail = email.trim().toLowerCase();

  const proposal = proposals.find((p) => p.num.toUpperCase() === num);
  const invoice = invoices.find((i) => i.num.toUpperCase() === num);
  if (proposal === undefined && invoice === undefined) {
    return { ok: false, reason: "unknownNumber" };
  }

  const clientId = proposal?.client ?? invoice?.client;
  const client = clients.find((c) => c.id === clientId);
  if (client === undefined || client.email.toLowerCase() !== mail) {
    return { ok: false, reason: "wrongEmail" };
  }

  if (proposal !== undefined) {
    if (proposal.status === "draft") return { ok: false, reason: "notSent" };
    return { ok: true, kind: "proposal", num: proposal.num };
  }

  if (invoice !== undefined && invoice.status === "draft") {
    return { ok: false, reason: "notSent" };
  }
  return { ok: true, kind: "invoice", num: num };
}
