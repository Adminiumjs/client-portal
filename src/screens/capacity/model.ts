/**
 * "Can we take this?" — the answer, worked out from the weeks
 * `state/capacity.ts` gives (capacity, days used, days away) and, when asked,
 * the proposals still out for decision counted as booked.
 *
 *   sizes        a small, medium or large job: 3, 8 or 16 studio days
 *   out          each sent proposal still in date, as days: the hours of its
 *                lines (a line named after a rate that has hours per unit)
 *                over the studio's hours a day; when a line names no such
 *                rate, the proposal's subtotal over the card's day rate (none
 *                on the card: the proposal's days are not known). Placed from
 *                the fourth week on, at most four days a week, into what room
 *                is left — pessimistic, and usually right
 *   fit          the first week with enough open days to start (two for a
 *                small job, four for a bigger one) from which the open days
 *                add up to the job before the last week shown
 *
 * Pure: the screen hands it the rows it read.
 */
import type { Day, Decimal, Enquiry, Id, Proposal, ProposalLine, Rate } from "../../data/types.ts";
import { addDays } from "../../data/venueTime.ts";
import { dayRateOf } from "../../lib/rateCard.ts";
import type { CapacityView } from "../../state/capacity.ts";

export type SizeKey = "small" | "medium" | "large";
export const SIZES: readonly { key: SizeKey; days: number }[] = [
  { key: "small", days: 3 },
  { key: "medium", days: 8 },
  { key: "large", days: 16 },
];

/** Who is asking: the newest three enquiries not marked a poor fit, still open. */
export function enquiriesAsking(enquiries: readonly Enquiry[]): Enquiry[] {
  return enquiries
    .filter((e) => e.fit !== "no" && (e.status === "new" || e.status === "replied" || e.status === "parked"))
    .sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? "") || b.id - a.id)
    .slice(0, 3);
}

const num = (value: Decimal | number | null | undefined): number => {
  const n = Number(value ?? NaN);
  return Number.isFinite(n) ? n : NaN;
};


/** A proposal's studio days, whole days and at least one; null when nothing says. */
export function proposalDays(proposal: Pick<Proposal, "subtotal" | "total">, lines: readonly Pick<ProposalLine, "description" | "qty">[], rates: readonly Rate[], hoursPerDay: number): number | null {
  if (hoursPerDay <= 0) return null;
  const byLabel = new Map(rates.filter((r) => num(r.hours_per_unit) > 0).map((r) => [r.label.trim().toLocaleLowerCase(), num(r.hours_per_unit)]));
  let hours = 0;
  let named = lines.length > 0;
  for (const line of lines) {
    const perUnit = byLabel.get((line.description ?? "").trim().toLocaleLowerCase());
    const qty = num(line.qty);
    if (perUnit === undefined || !Number.isFinite(qty)) {
      named = false;
      break;
    }
    hours += qty * perUnit;
  }
  if (named) return Math.max(1, Math.round(hours / hoursPerDay));
  // The card's day rate; none on the card, and a proposal's days are not guessed from another rate.
  const day = dayRateOf(rates, hoursPerDay);
  const rate = day === null ? null : num(day.amount);
  const value = num(proposal.subtotal ?? proposal.total);
  if (rate === null || rate <= 0 || !Number.isFinite(value)) return null;
  return Math.max(1, Math.round(value / rate));
}

export interface OutProposal {
  id: Id;
  number: string | null;
  days: number;
}

