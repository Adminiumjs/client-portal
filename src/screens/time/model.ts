/**
 * What the Time screen shows, worked out from stored rows — and nothing the
 * screen saves. The hours are the entries' own (`time_entries.hours`, two
 * places), added up exactly; an entry is invoiced while a line of an invoice
 * points at it (the line is the one record of that). Amounts here — "not
 * invoiced, at the hourly rate" — are labels only: the lines' amounts,
 * subtotals and totals are Adminium's, read back after a move.
 *
 *   sums         logged this month (and on how many projects), not yet on an
 *                invoice, the heaviest project
 *   filters      Everything, then one per project with time logged, named by
 *                its client (and the project, when a client has more than one)
 *   rows         newest first; a running clock is not a row (it has no hours)
 *   the rate     the rate card's day rate over the hours in a working day
 *   a move       what "Move onto an invoice" would put where: per client, the
 *                hours, the amount at the rate, and the draft it lands on
 */
import type { Day, Decimal, Id, Invoice, Milestone, Person, Project, Rate, Settings, TimeEntry } from "../../data/types.ts";
import { sumDecimals } from "../../lib/money.ts";
import { hourlyRate } from "../../state/timeActions.ts";

/** An entry with hours: a stopped clock, or time logged by hand. */
export const isLogged = (entry: TimeEntry): boolean => entry.running_for === null && entry.hours !== null;

/** A clock still running: no hours yet, a person named. */
export const isRunning = (entry: TimeEntry): boolean => entry.running_for !== null;

/** Hours added up exactly (two places), as decimal text. */
export const sumHours = (entries: readonly TimeEntry[]): Decimal => sumDecimals(entries.map((e) => e.hours));

/** The first day of the month a day is in. */
export const monthStart = (day: Day): Day => `${day.slice(0, 7)}-01`;

export interface TimeSums {
  /** Hours logged in this month (the studio's calendar). */
  month: Decimal;
  /** The projects those hours went on. */
  monthProjects: number;
  /** Hours no line carries yet. */
  notInvoiced: Decimal;
  /** The project with the most hours, and its hours; null with no time at all. */
  heaviest: { projectId: Id; hours: Decimal } | null;
}

export function timeSums(entries: readonly TimeEntry[], invoiced: ReadonlySet<Id>, today: Day): TimeSums {
  const logged = entries.filter(isLogged);
  const month = today.slice(0, 7);
  const inMonth = logged.filter((e) => e.date.slice(0, 7) === month);
  const byProject = new Map<Id, TimeEntry[]>();
  for (const e of logged) byProject.set(e.project_id, [...(byProject.get(e.project_id) ?? []), e]);
  let heaviest: TimeSums["heaviest"] = null;
  for (const [projectId, list] of [...byProject].sort((a, b) => a[0] - b[0])) {
    const hours = sumHours(list);
    if (heaviest === null || Number(hours) > Number(heaviest.hours)) heaviest = { projectId, hours };
  }
  return {
    month: sumHours(inMonth),
    monthProjects: new Set(inMonth.map((e) => e.project_id)).size,
    notInvoiced: sumHours(logged.filter((e) => !invoiced.has(e.id))),
    heaviest,
  };
}

/** A filter: everything, or one project. */
export type TimeFilter = "all" | `p${number}`;
export const projectFilter = (projectId: Id): TimeFilter => `p${projectId}`;
export const filterProject = (filter: TimeFilter): Id | null => (filter === "all" ? null : Number(filter.slice(1)));

export interface FilterChoice {
  id: TimeFilter;
  /** The client's company; with the project's name when the client has more than one project here. */
  company: string | null;
  project: string | null;
  /** How many entries it holds. */
  count: number;
}

/** Everything, then one per project with time logged, in the order the projects were last worked on. */
export function filterChoices(entries: readonly TimeEntry[], projects: Readonly<Record<Id, Project>>, companyOf: (clientId: Id) => string | null): FilterChoice[] {
  const logged = entries.filter(isLogged).sort(newestFirst);
  const order: Id[] = [];
  const counts = new Map<Id, number>();
  for (const e of logged) {
    if (!counts.has(e.project_id)) order.push(e.project_id);
    counts.set(e.project_id, (counts.get(e.project_id) ?? 0) + 1);
  }
  const clientOf = (id: Id) => projects[id]?.client_id ?? null;
  const perClient = new Map<Id | null, number>();
  for (const id of order) perClient.set(clientOf(id), (perClient.get(clientOf(id)) ?? 0) + 1);
  return [
    { id: "all", company: null, project: null, count: logged.length },
    ...order.map((id) => {
      const client = clientOf(id);
      const company = client === null ? null : companyOf(client);
      const shared = (perClient.get(client) ?? 0) > 1 || company === null;
      return { id: projectFilter(id), company, project: shared ? (projects[id]?.name ?? null) : null, count: counts.get(id) ?? 0 };
    }),
  ];
}

/** Newest day first; on one day, the one logged last first. */
export function newestFirst(a: TimeEntry, b: TimeEntry): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b.id - a.id;
}

