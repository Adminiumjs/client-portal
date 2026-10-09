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
 *                               (or of a labelled starting row of the manifest's
 *                               own `seeds`: see `seedLabelsOf`)
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
 *   `{"@table": "<table>"}`    that table's stored name, for a column that
 *                               holds one (`rules.tableRef`): the name it has
 *                               on this install, whichever app made the table
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
 * AN APP'S ROWS FOR AN ADD-ON. An app that names an add-on may ship a second
 * file of the same format with a top-level `addOn`: rows of that add-on's
 * tables (its items, its recipes — never its history), and rows of the app's
 * own tables that link into them, each marked `"own": true`. It is named by
 * the manifest's `sampleData.addOns.<key>.file` and loaded only while the
 * add-on is there. `sampleSectionIssues` checks one.
 *
 * Pure: a format and its checks, no I/O. The server resolves the directives.
 */
import { z } from 'zod';

import { ledgersOf, type AddOnManifest, type AppManifest, type Manifest } from './schema.ts';

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
  z.object({ '@table': z.string().regex(/^[a-z][a-z0-9_]*$/, 'a table') }).strict(),
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
    /** An app's rows for an add-on it names: the add-on's key. Absent in a manifest's own bundle. */
    addOn: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an add-on key').optional(),
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
            /** In an app's rows for an add-on: a table of the app itself, one that links into the add-on. */
            own: z.literal(true).optional(),
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
  | { kind: 'table'; ref: string }
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
  if (typeof record['@table'] === 'string') return { kind: 'table', ref: record['@table'] };
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
  if (bundle.addOn !== undefined) {
    issues.push({ path: 'addOn', message: `This file holds rows for the add-on "${bundle.addOn}": name it in sampleData.addOns, not as the manifest's own sample file.` });
  }
  bundle.tables.forEach((table, t) => {
    if (table.own === true) issues.push({ path: `tables.${String(t)}.own`, message: '"own" marks a table of the app in its rows for an add-on; a manifest\'s own sample file takes none.' });
  });
  const declared = new Map<string, DeclaredTable>((manifest.requiredSchema?.tables ?? []).map((table) => [table.ref, table]));
  issues.push(...rowIssues(bundle, declared, { names: new Set(declared.keys()), what: manifest.kind === 'add-on' ? 'add-on' : 'app', otherLabels: false, known: seedLabelsOf(manifest) }));
  issues.push(...ledgerOrderIssues(bundle, manifest, declared));
  return issues;
}

/**
 * The labels a manifest's starting rows carry (`seeds`, rows written in the
 * manifest itself). A sample row may point at one: the starting row is found
 * again by what tells it apart (`seedRowIdentity`), so the sample's items can
 * name the unit an install seeded. A starting row kept in a file carries no
 * label a sample can name.
 */
export function seedLabelsOf(manifest: Manifest): Set<string> {
  const out = new Set<string>();
  for (const seed of manifest.seeds ?? []) {
    for (const row of seed.rows ?? []) if (typeof row['@label'] === 'string') out.add(row['@label']);
  }
  return out;
}

/**
 * What tells a labelled starting row apart once it is in its table: the
 * values it gives its table's one-of-a-kind columns, else the value of the
 * table's key field. A text in several languages (`@t`) is any of them — the
 * row was written in the installing person's. Empty when the row gives
 * neither: such a label cannot be found again.
 */
export function seedRowIdentity(manifest: Manifest, table: string, row: Record<string, unknown>): { column: string; values: (string | number | boolean)[] }[] {
  const shape = (manifest.requiredSchema?.tables ?? []).find((candidate) => candidate.ref === table);
  if (shape === undefined) return [];
  const valuesOf = (value: unknown): (string | number | boolean)[] | null => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [value];
    const found = sampleDirective(value);
    return found?.kind === 't' ? [...new Set(Object.values(found.texts))] : null;
  };
  const told = (columns: readonly string[]) =>
    columns.flatMap((column) => {
      const values = valuesOf(row[column]);
      return values === null ? [] : [{ column, values }];
    });
  const unique = told(shape.columns.filter((column) => column.unique === true).map((column) => column.ref));
  if (unique.length > 0) return unique;
  return shape.keyField === undefined ? [] : told([shape.keyField]);
}