export interface WeekRow {
  start: Day;
  /** Everyone's days that week before anyone is away: the squares drawn. */
  squares: number;
  capacity: number;
  used: number;
  /** Days of proposals out counted as booked. */
  held: number;
  /** The proposals those held days are for. */
  heldFor: Id[];
  /** Open days: capacity less used and held, never below none. */
  open: number;
  away: number;
  holidays: number;
  filledBy: { milestoneId: Id; days: number }[];
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** The week rows, with the proposals out placed when `countOut` is on. */
export function weekRows(view: CapacityView, squares: number, out: readonly OutProposal[], countOut: boolean): WeekRow[] {
  const rows: WeekRow[] = view.weeks.map((w) => ({ start: w.start, squares, capacity: w.capacity, used: w.used, held: 0, heldFor: [], open: 0, away: w.away, holidays: w.holidays, filledBy: w.filledBy }));
  if (countOut) {
    for (const p of out) {
      let days = p.days;
      for (let i = 3; days > 1e-9 && i < rows.length; i += 1) {
        const row = rows[i]!;
        const room = Math.max(0, row.capacity - row.used - row.held);
        const take = Math.min(room, days, 4);
        if (take <= 0) continue;
        row.held = round(row.held + take);
        if (!row.heldFor.includes(p.id)) row.heldFor.push(p.id);
        days -= take;
      }
    }
  }
  for (const row of rows) row.open = round(Math.max(0, row.capacity - row.used - row.held));
  return rows;
}

/** How many days a week must be open to start a job of `need` days. */
export const startFloor = (need: number): number => Math.min(need, need <= 3 ? 2 : 4);

/** The first week a job can start, and the week it would finish; null when it does not fit in view. */
export function fitOf(rows: readonly WeekRow[], need: number): { start: number; end: number } | null {
  const floor = startFloor(need);
  for (let s = 0; s < rows.length; s += 1) {
    if (rows[s]!.open < floor - 1e-9) continue;
    let sum = 0;
    for (let e = s; e < rows.length; e += 1) {
      sum += rows[e]!.open;
      if (sum >= need - 1e-9) return { start: s, end: e };
    }
    return null;
  }
  return null;
}

/** What each of a week's squares is: used, held for a proposal out, open, or not there (someone away). */
export type Square = "used" | "held" | "open" | "none";

export function squaresOf(row: WeekRow): Square[] {
  const total = row.squares;
  const used = Math.min(Math.round(row.used), total);
  const held = Math.min(Math.round(row.used + row.held), total) - used;
  const open = Math.max(0, Math.min(total, Math.round(row.capacity)) - used - held);
  return Array.from({ length: total }, (_, c) => (c < used ? "used" : c < used + held ? "held" : c < used + held + open ? "open" : "none"));
}

/** The week after the last one shown: where "not this quarter" points. */
export const afterView = (rows: readonly WeekRow[]): Day | null => (rows.length === 0 ? null : addDays(rows[rows.length - 1]!.start, 7));

/** Everything between today and a day, in the order it comes. */
export interface LoadItem {
  key: string;
  kind: "now" | "milestone" | "away" | "press" | "call";
  title: string;
  day: Day;
  /** An away stretch's last day. */
  to: Day | null;
  projectId: Id | null;
  clientId: Id | null;
  projectNumber: string | null;
  personId: Id | null;
}

export function loadBefore(
  inputs: {
    today: Day;
    projects: readonly { id: Id; status: string; client_id: Id; number: string | null }[];
    milestones: readonly { id: Id; project_id: Id; title: string; due_on: Day | null; state: string }[];
    events: readonly { id: Id; date: Day; to_date: Day | null; title: string; kind: string; person_id: Id | null }[];
  },
  end: Day,
): LoadItem[] {
  const out: LoadItem[] = [];
  const projects = new Map(inputs.projects.map((p) => [p.id, p]));
  for (const m of inputs.milestones) {
    const p = projects.get(m.project_id);
    if (p === undefined || p.status === "done" || m.state === "done" || m.due_on === null || m.due_on < inputs.today || m.due_on > end) continue;
    out.push({ key: `m${String(m.id)}`, kind: m.state === "now" ? "now" : "milestone", title: m.title, day: m.due_on, to: null, projectId: p.id, clientId: p.client_id, projectNumber: p.number, personId: null });
  }
  for (const e of inputs.events) {
    const last = e.to_date !== null && e.to_date > e.date ? e.to_date : e.date;
    if (last < inputs.today || e.date > end) continue;
    const kind = e.kind === "away" ? "away" : e.kind === "press" ? "press" : "call";
    out.push({ key: `e${String(e.id)}`, kind, title: e.title, day: e.date < inputs.today ? inputs.today : e.date, to: last === e.date ? null : last, projectId: null, clientId: null, projectNumber: null, personId: e.person_id });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.key.localeCompare(b.key)));
}
