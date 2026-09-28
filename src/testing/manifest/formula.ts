/*
 * VENDORED VERBATIM from packages/manifest/src/formula.ts.
 * Never hand-edit this copy: change the monorepo package and re-run
 * `node scripts/sync-manifest-validator.mjs`.
 *
 * WHY A COPY. `@adminium/manifest` is not published to npm and this app is a
 * standalone repo that must build from a clean clone, so it cannot depend on
 * the monorepo. It lives under `testing/` because `zod` is a devDependency
 * here and a runtime dependency the host does not carry — nothing in
 * the shipped bundle's import graph may reach it, which sources.test.ts gates.
 *
 * The only edits are import specifiers: `.js` becomes `.ts`, and the
 * `@adminium/add-on-contracts` package import becomes relative ones.
 */
/**
 * `rules.formula` — a column Adminium works out from the other columns of the
 * same row, on every write: a line's amount, a document's tax and total.
 *
 * ```json
 * { "ref": "amount", "type": "decimal", "scale": "currency",
 *   "rules": { "formula": { "max": [0, { "sub": [{ "mul": ["qty", "rate"] }, { "coalesce": ["discount", 0] }] }] } } }
 * ```
 *
 * The grammar is small on purpose: numbers, the row's own columns, the four
 * operations, `min`, `max`, `round`, `coalesce`, one `if`, the hours
 * between two moments of the row (`hoursBetween`), and the whole calendar
 * days between two dates of it (`daysBetween`: a stay's nights). A text column
 * may join columns and text into one (`join`: a guest's full name), empty
 * parts left out. Anything that
 * reads another row is a `copy` or a `rollup`, which already know how to keep
 * in step when that other row changes; a formula that could read across rows
 * would need the same machinery again.
 *
 * THE ARITHMETIC IS EXACT. Every value becomes a fraction of two big
 * integers, parsed from its decimal text (Postgres and MySQL hand a decimal
 * back as `"12.5000"`, SQLite as the number `12.5`), and nothing goes through
 * a float. Division stays exact; the result is rounded ONCE, half away from
 * zero, to the column's scale. So `1 / 3 × 3` is exactly 1, and a total is the
 * same on all three databases to the last minor unit.
 *
 * An empty column makes the result empty, unless `coalesce` says what to read
 * instead: a draft line with no rate yet has no amount, not an amount of 0
 * that looks like a price. Division by zero is empty too.
 *
 * HOURS ARE THE TIME THAT PASSED. `hoursBetween` reads two moments: one with
 * a zone is that moment; one without is read on this clock — the server's,
 * which is the clock Adminium keeps zone-less times on, and the one the
 * Postgres and MySQL drivers read them back on. So on the night the clocks go
 * forward an hour, 00:30 → 03:30 on the wall is two hours. A stop before its
 * start is empty, not negative: a negative number of hours would quietly take
 * pay off a total.
 *
 * Pure: a browser (an app's demo) evaluates the same formula the server does.
 */
import { z } from 'zod';

import { NUMERIC_TYPES, type ColumnShape, type ReferenceIssue } from './refs.ts';

/** A snake_case column of the same row. */
const columnName = z.string().regex(/^[a-z][a-z0-9_]*$/, 'a column of the same row');

export type FormulaExpr =
  | number
  | string
  | { add: FormulaExpr[] }
  | { sub: [FormulaExpr, FormulaExpr] }
  | { mul: FormulaExpr[] }
  | { div: [FormulaExpr, FormulaExpr] }
  | { min: FormulaExpr[] }
  | { max: FormulaExpr[] }
  | { round: FormulaExpr | [FormulaExpr, number] }
  | { coalesce: [FormulaExpr, FormulaExpr] }
  | { if: [FormulaCondition, FormulaExpr, FormulaExpr] }
  | { hoursBetween: [string, string] }
  | { daysBetween: [string, string] }
  | { join: string[] };

export type FormulaCondition =
  | { eq: [string, string | number | boolean] }
  | { neq: [string, string | number | boolean] }
  | { gt: [FormulaExpr, FormulaExpr] }
  | { gte: [FormulaExpr, FormulaExpr] }
  | { lt: [FormulaExpr, FormulaExpr] }
  | { lte: [FormulaExpr, FormulaExpr] }
  | { isNull: string }
  | { and: FormulaCondition[] }
  | { or: FormulaCondition[] };

