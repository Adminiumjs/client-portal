/*
 * VENDORED VERBATIM from packages/manifest/src/refs.ts.
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
 * The small shapes every block of a manifest reuses: a snake_case name, a
 * label in several languages, a number that may come from the app's settings
 * row, and the structural view of a table the cross-reference checks read.
 *
 * A module of its own so `schema.ts` and the blocks split out of it
 * (`booking.ts`, `outbox.ts`, `public-access.ts`) import one definition
 * without importing each other.
 */
import { z } from 'zod';

/** A snake_case identifier: a table or column ref. */
export const refSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be a snake_case identifier');

/** A BCP 47 tag, the way every label map in a manifest is keyed (`de-DE`). */
export const bcp47TagSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'keyed by BCP 47 tag');

/** A label in several languages. US English is the one every reader falls back to. */
export const labelsSchema = z
  .record(bcp47TagSchema, z.string().min(1).max(120))
  .refine((labels) => labels['en-US'] !== undefined, { message: 'labels must include en-US' });

/** A text that is either one string, or the same text in several languages. */
export const textOrLabels = z.union([z.string().min(1).max(256), labelsSchema]);

/** One column of the app's one-row settings table, read when the rule runs. */
export const settingRefSchema = z.object({ table: refSchema, column: refSchema }).strict();

/**
 * A value read from a setting when a rule runs: a column of the app's own
 * one-row settings table, or a setting of an add-on the app requires
 * (`{addOn: "invoices", setting: "default_tax_rate"}`), kept by Adminium.
 */
export const addOnSettingRefSchema = z
  .object({
    addOn: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an add-on key'),
    setting: z.string().regex(/^[a-z][a-z0-9_]*$/, 'a setting key is snake_case'),
  })
  .strict();
export const settingSourceSchema = z.union([settingRefSchema, addOnSettingRefSchema]);
export type SettingSource = z.infer<typeof settingSourceSchema>;

/**
 * A number the manifest states, or one the app's own settings row holds — so
 * a venue can change its capacity without a new release. `{table, column}`
 * reads the one row of that (one-row) table at write time.
 */
export const numberOrSetting = z.union([z.number().int().nonnegative(), settingRefSchema]);

/** A value a rule compares a column with. */
export const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

/** What the cross-reference checks read of a column. */
export interface ColumnShape {
  ref: string;
  type: string;
  role?: string | undefined;
  nullable?: boolean | undefined;
  enum?: readonly string[] | undefined;
  references?: string | undefined;
  maxLength?: number | undefined;
}

/** What the cross-reference checks read of a table. */
export interface TableShape<C extends ColumnShape = ColumnShape> {
  ref: string;
  columns: readonly C[];
}

/** One cross-reference problem: where in the manifest, and what is wrong. */
export interface ReferenceIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Lookups over the manifest's tables, shared by every block's checks so each
 * says "no such column" the same way.
 */
export function tableIndex<C extends ColumnShape>(tables: readonly TableShape<C>[]) {
  const byRef = new Map(tables.map((t) => [t.ref, t]));
  const column = (table: string, ref: string): C | undefined => byRef.get(table)?.columns.find((c) => c.ref === ref);
  return {
    table: (ref: string) => byRef.get(ref),
    /** Every table, in the manifest's order. */
    tables: (): readonly TableShape<C>[] => tables,
    column,
    has: (table: string, ref: string) => column(table, ref) !== undefined,
    /** The table's primary key column, when it declares one. */
    pk: (table: string) => byRef.get(table)?.columns.find((c) => c.role === 'pk'),
  };
}
export type TableIndex<C extends ColumnShape = ColumnShape> = ReturnType<typeof tableIndex<C>>;

/** Column types a total, a price or a count can be kept in. */
export const NUMERIC_TYPES: readonly string[] = ['int', 'bigint', 'decimal', 'money', 'float'];

/**
 * Whether `value` is one a column of this shape can hold: one of an enum's
 * values, a boolean for a bool, a number for a number, any text for text.
 */
