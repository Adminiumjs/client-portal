/*
 * VENDORED VERBATIM from packages/manifest/src/sample.ts.
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
 * `adminium.sample/1` — an app's sample data, shipped in its package and named
 * by the manifest's `sampleData.file`.
 *
 * Rows are written in the order the tables are listed, parents first, and
 * removed in reverse. A value is a plain JSON value or one of these directives:
 *
 *   `{"@ref": "<label>"}`      the key of an earlier row with that `@label`
 *   `{"@ago": "PT19M"}`        an ISO-8601 duration before now
 *   `{"@in": "PT20M", "@grid": 15}`   an ISO-8601 duration after now; with
 *                               `@grid`, rounded up to the next time on that
 *                               many minutes' grid of the venue's own clock
 *                               (the first pickup slot at least 20 minutes on)
 *   `{"@day": -1, "@time": "09:30"}`   a wall time in the venue's own zone,
 *                               days from today
 *   `{"@day": 3}`              a date in the venue's own zone
 *   `{"@t": {"en-US": "…"}}`   the adding person's language
 *   `{"@asset": "<label>"}`    a file from `assets`, added to the Files library
 *
 * A `@day` may add `"@workdays": true`: its days count Monday to Friday, and
 * day 0 on a weekend is the Monday after — so "today's" busy day is never a
 * Saturday. Or `"@week": true`: its days count from the bundle's anchor day
 * (`weekAnchor`, a weekday) in the week nearest today, so every date keeps
 * the weekday the sample was written for — a weekend stay stays on a
 * weekend, whatever day the sample is added on.
 *
 *   `{"@in": "PT20M", "@slot": "orders"}`   the first open time of that
 *                               table's slot limit at least that far ahead —
 *                               its hours, closures and pauses, on its grid —
 *                               on the next day it opens when today has none
 *
 *   `{"@month": -2, "@dom": 14}`   a date in the venue's own zone: that day of
 *                               the month so many months from this one; with
 *                               `"@time": "10:00"`, a wall time on it
 *
 * `@month` keeps a sample's history in calendar months whatever day it is
 * added on: a figure "this month" or "in May" reads the same on the 3rd as on
 * the 28th. A day past the month's end is its last day, and a day in this
 * month or later that has not come yet is today (at a time not yet come, now):
 * a month's history never runs into the future.
 *
 * A row may carry, beside its `@label`, one ROW directive: `@byClock`
 * `{at, before, around, after}` merges one of three sets of columns into the
 * row, by where its time `at` (a column of the row, or a `@day`/`@time`)
 * falls against the adding moment — more than half an hour before, within
 * half an hour, or later — so a sample day's statuses match the clock it is
 * added at. A set with `"@skip": true` leaves the row out (a payment for a
 * visit that has not happened yet). Or `@byStay` `{from, to, times?, before,
 * during, after}`: by where the adding moment falls against the row's two
 * times — its arrival and its departure (columns of the row, or `@day`s) —
 * before the stay, during it, or after it; a date is read at `times.from` /
 * `times.to` on its day (arriving from 15:00, leaving by 11:00), else at its
 * midnight. So a stay's status (booked, in house, departed) matches the
 * clock it is added at. A row takes one of the two.
 *
 * `"@onlyIfEmpty": true` is for a table that holds one row, the app's own
 * settings: the row is added only when the table has none, and otherwise its
 * `@label` names the row already there — the operator's own settings stay.
 *
 * Pure: a format and its checks, no I/O. The server resolves the directives.
 */
import { z } from 'zod';

import type { Manifest } from './schema.ts';

export const SAMPLE_FORMAT = 'adminium.sample/1';

const label = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/, 'a label of letters, digits and : . _ -');

