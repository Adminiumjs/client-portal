/**
 * The studio's day, worked out from the rows the desk holds: what needs
 * chasing, what is out with a client, the money still owed and how late it
 * is, what happened lately (from the stamps Adminium wrote), what is waiting
 * on a client, and what falls due this week.
 *
 * "Waiting on a client" means something the client can act on: a proposal
 * still in date, an overdue invoice, a deliverable that has been shared. Sums
 * leave out void invoices and voided payments. Every amount is a stored one;
 * a total here is only ever shown.
 */
import type { Held } from "../../state/desk.ts";
import { isInDate, isOverdue } from "../../state/desk.ts";
import type { Day, Decimal, Id, Instant, Invoice } from "../../data/types.ts";
import { addDays, daysBetween, venueDay, venueMidnight } from "../../data/venueTime.ts";
import { DISCARDED_DRAFT } from "../../state/actions.ts";
import { daysLate } from "../../lib/dates.ts";
import { isPositive, sumDecimals } from "../../lib/money.ts";

/** Sent invoices with something still owed (a void invoice owes nothing). */
export const openInvoices = (rows: Held): Invoice[] => Object.values(rows.invoices).filter((i) => i.status === "sent" && isPositive(i.balance));

export const overdueInvoices = (rows: Held, today: Day): Invoice[] => Object.values(rows.invoices).filter((i) => isOverdue(i, today));

/** Sent proposals the client can still accept. */
export const proposalsOut = (rows: Held, today: Day) => Object.values(rows.proposals).filter((p) => isInDate(p, today));

/** The currency the day's sums are in: the open invoices' own, else the studio's. */
const currencyOf = (invoices: readonly Invoice[]): string | null => invoices.find((i) => i.currency !== null)?.currency ?? null;

export interface Kpis {
  outstanding: Decimal;
  openCount: number;
  overdueCount: number;
  /** Days the oldest overdue invoice is past due; 0 when none is. */
  oldestDays: number;
  active: number;
  paused: number;
  /** Done projects (a count Adminium answers; null until it has). */
  done: number | null;
  currency: string | null;
}

export function kpis(rows: Held, today: Day, doneProjects: number | null): Kpis {
  const open = openInvoices(rows);
  const overdue = overdueInvoices(rows, today);
  const projects = Object.values(rows.projects);
  return {
    outstanding: sumDecimals(open.map((i) => i.balance)),
    openCount: open.length,
    overdueCount: overdue.length,
    oldestDays: overdue.reduce((most, i) => Math.max(most, daysLate(i.due_on, today)), 0),
    active: projects.filter((p) => p.status === "active").length,
    paused: projects.filter((p) => p.status === "paused").length,
    done: doneProjects,
    currency: currencyOf(open),
  };
}

// ── aging ───────────────────────────────────────────────────────────────────

export type AgingKey = "current" | "d30" | "d60" | "d61";
export const AGING_KEYS: readonly AgingKey[] = ["current", "d30", "d60", "d61"];

export const agingKeyOf = (daysPastDue: number): AgingKey => (daysPastDue <= 0 ? "current" : daysPastDue <= 30 ? "d30" : daysPastDue <= 60 ? "d60" : "d61");

export interface AgingBucket {
  key: AgingKey;
  amount: Decimal;
  count: number;
}

/** The open balances by how late they are, measured against today (never stored). */
export function aging(rows: Held, today: Day): AgingBucket[] {
  const open = openInvoices(rows);
  return AGING_KEYS.map((key) => {
    const inBucket = open.filter((i) => agingKeyOf(i.due_on === null ? 0 : daysBetween(i.due_on, today)) === key);
    return { key, amount: sumDecimals(inBucket.map((i) => i.balance)), count: inBucket.length };
  });
}

// ── recent activity, from the stamps ────────────────────────────────────────

export type FeedKind =
  | "paymentReceived"
  | "invoiceSent"
  | "invoiceVoided"
  | "clientSaysPaid"
  | "proposalSent"
  | "proposalAccepted"
  | "proposalSigned"
  | "proposalDeclined"
  | "proposalWithdrawn"
  | "newPriceAsked"
  | "deliverableShared"
  | "deliverableApproved"
  | "changesRequested"
  | "projectStarted"
  | "enquiryIn";

export type Target = { view: "invoice" | "proposal" | "project"; id: Id } | { view: "enquiries"; id: Id };

