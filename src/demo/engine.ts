/**
 * THE DEMO'S ADMINIUM — what the server decides on every write, in memory.
 *
 * The website's demo has no server, so a write in the demo goes through this
 * instead of the data API, and comes out as Adminium would have left it —
 * step for step in Adminium's own order:
 *
 *   1. the fills a create leaves out (a literal, the moment), the copies
 *      through a link (a stage line's rate is its proposal's subtotal), the
 *      settings a column falls back to (the connection's currency, the
 *      add-on's tax and ladder);
 *   2. the states: a new row starts in its first state; a move is one its
 *      state allows, by a role that may, with what it requires (a sent
 *      document has lines and a total above zero; a void invoice took no
 *      money); a locked row changes only its exceptions; a date that only
 *      moves later; a child under a locked parent, or a payment under an
 *      invoice that is not sent — but a void invoice's line may let go of
 *      the hours or the purchase it carried; and the hours or the purchase a
 *      line carries stay as billed while its invoice is not void;
 *   3. the stamps (who, when, from which door), then the running number
 *      without gaps and its text with the add-on's prefix, a drawn code;
 *   4. the formulas, the rollups and the balance they leave, and the cap: a
 *      write that takes a balance below zero is refused and undone;
 *   5. the seal: an accepted proposal's fingerprint, over what was stored;
 *   6. a payment clears "the client says they paid";
 *   7. the write announced, as the live stream would, and handed to the
 *      outbox's producers (`outbox.ts`).
 *
 * Refusals carry the server's own status, code and details
 * (`STATE_MOVE_REFUSED`, `RECORD_LOCKED`, `DELETE_REFUSED`,
 * `BALANCE_EXCEEDED`, `VALIDATION_FAILED` … `ONLY_LATER`,
 * `UNIQUE_VIOLATION`), so a screen says the same words it would against
 * Adminium. The rules are the manifest's (`rules.ts`, and the sample
 * loader's `RULES`), each held to it by a drift test.
 *
 * DEMO BUILD ONLY — nothing in a real build imports it.
 */
import { COLUMNS, RULES, currencyScale, workOut, type Formula } from "../data/sampleRows.ts";
import { COLUMN_KINDS, TABLE_REFS, type Id, type TableRef } from "../data/types.ts";
import { addDays, venueDay } from "../data/venueTime.ts";
import { atPlaces, fromUnits, toUnits } from "./decimal.ts";
import { fingerprint, type HashOf } from "./fingerprint.ts";
import { DEMO_RULES } from "./rules.ts";
import type { Move, RowCondition, StampRule, StatesRule } from "./rulesOf.ts";

export type Row = Record<string, unknown> & { id: Id };
export type Rows = { [R in TableRef]: Row[] };

/** Who is writing, and through which door — what the stamps and the moves read. */
export interface Writer {
  /**
   * `desk`: a person at the studio's desk; `public`: a client on their own
   * page; `system`: Adminium itself (the outbox); `history`: rows brought in
   * as they were (a sample), judged and stamped by nothing.
   */
  origin: "desk" | "public" | "system" | "history";
  /** The desk person's name (`user-name` stamps). */
  name: string | null;
  /** The desk person's roles, or `any` for Adminium's own writes. */
  roles?: ReadonlySet<string> | "any";
  /** The client row a public write is claimed as (`claim` stamps). */
  claim?: Record<string, unknown> | null;
}

/** A write Adminium refuses: its status, code and details, as the data API answers. */
export class Refusal extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "Refusal";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const refuse = (status: number, code: string, message: string, details: Record<string, unknown> = {}): never => {
  throw new Refusal(status, code, message, details);
};

// ── values ─────────────────────────────────────────────────────────────────

export const empty = (value: unknown) => value === null || value === undefined || (typeof value === "string" && value.trim() === "");

/** Two stored values the same, however each was spelled (Adminium's `sameValue`). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  if (typeof a === "boolean" || typeof b === "boolean") {
    const truth = (v: unknown) => {
      const text = String(v).toLowerCase();
      return ["true", "t", "1", "yes"].includes(text) ? true : ["false", "f", "0", "no"].includes(text) ? false : null;
    };
    return truth(a) !== null && truth(a) === truth(b);
  }
  if (typeof a === "number" || typeof b === "number") {
    const [x, y] = [Number(a), Number(b)];
    return Number.isFinite(x) && x === y;
  }
  return String(a) === String(b);
}

/** Whether a condition holds for a row (a move's `requires.where`, a producer's `where`). */
export function holds(condition: RowCondition & { isNull?: boolean; in?: unknown[] }, row: Record<string, unknown>): boolean {
  const value = row[condition.column];
  if (condition.isNull !== undefined) return empty(value) === condition.isNull;
  if (condition.eq !== undefined) return sameValue(condition.eq, value);
  if (condition.in !== undefined) return condition.in.some((candidate) => sameValue(candidate, value));
  if (value === null || value === undefined || value === "") return false;
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (condition.gt !== undefined) return n > condition.gt;
  if (condition.gte !== undefined) return n >= condition.gte;
  if (condition.lt !== undefined) return n < condition.lt;
  return condition.lte !== undefined && n <= condition.lte;
}

