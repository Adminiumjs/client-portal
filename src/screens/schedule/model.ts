/**
 * The studio's month, worked out from the rows the desk holds — pure, so the
 * screen draws and the tests check the same answer.
 *
 * On a day:
 *   milestones  every milestone not done, of a project not finished, on its
 *               due day ("now" when it is the one in hand)
 *   payments    every sent invoice with something still owed, on its due day
 *   studio      the studio's own dates (`events`): a call, a press check, or
 *               someone away — an away stretch on every day from `date` to
 *               `to_date`
 *   holidays    the public holidays Holiday calendars keeps, when the add-on
 *               is attached, under their own names
 *
 * Every day is a calendar day on the studio's clock (`YYYY-MM-DD`), worked
 * out by calendar arithmetic — never shifted by the reader's zone.
 */
import type { Day, Id, Invoice, Milestone, Person, Project, StudioEvent } from "../../data/types.ts";
import { addDays, daysBetween, weekday } from "../../data/venueTime.ts";
import { isPositive } from "../../lib/money.ts";

/** What a day's item is, and so its colour and its tag. */
export type ItemKind = "now" | "milestone" | "payment" | "press" | "call" | "away" | "holiday";

export interface DayItem {
  key: string;
  kind: ItemKind;
  /** The words on the grid and the rows: a milestone's title, an invoice's number, a date's title, a holiday's name. */
  title: string;
  /** Who it is for: a client's company; null for the studio's own dates and holidays. */
  company: Id | null;
  /** What it opens. */
  opens: { view: "project" | "invoice"; id: Id } | null;
  /** An invoice's balance, for the grid's hover text. */
  invoiceId?: Id;
  /** An away stretch's first and last day. */
  from?: Day;
  to?: Day;
  personId?: Id | null;
}

