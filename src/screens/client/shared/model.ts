/**
 * What the clients' pages work out from the rows they hold — labels only.
 *
 * Every figure here is either a stored one (a balance, a total, a payment's
 * amount) or a label worked out from stored values for the page to show: an
 * invoice is "overdue" when it is sent, still has a balance and its due day is
 * behind the studio's today; a proposal is "out of date" when it is sent and
 * its hold day has passed. Sums are for showing only (`sumDecimals`), never
 * saved. Nothing here reads or writes the server.
 */
import type { Day, Decimal, Id, Instant, Tables } from "../../../data/types.ts";
import { daysBetween, venueDay } from "../../../data/venueTime.ts";
import { daysLate } from "../../../lib/dates.ts";
import { t } from "../../../i18n/ambient.ts";
import { isPositive, minorUnits, sumDecimals } from "../../../lib/money.ts";
import type { StatusWord } from "../../../components/ui.tsx";

type Invoice = Tables["invoices"];
type Proposal = Tables["proposals"];
type Project = Tables["projects"];
type Milestone = Tables["milestones"];
type Version = Tables["deliverable_versions"];
type Payment = Tables["payments"];

// ── invoices ────────────────────────────────────────────────────────────────

/** An invoice the client can still pay something on: sent, not void, with a balance. */
export const isOpen = (inv: Invoice): boolean => inv.status === "sent" && isPositive(inv.balance);

/** Past its due day with a balance, on the studio's calendar. */
export const isOverdue = (inv: Invoice, today: Day): boolean => isOpen(inv) && inv.due_on !== null && inv.due_on < today;

/** Whole days an open invoice is past its due day (0 when it is not). */
export const daysPastDue = (inv: Invoice, today: Day): number => (isOverdue(inv, today) ? daysLate(inv.due_on, today) : 0);

/** The pill an invoice shows the client: void, paid, overdue, part paid or sent. */
export function invoiceState(inv: Invoice, today: Day): StatusWord {
  if (inv.status === "void") return "void";
  if (!isPositive(inv.balance)) return "paid";
  if (isOverdue(inv, today)) return "overdue";
  if (isPositive(inv.paid)) return "partPaid";
  return "sent";
}

/**
 * Whether the client has already said they paid, and so may not say it again
 * until the studio records a payment (which clears it).
 */
export const hasClaimed = (inv: Invoice): boolean => inv.client_paid_at !== null || inv.client_paid === true;

/** The payments of one invoice, oldest first (the server already left the voided ones out). */
export function paymentsOf(payments: readonly Payment[], invoiceId: Id): Payment[] {
  return payments.filter((p) => p.document_id === invoiceId && !p.voided).sort(byPaidOn);
}

export const byPaidOn = (a: Payment, b: Payment): number => (a.paid_on === b.paid_on ? a.id - b.id : a.paid_on < b.paid_on ? -1 : 1);

/** The day an invoice was settled: its last payment's day. */
export function settledOn(inv: Invoice, payments: readonly Payment[]): Day | null {
  const own = paymentsOf(payments, inv.id);
  return own.length === 0 ? null : own[own.length - 1]!.paid_on;
}

/** A sum of stored amounts, to show only, at the currency's own number of places. */
export const shownSum = (values: readonly (Decimal | null | undefined)[], currency: string | null | undefined): Decimal => sumDecimals(values, minorUnits(currency));

// ── proposals ───────────────────────────────────────────────────────────────

/** Sent, and its hold day has passed: it can no longer be accepted, only re-priced. */
export const isStale = (p: Proposal, today: Day): boolean => p.status === "sent" && p.valid_until !== null && p.valid_until < today;

/** Sent and still holding its price: the client can accept or decline it. */
export const canDecide = (p: Proposal, today: Day): boolean => p.status === "sent" && !isStale(p, today);

/**
 * Accepted on the client's word (by email, a call or in a meeting) and not yet
 * signed: the client may put their name to it, and nothing else.
 */
export const needsSignature = (p: Proposal): boolean => p.status === "accepted" && (p.signed_name === null || p.signed_name.trim() === "") && p.accepted_how !== "portal";

export function proposalState(p: Proposal, today: Day): StatusWord {
  if (isStale(p, today)) return "outOfDate";
  return p.status as StatusWord;
}

/** Accept and sign is offered once a name of two letters or more is typed and the terms are ticked. */
export const canSign = (name: string, agreed: boolean): boolean => name.trim().length > 1 && agreed;

// ── projects ────────────────────────────────────────────────────────────────

export const byPosition = <T extends { position: number; id: Id }>(a: T, b: T): number => (a.position === b.position ? a.id - b.id : a.position - b.position);

/** How far along a project is, as a whole percentage: a done milestone counts whole, one under way half. */
export function progress(milestones: readonly Milestone[]): number {
  if (milestones.length === 0) return 0;
  const done = milestones.reduce((sum, m) => sum + (m.state === "done" ? 1 : m.state === "now" ? 0.5 : 0), 0);
  return Math.round((done / milestones.length) * 100);
}

/** A project's milestones, in their order. */
export const milestonesOf = (all: readonly Milestone[], projectId: Id): Milestone[] => all.filter((m) => m.project_id === projectId).sort(byPosition);

/** The first milestone not done. */
export const nextMilestone = (milestones: readonly Milestone[]): Milestone | undefined => milestones.find((m) => m.state !== "done");

/** The project Home leads with: the first that is not done, else the first. */
export function leadProject(projects: readonly Project[]): Project | undefined {
  const sorted = [...projects].sort((a, b) => b.id - a.id);
  return sorted.find((p) => p.status !== "done") ?? sorted[0];
}

/** Days from today to a day: negative when it has passed. */
export const daysUntil = (day: Day, today: Day): number => daysBetween(today, day);

// ── deliverables ────────────────────────────────────────────────────────────

/** A deliverable's versions, newest first (by number; a version with no number by when it was posted). */
export function versionsOf(all: readonly Version[], deliverableId: Id): Version[] {
  return all
    .filter((v) => v.deliverable_id === deliverableId)
    .sort((a, b) => {
      if (a.v !== null && b.v !== null && a.v !== b.v) return b.v - a.v;
      const at = (b.posted_at ?? "").localeCompare(a.posted_at ?? "");
      return at !== 0 ? at : b.id - a.id;
    });
}

/**
 * A file's name as the client reads it: the last part of its stored reference
 * or of its link, without a query ("box-large-v1.pdf").
 */
export function fileName(ref: string | null | undefined): string {
  if (ref === null || ref === undefined || ref.trim() === "") return "";
  const bare = ref.split(/[?#]/)[0]!.replace(/\/+$/, "");
  const last = bare.split(/[/:]/).pop() ?? bare;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The name a version's file goes by. */
export const versionFile = (v: Version | undefined): string => (v === undefined ? "" : fileName(v.file) || fileName(v.link));

/** A version's label ("v2", in the page's language): its number, else its place among the versions (a sample has none). */
export function versionLabel(v: Version, all: readonly Version[]): string {
  const n = v.v ?? [...all].reverse().indexOf(v) + 1;
  return t("common.versionTag", { n });
}

// ── time ────────────────────────────────────────────────────────────────────

/** The studio's calendar day of an instant. */
export const dayOf = (at: Instant | null | undefined, zone: string): Day | null => {
  if (at === null || at === undefined) return null;
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? venueDay(ms, zone) : null;
};