/** A decimal column's places for a row: fixed, or the row's currency's own (else the connection's). */
export function placesOf(ref: string, column: string, row: Record<string, unknown>, currency: string): number | undefined {
  const scale = DEMO_RULES.decimals[ref]?.[column];
  if (scale === undefined) return undefined;
  return scale === "currency" ? currencyScale(row["currency"] ?? currency) : scale;
}

/** Every decimal of a row as decimal text at its places, as the database answers it. */
export function spellDecimals(ref: string, row: Record<string, unknown>, currency: string): void {
  for (const column of Object.keys(DEMO_RULES.decimals[ref] ?? {})) {
    const value = row[column];
    if (value === null || value === undefined || value === "") {
      if (column in row) row[column] = null;
      continue;
    }
    row[column] = atPlaces(value, placesOf(ref, column, row, currency)!) ?? value;
  }
}

/** A table's date columns (`YYYY-MM-DD`), by the manifest. */
const DATE_COLUMNS: Partial<Record<TableRef, string[]>> = Object.fromEntries(
  Object.entries(COLUMN_KINDS).map(([ref, kinds]) => [ref, Object.entries(kinds as Record<string, string>).filter(([, kind]) => kind === "day").map(([column]) => column)]),
);

/**
 * Every date of a row as the day it names, `YYYY-MM-DD`, as Adminium hands a
 * date column out on every engine: a date keeps no time, so a value written
 * with one (`2026-08-14T00:00:00.000Z`, a Date) is kept as its day, and read
 * back as that day by a page in any zone.
 */
export function spellDates(ref: string, row: Record<string, unknown>): void {
  for (const column of DATE_COLUMNS[ref as TableRef] ?? []) {
    const value = row[column];
    if (value === null || value === undefined) continue;
    const text = value instanceof Date ? (Number.isNaN(value.getTime()) ? "" : value.toISOString()) : String(value);
    const day = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(text.trim())?.[1];
    row[column] = day ?? (text.trim() === "" ? null : value);
  }
}

// ── the rules, by table ────────────────────────────────────────────────────

const STATES = DEMO_RULES.states as Partial<Record<TableRef, StatesRule>>;
const STAMPS = DEMO_RULES.stamps as Partial<Record<TableRef, StampRule[]>>;
const isSeal = (stamp: StampRule) => typeof stamp.set === "object" && stamp.set !== null && "hashOf" in stamp.set;
const isAddDays = (stamp: StampRule) => typeof stamp.set === "object" && stamp.set !== null && "addDays" in stamp.set;

/** A table's formulas in the order they can be worked out: each after every formula column it reads. */
function formulaOrder(table: string): typeof RULES.formulas {
  const own = RULES.formulas.filter((f) => f.table === table);
  const byColumn = new Map(own.map((f) => [f.column, f]));
  const done: typeof RULES.formulas = [];
  const reads = (node: unknown, found: Set<string>): Set<string> => {
    if (typeof node === "string") found.add(node);
    else if (Array.isArray(node)) node.forEach((c) => reads(c, found));
    else if (typeof node === "object" && node !== null) Object.values(node).forEach((c) => reads(c, found));
    return found;
  };
  const visit = (f: (typeof own)[number]) => {
    if (done.includes(f)) return;
    for (const name of reads(f.expr, new Set())) {
      const before = byColumn.get(name);
      if (before !== undefined && before !== f) visit(before);
    }
    done.push(f);
  };
  own.forEach(visit);
  return done;
}
const FORMULAS = new Map(TABLE_REFS.map((ref) => [ref, formulaOrder(ref)]));

/** The columns each formula column is worked out from, by table. */
const FORMULA_INPUTS: Partial<Record<TableRef, Map<string, Set<string>>>> = (() => {
  const out: Partial<Record<TableRef, Map<string, Set<string>>>> = {};
  const reads = (node: unknown, found: Set<string>): Set<string> => {
    if (typeof node === "string") found.add(node);
    else if (Array.isArray(node)) node.forEach((c) => reads(c, found));
    else if (typeof node === "object" && node !== null) Object.values(node).forEach((c) => reads(c, found));
    return found;
  };
  for (const f of RULES.formulas) (out[f.table as TableRef] ??= new Map()).set(f.column, reads(f.expr, new Set()));
  return out;
})();

/**
 * A number a column keeps within (`validation.min`/`max`), as Adminium judges
 * it: a value the write gives, and one a formula works out from what the write
 * changed (a stopped clock's hours), refused `VALIDATION_FAILED` naming the column.
 */
function keepRanges(ref: TableRef, row: Record<string, unknown>, written: Record<string, unknown>, action: "create" | "update"): void {
  const ranges = DEMO_RULES.ranges[ref];
  if (ranges === undefined) return;
  for (const [column, { min, max }] of Object.entries(ranges)) {
    const inputs = FORMULA_INPUTS[ref]?.get(column);
    const judged = column in written || (inputs !== undefined && (action === "create" || [...inputs].some((input) => input in written)));
    if (!judged || empty(row[column])) continue;
    const n = Number(row[column]);
    if (!Number.isFinite(n)) continue;
    if (min !== undefined && n < min) refuse(422, "VALIDATION_FAILED", "Some values were refused.", { fields: { [column]: { code: "too-small", n: min } } });
    if (max !== undefined && n > max) refuse(422, "VALIDATION_FAILED", "Some values were refused.", { fields: { [column]: { code: "too-large", n: max } } });
  }
}