const literal = z.union([z.string().max(256), z.number().finite(), z.boolean()]);

export const formulaExprSchema: z.ZodType<FormulaExpr> = z.lazy(() =>
  z.union([
    z.number().finite(),
    columnName,
    z.object({ add: z.array(formulaExprSchema).min(2).max(8) }).strict(),
    z.object({ sub: z.tuple([formulaExprSchema, formulaExprSchema]) }).strict(),
    z.object({ mul: z.array(formulaExprSchema).min(2).max(8) }).strict(),
    z.object({ div: z.tuple([formulaExprSchema, formulaExprSchema]) }).strict(),
    z.object({ min: z.array(formulaExprSchema).min(2).max(8) }).strict(),
    z.object({ max: z.array(formulaExprSchema).min(2).max(8) }).strict(),
    z
      .object({ round: z.union([formulaExprSchema, z.tuple([formulaExprSchema, z.number().int().min(0).max(4)])]) })
      .strict(),
    z.object({ coalesce: z.tuple([formulaExprSchema, formulaExprSchema]) }).strict(),
    z.object({ if: z.tuple([formulaConditionSchema, formulaExprSchema, formulaExprSchema]) }).strict(),
    z.object({ hoursBetween: z.tuple([columnName, columnName]) }).strict(),
    z.object({ daysBetween: z.tuple([columnName, columnName]) }).strict(),
    z.object({ join: z.array(z.string().min(1).max(64)).min(2).max(8) }).strict(),
  ]),
);

/** Whether a part of a `join` names a column of the row; any other part is text written as it is. */
export function isJoinColumn(part: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(part);
}

export const formulaConditionSchema: z.ZodType<FormulaCondition> = z.lazy(() =>
  z.union([
    z.object({ eq: z.tuple([columnName, literal]) }).strict(),
    z.object({ neq: z.tuple([columnName, literal]) }).strict(),
    z.object({ gt: z.tuple([formulaExprSchema, formulaExprSchema]) }).strict(),
    z.object({ gte: z.tuple([formulaExprSchema, formulaExprSchema]) }).strict(),
    z.object({ lt: z.tuple([formulaExprSchema, formulaExprSchema]) }).strict(),
    z.object({ lte: z.tuple([formulaExprSchema, formulaExprSchema]) }).strict(),
    z.object({ isNull: columnName }).strict(),
    z.object({ and: z.array(formulaConditionSchema).min(2).max(8) }).strict(),
    z.object({ or: z.array(formulaConditionSchema).min(2).max(8) }).strict(),
  ]),
);

/** How deep a formula may nest: deeper is a formula nobody can read back. */
export const FORMULA_MAX_DEPTH = 8;

/** Every column a formula reads, in the order it first names them. */
export function formulaColumns(expr: FormulaExpr | FormulaCondition): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      if (!out.includes(node)) out.push(node);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const [op, args] = Object.entries(node)[0] as [string, unknown];
    if (op === 'eq' || op === 'neq') {
      walk((args as unknown[])[0]);
      return;
    }
    if (op === 'join') {
      (args as string[]).filter(isJoinColumn).forEach(walk);
      return;
    }
    if (op === 'isNull') {
      walk(args);
      return;
    }
    if (Array.isArray(args)) args.forEach(walk);
    else walk(args);
  };
  walk(expr);
  return out;
}

function depthOf(node: unknown): number {
  if (typeof node !== 'object' || node === null) return 0;
  const args = Object.values(node)[0];
  const children = Array.isArray(args) ? args : [args];
  return 1 + Math.max(0, ...children.map(depthOf));
}

/**
 * What is wrong with one column's formula against its table: a column it
 * names that the table lacks, a column used in arithmetic that holds no
 * number, a formula deeper than {@link FORMULA_MAX_DEPTH}, one that reads
 * itself. Cycles across a table's formulas are {@link formulaCycle}'s.
 */