export function valueFits(column: ColumnShape, value: unknown): boolean {
  switch (column.type) {
    case 'enum':
      return typeof value === 'string' && (column.enum ?? []).includes(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'int':
    case 'bigint':
      return typeof value === 'number' && Number.isInteger(value);
    case 'decimal':
    case 'money':
    case 'float':
      return typeof value === 'number';
    default:
      return typeof value === 'string';
  }
}

// ── moments ───────────────────────────────────────────────────────────────────
//
// One shape for every rule that reads a point in time: a move allowed only
// after or before a time, a move made on its own when a time passes, a
// deadline a stamp writes, a public change allowed only inside a window, a
// hold that lasts until a time. A moment is a date or a timestamp column of
// the row — or of the row one of its links points at — at a wall time of the
// venue's day, shifted by an amount, and may fall back to another moment when
// its column is empty.
//
// Minutes and hours are elapsed time (48 hours before 15:00 is 48 real
// hours); days are calendar days on the venue's clock at the same wall time
// (7 days before 20:00 is 20:00, whatever the clocks did in between). A
// moment whose column is empty, whose linked row is missing or whose setting
// cannot be read is no moment at all, and the rule reading it says what that
// means (a move waiting for it is refused).

/** A wall time on the venue's clock, `HH:MM`. */
const clockTextSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time of day is HH:MM');

/** A whole number the manifest states, or one the app's settings row holds, bounded. */
const momentAmount = (max: number) => z.union([z.number().int().min(0).max(max), settingRefSchema]);

/** The longest shifts a moment takes: about a hundred years of days, a million minutes. */
export const MOMENT_LIMITS = { minutes: 1_000_000, hours: 16_666, days: 36_600 } as const;

/** A whole number the manifest states, or a column of the app's settings row holding one. */
export type MomentAmount = number | { table: string; column: string };

/** How far a moment is shifted: exactly one of minutes, hours or days. */
export interface MomentOffset {
  minutes?: MomentAmount | undefined;
  hours?: MomentAmount | undefined;
  days?: MomentAmount | undefined;
}

/**
 * Written as a named type rather than inferred: every rule that holds a
 * moment would otherwise spell the whole shape out again in the package's
 * declarations, deep enough for the compiler to cut it short.
 */
export const momentOffsetSchema: z.ZodType<MomentOffset> = z
  .object({
    minutes: momentAmount(MOMENT_LIMITS.minutes).optional(),
    hours: momentAmount(MOMENT_LIMITS.hours).optional(),
    days: momentAmount(MOMENT_LIMITS.days).optional(),
  })
  .strict()
  .refine((o) => [o.minutes, o.hours, o.days].filter((part) => part !== undefined).length === 1, {
    message: 'a shift is one of minutes, hours or days',
  });

/** A time of day: `HH:MM`, or a text setting holding one. */
export const clockTimeSchema = z.union([clockTextSchema, settingRefSchema]);
export type ClockTime = z.infer<typeof clockTimeSchema>;

/**
 * The hour the venue opens or closes on the moment's own weekday, read from a
 * weekly hours table (one row per weekday, `HH:MM` text times). A day that is
 * closed, or has no row, ends at midnight.
 */
export const hoursEdgeSchema = z
  .object({
    hours: z
      .object({
        table: refSchema,
        /** An enum of mon, tue, wed, thu, fri, sat, sun. */
        weekday: refSchema,
        /** A bool: false means the venue is closed that day. */
        open: refSchema.optional(),
        opens: refSchema.optional(),
        closes: refSchema,
      })
      .strict(),
    edge: z.enum(['opens', 'closes']),
  })
  .strict();
export type HoursEdge = z.infer<typeof hoursEdgeSchema>;

/**
 * A time of day kept on the row itself: a column of the row the moment's own
 * column is read from (the linked row's, with `via`) holding `HH:MM` — a
 * guest's arrival time on their stay.
 */
export const rowTimeSchema = z.object({ column: refSchema }).strict();
export type RowTime = z.infer<typeof rowTimeSchema>;

/** A wall time: a time of day, a setting holding one, the venue's opening or closing hour, or a time kept on the row. */
export type WallTime = ClockTime | HoursEdge | RowTime;
export const wallTimeSchema: z.ZodType<WallTime> = z.union([clockTimeSchema, hoursEdgeSchema, rowTimeSchema]);

const momentFields = {
  /** A `date` or `timestamptz` column: this row's own, or the linked row's when `via` is given. */
  column: refSchema,
  /** This row's foreign key: the moment is read from the row it points at (one link, never two). */
  via: refSchema.optional(),
  /** The venue's wall time on the column's day; a date column needs one to be a moment. */
  time: wallTimeSchema.optional(),
  plus: momentOffsetSchema.optional(),
  minus: momentOffsetSchema.optional(),
};
const oneShift = (m: { plus?: unknown; minus?: unknown }) => m.plus === undefined || m.minus === undefined;
const ONE_SHIFT = { message: 'a moment is shifted forward (plus) or back (minus), not both' };

/** A moment with no fallback of its own: what `or` lists. */
export interface PlainMoment {
  column: string;
  via?: string | undefined;
  time?: WallTime | undefined;
  plus?: MomentOffset | undefined;
  minus?: MomentOffset | undefined;
}
export const plainMomentSchema: z.ZodType<PlainMoment> = z.object(momentFields).strict().refine(oneShift, ONE_SHIFT);

/**
 * A point in time a rule reads (see above). `or` lists moments read in turn
 * when this one's column is empty: an event's own refund deadline, or else
 * seven days before it starts.
 */
export interface Moment extends PlainMoment {
  or?: PlainMoment[] | undefined;
}
export const momentSchema: z.ZodType<Moment> = z
  .object({ ...momentFields, or: z.array(plainMomentSchema).min(1).max(3).optional() })
  .strict()
  .refine(oneShift, ONE_SHIFT);

/** The weekday values a weekly hours table's weekday enum holds, in this order. */
const WEEKDAY_VALUES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * Everything wrong with one moment read from a row of `table`: its link, its
 * column, the settings and hours it reads. The same checks for every rule
 * that holds a moment, so each says "not a date" the same way.
 */
export function momentIssues<C extends ColumnShape>(
  table: string,
  moment: Moment | PlainMoment,
  index: TableIndex<C>,
  path: (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const want = (tableRef: string, column: string, types: readonly string[], at: (string | number)[], what: string): C | undefined => {
    if (index.table(tableRef) === undefined) {
      out.push({ path: at, message: `"${tableRef}" is not a table of this manifest` });
      return undefined;
    }
    const found = index.column(tableRef, column);
    if (found === undefined) {
      out.push({ path: at, message: `"${tableRef}" has no column "${column}"` });
      return undefined;
    }
    if (!types.includes(found.type)) {
      out.push({ path: at, message: `"${tableRef}.${column}" is not ${what}` });
      return undefined;
    }
    return found;
  };
  let owner: string | undefined = table;
  if (moment.via !== undefined) {
    const via = index.column(table, moment.via);
    if (via === undefined) {
      out.push({ path: [...path, 'via'], message: `"${table}" has no column "${moment.via}"` });
      owner = undefined;
    } else if (via.role === 'pk') {
      out.push({ path: [...path, 'via'], message: `"${table}.${moment.via}" is the key, and points at no other row` });
      owner = undefined;
    } else if (via.type !== 'fk' || via.references === undefined || index.table(via.references) === undefined) {
      out.push({ path: [...path, 'via'], message: `"${table}.${moment.via}" does not point at a table of this manifest` });
      owner = undefined;
    } else {
      owner = via.references;
    }
  }
  if (owner !== undefined) {
    const column = want(owner, moment.column, ['date', 'timestamptz'], [...path, 'column'], 'a date or a timestamptz');
    if (column?.type === 'date' && moment.time === undefined) {
      out.push({ path: [...path, 'time'], message: `"${owner}.${moment.column}" is a date, so the moment names a time of day on it` });
    }
  }
  const time = moment.time;
  if (time !== undefined && typeof time === 'object' && !('edge' in time) && !('table' in time)) {
    // A time kept on the row the moment's column is read from.
    if (owner !== undefined) {
      const found = want(owner, time.column, ['text'], [...path, 'time', 'column'], 'a text column holding HH:MM');
      if (found?.maxLength !== undefined && found.maxLength < 5) {
        out.push({ path: [...path, 'time', 'column'], message: `"${owner}.${time.column}" holds fewer than the 5 characters of HH:MM` });
      }
    }
  } else if (time !== undefined && typeof time === 'object') {
    if ('edge' in time) {
      const hours = time.hours;
      const at = [...path, 'time', 'hours'];
      const weekday = want(hours.table, hours.weekday, ['enum'], [...at, 'weekday'], `an enum of ${WEEKDAY_VALUES.join(', ')}`);
      if (weekday !== undefined && (weekday.enum ?? []).join(',') !== WEEKDAY_VALUES.join(',')) {
        out.push({ path: [...at, 'weekday'], message: `"${hours.table}.${hours.weekday}" is not an enum of ${WEEKDAY_VALUES.join(', ')}` });
      }
      if (hours.open !== undefined) want(hours.table, hours.open, ['bool'], [...at, 'open'], 'a bool');
      if (hours.opens !== undefined) want(hours.table, hours.opens, ['text'], [...at, 'opens'], 'a text column holding HH:MM');
      want(hours.table, hours.closes, ['text'], [...at, 'closes'], 'a text column holding HH:MM');
      if (time.edge === 'opens' && hours.opens === undefined) {
        out.push({ path: [...path, 'time', 'edge'], message: 'the opening hour is read from a column: name it (hours.opens)' });
      }
    } else {
      const found = want(time.table, time.column, ['text'], [...path, 'time'], 'a text column holding HH:MM');
      if (found?.maxLength !== undefined && found.maxLength < 5) {
        out.push({ path: [...path, 'time'], message: `"${time.table}.${time.column}" holds fewer than the 5 characters of HH:MM` });
      }
    }
  }
  for (const side of ['plus', 'minus'] as const) {
    const shift = moment[side];
    if (shift === undefined) continue;
    for (const unit of ['minutes', 'hours', 'days'] as const) {
      const amount = shift[unit];
      if (amount !== undefined && typeof amount === 'object') {
        want(amount.table, amount.column, ['int', 'bigint'], [...path, side, unit], 'a whole number');
      }
    }
  }
  if ('or' in moment && moment.or !== undefined) {
    moment.or.forEach((fallback, i) => out.push(...momentIssues(table, fallback, index, [...path, 'or', i])));
  }
  return out;
}
