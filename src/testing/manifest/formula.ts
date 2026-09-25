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
 * operations, `min`, `max`, `round`, `coalesce` and one `if`. Anything that
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
  | { if: [FormulaCondition, FormulaExpr, FormulaExpr] };

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
  ]),
);

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
  // takes part in arithmetic or an ordering must hold a number.
  const arithmetic = arithmeticColumns(expr);
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
    if (arithmetic.has(name) && !NUMERIC_TYPES.includes(found.type)) {
      out.push(`"${name}" is not a number, so a formula cannot count with it`);
    }
  }
  return out;
}

/** The columns a formula counts with (every name outside `eq`, `neq` and `isNull`). */
function arithmeticColumns(expr: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      out.add(node);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const [op, args] = Object.entries(node)[0] as [string, unknown];
    if (op === 'eq' || op === 'neq' || op === 'isNull') return;
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
    default:
      return null;
  }
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
    if (!NUMERIC_TYPES.includes(column.type) || column.type === 'float') {
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