/** The rows a filter shows: logged entries, newest first. */
export function rowsFor(entries: readonly TimeEntry[], filter: TimeFilter): TimeEntry[] {
  const projectId = filterProject(filter);
  return entries.filter((e) => isLogged(e) && (projectId === null || e.project_id === projectId)).sort(newestFirst);
}

/** The day rate: the first rate on the card still in use. */
export function dayRate(rates: readonly Rate[]): Rate | null {
  return [...rates].filter((r) => r.active).sort((a, b) => a.position - b.position || a.id - b.id)[0] ?? null;
}

/**
 * The hourly rate lines carry: the day rate over the hours in a working day,
 * to the cent — exact, never a float. Null without a rate or hours.
 */
export function hourly(rates: readonly Rate[], settings: Pick<Settings, "hours_per_day"> | null): Decimal | null {
  const rate = dayRate(rates);
  const hours = settings?.hours_per_day;
  if (rate === null || hours === undefined || hours === null || hours <= 0) return null;
  return hourlyRate({ amount: rate.amount, hours_per_unit: String(hours) });
}

/** Hours × a rate, to the cent, rounded half away from zero — a label, never saved. */
export function amountAt(hours: Decimal, rate: Decimal): Decimal {
  const units = (text: string, scale: number): bigint => {
    const negative = text.startsWith("-");
    const [whole = "0", fraction = ""] = text.replace("-", "").split(".");
    const n = BigInt(`${whole}${fraction.padEnd(scale, "0").slice(0, scale)}`);
    return negative ? -n : n;
  };
  // hundredths of an hour × cents = 1/10 000 of a unit; back to cents, rounded.
  const product = units(hours, 2) * units(rate, 2);
  const cents = (product + (product >= 0n ? 50n : -50n)) / 100n;
  const negative = cents < 0n;
  const text = (negative ? -cents : cents).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${text.slice(0, -2)}.${text.slice(-2)}`;
}

/** The person the signed-in account is, found by email; null when no person carries it. */
export function personOf(people: readonly Person[], email: string | null): Person | null {
  if (email === null || email.trim() === "") return null;
  const wanted = email.trim().toLowerCase();
  return people.find((p) => (p.email ?? "").trim().toLowerCase() === wanted) ?? null;
}

/** People in the studio's order. */
export const inOrder = (people: readonly Person[]): Person[] => [...people].sort((a, b) => a.position - b.position || a.id - b.id);

/** The projects time can go on: not finished. */
export const openProjects = (projects: readonly Project[]): Project[] => projects.filter((p) => p.status === "active" || p.status === "paused").sort((a, b) => a.id - b.id);

/** A project's milestones in their order. */
export const milestonesOf = (milestones: readonly Milestone[], projectId: Id): Milestone[] => milestones.filter((m) => m.project_id === projectId).sort((a, b) => a.position - b.position);

/** How a stored number of hours reads: minutes under a tenth of an hour, else hours to two places at most. */
export function hoursParts(hours: Decimal | number): { unit: "min" | "h"; value: number } {
  const n = typeof hours === "number" ? hours : Number(hours);
  return n > 0 && n < 0.1 ? { unit: "min", value: Math.round(n * 60) } : { unit: "h", value: Math.round(n * 100) / 100 };
}

/** A running clock's time so far, as hours, minutes and seconds (never below nothing). */
export function elapsed(startedAt: string | null, at: number): { h: number; m: number; s: number } {
  const ms = startedAt === null ? 0 : Math.max(0, at - Date.parse(startedAt));
  const total = Math.floor(ms / 1000);
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

// ── a move onto an invoice ──────────────────────────────────────────────────

export interface MoveGroup {
  clientId: Id;
  entries: TimeEntry[];
  hours: Decimal;
  /** At the hourly rate: what the lines will come to before tax (Adminium works it out). */
  amount: Decimal | null;
  /** The draft the lines go on, or null for a new one. */
  draft: Invoice | null;
}

/**
 * What a move would do, before it is asked: the entries not yet invoiced,
 * grouped by client, and the draft each client's lines go on — found as the
 * move itself finds it (`draftFor`).
 */
export function movePreview(entries: readonly TimeEntry[], invoiced: ReadonlySet<Id>, rate: Decimal | null, draftFor: (clientId: Id, projectId: Id | null) => Invoice | null): MoveGroup[] {
  const todo = entries.filter((e) => isLogged(e) && !invoiced.has(e.id) && e.client_id !== null);
  const byClient = new Map<Id, TimeEntry[]>();
  for (const e of todo) byClient.set(e.client_id as Id, [...(byClient.get(e.client_id as Id) ?? []), e]);
  return [...byClient].map(([clientId, list]) => {
    const projects = [...new Set(list.map((e) => e.project_id))];
    const hours = sumHours(list);
    return {
      clientId,
      entries: list,
      hours,
      amount: rate === null ? null : sumDecimals(list.map((e) => amountAt(e.hours as Decimal, rate))),
      draft: draftFor(clientId, projects.length === 1 ? (projects[0] ?? null) : null),
    };
  });
}

/** A calendar day with its year ("27 Jul 2026"), the same in every zone. */
export function dayWithYear(day: Day, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}