/**
 * An add-on's own sample may hold its ledger's history: rows of its receipt
 * table and of the tables its ledger writes, written as they are (nothing is
 * posted). A table of either kind is listed AFTER every table its rows name,
 * and so a ledger row after the receipt it names — the removal runs in
 * reverse, so it takes them out first, before the rows a foreign key of
 * theirs points at. Once the receipts are listed only the ledger's own tables
 * follow: the history is the last thing a sample adds.
 *
 * "Names" is what the rows of the file give, not what the table could hold:
 * a ledger may also write a table people fill (an item it makes on the way),
 * and a sample's items name no receipt, so they stand where items stand.
 */
function ledgerOrderIssues(bundle: SampleBundle, manifest: Manifest, declared: ReadonlyMap<string, DeclaredTable>): SampleIssue[] {
  const issues: SampleIssue[] = [];
  const position = new Map(bundle.tables.map((table, t) => [table.ref, t]));
  const everyLedger = ledgersOf(manifest);
  for (const ledger of everyLedger) {
    const written = Object.keys(ledger.writes);
    const receipts = position.get(ledger.receipts);
    for (const ref of [ledger.receipts, ...written]) {
      const t = position.get(ref);
      const shape = declared.get(ref);
      if (t === undefined || shape === undefined) continue;
      const what = ref === ledger.receipts ? 'the receipt table' : 'a ledger table';
      const rows = bundle.tables[t]!.rows;
      for (const column of shape.columns) {
        const named = column.type === 'fk' ? column.references : undefined;
        if (named === undefined || named === ref) continue;
        // A column no row of the file fills names nothing.
        if (!rows.some((row) => row[column.ref] !== undefined && row[column.ref] !== null)) continue;
        const listed = position.get(named);
        if (listed === undefined || listed < t) continue;
        issues.push(
          named === ledger.receipts
            ? { path: `tables.${String(t)}.ref`, message: `"${ref}" is a ledger table of "${ledger.id}": list the receipt table "${ledger.receipts}" before it.` }
            : { path: `tables.${String(t)}.ref`, message: `"${ref}" is ${what} of "${ledger.id}": list it after "${named}", which its rows name (${column.ref}).` },
        );
      }
    }
    // Everything else comes first: after the receipts, only what a ledger writes.
    if (receipts === undefined) continue;
    bundle.tables.forEach((table, t) => {
      if (t > receipts && !everyLedger.some((other) => other.receipts === table.ref || other.writes[table.ref] !== undefined)) {
        issues.push({ path: `tables.${String(t)}.ref`, message: `"${table.ref}" comes after the history of the ledger "${ledger.id}": list a ledger's receipt and ledger tables last.` });
      }
    });
  }
  return issues;
}

/** What the row checks read of a table. */
type DeclaredTable = NonNullable<Manifest['requiredSchema']>['tables'][number];

/**
 * The tables a ledger writes that are CATALOGUE, not history: what the
 * ledger keeps beside its books — "this dish uses these items", "this visit
 * type offers that kit" — which a posting may write and a person, or an app's
 * sample, may write just as well.
 *
 * Read from the manifest as it stands. A table is history when it holds a
 * total, when a total or a limit anywhere adds its rows up, or when an action
 * that writes it also writes rows something adds up (a batch is made by the
 * action that moves stock into it: it is part of that movement). What is left
 * is written only by actions that count nothing. The receipt table never is.
 */
