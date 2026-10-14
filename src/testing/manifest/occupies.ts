/*
 * VENDORED VERBATIM from packages/manifest/src/occupies.ts.
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
 * `table.occupies` — a row takes a resource for a time: a room for an hour,
 * a van for a morning, a crew for a day. The plain rule beside `booking`.
 *
 * `booking` books people for kinds of visit, with who does what, a grid of
 * start times, a practice's hours and a window. This asks one thing or two:
 *
 *  - no two counted rows of one resource overlap (left out with `shared`:
 *    a crew does several jobs a day);
 *  - with `hours`, the resource has hours that weekday, and a timed row lies
 *    inside them. A resource with no row for a weekday does not work it;
 *    one with no rows at all keeps no week and is held to none.
 *
 * The time is a start with its minutes or its end, or a whole `day`. A row
 * with no resource, or no time yet, takes nothing and is not judged.
 *
 * A `day` with `until` is a span of whole days, both ends counted: a cover
 * from the 10th until the 14th and one from the 14th on overlap. An empty
 * `until` is a span with no end ("until further notice"). A span is judged
 * for overlap alone, so it has no `hours` and is never `shared`.
 *
 * Every table the rule names sits under a key called `table`, so the
 * installer maps it to the real table.
 */
import { z } from 'zod';

import { BOOKING_WEEKDAYS } from './booking.ts';
import { refSchema, valueFits, type ColumnShape, type ReferenceIssue, type TableIndex, type TableShape } from './refs.ts';

export const occupiesSchema = z
  .object({
    /** What is taken: a link to the resource's row, or any column that names it. */
    resource: refSchema,
    /** When the row starts: a `timestamptz`, read in the venue's zone. With `minutes` or `end`. */
    start: refSchema.optional(),
    /** How long it lasts: an int column of the row. */
    minutes: refSchema.optional(),
    /** When it ends: a `timestamptz` of the row. */
    end: refSchema.optional(),
    /** Or the whole day it takes: a `date`. */
    day: refSchema.optional(),
    /** With `day`: the last day it takes, a `date` (counted too). Empty in a row: it has no end. */
    until: refSchema.optional(),
    /** Only rows whose column holds one of these take the resource (a cancelled booking takes nothing). */
    countWhere: z.object({ column: refSchema, values: z.array(z.string().min(1)).min(1) }).strict().optional(),
    /** Rows may share the resource's time: only its hours are judged. */
    shared: z.literal(true).optional(),
    /** The resource's week: one row per weekday it works, with `HH:MM` texts when the day has an opening and a closing time. */
    hours: z.object({ table: refSchema, resource: refSchema, weekday: refSchema, opens: refSchema.optional(), closes: refSchema.optional() }).strict().optional(),
  })
  .strict()
  .refine((rule) => (rule.start === undefined) !== (rule.day === undefined), { message: 'the time is a `start` or a whole `day`, one of the two' })
  .refine((rule) => rule.start === undefined || (rule.minutes === undefined) !== (rule.end === undefined), { message: 'a `start` comes with its `minutes` or its `end`, one of the two' })
  .refine((rule) => rule.day === undefined || (rule.minutes === undefined && rule.end === undefined), { message: 'a whole `day` takes no `minutes` and no `end`' })
  .refine((rule) => rule.until === undefined || rule.day !== undefined, { message: '`until` is the last day of a span that starts on a `day`: name the `day`' })
  .refine((rule) => rule.until === undefined || (rule.hours === undefined && rule.shared === undefined), { message: 'a span of days (`until`) is judged for overlap alone: it has no `hours` and is not `shared`' })
  .refine((rule) => rule.shared !== true || rule.hours !== undefined, { message: 'rows that share the time are judged by the resource\'s `hours` alone: name them' })
  .refine((rule) => rule.hours === undefined || (rule.hours.opens === undefined) === (rule.hours.closes === undefined), { message: 'hours name both when the day opens and when it closes, or neither' });
export type OccupiesRule = z.infer<typeof occupiesSchema>;

/** Everything in a table's rule that names something the manifest does not declare, or a column of the wrong kind. */
export function occupiesIssues(table: TableShape, rule: OccupiesRule, index: TableIndex, at: (...rest: (string | number)[]) => (string | number)[]): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const here = (...rest: (string | number)[]) => at('occupies', ...rest);
  const want = (tableRef: string, column: string, types: readonly string[] | null, path: (string | number)[], what: string): ColumnShape | undefined => {
    if (index.table(tableRef) === undefined) {
      out.push({ path, message: `"${tableRef}" is not a table of this app` });
      return undefined;
    }
    const found = index.column(tableRef, column);
    if (found === undefined) {
      out.push({ path, message: `"${tableRef}" has no column "${column}"` });
      return undefined;
    }
    if (types !== null && !types.includes(found.type)) {
      out.push({ path, message: `"${tableRef}.${column}" must be ${what}` });
      return undefined;
    }
    return found;
  };
  const resource = want(table.ref, rule.resource, null, here('resource'), '');
  if (rule.start !== undefined) want(table.ref, rule.start, ['timestamptz'], here('start'), 'a timestamptz');
  if (rule.minutes !== undefined) want(table.ref, rule.minutes, ['int', 'bigint'], here('minutes'), 'an int');
  if (rule.end !== undefined) want(table.ref, rule.end, ['timestamptz'], here('end'), 'a timestamptz');
  if (rule.day !== undefined) want(table.ref, rule.day, ['date'], here('day'), 'a date');
  if (rule.until !== undefined) {
    want(table.ref, rule.until, ['date'], here('until'), 'a date');
    if (rule.until === rule.day) out.push({ path: here('until'), message: 'a span\'s last day is kept in a column of its own' });
  }
  if (rule.countWhere !== undefined) {
    const counted = index.column(table.ref, rule.countWhere.column);
    if (counted === undefined) out.push({ path: here('countWhere', 'column'), message: `"${table.ref}" has no column "${rule.countWhere.column}"` });
    else for (const value of rule.countWhere.values) if (!valueFits(counted, value)) out.push({ path: here('countWhere', 'values'), message: `"${value}" is not a value of "${table.ref}.${counted.ref}"` });
  }
  const hours = rule.hours;
  if (hours !== undefined) {
    const theirs = want(hours.table, hours.resource, null, here('hours', 'resource'), '');
    // The two name the same thing: both links to one table, or two plain columns of one type.
    if (resource !== undefined && theirs !== undefined) {
      const same = resource.type === 'fk' || theirs.type === 'fk' ? resource.type === theirs.type && resource.references === theirs.references : resource.type === theirs.type;
      if (!same) out.push({ path: here('hours', 'resource'), message: `"${hours.table}.${hours.resource}" does not name what "${table.ref}.${rule.resource}" names` });
    }
    const weekday = want(hours.table, hours.weekday, ['enum'], here('hours', 'weekday'), `an enum of ${BOOKING_WEEKDAYS.join(', ')}`);
    if (weekday !== undefined && (weekday.enum ?? []).join(',') !== BOOKING_WEEKDAYS.join(',')) out.push({ path: here('hours', 'weekday'), message: `"${hours.table}.${hours.weekday}" must be an enum of ${BOOKING_WEEKDAYS.join(', ')}` });
    for (const name of ['opens', 'closes'] as const) {
      const column = hours[name];
      if (column !== undefined) want(hours.table, column, ['text'], here('hours', name), 'a text column holding HH:MM');
    }
    if (hours.table === table.ref) out.push({ path: here('hours', 'table'), message: 'a resource\'s hours are kept in a table of their own' });
  }
  return out;
}