/**
 * Columns Adminium works out (formulas, rollups, balances, numbers): a
 * writer's value for one is not used. A copy is not among them: it is made
 * only while its link names a row (a stage line's rate), and a line with no
 * link keeps the rate its writer gave it.
 */
const WORKED_OUT: Partial<Record<TableRef, Set<string>>> = (() => {
  const out: Partial<Record<TableRef, Set<string>>> = {};
  const add = (table: string, column: string) => (out[table as TableRef] ??= new Set()).add(column);
  for (const f of RULES.formulas) add(f.table, f.column);
  for (const r of RULES.rollups) {
    add(r.table, r.column);
    if (r.balance !== undefined) add(r.table, r.balance.column);
  }
  for (const s of RULES.sequences) add(s.table, s.column);
  for (const f of RULES.formats) add(f.table, f.column);
  return out;
})();

/** A column's fill for a create that leaves it out: a literal, the moment, or nothing. */
function fillOf(ref: TableRef, column: string, now: number): unknown {
  const fill = (COLUMNS[ref] as Record<string, unknown> | undefined)?.[column];
  if (typeof fill === "symbol") return fill.description === "now" ? new Date(now).toISOString() : undefined;
  return fill;
}

/** Whether this write is the moment a stamp is for (Adminium's `stampFires`): the column must be in the write. */
function stampFires(stamp: StampRule, action: "create" | "update", values: Record<string, unknown>, before: Record<string, unknown> | null): boolean {
  const triggers = (Array.isArray(stamp.on) ? stamp.on : [stamp.on]) as unknown[];
  return triggers.some((trigger) => {
    if (trigger === "create") return action === "create";
    const t = trigger as { column: string; values?: unknown[]; filled?: boolean };
    if (!(t.column in values)) return false;
    if (t.filled === true) return !empty(values[t.column]) && (action === "create" || empty(before?.[t.column]));
    if (!(t.values ?? []).some((value) => sameValue(value, values[t.column]))) return false;
    return action === "create" || !sameValue(before?.[t.column], values[t.column]);
  });
}

// ── the store ──────────────────────────────────────────────────────────────

export interface WriteEvent {
  table: TableRef;
  action: "create" | "update";
  before: Row | null;
  after: Row;
  writer: Writer;
}

export interface EngineOptions {
  now: () => number;
  zone: string;
  /** The connection's currency. */
  currency: string;
  /** The add-ons' settings a rule reads, by `<addOn>.<setting>`. */
  settings: () => Readonly<Record<string, unknown>>;
  /** Told of every row a write touched, as the live stream tells the screens. */
  announce: (table: TableRef, kind: "record.create" | "record.update" | "record.delete", id: Id) => void;
  /** A before hook on updates (the outbox's person moves): may change the values, or refuse. */
  before?: (table: TableRef, stored: Row, values: Record<string, unknown>, writer: Writer) => void;
  /** Told of every row created or changed once it is stored: the outbox's producers. */
  after?: (event: WriteEvent) => void;
}

export interface Engine {
  readonly rows: Rows;
  find(ref: TableRef, id: unknown): Row | undefined;
  insert(ref: TableRef, values: Record<string, unknown>, writer: Writer): Row;
  update(ref: TableRef, id: Id, values: Record<string, unknown>, writer: Writer): Row;
  remove(ref: TableRef, id: Id, writer: Writer): void;
  /** Every total worked out again from the rows that feed it. */
  settle(): void;
  /** Replace every row with rows brought in as history (a sample, a hand seed): filled, numbered, settled. */
  load(rows: Partial<Record<TableRef, Record<string, unknown>[]>>): void;
}