export function ledgerCatalogueTables(addOn: AddOnManifest): ReadonlySet<string> {
  const tables = addOn.requiredSchema?.tables ?? [];
  /** Tables whose rows a total, or a limit, adds up. */
  const counted = new Set<string>();
  /** Tables that hold a total. */
  const totals = new Set<string>();
  for (const table of tables) {
    if ((table as { capacity?: unknown }).capacity !== undefined) counted.add(table.ref);
    for (const column of table.columns) {
      const rollup = column.rules?.rollup;
      if (rollup === undefined) continue;
      totals.add(table.ref);
      counted.add(rollup.from);
    }
  }
  const verdicts = new Map<string, boolean>();
  for (const ledger of ledgersOf(addOn)) {
    const all = Object.keys(ledger.writes);
    const writtenBy = Object.values(ledger.actions).map((action) => action.writes ?? all);
    for (const ref of all) {
      const writers = writtenBy.filter((written) => written.includes(ref));
      const catalogue =
        // (A table something adds up fails the last test itself: whatever writes it, writes it.)
        ref !== ledger.receipts && !totals.has(ref) && writers.length > 0 && writers.every((written) => written.every((other) => !counted.has(other)));
      // Two ledgers that write one table both have to leave it out of their books.
      verdicts.set(ref, (verdicts.get(ref) ?? true) && catalogue);
    }
  }
  for (const ledger of ledgersOf(addOn)) verdicts.set(ledger.receipts, false);
  return new Set([...verdicts].filter(([, catalogue]) => catalogue).map(([ref]) => ref));
}

/**
 * An app's rows for an add-on it names (`sampleData.addOns.<key>.file`):
 * the file is for this app and that add-on, the app names the add-on, a
 * table marked `own` is the app's and links into the add-on, and — when the
 * add-on's manifest is at hand — every other table is one of the add-on's.
 * A `@ref` may name a row of the app's or the add-on's own sample, so a label
 * this file does not hold is left for the load to find.
 */
export function sampleSectionIssues(bundle: SampleBundle, app: AppManifest, addOn?: AddOnManifest): SampleIssue[] {
  const issues: SampleIssue[] = [];
  if (bundle.app !== app.key) issues.push({ path: 'app', message: `The file is for "${bundle.app}", not "${app.key}".` });
  const key = bundle.addOn;
  if (key === undefined) {
    issues.push({ path: 'addOn', message: 'Rows for an add-on say which: write "addOn": "<its key>" at the top of the file.' });
    return issues;
  }
  if (addOn !== undefined && addOn.key !== key) issues.push({ path: 'addOn', message: `The file is for the add-on "${key}", not "${addOn.key}".` });
  const named = [...(app.addOns?.requires ?? []), ...(app.addOns?.suggests ?? [])].some((need) => need.key === key);
  if (!named) issues.push({ path: 'addOn', message: `"${key}" is not an add-on this app names: add it to addOns.requires or addOns.suggests.` });

  const own = new Map<string, DeclaredTable>(app.requiredSchema.tables.map((table) => [table.ref, table]));
  const theirs = addOn === undefined ? null : new Map<string, DeclaredTable>((addOn.requiredSchema?.tables ?? []).map((table) => [table.ref, table]));
  const declared = new Map<string, DeclaredTable>();
  const catalogue = addOn === undefined ? new Set<string>() : ledgerCatalogueTables(addOn);
  const receipts = new Set(addOn === undefined ? [] : ledgersOf(addOn).map((ledger) => ledger.receipts));
  bundle.tables.forEach((table, t) => {
    const at = `tables.${String(t)}`;
    if (table.own === true) {
      const shape = own.get(table.ref);
      if (shape === undefined) {
        issues.push({ path: `${at}.ref`, message: `"${table.ref}" is not a table this app declares.` });
      } else if (!shape.columns.some((column) => column.rules?.addOnLink?.addOn === key)) {
        issues.push({ path: `${at}.own`, message: `"${table.ref}" has no column that links into "${key}" (rules.addOnLink), so its rows belong in the app's own sample file.` });
      } else {
        declared.set(table.ref, shape);
      }
      return;
    }
    if (theirs === null) return; // checked when the add-on's manifest is at hand
    const shape = theirs.get(table.ref);
    // An add-on's history is its own to write: an app brings what a ledger counts, never what it counted.
    // What a ledger writes beside its books (which item a dish uses) is no history, and an app may bring it.
    const ledger = addOn === undefined || catalogue.has(table.ref) ? undefined : ledgersOf(addOn).find((candidate) => candidate.receipts === table.ref || candidate.writes[table.ref] !== undefined);
    if (shape === undefined) issues.push({ path: `${at}.ref`, message: `"${table.ref}" is not a table of "${key}". A table of the app itself is marked "own": true.` });
    else if (ledger !== undefined) issues.push({ path: `${at}.ref`, message: `"${table.ref}" is ${ledger.receipts === table.ref ? 'the receipt table' : 'a table'} of "${key}"'s ledger "${ledger.id}", which only postings write: an app's rows for an add-on hold none of its history.` });
    else {
      declared.set(table.ref, shape);
      // Such a row is nobody's posting: it names no receipt, so nothing ever takes it for one to give back.
      for (const column of shape.columns) {
        if (column.type !== 'fk' || column.references === undefined || !receipts.has(column.references)) continue;
        table.rows.forEach((row, r) => {
          if (row[column.ref] !== undefined && row[column.ref] !== null) issues.push({ path: `${at}.rows.${String(r)}.${column.ref}`, message: `"${table.ref}.${column.ref}" names the receipt of a posting: an app's rows for an add-on are made by no posting, so leave it out.` });
        });
      }
    }
  });
  const twice = bundle.tables.map((table) => table.ref).filter((ref, i, all) => all.indexOf(ref) !== i);
  for (const ref of new Set(twice)) issues.push({ path: 'tables', message: `"${ref}" is listed twice.` });
  // A `@table` names a table of the app: the add-on's rows say which of the app's rows they belong to.
  issues.push(...rowIssues(bundle, declared, { names: new Set(own.keys()), what: 'app', otherLabels: true }));
  return issues;
}