export interface FeedItem {
  key: string;
  kind: FeedKind;
  at: Instant;
  /** The words' values: a number, a company, an amount … */
  params: Record<string, string>;
  /** An amount the words name, with its currency (formatted on screen). */
  amount?: { value: Decimal | null; currency: string | null };
  go: Target;
}

const named = (rows: Held, clientId: Id | null | undefined) => (clientId === null || clientId === undefined ? undefined : rows.clients[clientId]);
const company = (rows: Held, clientId: Id | null | undefined) => named(rows, clientId)?.company ?? "";
const contact = (rows: Held, clientId: Id | null | undefined) => named(rows, clientId)?.contact_name ?? "";
const first = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** What happened lately, newest first, built from the stamps on the rows the desk holds. */
export function feed(rows: Held, zone: string, limit = 6): FeedItem[] {
  const out: FeedItem[] = [];
  const add = (item: FeedItem | null) => {
    if (item !== null && item.at !== "") out.push(item);
  };
  for (const pay of Object.values(rows.payments)) {
    if (pay.voided) continue;
    const invoice = rows.invoices[pay.document_id];
    add({
      key: `pay-${String(pay.id)}`,
      kind: "paymentReceived",
      at: pay.recorded_at ?? venueMidnight(pay.paid_on, zone),
      params: { company: company(rows, pay.client_id ?? invoice?.client_id), number: invoice?.number ?? "" },
      amount: { value: pay.amount, currency: pay.currency ?? invoice?.currency ?? null },
      go: { view: "invoice", id: pay.document_id },
    });
  }
  for (const inv of Object.values(rows.invoices)) {
    const who = { company: company(rows, inv.client_id), contact: contact(rows, inv.client_id), first: first(contact(rows, inv.client_id)), number: inv.number ?? "" };
    if (inv.sent_at !== null) add({ key: `inv-sent-${String(inv.id)}`, kind: "invoiceSent", at: inv.sent_at, params: who, go: { view: "invoice", id: inv.id } });
    // A discarded draft never reached the client: it is not news.
    if (inv.status === "void" && inv.voided_at !== null && !(inv.void_reason === DISCARDED_DRAFT && inv.issued_on === null)) {
      add({ key: `inv-void-${String(inv.id)}`, kind: "invoiceVoided", at: inv.voided_at, params: { ...who, reason: inv.void_reason ?? "" }, go: { view: "invoice", id: inv.id } });
    }
    if (inv.client_paid_at !== null && inv.status === "sent") {
      add({ key: `inv-says-${String(inv.id)}`, kind: "clientSaysPaid", at: inv.client_paid_at, params: who, amount: { value: inv.client_paid_amount, currency: inv.currency }, go: { view: "invoice", id: inv.id } });
    }
  }
  for (const p of Object.values(rows.proposals)) {
    const who = { company: company(rows, p.client_id), contact: contact(rows, p.client_id), first: first(contact(rows, p.client_id)), number: p.number ?? "" };
    const go: Target = { view: "proposal", id: p.id };
    if (p.sent_at !== null) add({ key: `pro-sent-${String(p.id)}`, kind: "proposalSent", at: p.sent_at, params: who, go });
    if (p.decided_at !== null) {
      if (p.status === "accepted") {
        const signed = p.signed_name !== null && p.signed_name.trim() !== "";
        add({ key: `pro-dec-${String(p.id)}`, kind: signed ? "proposalSigned" : "proposalAccepted", at: p.decided_at, params: { ...who, name: p.signed_name ?? "" }, go });
      }
      if (p.status === "declined") add({ key: `pro-dec-${String(p.id)}`, kind: "proposalDeclined", at: p.decided_at, params: who, go });
      if (p.status === "withdrawn") add({ key: `pro-dec-${String(p.id)}`, kind: "proposalWithdrawn", at: p.decided_at, params: { ...who, reason: p.withdraw_reason ?? "" }, go });
    }
    if (p.new_price_asked_at !== null) add({ key: `pro-price-${String(p.id)}`, kind: "newPriceAsked", at: p.new_price_asked_at, params: who, go });
  }
  for (const d of Object.values(rows.deliverables)) {
    const project = rows.projects[d.project_id];
    const clientId = d.client_id ?? project?.client_id;
    const params = { company: company(rows, clientId), first: first(contact(rows, clientId)), title: d.title };
    const go: Target = { view: "project", id: d.project_id };
    if (d.shared_at !== null) add({ key: `del-shared-${String(d.id)}`, kind: "deliverableShared", at: d.shared_at, params, go });
    if (d.reviewed_at !== null && d.status === "approved") add({ key: `del-rev-${String(d.id)}`, kind: "deliverableApproved", at: d.reviewed_at, params, go });
    if (d.reviewed_at !== null && d.status === "changes") add({ key: `del-rev-${String(d.id)}`, kind: "changesRequested", at: d.reviewed_at, params, go });
  }
  for (const pr of Object.values(rows.projects)) {
    if (pr.started_on !== null) add({ key: `prj-${String(pr.id)}`, kind: "projectStarted", at: venueMidnight(pr.started_on, zone), params: { number: pr.number ?? "", name: pr.name, company: company(rows, pr.client_id) }, go: { view: "project", id: pr.id } });
  }
  for (const e of Object.values(rows.enquiries)) {
    if (e.received_at !== null) add({ key: `enq-${String(e.id)}`, kind: "enquiryIn", at: e.received_at, params: { business: e.business ?? e.name, number: e.number ?? "" }, go: { view: "enquiries", id: e.id } });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key)).slice(0, limit);
}

