/**
 * The studio's time: what the Time screen reads and does, each an Adminium
 * write (`time_entries`).
 *
 *   log time            one entry: a project, who, the hours, what they went
 *                       on — on the project's milestone under way unless one
 *                       is named, dated today unless a day is
 *   the running clock   an entry with no hours yet, whose `running_for` names
 *                       the person. Adminium keeps `running_for` unique, so a
 *                       person has one clock, whichever computer started a
 *                       second; the moment it started is Adminium's stamp.
 *                       Stopping it empties `running_for` and says the clock
 *                       has stopped: Adminium stamps that moment too and works
 *                       the hours out from the two stamps. The browser's own
 *                       clock never decides them
 *   the hours           `hours` is Adminium's figure: the ones a person typed
 *                       (`logged_hours`: time logged by hand, or a clock's
 *                       real hours), else the clock's, to the quarter hour
 *   move onto invoice   one line per entry on the client's draft
 *                       (`invoiceDrafts.ts`); the line is the record that the
 *                       hours are invoiced
 *
 * An entry on an invoice keeps its hours, its day and its project: Adminium
 * refuses a change to them while a line of an invoice that is not void carries
 * it, whichever door the change comes through. Take the line off the draft
 * first (it frees the entry), or leave it — a sent invoice's lines are locked.
 * Its note and milestone are the studio's own, and still change.
 */
import { SinkError } from "../data/sink.ts";
import type { Day, Id, Milestone, TimeEntry } from "../data/types.ts";
import { today } from "../lib/clock.ts";
import { deskWrites, drop, ensureRows, loadWhere, refreshRows, rowsOf, upsert, useDesk } from "./desk.ts";
import { asInvoiced, linesCarrying, ontoDrafts, type OntoDrafts } from "./invoiceDrafts.ts";
import { attempt, refusalOf, type Outcome } from "./outcome.ts";
import { createOne, decimalText, invalid } from "./officeWrites.ts";

export type { Outcome } from "./outcome.ts";

/** The most hours one entry may hold (Adminium refuses more, a clock's too): nobody works more than that in a day. */
export const MOST_HOURS = 16;

// ── reading ─────────────────────────────────────────────────────────────────

/**
 * The entries the Time screen shows: from `since` (a month's first day, say)
 * to today, with the lines that invoice them, their projects and milestones.
 * Also every clock still running, whenever it started.
 */
export async function loadTime(since: Day, projectId: Id | null = null): Promise<TimeEntry[]> {
  const range = { column: "date", op: "gte" as const, value: since };
  const where = projectId === null ? range : { and: [range, { column: "project_id", op: "eq" as const, value: projectId }] };
  const [entries] = await Promise.all([loadWhere("time_entries", where, "date.desc", 2000), loadRunningClocks()]);
  await readAround(entries);
  return entries;
}

/** Every clock still running (one per person at most). */
export function loadRunningClocks(): Promise<TimeEntry[]> {
  return loadWhere("time_entries", { column: "running_for", op: "not_null" }, "started_at.asc", 50);
}

/** The lines that invoice these entries, and the projects and milestones they name. */
async function readAround(entries: readonly TimeEntry[]): Promise<void> {
  const ids = entries.map((e) => e.id);
  await Promise.all([
    ids.length === 0 ? Promise.resolve() : loadWhere("invoice_lines", { column: "time_entry_id", op: "in", value: ids }, undefined, ids.length + 10),
    ensureRows("projects", entries.map((e) => e.project_id)),
    ensureRows("milestones", entries.map((e) => e.milestone_id)),
  ]);
}

/** The line that invoices each entry the desk holds, by entry. */
export function invoicedBy(entries: readonly TimeEntry[]): Map<Id, Id> {
  return new Map(linesCarrying("time_entry_id", entries.map((e) => e.id)).map((l) => [l.time_entry_id as Id, l.document_id]));
}

/** Whether an entry is on an invoice (as far as the desk has read). */
export const isInvoiced = (entry: TimeEntry): boolean => linesCarrying("time_entry_id", [entry.id]).length > 0;

/** The running clock of one person, if the desk holds one. */
export function clockOf(personId: Id): TimeEntry | null {
  return rowsOf(useDesk.getState(), "time_entries").find((e) => e.running_for === personId) ?? null;
}

/**
 * The milestone time on a project goes on when none is named: the one under
 * way, else the next still to come, else the last one.
 */
export function currentMilestone(projectId: Id): Milestone | null {
  const list = rowsOf(useDesk.getState(), "milestones")
    .filter((m) => m.project_id === projectId)
    .sort((a, b) => a.position - b.position);
  return list.find((m) => m.state === "now") ?? list.find((m) => m.state === "next") ?? list.at(-1) ?? null;
}

// ── logging time ────────────────────────────────────────────────────────────