export function formulaIssues(
  expr: FormulaExpr,
  own: string,
  column: (ref: string) => ColumnShape | undefined,
): string[] {
  const out: string[] = [];
  if (depthOf(expr) > FORMULA_MAX_DEPTH) out.push(`a formula nests at most ${String(FORMULA_MAX_DEPTH)} deep`);
  // A column compared with `eq` may be any type (an enum, a bool); one that
  // takes part in arithmetic or an ordering must hold a number, and one
  // hours are counted from, a moment.
  const arithmetic = arithmeticColumns(expr);
  const moments = momentColumns(expr);
  for (const [start, stop] of moments.pairs) {
    if (start === stop) out.push('hours are counted between two different columns');
  }
  // A join makes text: it is the whole formula, never a part of a sum.
  if (typeof expr === 'object' && !('join' in expr) && joinsInside(expr)) {
    out.push('a join is the whole formula, not a part of one');
  }
  const days = dayColumns(expr);
  for (const [start, stop] of days.pairs) {
    if (start === stop) out.push('days are counted between two different columns');
  }
  const joined = typeof expr === 'object' && 'join' in expr ? expr.join.filter(isJoinColumn) : [];
  for (const name of formulaColumns(expr)) {
    if (name === own) {
      out.push(`a formula does not read its own column "${name}"`);
      continue;
    }
    const found = column(name);
    if (found === undefined) {
      out.push(`the table has no column "${name}"`);
      continue;
    }
    if (joined.includes(name) && !JOIN_COLUMN_TYPES.includes(found.type)) {
      out.push(`"${name}" is a ${found.type} column: a join reads text and whole-number columns only`);
    }
    if (arithmetic.has(name) && !NUMERIC_TYPES.includes(found.type)) {
      out.push(`"${name}" is not a number, so a formula cannot count with it`);
    }
    if (moments.columns.has(name) && found.type !== 'timestamptz') {
      out.push(`"${name}" is not a moment (a timestamptz column), so no hours are counted from it`);
    }
    if (days.columns.has(name) && found.type !== 'date') {
      out.push(`"${name}" is not a date (a date column), so no days are counted from it`);
    }
  }
  return out;
}

/** The columns `hoursBetween` reads, and each pair it reads them in. */
export function momentColumns(expr: unknown): { columns: Set<string>; pairs: [string, string][] } {
  const columns = new Set<string>();
  const pairs: [string, string][] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const [op, args] = Object.entries(node)[0] as [string, unknown];
    if (op === 'hoursBetween') {
      const [start, stop] = args as [string, string];
      columns.add(start);
      columns.add(stop);
      pairs.push([start, stop]);
      return;
    }
    const children = Array.isArray(args) ? args : [args];
    children.forEach(walk);
  };
  walk(expr);
  return { columns, pairs };
}

/** Whether a `join` appears anywhere in a formula. */
function joinsInside(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const [op, args] = Object.entries(node)[0] as [string, unknown];
  if (op === 'join') return true;
  return (Array.isArray(args) ? args : [args]).some(joinsInside);
}

/**
 * The columns `daysBetween` reads, and each pair it reads them in: whole
 * calendar days from the first date to the second (a stay's nights).
 */
export function dayColumns(expr: unknown): { columns: Set<string>; pairs: [string, string][] } {
  const columns = new Set<string>();
  const pairs: [string, string][] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const [op, args] = Object.entries(node)[0] as [string, unknown];
    if (op === 'daysBetween') {
      const [start, stop] = args as [string, string];
      columns.add(start);
      columns.add(stop);
      pairs.push([start, stop]);
      return;
    }
    const children = Array.isArray(args) ? args : [args];
    children.forEach(walk);
  };
  walk(expr);
  return { columns, pairs };
}

/** The columns a formula counts with (every name outside `eq`, `neq`, `isNull`, `hoursBetween` and `daysBetween`). */
function arithmeticColumns(expr: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      out.add(node);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const [op, args] = Object.entries(node)[0] as [string, unknown];
    if (op === 'eq' || op === 'neq' || op === 'isNull' || op === 'hoursBetween' || op === 'daysBetween' || op === 'join') return;
    const children = Array.isArray(args) ? args : [args];
    children.forEach(walk);
  };
  walk(expr);
  return out;
}

/**
 * The first cycle among a table's formula columns (`total` reads `tax`, which
 * reads `total`), as the columns in order, or `null`. A cycle has no value to
 * settle on, so it is refused before it is ever stored.
 */