// ── waiting on a client ─────────────────────────────────────────────────────

export interface Waiting {
  key: string;
  kind: "proposal" | "invoice" | "deliverable";
  client: string;
  /** The document's number, or the deliverable's title. */
  ref: string;
  balance?: { value: Decimal | null; currency: string | null };
  days: number;
  go: Target;
}

const daysSince = (at: Instant | null, today: Day, zone: string): number => (at === null ? 0 : Math.max(0, daysBetween(venueDay(Date.parse(at), zone), today)));

/** What only the client can move on, the longest waiting first (five at most). */
export function waiting(rows: Held, today: Day, zone: string, limit = 5): Waiting[] {
  const out: Waiting[] = [];
  for (const p of proposalsOut(rows, today)) {
    out.push({ key: `w-pro-${String(p.id)}`, kind: "proposal", client: company(rows, p.client_id), ref: p.number ?? "", days: daysSince(p.sent_at, today, zone), go: { view: "proposal", id: p.id } });
  }
  for (const i of overdueInvoices(rows, today)) {
    out.push({ key: `w-inv-${String(i.id)}`, kind: "invoice", client: company(rows, i.client_id), ref: i.number ?? "", balance: { value: i.balance, currency: i.currency }, days: daysLate(i.due_on, today), go: { view: "invoice", id: i.id } });
  }
  for (const d of Object.values(rows.deliverables)) {
    // Pending means shared and not yet answered; an unshared one is the studio's still.
    if (d.status !== "pending") continue;
    const project = rows.projects[d.project_id];
    if (project !== undefined && project.status === "done") continue;
    out.push({ key: `w-del-${String(d.id)}`, kind: "deliverable", client: company(rows, d.client_id ?? project?.client_id), ref: d.title, days: daysSince(d.shared_at, today, zone), go: { view: "project", id: d.project_id } });
  }
  return out.sort((a, b) => b.days - a.days || a.key.localeCompare(b.key)).slice(0, limit);
}

// ── this week ───────────────────────────────────────────────────────────────

export interface WeekItem {
  key: string;
  kind: "milestone" | "invoice";
  title: string;
  company: string;
  project: string | null;
  balance?: { value: Decimal | null; currency: string | null };
  due: Day;
  go: Target;
}

/** Open milestones and open invoices falling due from today to six days on, soonest first. */
export function week(rows: Held, today: Day): WeekItem[] {
  const end = addDays(today, 6);
  const within = (day: Day | null): day is Day => day !== null && day >= today && day <= end;
  const out: WeekItem[] = [];
  for (const m of Object.values(rows.milestones)) {
    const project = rows.projects[m.project_id];
    if (m.state === "done" || project === undefined || project.status === "done" || !within(m.due_on)) continue;
    out.push({ key: `m-${String(m.id)}`, kind: "milestone", title: m.title, company: company(rows, project.client_id), project: project.name, due: m.due_on, go: { view: "project", id: project.id } });
  }
  for (const i of openInvoices(rows)) {
    if (!within(i.due_on)) continue;
    out.push({ key: `i-${String(i.id)}`, kind: "invoice", title: i.number ?? "", company: company(rows, i.client_id), project: null, balance: { value: i.balance, currency: i.currency }, due: i.due_on, go: { view: "invoice", id: i.id } });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.key.localeCompare(b.key));
}