export interface TimeInput {
  project_id: Id;
  person_id: Id;
  /** Decimal text, above 0 and at most 16. */
  hours: string;
  /** What the hours went on. */
  note: string;
  /** The project's milestone under way when left out. */
  milestone_id?: Id | null;
  /** Today when left out. */
  date?: Day;
}

/** Hours as typed: above zero, at most sixteen, two places at most. */
export function hoursProblem(hours: string): string | null {
  const text = decimalText(hours);
  if (text === null || !/^\d+(\.\d{1,2})?$/.test(text)) return "HOURS_NOT_A_NUMBER";
  const value = Number(text);
  return value > 0 && value <= MOST_HOURS ? null : "HOURS_OUT_OF_RANGE";
}

async function milestoneFor(projectId: Id, named: Id | null | undefined): Promise<Id | null> {
  if (named !== undefined) return named;
  await loadWhere("milestones", { column: "project_id", op: "eq", value: projectId }, "position.asc");
  return currentMilestone(projectId)?.id ?? null;
}

/** Log time: one entry (the hours are the person's own, as typed; its client is copied from the project by Adminium). */
export async function logTime(input: TimeInput): Promise<Outcome<TimeEntry>> {
  const problem = hoursProblem(input.hours);
  if (problem !== null) return invalid(problem, "hours");
  if (input.note.trim() === "") return invalid("NOTE_REQUIRED", "note");
  let milestone: Id | null;
  try {
    milestone = await milestoneFor(input.project_id, input.milestone_id);
  } catch (error) {
    return refusalOf(error);
  }
  return createOne("time_entries", {
    project_id: input.project_id,
    milestone_id: milestone,
    person_id: input.person_id,
    date: input.date ?? today(),
    logged_hours: decimalText(input.hours),
    note: input.note.trim(),
  });
}

export interface TimeChange {
  hours?: string;
  note?: string;
  date?: Day;
  milestone_id?: Id | null;
  project_id?: Id;
}

/** Change an entry. Hours, a day or a project an invoice bills are refused by Adminium: they are the line's now. */
export async function editTime(entryId: Id, change: TimeChange): Promise<Outcome<TimeEntry>> {
  if (change.hours !== undefined) {
    const problem = hoursProblem(change.hours);
    if (problem !== null) return invalid(problem, "hours");
  }
  if (change.note !== undefined && change.note.trim() === "") return invalid("NOTE_REQUIRED", "note");
  const out = await attempt(async () => {
    const patch = {
      // The typed hours: Adminium's `hours` follows them, a stopped clock's too.
      ...(change.hours === undefined ? {} : { logged_hours: decimalText(change.hours) }),
      ...(change.note === undefined ? {} : { note: change.note.trim() }),
      ...(change.date === undefined ? {} : { date: change.date }),
      ...(change.milestone_id === undefined ? {} : { milestone_id: change.milestone_id }),
      ...(change.project_id === undefined ? {} : { project_id: change.project_id }),
    };
    const row = await deskWrites().update("time_entries", entryId, patch);
    upsert("time_entries", { ...row, id: entryId });
    return useDesk.getState().rows.time_entries[entryId]!;
  });
  return asInvoiced(out);
}

/**
 * Remove an entry (a studio manager's; the studio role deletes nothing).
 * One a line invoices is refused by Adminium: the line points at it.
 */
export function removeTime(entryId: Id): Promise<Outcome<void>> {
  return attempt(async () => {
    await deskWrites().remove("time_entries", entryId);
    drop("time_entries", entryId);
  });
}

// ── the running clock ───────────────────────────────────────────────────────

export interface ClockInput {
  project_id: Id;
  person_id: Id;
  milestone_id?: Id | null;
  note?: string | null;
}

/**
 * Start a clock for a person: an entry with no hours yet, dated today, whose
 * start Adminium stamps. A second clock for the same person is refused
 * (`UNIQUE_VIOLATION` on `running_for`), whichever computer holds the first.
 */
export async function startClock(input: ClockInput): Promise<Outcome<TimeEntry>> {
  let milestone: Id | null;
  try {
    milestone = await milestoneFor(input.project_id, input.milestone_id);
  } catch (error) {
    return refusalOf(error);
  }
  const note = input.note?.trim() ?? "";
  return createOne("time_entries", {
    project_id: input.project_id,
    milestone_id: milestone,
    person_id: input.person_id,
    running_for: input.person_id,
    date: today(),
    note: note === "" ? null : note,
  });
}

/**
 * Stop a clock: `running_for` emptied so the person may start another, and the
 * clock marked stopped, which Adminium stamps with the moment; the hours are
 * Adminium's, from its two stamps — or the ones the person typed instead
 * (`logged_hours`). A clock that ran past sixteen hours is refused by
 * Adminium rather than stored: it asks for the hours (`CLOCK_TOO_LONG`).
 */
