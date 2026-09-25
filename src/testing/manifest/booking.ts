/*
 * VENDORED VERBATIM from packages/manifest/src/booking.ts.
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
 * `table.booking` — booking PEOPLE rather than tables: a row takes a resource
 * (a clinician) for its own length, and two counted rows of one resource may
 * never overlap.
 *
 * Beside `capacity`, not folded into it. Capacity adds up a party per start
 * time; booking forbids overlap per resource, within that resource's hours,
 * breaks and closures. They are different questions, and a table carries one
 * or the other.
 *
 * Every table the rule names is the app's own, by ref. With `prefixed`
 * install the server maps each of them — nested ones included — to the real
 * table name.
 */
import { z } from 'zod';

import {
  NUMERIC_TYPES,
  numberOrSetting,
  refSchema,
  settingRefSchema,
  valueFits,
  type ColumnShape,
  type ReferenceIssue,
  type TableIndex,
  type TableShape,
} from './refs.ts';

/** The weekday values an hours table's weekday enum must hold, in this order. */
export const BOOKING_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const hoursColumns = {
  weekday: refSchema,
  opens: refSchema,
  closes: refSchema,
  breakStart: refSchema.optional(),
  breakEnd: refSchema.optional(),
};

export const bookingSchema = z
  .object({
    /** When the row starts: a `timestamptz`, read in the venue's zone. */
    start: refSchema,
    /** How long it lasts: an int column on the row (copied from the kind). */
    minutes: refSchema,
    /** Whose time it takes: a foreign key. Empty on a create means "anyone" — Adminium picks. */
    resource: refSchema,
    /** What it is: a foreign key, which decides who may be booked for it. */
    kind: refSchema,
    /** Only rows whose column holds one of these take time (a cancelled visit takes none). */
    countWhere: z.object({ column: refSchema, values: z.array(z.string().min(1)).min(1) }).strict(),
    /** Who does what: a link table of (resource, kind), and the resources' own order and switches. */
    eligible: z
      .object({
        table: refSchema,
        resource: refSchema,
        kind: refSchema,
        order: z
          .object({
            table: refSchema,
            column: refSchema,
            /** A resource whose column is false is never booked. */
            active: refSchema.optional(),
            /** A resource whose column is false is never booked through the public API. */
            public: refSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    /**
     * Weekly hours as `HH:MM` text, one row per weekday. A resource with rows
     * of its own follows them; one without follows the practice's.
     */
    hours: z
      .object({
        practice: z.object({ table: refSchema, open: refSchema.optional(), ...hoursColumns }).strict(),
        own: z.object({ table: refSchema, resource: refSchema, ...hoursColumns }).strict().optional(),
      })
      .strict(),
    /** Dated closures, for everyone (resource empty) or one resource. */
    closures: z
      .object({
        table: refSchema,
        from: refSchema,
        to: refSchema,
        resource: refSchema.optional(),
        active: refSchema.optional(),
      })
      .strict()
      .optional(),
    /** The minutes between bookable starts. */
    grid: numberOrSetting,
    /** How many working days ahead a booking may be made. */
    windowDays: numberOrSetting.optional(),
    /** How far ahead a public booking must be. Staff are never held to it. */
    noticeMinutes: numberOrSetting.optional(),
    /**
     * A cancellation inside `hours` of the start. `refuse` turns a public
     * one away; `flag` lets it through and sets `flag`. Staff are never refused.
     */
    cancel: z
      .object({
        hours: numberOrSetting,
        mode: z.enum(['refuse', 'flag']),
        flag: refSchema.optional(),
        when: z.object({ column: refSchema, to: z.string().min(1) }).strict(),
      })
      .strict()
      .refine((c) => (c.mode === 'flag') === (c.flag !== undefined), {
        message: 'a flag names its column, and only mode "flag" has one',
        path: ['flag'],
      })
      .optional(),
  })
  .strict();
export type BookingRule = z.infer<typeof bookingSchema>;

/**
 * Everything in a table's booking rule that names something the manifest does
 * not declare, or a column of the wrong kind.
 */
export function bookingIssues(
  table: TableShape,
  rule: BookingRule,
  index: TableIndex,
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const here = (...rest: (string | number)[]) => at('booking', ...rest);

  /** The column, when it exists and is one of `types`; an issue otherwise. */
  const want = (
    tableRef: string,
    column: string,
    types: readonly string[],
    path: (string | number)[],
    what: string,
  ): ColumnShape | undefined => {
    if (index.table(tableRef) === undefined) {
      out.push({ path, message: `"${tableRef}" is not a table of this app` });
      return undefined;
    }
    const found = index.column(tableRef, column);
    if (found === undefined) {
      out.push({ path, message: `"${tableRef}" has no column "${column}"` });
      return undefined;
    }
    if (!types.includes(found.type)) {
      out.push({ path, message: `"${tableRef}.${column}" must be ${what}` });
      return undefined;
    }
    return found;
  };
  /** A foreign key pointing at `target` (any target when omitted). */
  const wantFk = (tableRef: string, column: string, target: string | undefined, path: (string | number)[]) => {
    const found = want(tableRef, column, ['fk'], path, 'a foreign key');
    if (found !== undefined && target !== undefined && found.references !== target) {
      out.push({ path, message: `"${tableRef}.${column}" does not point at "${target}"` });
    }
    return found;
  };
  const setting = (value: unknown, path: (string | number)[]) => {
    const parsed = settingRefSchema.safeParse(value);
    if (parsed.success) want(parsed.data.table, parsed.data.column, NUMERIC_TYPES, path, 'a number');
  };

  want(table.ref, rule.start, ['timestamptz'], here('start'), 'a timestamptz');
  want(table.ref, rule.minutes, ['int', 'bigint'], here('minutes'), 'an int');
  const resource = wantFk(table.ref, rule.resource, undefined, here('resource'));
  const kind = wantFk(table.ref, rule.kind, undefined, here('kind'));
  const resourceTable = resource?.references;
  const kindTable = kind?.references;

  const counted = index.column(table.ref, rule.countWhere.column);
  if (counted === undefined) {
    out.push({ path: here('countWhere', 'column'), message: `"${table.ref}" has no column "${rule.countWhere.column}"` });
  } else {
    for (const value of rule.countWhere.values) {
      if (!valueFits(counted, value)) {
        out.push({ path: here('countWhere', 'values'), message: `"${value}" is not a value of "${table.ref}.${counted.ref}"` });
      }
    }
  }

  const eligible = rule.eligible;
  wantFk(eligible.table, eligible.resource, resourceTable, here('eligible', 'resource'));
  wantFk(eligible.table, eligible.kind, kindTable, here('eligible', 'kind'));
  if (eligible.order !== undefined) {
    const order = eligible.order;
    if (resourceTable !== undefined && order.table !== resourceTable) {
      out.push({ path: here('eligible', 'order', 'table'), message: `the order is kept on "${resourceTable}", the table "${rule.resource}" points at` });
    }
    want(order.table, order.column, NUMERIC_TYPES, here('eligible', 'order', 'column'), 'a number');
    for (const name of ['active', 'public'] as const) {
      const column = order[name];
      if (column !== undefined) want(order.table, column, ['bool'], here('eligible', 'order', name), 'a bool');
    }
  }

  const weekday = (tableRef: string, column: string, path: (string | number)[]) => {
    const found = want(tableRef, column, ['enum'], path, `an enum of ${BOOKING_WEEKDAYS.join(', ')}`);
    if (found !== undefined && (found.enum ?? []).join(',') !== BOOKING_WEEKDAYS.join(',')) {
      out.push({ path, message: `"${tableRef}.${column}" must be an enum of ${BOOKING_WEEKDAYS.join(', ')}` });
    }
  };
  const times = (tableRef: string, hours: Record<string, string | undefined>, path: (string | number)[]) => {
    for (const name of ['opens', 'closes', 'breakStart', 'breakEnd']) {
      const column = hours[name];
      if (column !== undefined) want(tableRef, column, ['text'], [...path, name], 'a text column holding HH:MM');
    }
    if ((hours['breakStart'] === undefined) !== (hours['breakEnd'] === undefined)) {
      out.push({ path, message: 'a break names both its start and its end' });
    }
  };
  const practice = rule.hours.practice;
  weekday(practice.table, practice.weekday, here('hours', 'practice', 'weekday'));
  times(practice.table, practice, here('hours', 'practice'));
  if (practice.open !== undefined) want(practice.table, practice.open, ['bool'], here('hours', 'practice', 'open'), 'a bool');
  const own = rule.hours.own;
  if (own !== undefined) {
    wantFk(own.table, own.resource, resourceTable, here('hours', 'own', 'resource'));
    weekday(own.table, own.weekday, here('hours', 'own', 'weekday'));
    times(own.table, own, here('hours', 'own'));
  }

  const closures = rule.closures;
  if (closures !== undefined) {
    want(closures.table, closures.from, ['date'], here('closures', 'from'), 'a date');
    want(closures.table, closures.to, ['date'], here('closures', 'to'), 'a date');
    if (closures.resource !== undefined) {
      const column = wantFk(closures.table, closures.resource, resourceTable, here('closures', 'resource'));
      if (column !== undefined && column.nullable !== true) {
        out.push({ path: here('closures', 'resource'), message: `"${closures.table}.${closures.resource}" must be nullable: an empty one closes for everyone` });
      }
    }
    if (closures.active !== undefined) want(closures.table, closures.active, ['bool'], here('closures', 'active'), 'a bool');
  }

  setting(rule.grid, here('grid'));
  if (typeof rule.grid === 'number' && rule.grid === 0) out.push({ path: here('grid'), message: 'the grid is at least one minute' });
  setting(rule.windowDays, here('windowDays'));
  setting(rule.noticeMinutes, here('noticeMinutes'));

  if (rule.cancel !== undefined) {
    const cancel = rule.cancel;
    setting(cancel.hours, here('cancel', 'hours'));
    if (cancel.flag !== undefined) want(table.ref, cancel.flag, ['bool'], here('cancel', 'flag'), 'a bool');
    if (cancel.when.column !== rule.countWhere.column) {
      out.push({ path: here('cancel', 'when', 'column'), message: `a cancellation is a change of "${rule.countWhere.column}", the column that decides what counts` });
    } else if (counted !== undefined) {
      if (!valueFits(counted, cancel.when.to)) {
        out.push({ path: here('cancel', 'when', 'to'), message: `"${cancel.when.to}" is not a value of "${table.ref}.${counted.ref}"` });
      } else if (rule.countWhere.values.includes(cancel.when.to)) {
        out.push({ path: here('cancel', 'when', 'to'), message: `"${cancel.when.to}" still counts, so it frees no time` });
      }
    }
  }
  return out;
}