/** `P[nW][nD][T[nH][nM][nS]]`, with at least one part. */
const ISO_DURATION = /^P(?!$)(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;

const directive = z.union([
  z.object({ '@ref': label }).strict(),
  z.object({ '@ago': z.string().regex(ISO_DURATION, 'an ISO-8601 duration such as PT19M') }).strict(),
  z
    .object({
      '@in': z.string().regex(ISO_DURATION, 'an ISO-8601 duration such as PT20M'),
      '@grid': z.number().int().min(1).max(1440).optional(),
      '@slot': z.string().regex(/^[a-z][a-z0-9_]*$/, 'a table').optional(),
    })
    .strict()
    .refine((d) => d['@grid'] === undefined || d['@slot'] === undefined, { message: 'a time on a slot limit takes its grid from the limit' }),
  z
    .object({
      '@day': z.number().int().min(-366).max(366),
      '@time': z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time such as 09:30'),
      '@workdays': z.literal(true).optional(),
      '@week': z.literal(true).optional(),
    })
    .strict()
    .refine((d) => d['@workdays'] === undefined || d['@week'] === undefined, { message: 'days count working days or from the week anchor, not both' }),
  z
    .object({ '@day': z.number().int().min(-366).max(366), '@workdays': z.literal(true).optional(), '@week': z.literal(true).optional() })
    .strict()
    .refine((d) => d['@workdays'] === undefined || d['@week'] === undefined, { message: 'days count working days or from the week anchor, not both' }),
  z
    .object({
      '@month': z.number().int().min(-120).max(0),
      '@dom': z.number().int().min(1).max(31),
      '@time': z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time such as 09:30').optional(),
    })
    .strict(),
  z.object({ '@t': z.record(z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/), z.string()).refine((m) => Object.keys(m).length > 0) }).strict(),
  z.object({ '@asset': label }).strict(),
]);

const plain = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** A column's value: a plain value, a directive, or (for a json column) any object or array. */
export const sampleValueSchema = z.union([plain, directive, z.array(z.unknown()), z.record(z.string(), z.unknown())]);

export const sampleRowSchema = z.record(z.string(), sampleValueSchema);

/** One of `@byClock`'s three sets: columns to merge, or `"@skip": true` to leave the row out. */
const clockBranchSchema = z.record(z.string(), sampleValueSchema);

/** `@byClock`: a row's columns by where its time falls against the adding moment. */
export const byClockSchema = z
  .object({
    /** A column of the row holding its time, or the time itself. */
    at: z.union([z.string().min(1), directive]),
    before: clockBranchSchema.optional(),
    around: clockBranchSchema.optional(),
    after: clockBranchSchema.optional(),
  })
  .strict();
export type ByClock = z.infer<typeof byClockSchema>;

const clockText = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time such as 15:00');

/** `@byStay`: a row's columns by where the adding moment falls against its two times — before, during or after its stay. */
export const byStaySchema = z
  .object({
    /** The arrival and the departure: columns of the row, or the times themselves. */
    from: z.union([z.string().min(1), directive]),
    to: z.union([z.string().min(1), directive]),
    /** The wall times a date is read at: arriving from, leaving by. */
    times: z.object({ from: clockText.optional(), to: clockText.optional() }).strict().optional(),
    before: clockBranchSchema.optional(),
    during: clockBranchSchema.optional(),
    after: clockBranchSchema.optional(),
  })
  .strict();
export type ByStay = z.infer<typeof byStaySchema>;

/** The keys of a row that are directives about the row, not columns. */
export const ROW_DIRECTIVES: ReadonlySet<string> = new Set(['@label', '@byClock', '@byStay', '@onlyIfEmpty']);