/** A public holiday, as Holiday calendars hands it over. */
export interface Holiday {
  date: Day;
  name: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The days Holiday calendars keeps, read from the add-on's public settings
 * (`days`: a list of `{ date, name }`). Anything else is left out rather than
 * guessed at; with the add-on absent the list is empty.
 */
export function holidaysOf(settings: Record<string, unknown> | null | undefined): Holiday[] {
  const days = settings?.["days"];
  if (!Array.isArray(days)) return [];
  const out: Holiday[] = [];
  for (const entry of days) {
    if (entry === null || typeof entry !== "object") continue;
    const date = (entry as Record<string, unknown>)["date"];
    const name = (entry as Record<string, unknown>)["name"];
    if (typeof date !== "string" || !DAY.test(date)) continue;
    out.push({ date, name: typeof name === "string" && name.trim() !== "" ? name.trim() : date });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface ScheduleInputs {
  projects: readonly Pick<Project, "id" | "status" | "client_id">[];
  milestones: readonly Pick<Milestone, "id" | "project_id" | "title" | "due_on" | "state">[];
  invoices: readonly Pick<Invoice, "id" | "number" | "status" | "balance" | "due_on" | "client_id">[];
  events: readonly Pick<StudioEvent, "id" | "date" | "to_date" | "title" | "kind" | "person_id">[];
  holidays: readonly Holiday[];
}

/** Every dated item, by day. An away stretch is on each of its days. */
export function itemsByDay(inputs: ScheduleInputs): Map<Day, DayItem[]> {
  const bag = new Map<Day, DayItem[]>();
  const add = (day: Day, item: DayItem) => bag.set(day, [...(bag.get(day) ?? []), item]);
  const projects = new Map(inputs.projects.map((p) => [p.id, p]));
  for (const m of [...inputs.milestones].sort((a, b) => a.id - b.id)) {
    const project = projects.get(m.project_id);
    if (project === undefined || project.status === "done" || m.state === "done" || m.due_on === null) continue;
    add(m.due_on, { key: `m${String(m.id)}`, kind: m.state === "now" ? "now" : "milestone", title: m.title, company: project.client_id, opens: { view: "project", id: project.id } });
  }
  for (const i of [...inputs.invoices].sort((a, b) => a.id - b.id)) {
    if (i.status !== "sent" || !isPositive(i.balance) || i.due_on === null) continue;
    add(i.due_on, { key: `i${String(i.id)}`, kind: "payment", title: i.number ?? "", company: i.client_id, opens: { view: "invoice", id: i.id }, invoiceId: i.id });
  }
  for (const e of [...inputs.events].sort((a, b) => a.id - b.id)) {
    const last = e.to_date !== null && e.to_date > e.date ? e.to_date : e.date;
    // A bounded stretch: a mistyped year never draws a thousand days.
    for (let day = e.date, n = 0; day <= last && n < 366; day = addDays(day, 1), n += 1) {
      add(day, { key: `e${String(e.id)}-${day}`, kind: e.kind, title: e.title, company: null, opens: null, from: e.date, to: last, personId: e.person_id });
    }
  }
  for (const h of inputs.holidays) add(h.date, { key: `h${h.date}`, kind: "holiday", title: h.name, company: null, opens: null });
  return bag;
}

/** `YYYY-MM` of a day. */
export const monthOf = (day: Day): string => day.slice(0, 7);

/** The month after (or before, with −1) a `YYYY-MM`. */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const at = y * 12 + (m - 1) + by;
  return `${String(Math.floor(at / 12)).padStart(4, "0")}-${String((at % 12) + 1).padStart(2, "0")}`;
}

/** How many days a month has. */
export function daysIn(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface Cell {
  /** Null for a square before the 1st or after the last day. */
  day: Day | null;
  weekend: boolean;
}

/** The month's grid, Monday first, whole weeks. */
export function monthGrid(month: string): Cell[] {
  const first = `${month}-01`;
  const lead = (weekday(first) + 6) % 7;
  const days = daysIn(month);
  const total = Math.ceil((lead + days) / 7) * 7;
  return Array.from({ length: total }, (_, n) => {
    const d = n - lead + 1;
    return { day: d >= 1 && d <= days ? `${month}-${String(d).padStart(2, "0")}` : null, weekend: n % 7 >= 5 };
  });
}

const isWeekday = (day: Day): boolean => {
  const w = weekday(day);
  return w >= 1 && w <= 5;
};

export interface MonthStats {
  /** Monday to Friday, less the public holidays that fall on one. */
  workingDays: number;
  /** Public holidays on a weekday this month. */
  holidays: number;
  /** Milestones due this month. */
  committed: number;
  /** Weekdays someone is away, counted per person. */
  awayDays: number;
  /** Who is away this month, by person (null: a date that names nobody). */
  awayPeople: (Id | null)[];
}

export function monthStats(month: string, bag: Map<Day, DayItem[]>): MonthStats {
  let workingDays = 0;
  let holidays = 0;
  let committed = 0;
  let awayDays = 0;
  const people: (Id | null)[] = [];
  for (let d = 1; d <= daysIn(month); d += 1) {
    const day = `${month}-${String(d).padStart(2, "0")}`;
    const items = bag.get(day) ?? [];
    const holiday = items.some((i) => i.kind === "holiday");
    if (isWeekday(day)) {
      if (holiday) holidays += 1;
      else workingDays += 1;
    }
    committed += items.filter((i) => i.kind === "now" || i.kind === "milestone").length;
    // Away is counted on working days only: a weekend away takes nobody's work.
    if (isWeekday(day) && !holiday) {
      const away = new Set(items.filter((i) => i.kind === "away").map((i) => i.personId ?? null));
      awayDays += away.size;
      for (const who of away) if (!people.includes(who)) people.push(who);
    }
  }
  return { workingDays, holidays, committed, awayDays, awayPeople: people };
}

export interface NextItem {
  day: Day;
  item: DayItem;
}

/**
 * The next dated things from today on, in order: an away stretch once, on its
 * first day (or today, when it has already begun).
 */
export function nextInOrder(bag: Map<Day, DayItem[]>, today: Day, count = 7): NextItem[] {
  const out: NextItem[] = [];
  const seen = new Set<string>();
  for (const day of [...bag.keys()].sort()) {
    if (day < today) continue;
    for (const item of bag.get(day)!) {
      const stretch = item.kind === "away" ? item.key.slice(0, item.key.indexOf("-")) : null;
      if (stretch !== null) {
        if (seen.has(stretch)) continue;
        seen.add(stretch);
      }
      out.push({ day, item });
      if (out.length >= count) return out;
    }
  }
  return out;
}

/** Whole days from today to a day (negative: gone). */
export const daysUntil = (today: Day, day: Day): number => daysBetween(today, day);

/** A day is a weekend day. */
export const isWeekend = (day: Day): boolean => !isWeekday(day);

/** A month's name and year, in the page's language ("August 2026"). */
export function monthLabel(month: string, locale: string, style: "long" | "short" = "long"): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, { month: style, year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** A month's name alone ("August"). */
export function monthName(month: string, locale: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** A day with its month written out and no year ("14 September"), for a sentence. */
export function dayMonthLabel(day: Day, locale: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** People's first names, for "Tomas away". */
export function firstNameOf(people: readonly Pick<Person, "id" | "name">[], id: Id | null): string | null {
  if (id === null) return null;
  const person = people.find((p) => p.id === id);
  return person === undefined ? null : (person.name.trim().split(/\s+/)[0] ?? person.name);
}