export function formulaCycle(formulas: ReadonlyMap<string, FormulaExpr>): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];
  const visit = (name: string): string[] | null => {
    const mark = state.get(name);
    if (mark === 'done') return null;
    if (mark === 'visiting') return [...path.slice(path.indexOf(name)), name];
    state.set(name, 'visiting');
    path.push(name);
    for (const next of formulaColumns(formulas.get(name)!)) {
      if (!formulas.has(next)) continue;
      const found = visit(next);
      if (found !== null) return found;
    }
    path.pop();
    state.set(name, 'done');
    return null;
  };
  for (const name of formulas.keys()) {
    const found = visit(name);
    if (found !== null) return found;
  }
  return null;
}

/**
 * A table's formula columns in the order they can be worked out: each after
 * every formula column it reads. Assumes no cycle (checked at validation).
 */
export function formulaOrder(formulas: ReadonlyMap<string, FormulaExpr>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const next of formulaColumns(formulas.get(name)!)) if (formulas.has(next)) visit(next);
    out.push(name);
  };
  for (const name of formulas.keys()) visit(name);
  return out;
}

// ── exact evaluation ───────────────────────────────────────────────────────

/** A fraction of two big integers; `d` is always positive. */
interface Ratio {
  n: bigint;
  d: bigint;
}

const DECIMAL_TEXT = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
}

function ratio(n: bigint, d: bigint): Ratio {
  if (d < 0n) return ratio(-n, -d);
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

/**
 * A stored value as an exact fraction: the decimal text of a number (never a
 * float product), a decimal string as a driver returns it, a bigint, or a
 * boolean (1 / 0, as MySQL and SQLite store one). `null` for an empty value or
 * text that is not a number.
 */
export function toRatio(value: unknown): Ratio | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return { n: value, d: 1n };
  if (typeof value === 'boolean') return { n: value ? 1n : 0n, d: 1n };
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return null;
  }
  const match = DECIMAL_TEXT.exec(text);
  if (match === null) return null;
  const [, sign = '', whole = '', fraction = '', exponent = '0'] = match;
  if (whole === '' && fraction === '') return null;
  let n = BigInt(`${whole}${fraction}` === '' ? '0' : `${whole}${fraction}`);
  let d = 10n ** BigInt(fraction.length);
  const e = Number.parseInt(exponent, 10);
  if (e > 0) n *= 10n ** BigInt(e);
  else if (e < 0) d *= 10n ** BigInt(-e);
  return ratio(sign === '-' ? -n : n, d);
}

const add = (a: Ratio, b: Ratio) => ratio(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Ratio, b: Ratio) => ratio(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Ratio, b: Ratio) => ratio(a.n * b.n, a.d * b.d);
const cmp = (a: Ratio, b: Ratio) => {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
};

/** Round half away from zero to `scale` places. */
function roundTo(value: Ratio, scale: number): Ratio {
  const factor = 10n ** BigInt(scale);
  const scaled = value.n * factor;
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  let q = magnitude / value.d;
  const r = magnitude % value.d;
  if (r * 2n >= value.d) q += 1n;
  return ratio(negative ? -q : q, factor);
}

/** A fraction as decimal text with exactly `scale` places (`12.50`, `-3`, `0.125`). */
export function ratioText(value: Ratio, scale: number): string {
  const rounded = roundTo(value, scale);
  const factor = 10n ** BigInt(scale);
  const units = (rounded.n * factor) / rounded.d;
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = scale === 0 ? digits : digits.slice(0, -scale);
  const fraction = scale === 0 ? '' : `.${digits.slice(-scale)}`;
  return `${negative && units !== 0n ? '-' : ''}${whole}${fraction}`;
}

/**
 * What a total over child rows comes to, exactly: each row's `sum` (times its
 * `times`) added up as fractions and rounded once to `places`, or the rows
 * counted. A row whose value is empty or not a number adds nothing, as SQL's
 * `sum` leaves it out. SQLite adds decimals as floats, where 1.500 × 0.33 is
 * a hair under 0.495 and rounds to 0.49; this answers 0.50, as Postgres and
 * MySQL do.
 */