/**
 * The checks every row of a file gets, over the tables `declared` knows. A
 * table it does not know is skipped: the caller has said why, or cannot see it.
 */
function rowIssues(
  bundle: SampleBundle,
  declared: ReadonlyMap<string, DeclaredTable>,
  opts: {
    /** The tables a `@table` may name. */
    names: ReadonlySet<string>;
    what: 'app' | 'add-on';
    /** Whether a `@ref` may name a row of another file (so an unknown label is not an error here). */
    otherLabels: boolean;
    /** Labels of rows that are there before the file's first: the manifest's own starting rows. */
    known?: ReadonlySet<string>;
  },
): SampleIssue[] {
  const issues: SampleIssue[] = [];
  const seen = new Set<string>(opts.known ?? []);
  // The labels of a table whose rows may all be left out: nothing may point at them.
  const mayBeLeftOut = new Set(bundle.tables.filter((table) => table.onlyIfEmpty === true).flatMap((table) => table.rows.map((row) => row['@label']).filter((l): l is string => typeof l === 'string')));
  for (const [t, table] of bundle.tables.entries()) {
    const shape = declared.get(table.ref);
    if (shape === undefined) {
      if (!opts.otherLabels) issues.push({ path: `tables.${String(t)}.ref`, message: `"${table.ref}" is not a table this ${opts.what} declares.` });
      // Its labels still count: a later row may point at one.
      for (const row of table.rows) if (typeof row['@label'] === 'string') seen.add(row['@label']);
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
              if (found?.kind === 'ref' && !seen.has(found.label) && !opts.otherLabels) {
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
              if (found?.kind === 'ref' && !seen.has(found.label) && !opts.otherLabels) {
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
        if (found?.kind === 'table') {
          const holds = shape.columns.find((c) => c.ref === column);
          if (!opts.names.has(found.ref)) issues.push({ path: `${at}.${column}`, message: `"${found.ref}" is not a table this ${opts.what} declares.` });
          else if (holds?.rules?.tableRef !== true) issues.push({ path: `${at}.${column}`, message: `"${table.ref}.${column}" does not hold a table's name (rules.tableRef), so it takes no "@table".` });
        }
        if (found?.kind === 'ref' && !seen.has(found.label) && !opts.otherLabels) {
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