export async function stopClock(entryId: Id, opts: { hours?: string; note?: string | null } = {}): Promise<Outcome<TimeEntry>> {
  // Read afresh, never from what this page holds: another computer may have stopped it, and even
  // put its hours on an invoice, since this page drew it running.
  let entry: TimeEntry | undefined;
  let invoiced: boolean;
  try {
    const [rows, lines] = await Promise.all([
      refreshRows("time_entries", [entryId]),
      loadWhere("invoice_lines", { column: "time_entry_id", op: "eq", value: entryId }, undefined, 1),
    ]);
    entry = rows[0];
    invoiced = lines.length > 0;
  } catch (error) {
    return refusalOf(error);
  }
  if (entry === undefined) return refusalOf(new SinkError("gone", "refused", 404, "NOT_FOUND"));
  if (invoiced) return refusalOf(new SinkError("on an invoice", "refused", 409, "ALREADY_INVOICED"));
  if (entry.running_for === null) return refusalOf(new SinkError("not running", "refused", 409, "CLOCK_NOT_RUNNING"));
  const typed = opts.hours === undefined || opts.hours.trim() === "" ? null : opts.hours;
  if (typed !== null) {
    const problem = hoursProblem(typed);
    if (problem !== null) return invalid(problem, "hours");
  }
  const note = opts.note === undefined ? entry.note : opts.note === null || opts.note.trim() === "" ? null : opts.note.trim();
  if (note === null) return invalid("NOTE_REQUIRED", "note");
  const out = await attempt(async () => {
    const row = await deskWrites().update("time_entries", entryId, {
      ...(typed === null ? {} : { logged_hours: decimalText(typed) }),
      note,
      running_for: null,
      clock_stopped: true,
    });
    upsert("time_entries", { ...row, id: entryId });
    return useDesk.getState().rows.time_entries[entryId]!;
  });
  // Adminium's hours from its two stamps are more than an entry may hold: the clock was left running.
  if (!out.ok && typed === null && out.reason === "invalid" && out.field === "hours") return invalid("CLOCK_TOO_LONG", "hours");
  return out;
}

/** Throw a clock away (started by mistake): the entry goes. A studio manager's, as every removal is. */
export function discardClock(entryId: Id): Promise<Outcome<void>> {
  return removeTime(entryId);
}

// ── onto an invoice ─────────────────────────────────────────────────────────

export interface MoveTimeInput {
  /** The hourly rate the lines carry, decimal text (the rate card's, see `hourlyRate`). */
  rate: string;
  /** A new draft's title, when a client has none to add to. */
  newTitle: (clientId: Id, projectId: Id | null) => string | null;
  /** A line's words for an entry (its note, by default). */
  describe?: (entry: TimeEntry) => string;
}

/**
 * Move onto an invoice: one line per entry (the hours × the rate) on the
 * client's draft. Entries still running, or already on a line, are left as
 * they are; pressing twice writes nothing twice.
 */
export async function moveTimeOntoInvoice(entryIds: readonly Id[], input: MoveTimeInput): Promise<Outcome<OntoDrafts>> {
  const rate = decimalText(input.rate);
  if (rate === null || !/^\d+(\.\d{1,4})?$/.test(rate)) return invalid("RATE_NOT_A_NUMBER", "rate");
  try {
    // Read afresh: hours a voided invoice let go of may have changed since this page drew them, and the line bills what is stored.
    await refreshRows("time_entries", entryIds);
  } catch (error) {
    return refusalOf(error);
  }
  const held = useDesk.getState().rows.time_entries;
  const entries = entryIds.map((id) => held[id]).filter((e): e is TimeEntry => e !== undefined && e.running_for === null && e.hours !== null && e.client_id !== null);
  if (entries.length === 0) return { ok: true, value: { invoices: [], lines: [], skipped: [] } };
  return ontoDrafts(
    "time_entry_id",
    entries.map((e) => ({
      id: e.id,
      clientId: e.client_id as Id,
      projectId: e.project_id,
      description: input.describe?.(e) ?? e.note ?? "",
      qty: e.hours as string,
      rate,
    })),
    input.newTitle,
  );
}

/** The rate card's hourly rate: a rate's amount over the hours it stands for, to the cent (null without hours). */
export function hourlyRate(rate: { amount: string; hours_per_unit: string | null }): string | null {
  const amount = decimalText(rate.amount);
  const hours = decimalText(rate.hours_per_unit);
  if (amount === null || hours === null || Number(hours) <= 0) return null;
  const scale = (text: string) => {
    const [whole, fraction = ""] = text.split(".");
    return { n: BigInt(`${whole}${fraction}`), places: fraction.length };
  };
  const a = scale(amount);
  const h = scale(hours);
  // amount / hours in cents, rounded half away from zero: (a / 10^pa) / (h / 10^ph) × 100.
  const numerator = a.n * 10n ** BigInt(h.places) * 100n;
  const denominator = h.n * 10n ** BigInt(a.places);
  const cents = (numerator * 2n + denominator) / (denominator * 2n);
  const text = cents.toString().padStart(3, "0");
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}