export function rollupValue(
  rows: readonly Readonly<Record<string, unknown>>[],
  spec: { sum?: string | undefined; times?: string | undefined; count?: true | undefined },
  places: number,
): string {
  if (spec.count === true) return String(rows.length);
  let total: Ratio = { n: 0n, d: 1n };
  for (const row of rows) {
    const amount = spec.sum === undefined ? null : toRatio(row[spec.sum]);
    if (amount === null) continue;
    if (spec.times === undefined) {
      total = add(total, amount);
      continue;
    }
    const times = toRatio(row[spec.times]);
    if (times !== null) total = add(total, mul(amount, times));
  }
  return ratioText(total, places);
}

/** Whether two decimals are the same number at `places` (`90` and `"90.00"` are; `"89.999"` at 2 is `"90.00"`). */
export function sameDecimal(a: unknown, b: unknown, places: number): boolean {
  const left = toRatio(a);
  const right = toRatio(b);
  if (left === null || right === null) return left === right;
  return ratioText(left, places) === ratioText(right, places);
}

function sameValue(stored: unknown, literal: string | number | boolean): boolean {
  if (stored === null || stored === undefined) return false;
  if (typeof literal === 'boolean') {
    return stored === literal || stored === (literal ? 1 : 0) || stored === (literal ? '1' : '0') || stored === String(literal);
  }
  if (typeof literal === 'number') {
    const a = toRatio(stored);
    const b = toRatio(literal);
    return a !== null && b !== null && cmp(a, b) === 0;
  }
  return String(stored) === literal;
}

/**
 * Work a formula out over a row, exactly: the result as decimal text at
 * `scale` places, or `null` when an input it needs is empty or a divisor is
 * zero. `row` holds the stored row with the new values over it.
 */
export function evaluateFormula(expr: FormulaExpr, row: Readonly<Record<string, unknown>>, scale: number): string | null {
  if (typeof expr === 'object' && 'join' in expr) return joinText(expr.join, row);
  const value = evaluate(expr, row, scale);
  return value === null ? null : ratioText(value, scale);
}

function evaluate(expr: FormulaExpr, row: Readonly<Record<string, unknown>>, scale: number): Ratio | null {
  if (typeof expr === 'number') return toRatio(expr);
  if (typeof expr === 'string') return toRatio(row[expr]);
  const [op, args] = Object.entries(expr)[0] as [string, unknown];
  const all = (list: FormulaExpr[]): Ratio[] | null => {
    const out: Ratio[] = [];
    for (const item of list) {
      const v = evaluate(item, row, scale);
      if (v === null) return null;
      out.push(v);
    }
    return out;
  };
  switch (op) {
    case 'add':
    case 'mul':
    case 'min':
    case 'max': {
      const values = all(args as FormulaExpr[]);
      if (values === null) return null;
      return values.reduce((a, b) =>
        op === 'add' ? add(a, b) : op === 'mul' ? mul(a, b) : op === 'min' ? (cmp(a, b) <= 0 ? a : b) : cmp(a, b) >= 0 ? a : b,
      );
    }
    case 'sub': {
      const values = all(args as FormulaExpr[]);
      return values === null ? null : sub(values[0]!, values[1]!);
    }
    case 'div': {
      const values = all(args as FormulaExpr[]);
      if (values === null || values[1]!.n === 0n) return null;
      return ratio(values[0]!.n * values[1]!.d, values[0]!.d * values[1]!.n);
    }
    case 'round': {
      const [inner, places] = Array.isArray(args) ? (args as [FormulaExpr, number]) : [args as FormulaExpr, scale];
      const v = evaluate(inner, row, scale);
      return v === null ? null : roundTo(v, places);
    }
    case 'coalesce': {
      const [first, second] = args as [FormulaExpr, FormulaExpr];
      return evaluate(first, row, scale) ?? evaluate(second, row, scale);
    }
    case 'if': {
      const [condition, then, otherwise] = args as [FormulaCondition, FormulaExpr, FormulaExpr];
      return evaluate(holds(condition, row, scale) ? then : otherwise, row, scale);
    }
    case 'hoursBetween': {
      const [start, stop] = (args as [string, string]).map((column) => momentOf(row[column]));
      if (start === null || start === undefined || stop === null || stop === undefined || stop < start) return null;
      return ratio(BigInt(stop - start), MS_PER_HOUR);
    }
    case 'daysBetween': {
      const [start, stop] = (args as [string, string]).map((column) => dayNumberOf(row[column]));
      if (start === null || start === undefined || stop === null || stop === undefined || stop < start) return null;
      return { n: BigInt(stop - start), d: 1n };
    }
    default:
      return null;
  }
}

