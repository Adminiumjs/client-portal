/**
 * A client's figures and state, worked out for display from their stored
 * rows — the Clients cards and the client record read these.
 *
 *   open       what they owe: the stored balances of their sent invoices
 *   overdue    the part of it past its due day
 *   paid       paid to date: each non-void invoice's stored `paid` (the
 *              add-on's rollup of its unvoided payments) — a void invoice and a
 *              voided payment count for nothing
 *   issued     how many invoices they have been sent (a discarded draft was
 *              never issued)
 *   paysIn     on average, the days from issue to the last payment of each
 *              settled invoice (null until one is settled)
 *   since      the day the studio first worked with them: the earliest project
 *              start or invoice issue
 *   state      Overdue, Paused, Active, Awaiting (a proposal out and in
 *              date) or Quiet — the first that holds
 */
import type { Day, Id, Invoice, Milestone, Payment, Project, Proposal } from "../../data/types.ts";
import { daysBetween } from "../../data/venueTime.ts";
import { isInDate, isOverdue } from "../../state/desk.ts";
import { isDiscarded, isOpen, isSettled, paymentsOf, sumByCurrency, type CurrencySum } from "../invoices/figures.ts";

export type ClientState = "overdue" | "paused" | "active" | "awaiting" | "quiet";

export interface ClientFigures {
  open: CurrencySum[];
  overdue: CurrencySum[];
  paid: CurrencySum[];
  anyOverdue: boolean;
  anyOpen: boolean;
  issued: number;
  paysIn: number | null;
  since: Day | null;
  projects: Project[];
  active: number;
  paused: number;
  proposals: number;
  state: ClientState;
}

export interface ClientRows {
  invoices: readonly Invoice[];
  projects: readonly Project[];
  proposals: readonly Proposal[];
  payments?: readonly Payment[];
}

export function clientFigures(clientId: Id, rows: ClientRows, day: Day, studioCurrency: string | null = null): ClientFigures {
  const invoices = rows.invoices.filter((i) => i.client_id === clientId);
  const issuedRows = invoices.filter((i) => i.status !== "draft" && !isDiscarded(i));
  const live = invoices.filter((i) => i.status === "sent");
  const openRows = live.filter(isOpen);
  const overdueRows = live.filter((i) => isOverdue(i, day));
  const projects = rows.projects.filter((p) => p.client_id === clientId).sort((a, b) => b.id - a.id);
  const proposals = rows.proposals.filter((p) => p.client_id === clientId);

  const days: number[] = [];
  if (rows.payments !== undefined) {
    for (const invoice of live.filter(isSettled)) {
      const kept = paymentsOf(rows.payments, invoice.id).filter((p) => !p.voided);
      const last = kept[kept.length - 1];
      if (last !== undefined && invoice.issued_on !== null) days.push(daysBetween(invoice.issued_on, last.paid_on));
    }
  }
  const firsts = [...projects.map((p) => p.started_on), ...issuedRows.map((i) => i.issued_on)].filter((d): d is Day => d !== null).sort();

  const active = projects.filter((p) => p.status === "active").length;
  const paused = projects.filter((p) => p.status === "paused").length;
  const anyOverdue = overdueRows.length > 0;
  const state: ClientState = anyOverdue ? "overdue" : paused > 0 ? "paused" : active > 0 ? "active" : proposals.some((p) => isInDate(p, day)) ? "awaiting" : "quiet";

  return {
    open: sumByCurrency(openRows, (i) => i.balance, studioCurrency),
    overdue: sumByCurrency(overdueRows, (i) => i.balance, studioCurrency),
    paid: sumByCurrency(live, (i) => i.paid, studioCurrency),
    anyOverdue,
    anyOpen: openRows.length > 0,
    issued: issuedRows.length,
    paysIn: days.length === 0 ? null : Math.round(days.reduce((a, b) => a + b, 0) / days.length),
    since: firsts[0] ?? null,
    projects,
    active,
    paused,
    proposals: proposals.length,
    state,
  };
}

/** A project's open milestones, in order, and how far along it is (done of all, as a whole percent). */
export function progressOf(projectId: Id, milestones: readonly Milestone[]): { next: Milestone | null; pct: number; total: number } {
  const mine = milestones.filter((m) => m.project_id === projectId).sort((a, b) => a.position - b.position || a.id - b.id);
  const done = mine.filter((m) => m.state === "done").length;
  return { next: mine.find((m) => m.state !== "done") ?? null, pct: mine.length === 0 ? 0 : Math.round((done / mine.length) * 100), total: mine.length };
}