/** The weekdays a bundle's week anchor names. */
export const SAMPLE_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const sampleBundleSchema = z
  .object({
    format: z.literal(SAMPLE_FORMAT),
    app: z.string().min(1),
    /** The weekday the sample's `@week` days count from (the day it was written for), in the week nearest the adding day. */
    weekAnchor: z.enum(SAMPLE_WEEKDAYS).optional(),
    assets: z
      .record(label, z.object({ file: z.string().regex(/^seeds\/[a-z0-9][a-z0-9._/-]*$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict())
      .default({}),
    tables: z
      .array(
        z
          .object({
            ref: z.string().min(1),
            /** The table's rows go in only when it holds none (a kitchen's opening hours, set before the sample). */
            onlyIfEmpty: z.literal(true).optional(),
            rows: z.array(sampleRowSchema).min(1).max(5000),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type SampleBundle = z.infer<typeof sampleBundleSchema>;
export type SampleValue = z.infer<typeof sampleValueSchema>;

/** A value's directive, when it is one. */
export function sampleDirective(value: unknown):
  | { kind: 'ref'; label: string }
  | { kind: 'ago'; duration: string }
  | { kind: 'in'; duration: string; grid: number | null; slot: string | null }
  | { kind: 'wall'; day: number; time: string; workdays: boolean; week: boolean }
  | { kind: 'date'; day: number; workdays: boolean; week: boolean }
  | { kind: 'month'; months: number; dom: number; time: string | null }
  | { kind: 't'; texts: Record<string, string> }
  | { kind: 'asset'; label: string }
  | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record['@ref'] === 'string') return { kind: 'ref', label: record['@ref'] };
  if (typeof record['@ago'] === 'string') return { kind: 'ago', duration: record['@ago'] };
  if (typeof record['@in'] === 'string') {
    return {
      kind: 'in',
      duration: record['@in'],
      grid: typeof record['@grid'] === 'number' ? record['@grid'] : null,
      slot: typeof record['@slot'] === 'string' ? record['@slot'] : null,
    };
  }
  if (typeof record['@day'] === 'number' && typeof record['@time'] === 'string') {
    return { kind: 'wall', day: record['@day'], time: record['@time'], workdays: record['@workdays'] === true, week: record['@week'] === true };
  }
  if (typeof record['@day'] === 'number') return { kind: 'date', day: record['@day'], workdays: record['@workdays'] === true, week: record['@week'] === true };
  if (typeof record['@month'] === 'number' && typeof record['@dom'] === 'number') {
    return { kind: 'month', months: record['@month'], dom: record['@dom'], time: typeof record['@time'] === 'string' ? record['@time'] : null };
  }
  if (typeof record['@t'] === 'object' && record['@t'] !== null) {
    return { kind: 't', texts: record['@t'] as Record<string, string> };
  }
  if (typeof record['@asset'] === 'string') return { kind: 'asset', label: record['@asset'] };
  return null;
}

/** An ISO-8601 duration in milliseconds. */
export function isoDurationMs(duration: string): number {
  const match = ISO_DURATION.exec(duration);
  if (match === null) throw new Error(`"${duration}" is not an ISO-8601 duration`);
  const n = (part: string | undefined) => (part === undefined ? 0 : Number.parseFloat(part));
  const weeks = n(match[1]);
  const days = n(match[2]);
  const hours = n(match[4]);
  const minutes = n(match[5]);
  const seconds = n(match[6]);
  return ((((weeks * 7 + days) * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

export interface SampleIssue {
  path: string;
  message: string;
}

/**
 * What a time directive needs of the bundle and the manifest: a `@week` day
 * the bundle's week anchor, and a `@slot` time a table of the app with a slot
 * limit to find its open times in.
 */
function timeDirectiveIssues(
  found: ReturnType<typeof sampleDirective>,
  path: string,
  bundle: SampleBundle,
  declared: ReadonlyMap<string, { capacity?: unknown }>,
): SampleIssue[] {
  if (found === null) return [];
  if ((found.kind === 'wall' || found.kind === 'date') && found.week && bundle.weekAnchor === undefined) {
    return [{ path, message: 'A `@week` day counts from the bundle’s week anchor: name it (`weekAnchor`).' }];
  }
  if (found.kind === 'in' && found.slot !== null) {
    const capacity = declared.get(found.slot)?.capacity;
    const rules = capacity === undefined ? [] : Array.isArray(capacity) ? capacity : [capacity];
    if (!rules.some((rule) => ((rule as { kind?: string }).kind ?? 'slot') === 'slot')) {
      return [{ path, message: `"${found.slot}" keeps no slot limit, so it has no open times to find.` }];
    }
  }
  return [];
}

/**
 * Everything wrong with a bundle for this manifest: a table it does not
 * declare, a column the table does not have, a label used twice, a `@ref` to
 * a row that comes later or not at all, an `@asset` it does not list, a
 * number without gaps the row does not spell `null`.
 */
export function sampleBundleIssues(bundle: SampleBundle, manifest: Manifest): SampleIssue[] {
  const issues: SampleIssue[] = [];
  if (bundle.app !== manifest.key) {
    issues.push({ path: 'app', message: `The bundle is for "${bundle.app}", not "${manifest.key}".` });
  }
  const declared = new Map((manifest.requiredSchema?.tables ?? []).map((table) => [table.ref, table]));
  const seen = new Set<string>();
  // The labels of a table whose rows may all be left out: nothing may point at them.
  const mayBeLeftOut = new Set(bundle.tables.filter((table) => table.onlyIfEmpty === true).flatMap((table) => table.rows.map((row) => row['@label']).filter((l): l is string => typeof l === 'string')));
  for (const [t, table] of bundle.tables.entries()) {
    const shape = declared.get(table.ref);
    if (shape === undefined) {
      issues.push({ path: `tables.${String(t)}.ref`, message: `"${table.ref}" is not a table this app declares.` });
      continue;
    }
    const columns = new Set(shape.columns.map((column) => column.ref));
    // A row priced by the night is priced as it is written, from its rate and adjustment rows: those come first.
    for (const column of shape.columns) {
      const rule = column.rules?.perNight;
      if (rule === undefined) continue;
      const rateTable = shape.columns.find((c) => c.ref === rule.rate.via)?.references;
      for (const source of [rateTable, rule.adjust?.table]) {
        if (source === undefined) continue;
        const listed = bundle.tables.findIndex((other) => other.ref === source);
        if (listed >= t) issues.push({ path: `tables.${String(t)}.ref`, message: `"${source}" must come before "${table.ref}": "${table.ref}" is priced from it.` });
      }
    }
    // A number Adminium gives without gaps: a sample row names it, empty, or the load numbers it into the real series.
    const gapless = shape.columns.filter((column) => column.rules?.sequence?.gapless === true).map((column) => column.ref);
    for (const [r, row] of table.rows.entries()) {
      const at = `tables.${String(t)}.rows.${String(r)}`;
      for (const column of gapless) {
        if (row[column] !== null) {
          // Said as what to write: a model given only the reason left the key out, eight times running.
          const now = row[column] === undefined ? 'this row leaves it out' : 'this row gives it a value';
          issues.push({
            path: `${at}.${column}`,
            message: `"${column}" is numbered without gaps, and ${now}. Write "${column}": null in every sample row of "${table.ref}", so the sample stays off the real series.`,
          });
        }
      }
      for (const [column, value] of Object.entries(row)) {
        if (column === '@label') {
          if (typeof value !== 'string' || !label.safeParse(value).success) {
            issues.push({ path: `${at}.@label`, message: 'A label is letters, digits and : . _ -.' });
          } else if (seen.has(value)) {
            issues.push({ path: `${at}.@label`, message: `The label "${value}" is used twice.` });
          }
          continue;
        }
        if (column === '@onlyIfEmpty') {
          if (value !== true) issues.push({ path: `${at}.@onlyIfEmpty`, message: '"@onlyIfEmpty" is true, or absent.' });
          else if (table.onlyIfEmpty === true) issues.push({ path: `${at}.@onlyIfEmpty`, message: `"${table.ref}" is only for an empty table as a whole; a row of it says nothing more.` });
          continue;
        }
        if (column === '@byStay') {
          if (row['@byClock'] !== undefined) issues.push({ path: `${at}.@byStay`, message: 'A row takes @byClock or @byStay, not both.' });
          const stay = byStaySchema.safeParse(value);
          if (!stay.success) {
            issues.push({ path: `${at}.@byStay`, message: '@byStay names its two times (`from`, `to`) and up to three sets: before, during, after.' });
            continue;
          }
          for (const end of ['from', 'to'] as const) {
            const when = stay.data[end];
            if (typeof when === 'string' && !(columns.has(when) && when in row)) {
              issues.push({ path: `${at}.@byStay.${end}`, message: `"${when}" is not a column this row sets.` });
            } else if (typeof when !== 'string' && !['wall', 'date'].includes(sampleDirective(when)?.kind ?? '')) {
              issues.push({ path: `${at}.@byStay.${end}`, message: 'A time is a column of the row or a `@day` (with a `@time`, or not).' });
            }
          }
          for (const branch of ['before', 'during', 'after'] as const) {
            for (const [name, part] of Object.entries(stay.data[branch] ?? {})) {
              if (name === '@skip') {
                if (part !== true) issues.push({ path: `${at}.@byStay.${branch}.@skip`, message: '"@skip" is true, or absent.' });
                continue;
              }
              if (!columns.has(name)) issues.push({ path: `${at}.@byStay.${branch}.${name}`, message: `"${table.ref}" has no column "${name}".` });
              const found = sampleDirective(part);
              if (found?.kind === 'ref' && !seen.has(found.label)) {
                issues.push({ path: `${at}.@byStay.${branch}.${name}`, message: `"${found.label}" is not an earlier row: a referenced row must come first.` });
              }
            }
          }
          continue;
        }
        if (column === '@byClock') {
          const clock = byClockSchema.safeParse(value);
          if (!clock.success) {
            issues.push({ path: `${at}.@byClock`, message: '@byClock names its time (`at`) and up to three sets: before, around, after.' });
            continue;
          }
          const when = clock.data.at;
          if (typeof when === 'string' && !(columns.has(when) && when in row)) {
            issues.push({ path: `${at}.@byClock.at`, message: `"${when}" is not a column this row sets.` });
          } else if (typeof when !== 'string' && sampleDirective(when)?.kind !== 'wall') {
            issues.push({ path: `${at}.@byClock.at`, message: 'The time is a column of the row or a `@day` with a `@time`.' });
          }
          for (const branch of ['before', 'around', 'after'] as const) {
            for (const [name, part] of Object.entries(clock.data[branch] ?? {})) {
              if (name === '@skip') {
                if (part !== true) issues.push({ path: `${at}.@byClock.${branch}.@skip`, message: '"@skip" is true, or absent.' });
                continue;
              }
              if (!columns.has(name)) issues.push({ path: `${at}.@byClock.${branch}.${name}`, message: `"${table.ref}" has no column "${name}".` });
              const found = sampleDirective(part);
              if (found?.kind === 'ref' && !seen.has(found.label)) {
                issues.push({ path: `${at}.@byClock.${branch}.${name}`, message: `"${found.label}" is not an earlier row: a referenced row must come first.` });
              }
            }
          }
          continue;
        }
        if (!columns.has(column)) {
          issues.push({ path: `${at}.${column}`, message: `"${table.ref}" has no column "${column}".` });
          continue;
        }
        // An object that looks like a directive must BE one: a malformed
        // `@ago` would otherwise be written into the column as JSON.
        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value) &&
          Object.keys(value).some((key) => key.startsWith('@')) &&
          !directive.safeParse(value).success
        ) {
          issues.push({ path: `${at}.${column}`, message: `"${column}" holds a directive that is not well formed.` });
          continue;
        }
        const found = sampleDirective(value);
        if (found?.kind === 'ref' && !seen.has(found.label)) {
          issues.push({
            path: `${at}.${column}`,
            message: `"${found.label}" is not an earlier row: a referenced row must come first.`,
          });
        } else if (found?.kind === 'ref' && mayBeLeftOut.has(found.label)) {
          issues.push({ path: `${at}.${column}`, message: `"${found.label}" is in a table only for an empty table, so it may not be written: nothing points at it.` });
        }
        if (found?.kind === 'asset' && bundle.assets[found.label] === undefined) {
          issues.push({ path: `${at}.${column}`, message: `"${found.label}" is not one of the bundle’s assets.` });
        }
        issues.push(...timeDirectiveIssues(found, `${at}.${column}`, bundle, declared));
      }
      // A time a row directive reads or sets obeys the same rules as a column's.
      for (const rowDirective of ['@byClock', '@byStay'] as const) {
        const set = row[rowDirective];
        if (typeof set !== 'object' || set === null) continue;
        for (const [key, part] of Object.entries(set as Record<string, unknown>)) {
          const parts = typeof part === 'object' && part !== null && !Array.isArray(part) && sampleDirective(part) === null ? Object.entries(part as Record<string, unknown>) : [['', part] as const];
          for (const [name, inner] of parts) {
            issues.push(...timeDirectiveIssues(sampleDirective(inner), `${at}.${rowDirective}.${key}${name === '' ? '' : `.${name}`}`, bundle, declared));
          }
        }
      }
      // Labelled AFTER its own values are checked: a row cannot refer to itself.
      const own = row['@label'];
      if (typeof own === 'string') seen.add(own);
    }
  }
  return issues;
}