const MS_PER_HOUR = 3_600_000n;

/**
 * A time as the drivers and a form spell one — `2026-09-25 09:15:00`,
 * `2026-09-25T09:15` — and its zone when it has one: `Z`, `+02:00`, `+0200`
 * or `+02`, straight after the time or after a space
 * (`2026-09-25 09:15:00 +02:00`).
 */
const TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?: ?(Z|[+-]\d{2}(?::?\d{2})?))?$/i;

/** Whether the parts name a day and a time the calendar has: no 30 February, no 25 o'clock. */
function onTheCalendar(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/**
 * A stored moment as milliseconds since the epoch, or `null` when it is empty
 * or not a time: a `Date` as a driver hands one back; a number as the seconds
 * since 1970 SQLite's `unixepoch()` fills a column with; a zoned text as the
 * moment it names, and a zone-less one on this clock (see the header). A day
 * or an hour the calendar does not have (30 February) is no time, not the one
 * it would roll over to.
 */
export function momentOf(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) : null;
  if (typeof value === 'bigint') return Number(value) * 1000;
  if (typeof value !== 'string') return null;
  const found = TIME.exec(value.trim());
  if (found === null) return null;
  const [y, mo, d, h, mi, s] = found.slice(1, 7).map((part) => Number(part ?? 0)) as [number, number, number, number, number, number];
  if (!onTheCalendar(y, mo, d, h, mi, s)) return null;
  const ms = Number((found[7] ?? '').slice(0, 3).padEnd(3, '0'));
  const zone = found[8];
  if (zone === undefined) return new Date(y, mo - 1, d, h, mi, s, ms).getTime();
  const [, sign, hours, minutes] = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone) ?? [];
  const offset = sign === undefined ? 0 : (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes ?? 0));
  return Date.UTC(y, mo - 1, d, h, mi, s, ms) - offset * 60_000;
}

/** A date as the drivers and a form spell one: `2026-08-03`, optionally followed by a time. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/;

/**
 * A stored date as a day number (days since 1970-01-01 on the calendar), or
 * `null` when it is empty or not a day the calendar has. Text is read as the
 * calendar day it spells, whatever the zone; a `Date` (how a driver hands a
 * DATE back) as the day it falls on on this clock, since the drivers make it
 * at local midnight. The count is of calendar days, so a night the clocks
 * change is still one night.
 */
export function dayNumberOf(value: unknown): number | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000;
  }
  if (typeof value !== 'string') return null;
  const found = DAY.exec(value.trim());
  if (found === null) return null;
  const [y, mo, d] = found.slice(1, 4).map(Number) as [number, number, number];
  if (!onTheCalendar(y, mo, d, 0, 0, 0)) return null;
  return Date.UTC(y, mo - 1, d) / 86_400_000;
}

// ── a text joined from columns ─────────────────────────────────────────────

/**
 * The column types a join reads: text, and whole numbers. A decimal
 * (`8.250` on one database, `8.25` on another), a yes or no (`true`, `1`) or
 * a time (on the server's clock) would join differently on each engine.
 */
export const JOIN_COLUMN_TYPES: readonly string[] = ['text', 'int', 'bigint'];

/** A value as a joined text spells it: text trimmed, a whole number as its digits; anything else adds nothing. */
function joinedPart(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return '';
}

/**
 * A `join` worked out: its columns' values and its text, in order. An empty
 * column is left out, and so is the text between it and its neighbour (a
 * guest with no last name is "Mia", not "Mia "); text before the first
 * column or after the last stays while that column has a value. The result
 * is trimmed, and empty when every column is.
 */
export function joinText(parts: readonly string[], row: Readonly<Record<string, unknown>>): string | null {
  const columns = parts.map((part) => isJoinColumn(part));
  const filled = parts.map((part, i) => (columns[i] ? joinedPart(row[part]) !== '' : true));
  let out = '';
  let any = false;
  parts.forEach((part, i) => {
    if (columns[i]) {
      if (!filled[i]) return;
      out += joinedPart(row[part]);
      any = true;
      return;
    }
    // Text sits between the nearest columns on each side: kept only while both (that there are) have a value.
    let left = i - 1;
    while (left >= 0 && !columns[left]) left -= 1;
    let right = i + 1;
    while (right < parts.length && !columns[right]) right += 1;
    const leftOk = left < 0 || filled[left];
    const rightOk = right >= parts.length || filled[right];
    if (leftOk && rightOk) out += part;
  });
  const text = out.trim();
  return any && text !== '' ? text : null;
}