export function createEngine(opts: EngineOptions): Engine {
  let rows = Object.fromEntries(TABLE_REFS.map((ref) => [ref, []])) as unknown as Rows;
  const find = (ref: TableRef, id: unknown): Row | undefined =>
    id === null || id === undefined ? undefined : rows[ref]?.find((r) => r.id === id || String(r.id) === String(id));
  const iso = () => new Date(opts.now()).toISOString();
  const setting = (name: string): unknown => (name === "connection.currency" ? opts.currency : opts.settings()[name]);
  const places = (ref: string, column: string, row: Record<string, unknown>) => placesOf(ref, column, row, opts.currency) ?? 2;

  // ── settle: copies, formulas, rollups and the balance, until nothing moves ──
  function settle(): void {
    for (let pass = 0; pass < 12; pass += 1) {
      let moved = false;
      const put = (row: Row, column: string, value: unknown) => {
        if (row[column] === value) return;
        row[column] = value;
        moved = true;
      };
      for (const ref of TABLE_REFS) {
        for (const row of rows[ref]) {
          for (const copy of RULES.copies) {
            if (copy.table !== ref || !copy.always || empty(row[copy.via])) continue;
            const source = find(copy.parent as TableRef, row[copy.via]);
            if (source !== undefined) {
              const value = source[copy.from] ?? null;
              const at = placesOf(ref, copy.column, row, opts.currency);
              put(row, copy.column, at === undefined || value === null ? value : atPlaces(value, at));
            }
          }
          for (const f of FORMULAS.get(ref) ?? []) {
            const at = places(ref, f.column, row);
            const value = workOut(f.expr as Formula, row, at);
            put(row, f.column, value === null ? null : atPlaces(value, at));
          }
        }
        for (const rollup of RULES.rollups) {
          if (rollup.table !== ref) continue;
          for (const row of rows[ref]) {
            const at = places(ref, rollup.column, row);
            let total = 0n;
            for (const child of rows[rollup.child as TableRef] ?? []) {
              if (empty(child[rollup.via]) || String(child[rollup.via]) !== String(row.id)) continue;
              if (rollup.where !== undefined && !sameValue(child[rollup.where.column], rollup.where.eq)) continue;
              total += toUnits(child[rollup.sum], at) ?? 0n;
            }
            put(row, rollup.column, fromUnits(total, at));
            if (rollup.balance !== undefined) {
              const of = toUnits(row[rollup.balance.of], at);
              put(row, rollup.balance.column, of === null ? null : fromUnits(of - total, at));
            }
          }
        }
      }
      if (!moved) return;
    }
    throw new Error("the demo's totals did not settle");
  }

  // ── the states ──

  /** Whether a row is locked now: in a lock state, or pointed at by a row that locks it. */
  function lockedNow(ref: TableRef, row: Row): boolean {
    const rule = STATES[ref];
    if (rule?.lock === undefined) return false;
    const state = String(row[rule.column] ?? rule.initial);
    if (rule.lock.when.includes(state)) return true;
    return (rule.lockedWhenReferencedBy ?? []).some((by) =>
      (rows[by.table as TableRef] ?? []).some(
        (other) => String(other[by.via]) === String(row.id) && by.in.includes(String(other[STATES[by.table as TableRef]?.column ?? "status"])),
      ),
    );
  }

  /**
   * The parents a child row is tied to, before and after — each judged: a locked parent takes no
   * change to its lines (but the one its state releases), and a parent outside `parentIn` takes
   * none at all. `changed` is an update's changed columns, what a release is judged on.
   */
  function judgeParents(ref: TableRef, sides: { now: Row | null; was: Row | null }, writer: Writer, changed?: readonly string[]): { parentRef: TableRef; parent: Row; clear: string[] }[] {
    const out: { parentRef: TableRef; parent: Row; clear: string[] }[] = [];
    for (const [parentRef, rule] of Object.entries(STATES) as [TableRef, StatesRule][]) {
      const child = rule.children?.[ref];
      if (child === undefined) continue;
      const keys = new Set<string>();
      for (const side of [sides.now, sides.was]) if (side !== null && !empty(side[child.via])) keys.add(String(side[child.via]));
      for (const key of keys) {
        const parent = find(parentRef, key);
        if (parent === undefined) continue;
        out.push({ parentRef, parent, clear: child.clearOnCreate ?? [] });
        if (writer.origin === "history") continue;
        const state = parent[rule.column] === null || parent[rule.column] === undefined ? null : String(parent[rule.column]);
        if (child.lock === true && lockedNow(parentRef, parent) && !released(child, state, sides, changed)) {
          refuse(409, "RECORD_LOCKED", `${ref} rows cannot change while their ${parentRef} is ${state ?? "locked"}.`, { table: ref, parent: parentRef, state });
        }
        if (child.parentIn !== undefined && (state === null || !child.parentIn.includes(state))) {
          refuse(409, "RECORD_LOCKED", `${ref} rows can change only while their ${parentRef} is ${child.parentIn.join(" or ")}.`, {
            table: ref,
            parent: parentRef,
            state,
            parentIn: child.parentIn,
          });
        }
      }
    }
    return out;
  }

  /**
   * Whether a change to a locked child is one its parent's state releases: an update, under the
   * same parent, that only EMPTIES columns the release lists. Setting one to a value, changing any
   * other column, moving the row to another parent, creating and deleting stay locked.
   */
  function released(child: NonNullable<StatesRule["children"]>[string], state: string | null, sides: { now: Row | null; was: Row | null }, changed: readonly string[] | undefined): boolean {
    const release = child.release;
    if (release === undefined || state === null || !release.when.includes(state)) return false;
    if (changed === undefined || changed.length === 0 || sides.now === null || sides.was === null) return false;
    if (!sameValue(sides.now[child.via], sides.was[child.via])) return false;
    return changed.every((column) => release.columns.includes(column) && empty(sides.now![column]));
  }

  /**
   * The first column of this row a line linking to it keeps (`lockLinked`) that the update
   * changed, with the linking table — or null. A link keeps unless the line's parent is in a
   * state that releases that link; a line with no parent keeps.
   */
  function linkKept(ref: TableRef, stored: Row, now: Row, changed: readonly string[]): { column: string; by: string } | null {
    for (const [parentRef, rule] of Object.entries(STATES) as [TableRef, StatesRule][]) {
      for (const [childRef, child] of Object.entries(rule.children ?? {})) {
        for (const [link, columns] of Object.entries(child.lockLinked ?? {})) {
          if (DEMO_RULES.references[childRef]?.[link] !== ref) continue;
          // What the write named first, then what its formulas moved.
          const column = changed.find((name) => columns.includes(name)) ?? columns.find((name) => !sameValue(stored[name], now[name]));
          if (column === undefined) continue;
          const holds = (rows[childRef as TableRef] ?? []).some((line) => {
            if (String(line[link]) !== String(stored.id)) return false;
            const parent = empty(line[child.via]) ? undefined : find(parentRef, line[child.via]);
            const state = parent === undefined ? null : String(parent[rule.column] ?? rule.initial);
            return !(state !== null && child.release?.when.includes(state) === true && child.release.columns.includes(link));
          });
          if (holds) return { column, by: childRef };
        }
      }
    }
    return null;
  }

  /** An update of a row that keeps states: the move, then the lock, then the dates that only move later. */
  function judgeOwnUpdate(ref: TableRef, rule: StatesRule, stored: Row, values: Record<string, unknown>, changed: string[], decided: Set<string>, writer: Writer): void {
    const from = String(stored[rule.column] ?? rule.initial);
    if (changed.includes(rule.column)) {
      const to = values[rule.column] === null || values[rule.column] === undefined ? null : String(values[rule.column]);
      const move: Move | undefined = (rule.moves[from] ?? []).find((candidate) => candidate.to === to);
      const no = (message: string, extra: Record<string, unknown> = {}): never =>
        refuse(409, "STATE_MOVE_REFUSED", message, { column: rule.column, from, to, ...extra });
      if (move === undefined) return no(`A ${ref} row cannot go from ${from} to ${String(to)}.`);
      const roles = writer.roles ?? "any";
      if (move.roles !== undefined && roles !== "any" && !move.roles.some((role) => roles.has(role))) {
        no(`Only some roles may move a ${ref} row from ${from} to ${String(to)}.`, { roles: move.roles });
      }
      for (const [child, min] of Object.entries(move.requires?.children ?? {})) {
        const via = rule.children?.[child]?.via;
        if (via === undefined) continue;
        const found = (rows[child as TableRef] ?? []).filter((c) => String(c[via]) === String(stored.id)).length;
        if (found < min) no(`A ${ref} row goes from ${from} to ${String(to)} only with at least ${String(min)} ${child} row(s).`, { requires: child, min });
      }
      const next = { ...stored, ...values } as Row;
      for (const condition of move.requires?.where ?? []) {
        if (!holds(condition, next)) no(`A ${ref} row goes from ${from} to ${String(to)} only when ${condition.column} allows it.`, { requires: condition.column });
      }
    }
    if (lockedNow(ref, stored)) {
      const open = new Set([rule.column, ...(rule.lock?.except ?? []), ...decided]);
      const column = changed.find((name) => !open.has(name));
      if (column !== undefined) refuse(409, "RECORD_LOCKED", `This ${ref} row is ${from}: ${column} can no longer change.`, { column, state: from });
    }
    for (const column of rule.onlyLater ?? []) {
      if (!changed.includes(column)) continue;
      const was = /^\d{4}-\d{2}-\d{2}/.exec(String(stored[column] ?? ""))?.[0] ?? null;
      const next = /^\d{4}-\d{2}-\d{2}/.exec(String(values[column] ?? ""))?.[0] ?? null;
      if (was !== null && (next === null || next < was)) {
        refuse(422, "VALIDATION_FAILED", "Some values were refused.", { fields: { [column]: { code: "out-of-range" } }, reason: "ONLY_LATER" });
      }
    }
  }

  // ── the stamps ──

  function stampValue(stamp: StampRule, writer: Writer, row: Record<string, unknown>): unknown {
    const set = stamp.set;
    const guest = writer.origin === "public";
    const who = writer.origin === "desk" ? (writer.name ?? undefined) : undefined;
    if (typeof set === "string") {
      if (set === "now") return iso();
      if (set === "today") return venueDay(opts.now(), opts.zone);
      return guest ? undefined : who;
    }
    const spec = set as Record<string, unknown>;
    if ("byOrigin" in spec) {
      const by = spec["byOrigin"] as Record<string, unknown>;
      const word = guest ? by["public"] : by["staff"];
      // A time word means what it means on its own: "today" is the studio's day, never the text "today".
      return word === "now" || word === "today" ? stampValue({ ...stamp, set: word }, writer, row) : word;
    }
    if ("copy" in spec) return row[String(spec["copy"])] ?? null;
    if ("claim" in spec) {
      if (guest) return writer.claim?.[String(spec["claim"])] ?? undefined;
      return spec["staff"] === undefined ? undefined : who;
    }
    if ("addDays" in spec) {
      const { date, days, map } = spec["addDays"] as { date: string; days: string | number; map?: Record<string, number> };
      const from = /^\d{4}-\d{2}-\d{2}/.exec(String(row[date] ?? ""))?.[0];
      if (from === undefined) return null;
      const count = typeof days === "number" ? days : map !== undefined ? map[String(row[days])] : Number(row[days]);
      return count === undefined || !Number.isFinite(count) ? undefined : addDays(from, count);
    }
    return undefined;
  }

  /** The stamps a write fires, written into its values (dates worked out from another go last). */
  function stampRow(ref: TableRef, action: "create" | "update", values: Record<string, unknown>, before: Row | null, writer: Writer): void {
    const stamps = (STAMPS[ref] ?? []).filter((stamp) => !isSeal(stamp));
    for (const stamp of [...stamps.filter((s) => !isAddDays(s)), ...stamps.filter(isAddDays)]) {
      if (!stampFires(stamp, action, values, before)) continue;
      const value = stampValue(stamp, writer, { ...(before ?? {}), ...values });
      if (value !== undefined) values[stamp.column] = value;
    }
  }

  /** The seals a write fires: the fingerprint of the row as it is now stored. */
  function seal(ref: TableRef, action: "create" | "update", values: Record<string, unknown>, before: Row | null, row: Row): void {
    for (const stamp of (STAMPS[ref] ?? []).filter(isSeal)) {
      if (!stampFires(stamp, action, values, before)) continue;
      row[stamp.column] = fingerprint(ref, row, (stamp.set as { hashOf: HashOf }).hashOf, {
        rows: (table) => rows[table as TableRef] ?? [],
        kind: (table, column) => DEMO_RULES.kinds[table]?.[column],
        places: (table, column, r) => placesOf(table, column, r, opts.currency),
      });
    }
  }

  /** The columns a write's own rules decide, which a lock never refuses. */
  function decidedBy(ref: TableRef, action: "create" | "update", values: Record<string, unknown>, before: Row | null): Set<string> {
    const out = new Set(WORKED_OUT[ref] ?? []);
    for (const stamp of STAMPS[ref] ?? []) if (stampFires(stamp, action, values, before)) out.add(stamp.column);
    return out;
  }

  // ── numbers, codes, uniques ──

  /** The prefix a numbered table's text starts with: the add-on's setting, else the manifest's own. */
  function prefixOf(format: (typeof RULES.formats)[number]): string {
    const set = format.prefixSetting === null ? undefined : setting(format.prefixSetting);
    return typeof set === "string" ? set : (format.prefix ?? "");
  }

  /** The number a create takes: the largest in its series (and scope) plus one, floored by the add-on's start. */
  function number(ref: TableRef, row: Row, history: boolean): void {
    for (const sequence of RULES.sequences) {
      if (sequence.table !== ref) continue;
      const format = RULES.formats.find((f) => f.table === ref && f.from === sequence.column);
      if (history) {
        // Rows brought in keep their numbers: a text written the table's way is read back into the series.
        if (empty(row[sequence.column]) && format !== undefined && typeof row[format.column] === "string") {
          const prefix = prefixOf(format);
          const text = row[format.column] as string;
          const digits = text.startsWith(prefix) ? text.slice(prefix.length) : "";
          if (/^\d{1,15}$/.test(digits)) row[sequence.column] = Number(digits);
        }
        continue;
      }
      if (!empty(row[sequence.column])) continue;
      const peers = rows[ref].filter((peer) => sequence.scope === null || sameValue(peer[sequence.scope], row[sequence.scope]));
      const gapless = DEMO_RULES.numbered[ref]?.find((n) => n.column === sequence.column);
      const configured = gapless?.startSetting === null || gapless === undefined ? undefined : Number(setting(gapless.startSetting));
      const start = Math.max(1, Number.isInteger(configured) ? configured! : 1);
      row[sequence.column] = Math.max(Math.max(0, ...peers.map((peer) => Number(peer[sequence.column] ?? 0))) + 1, start);
      if (format !== undefined) row[format.column] = `${prefixOf(format)}${String(row[sequence.column]).padStart(format.pad, "0")}`;
    }
  }

  function unique(ref: TableRef, row: Row): void {
    const lower = new Set(DEMO_RULES.normalize[ref] ?? []);
    for (const column of DEMO_RULES.unique[ref] ?? []) {
      if (empty(row[column])) continue;
      const spell = (v: unknown) => (lower.has(column) ? String(v).trim().toLowerCase() : String(v));
      if (rows[ref].some((other) => other.id !== row.id && !empty(other[column]) && spell(other[column]) === spell(row[column]))) {
        refuse(409, "UNIQUE_VIOLATION", `Another ${ref} row already has this ${column}.`, { column });
      }
    }
  }

  function normalise(ref: TableRef, values: Record<string, unknown>): void {
    for (const column of DEMO_RULES.normalize[ref] ?? []) {
      if (typeof values[column] === "string") values[column] = (values[column] as string).trim().toLowerCase();
    }
  }

  // ── the balance cap ──

  const cappedBalances = RULES.rollups.filter((r) => r.balance !== undefined && DEMO_RULES.capped.includes(r.table));
  function balancesNow(): Map<string, bigint | null> {
    const out = new Map<string, bigint | null>();
    for (const rollup of cappedBalances) {
      const column = rollup.balance!.column;
      for (const row of rows[rollup.table as TableRef]) out.set(`${rollup.table}|${String(row.id)}`, toUnits(row[column], places(rollup.table, column, row)));
    }
    return out;
  }
  /** A write may not take a balance below zero, nor further below it. */
  function capHolds(before: Map<string, bigint | null>): void {
    for (const rollup of cappedBalances) {
      const column = rollup.balance!.column;
      for (const row of rows[rollup.table as TableRef]) {
        const at = places(rollup.table, column, row);
        const now = toUnits(row[column], at);
        const was = before.get(`${rollup.table}|${String(row.id)}`) ?? null;
        if (now === null || now >= 0n || (was !== null && now >= was)) continue;
        refuse(409, "BALANCE_EXCEEDED", "That is more than the balance.", { column, balance: was === null ? null : Number(fromUnits(was > 0n ? was : 0n, at)) });
      }
    }
  }

  /** Every row as it was when a write started, to put back when it is refused. */
  function snapshot(): () => void {
    const saved = TABLE_REFS.map((ref) => [ref, rows[ref].map((r) => ({ ...r }))] as const);
    return () => {
      for (const [ref, list] of saved) {
        rows[ref].length = 0;
        rows[ref].push(...(list as Row[]));
      }
    };
  }

  /** A child's write changes its parent's totals: the screens hear of the parent too. */
  function announceParents(ref: TableRef, row: Row): void {
    for (const rollup of RULES.rollups) {
      if (rollup.child !== ref) continue;
      const parent = find(rollup.table as TableRef, row[rollup.via]);
      if (parent !== undefined) opts.announce(rollup.table as TableRef, "record.update", parent.id);
    }
  }

  // ── a create ──

  /** A row's values filled as a create fills them: fills, copies, settings, the first state. */
  function filled(ref: TableRef, given: Record<string, unknown>, history: boolean): Row {
    const values: Record<string, unknown> = { ...given };
    if (!history) for (const column of WORKED_OUT[ref] ?? []) delete values[column];
    const id = history && given["id"] !== undefined ? (given["id"] as Id) : Math.max(0, ...rows[ref].map((r) => Number(r.id))) + 1;
    const row = { id } as Row;
    for (const column of Object.keys((COLUMNS[ref] as Record<string, unknown>) ?? {})) {
      if (column in values) row[column] = values[column];
      else {
        const fill = fillOf(ref, column, opts.now());
        row[column] = fill === undefined ? null : fill;
      }
    }
    for (const [column, value] of Object.entries(values)) if (!(column in row) && column !== "id") row[column] = value;
    for (const copy of RULES.copies) {
      if (copy.table !== ref || empty(row[copy.via])) continue;
      if (!copy.always && !empty(row[copy.column])) continue;
      const source = find(copy.parent as TableRef, row[copy.via]);
      if (source !== undefined && (copy.always || !empty(source[copy.from]))) row[copy.column] = source[copy.from] ?? null;
    }
    for (const fallback of RULES.defaults) {
      if (fallback.table !== ref || !empty(row[fallback.column])) continue;
      const value = setting(fallback.from);
      if (value !== undefined) row[fallback.column] = value;
    }
    const rule = STATES[ref];
    if (rule !== undefined && empty(row[rule.column])) row[rule.column] = rule.initial;
    return row;
  }

  /** A write naming a column the table does not have is refused, as the data API refuses it (a sample brought in is not judged). */
  function knownColumns(ref: TableRef, values: Record<string, unknown>): void {
    const columns = (COLUMNS[ref] as Record<string, unknown> | undefined) ?? {};
    const unknown = Object.keys(values).find((column) => column !== "id" && !(column in columns));
    if (unknown !== undefined) refuse(422, "UNKNOWN_IDENTIFIER", `Unknown column ${JSON.stringify(unknown)} on ${ref}.`, { table: ref, column: unknown });
  }

  function insert(ref: TableRef, given: Record<string, unknown>, writer: Writer): Row {
    const history = writer.origin === "history";
    const undo = snapshot();
    try {
      const values = { ...given };
      delete values["id"];
      if (!history) knownColumns(ref, values);
      normalise(ref, values);
      spellDates(ref, values);
      const rule = STATES[ref];
      if (rule !== undefined && !history && !empty(values[rule.column]) && String(values[rule.column]) !== rule.initial) {
        refuse(409, "STATE_MOVE_REFUSED", `A new ${ref} row starts as ${rule.initial}.`, { column: rule.column, from: null, to: String(values[rule.column]) });
      }
      const row = filled(ref, values, history);
      spellDates(ref, row);
      const parents = judgeParents(ref, { now: row, was: null }, writer);
      if (!history) {
        // A create's stamps read the row as it is filled: its first state is in it.
        const stamped: Record<string, unknown> = { ...row };
        stampRow(ref, "create", stamped, null, writer);
        Object.assign(row, stamped);
        for (const code of DEMO_RULES.codes[ref] ?? []) if (empty(row[code.column])) row[code.column] = drawCode(code.length);
      }
      number(ref, row, history);
      spellDecimals(ref, row, opts.currency);
      unique(ref, row);
      const balances = balancesNow();
      rows[ref].push(row);
      settle();
      if (!history) {
        keepRanges(ref, row, values, "create");
        capHolds(balances);
        seal(ref, "create", { ...row }, null, row);
        // A child recorded empties what its parent says it clears (a payment: "the client says they paid").
        for (const { parentRef, parent, clear } of parents) {
          if (clear.length === 0) continue;
          const before = { ...parent } as Row;
          for (const column of clear) parent[column] = null;
          if (clear.some((column) => !sameValue(before[column], parent[column]))) {
            opts.announce(parentRef, "record.update", parent.id);
            opts.after?.({ table: parentRef, action: "update", before, after: parent, writer: { origin: "system", name: null, roles: "any" } });
          }
        }
      }
      opts.announce(ref, "record.create", row.id);
      announceParents(ref, row);
      if (!history) opts.after?.({ table: ref, action: "create", before: null, after: row, writer });
      return row;
    } catch (error) {
      undo();
      throw error;
    }
  }

  // ── a change ──

  function update(ref: TableRef, id: Id, given: Record<string, unknown>, writer: Writer): Row {
    const row = find(ref, id) ?? refuse(404, "NOT_FOUND", `No ${ref} row ${String(id)}.`);
    const history = writer.origin === "history";
    const undo = snapshot();
    try {
      const stored = { ...row } as Row;
      const values: Record<string, unknown> = { ...given };
      delete values["id"];
      if (!history) knownColumns(ref, values);
      if (!history) for (const column of WORKED_OUT[ref] ?? []) delete values[column];
      normalise(ref, values);
      spellDates(ref, values);
      if (!history) opts.before?.(ref, stored, values, writer);
      const changed = Object.keys(values).filter((column) => !sameValue(values[column], stored[column]));
      if (changed.length === 0) return row;
      if (!history) {
        const decided = decidedBy(ref, "update", values, stored);
        const rule = STATES[ref];
        if (rule !== undefined) judgeOwnUpdate(ref, rule, stored, values, changed, decided, writer);
        judgeParents(ref, { now: { ...stored, ...values } as Row, was: stored }, writer, changed);
        stampRow(ref, "update", values, stored, writer);
      }
      const balances = balancesNow();
      Object.assign(row, values);
      spellDecimals(ref, row, opts.currency);
      unique(ref, row);
      settle();
      if (!history) {
        // Judged once the formulas have moved: a change to their inputs moves what a line billed.
        const kept = linkKept(ref, stored, row, changed);
        if (kept !== null) refuse(409, "RECORD_LOCKED", `This ${ref} row is linked from ${kept.by}: ${kept.column} can no longer change.`, { column: kept.column, linkedFrom: kept.by });
        keepRanges(ref, row, values, "update");
        capHolds(balances);
        seal(ref, "update", values, stored, row);
      }
      opts.announce(ref, "record.update", row.id);
      announceParents(ref, row);
      if (!history) opts.after?.({ table: ref, action: "update", before: stored, after: row, writer });
      return row;
    } catch (error) {
      undo();
      throw error;
    }
  }

  // ── a delete ──

  function remove(ref: TableRef, id: Id, writer: Writer): void {
    const at = rows[ref].findIndex((r) => String(r.id) === String(id));
    if (at === -1) refuse(404, "NOT_FOUND", `No ${ref} row ${String(id)}.`);
    const stored = rows[ref][at]!;
    const rule = STATES[ref];
    if (rule !== undefined && writer.origin !== "history") {
      const state = String(stored[rule.column] ?? rule.initial);
      const when = rule.noDelete?.when;
      const numbered = when === "numbered" && (DEMO_RULES.numbered[ref] ?? []).some((n) => !empty(stored[n.column]));
      if (numbered || (Array.isArray(when) && when.includes(state))) {
        refuse(409, "DELETE_REFUSED", `This ${ref} row cannot be deleted${numbered ? ": it has a number" : ` while it is ${state}`}. Void it instead.`, { state, numbered });
      }
      if (lockedNow(ref, stored)) refuse(409, "DELETE_REFUSED", `This ${ref} row is ${state}, so it cannot be deleted.`, { state, numbered: false });
    }
    judgeParents(ref, { now: null, was: stored }, writer);
    // A row another row points at stays: the database's foreign key refuses the delete
    // (a time entry an invoice line carries, a supplier a purchase names).
    if (writer.origin !== "history") {
      for (const [table, links] of Object.entries(DEMO_RULES.references)) {
        for (const [column, target] of Object.entries(links)) {
          if (target !== ref) continue;
          if (rows[table as TableRef].some((r) => r !== stored && String(r[column]) === String(stored.id))) {
            // Adminium's own refusal, which names the constraint, never a column to write in.
            refuse(409, "FK_VIOLATION", "The change violates a foreign-key constraint.", { constraint: null, detail: `${table}.${column}` });
          }
        }
      }
    }
    rows[ref].splice(at, 1);
    settle();
    opts.announce(ref, "record.delete", stored.id);
    announceParents(ref, stored);
  }

  function load(input: Partial<Record<TableRef, Record<string, unknown>[]>>): void {
    rows = Object.fromEntries(TABLE_REFS.map((ref) => [ref, []])) as unknown as Rows;
    for (const ref of TABLE_REFS) {
      for (const given of input[ref] ?? []) {
        const row = filled(ref, given, true);
        number(ref, row, true);
        spellDecimals(ref, row, opts.currency);
        spellDates(ref, row);
        rows[ref].push(row);
      }
    }
    settle();
  }

  return {
    get rows() {
      return rows;
    },
    find,
    insert,
    update,
    remove,
    settle,
    load,
  };
}

/** A code the server draws at random: letters and digits a person can read out. */
export function drawCode(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}