// ── prices by the night ────────────────────────────────────────────────────

/** The most nights one stay is priced for: two years. A longer one is refused, not priced. */
export const PER_NIGHT_MAX = 731;

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * A weekdays value (`fri,sat`, `Fri Sat`) as the nights it names, 0 being
 * Sunday: an empty set for an empty value (every night), or `null` when any
 * word in it is not a day's three letters.
 */
export function weekdaysOf(value: unknown): Set<number> | null {
  if (value === null || value === undefined) return new Set();
  if (typeof value !== 'string') return null;
  const out = new Set<number>();
  for (const word of value.toLowerCase().split(/[\s,]+/)) {
    if (word === '') continue;
    const day = (WEEKDAYS as readonly string[]).indexOf(word);
    if (day < 0) return null;
    out.add(day);
  }
  return out;
}

/** One adjustment row as a price by the night reads it. */
export interface NightlyAdjustment {
  /** Added to the night (negative: a discount). */
  add: unknown;
  /** Its name: the night's tag. */
  name: string;
  /** Whether it is for this row's rate (its link empty, or the same row). */
  typeMatch: boolean;
  weekdays: unknown;
  /** The first and the last night it applies on, both included; empty = open. */
  from: unknown;
  to: unknown;
}

/** One night of a stay: its date, its rate (rounded), the base it started from, and the adjustments' names. */
export interface Night {
  date: string;
  rate: string;
  base: string;
  tags: string[];
}

/** An adjustment row a price cannot read (its weekdays, dates or amount): the price is refused, never guessed. */
export class NightlyRuleUnreadable extends Error {
  override readonly name = 'NightlyRuleUnreadable';

  constructor(
    /** Its place in the adjustments given. */
    readonly index: number,
    /** The column that could not be read: `weekdays`, `from`, `to` or `add`. */
    readonly column: 'weekdays' | 'from' | 'to' | 'add',
  ) {
    super(`An adjustment's ${column} cannot be read.`);
  }
}

/** The day number as `YYYY-MM-DD`. */
function dayText(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The nights from `from` up to the day before `to`, each priced at the base
 * rate plus every adjustment that applies to it — its rate, its day of the
 * week, its dates, both ends included — and rounded once, to `scale`; the
 * total is the rounded nights added up, so a folio's lines add up to it.
 * Days are calendar days (`dayNumberOf`): a night the clocks change is one
 * night, whatever the zone. `null` when a date or the base is empty, the stay
 * is no night long, or longer than {@link PER_NIGHT_MAX}. Throws
 * {@link NightlyRuleUnreadable} for an adjustment of this rate it cannot read.
 */
export function nightlyRates(input: {
  from: unknown;
  to: unknown;
  base: unknown;
  scale: number;
  adjustments: readonly NightlyAdjustment[];
}): { nights: Night[]; total: string } | null {
  const from = dayNumberOf(input.from);
  const to = dayNumberOf(input.to);
  const base = toRatio(input.base);
  if (from === null || to === null || base === null || to <= from || to - from > PER_NIGHT_MAX) return null;
  const rules = input.adjustments.flatMap((adjustment, index) => {
    if (!adjustment.typeMatch) return [];
    const weekdays = weekdaysOf(adjustment.weekdays);
    if (weekdays === null) throw new NightlyRuleUnreadable(index, 'weekdays');
    const first = empty(adjustment.from) ? null : dayNumberOf(adjustment.from);
    if (!empty(adjustment.from) && first === null) throw new NightlyRuleUnreadable(index, 'from');
    const last = empty(adjustment.to) ? null : dayNumberOf(adjustment.to);
    if (!empty(adjustment.to) && last === null) throw new NightlyRuleUnreadable(index, 'to');
    const add = empty(adjustment.add) ? { n: 0n, d: 1n } : toRatio(adjustment.add);
    if (add === null) throw new NightlyRuleUnreadable(index, 'add');
    return [{ weekdays, first, last, add, name: adjustment.name }];
  });
  const nights: Night[] = [];
  let total: Ratio = { n: 0n, d: 1n };
  for (let day = from; day < to; day += 1) {
    const weekday = new Date(day * 86_400_000).getUTCDay();
    let rate = base;
    const tags: string[] = [];
    for (const rule of rules) {
      if (rule.weekdays.size > 0 && !rule.weekdays.has(weekday)) continue;
      if (rule.first !== null && day < rule.first) continue;
      if (rule.last !== null && day > rule.last) continue;
      rate = add(rate, rule.add);
      tags.push(rule.name);
    }
    const rounded = roundTo(rate, input.scale);
    total = add(total, rounded);
    nights.push({ date: dayText(day), rate: ratioText(rounded, input.scale), base: ratioText(base, input.scale), tags });
  }
  return { nights, total: ratioText(total, input.scale) };
}

function empty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/** Whether a condition holds for the row; a comparison with an empty side does not. */
export function holds(condition: FormulaCondition, row: Readonly<Record<string, unknown>>, scale: number): boolean {
  const [op, args] = Object.entries(condition)[0] as [string, unknown];
  switch (op) {
    case 'eq': {
      const [column, value] = args as [string, string | number | boolean];
      return sameValue(row[column], value);
    }
    case 'neq': {
      const [column, value] = args as [string, string | number | boolean];
      return row[column] !== null && row[column] !== undefined && !sameValue(row[column], value);
    }
    case 'isNull': {
      const stored = row[args as string];
      return stored === null || stored === undefined || stored === '';
    }
    case 'and':
      return (args as FormulaCondition[]).every((c) => holds(c, row, scale));
    case 'or':
      return (args as FormulaCondition[]).some((c) => holds(c, row, scale));
    default: {
      const [left, right] = (args as [FormulaExpr, FormulaExpr]).map((side) => evaluate(side, row, scale));
      if (left === null || left === undefined || right === null || right === undefined) return false;
      const order = cmp(left, right);
      return op === 'gt' ? order > 0 : op === 'gte' ? order >= 0 : op === 'lt' ? order < 0 : order <= 0;
    }
  }
}

/** The decimals a currency is written with (ISO 4217): JPY 0, most 2, KWD 3. Unknown → 2. */
export function currencyScale(code: string | null | undefined): number {
  if (typeof code !== 'string' || !/^[A-Za-z]{3}$/.test(code)) return 2;
  const upper = code.toUpperCase();
  if (ZERO_DECIMAL.has(upper)) return 0;
  if (THREE_DECIMAL.has(upper)) return 3;
  return 2;
}

const ZERO_DECIMAL: ReadonlySet<string> = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_DECIMAL: ReadonlySet<string> = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** For the checks in `schema.ts`: every issue of a table's formulas, cycles included. */
export function tableFormulaIssues(
  columns: readonly (ColumnShape & { rules?: { formula?: FormulaExpr | undefined } | undefined })[],
  at: (column: number, ...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const byRef = new Map(columns.map((c) => [c.ref, c]));
  const formulas = new Map<string, FormulaExpr>();
  columns.forEach((column, c) => {
    const formula = column.rules?.formula;
    if (formula === undefined) return;
    formulas.set(column.ref, formula);
    const joins = typeof formula === 'object' && 'join' in formula;
    if (joins && column.type !== 'text') {
      out.push({ path: at(c, 'rules', 'formula'), message: 'a join fills a text column' });
    } else if (!joins && (!NUMERIC_TYPES.includes(column.type) || column.type === 'float')) {
      out.push({ path: at(c, 'rules', 'formula'), message: 'a formula fills a decimal, money or whole-number column' });
    }
    for (const message of formulaIssues(formula, column.ref, (ref) => byRef.get(ref))) {
      out.push({ path: at(c, 'rules', 'formula'), message });
    }
  });
  const cycle = formulaCycle(formulas);
  if (cycle !== null) {
    const first = columns.findIndex((c) => c.ref === cycle[0]);
    out.push({ path: at(first, 'rules', 'formula'), message: `formulas read each other in a circle: ${cycle.join(' → ')}` });
  }
  return out;
}
