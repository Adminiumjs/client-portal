/*
 * VENDORED VERBATIM from packages/manifest/src/documents.ts.
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
 * Document profiles an app ships: which of its columns make a printed
 * document (an invoice, a receipt, a statement), drawn by an add-on that
 * renders documents.
 *
 * ```json
 * "documents": [{
 *   "kind": "receipt", "addOn": "invoices", "table": "sales",
 *   "name": { "en-US": "Till receipt" },
 *   "mapping": {
 *     "number": { "column": "number" },
 *     "customerName": { "via": "customer_id", "column": "name" },
 *     "lines": { "collection": { "table": "sale_lines", "via": "sale_id", "orderBy": "position",
 *                                "columns": { "description": "name", "qty": "qty", "amount": "amount" } } }
 *   }
 * }]
 * ```
 *
 * A slot reads a column of the row, a column of a row a foreign key points at
 * (`via`), or a list of child rows in order. A list may leave rows out by
 * their own columns, the way a statement's sources do: `where` keeps only the
 * rows whose column holds one of its values, and `unless` drops a row whose
 * column is true or set (a voided line: `"unless": "voided"`). The slots
 * themselves are the add-on's words; Adminium checks the columns here and the
 * slots against the add-on when the profile is made at install. A profile is
 * the app's: made with real table names when the app is installed, removed
 * with it.
 *
 * A statement is a document over one row (a client) and a period: it lists
 * the documents and payments that point at that row, so it names them
 * instead of one child list.
 */
import { z } from 'zod';

import { refSchema, textOrLabels, type ReferenceIssue, type TableIndex } from './refs.ts';

const slotId = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'a slot id');

/** Only rows whose column holds one of the values (sent invoices, not drafts). */
const whereSchema = z.object({ column: refSchema, in: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).max(16) }).strict();

/**
 * A collection column that lists names read one level below the line — a
 * line's options (`order_item_modifiers.name`) — printed one after another.
 */
const namesListSchema = z
  .object({ list: z.object({ table: refSchema, via: refSchema, column: refSchema, orderBy: refSchema.optional() }).strict() })
  .strict();

/** The child rows of the document's row, one line each. */
const tableSourceSchema = z
  .object({
    table: refSchema,
    via: refSchema,
    orderBy: refSchema.optional(),
    /** A column of the line, or a list of names one level below it. */
    columns: z.record(slotId, z.union([refSchema, namesListSchema])),
    /** Only the child rows whose column holds one of the values. */
    where: whereSchema.optional(),
    /** A child row whose column is true (or set) is left out: a voided line. */
    unless: refSchema.optional(),
  })
  .strict();

/**
 * The nights a price-by-the-night column of the document's row is made of,
 * worked out when the document is drawn: one line per night. A column is one
 * of the night's own (`date`, `rate`, `base`, `qty`, `tags`) or a column of
 * the row the price's rate comes from (`room_type_id.name`).
 */
const nightlySourceSchema = z
  .object({
    nightly: refSchema,
    columns: z.record(slotId, z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/, 'a night\'s column, or <rate via>.<column>')),
  })
  .strict();

/** The pseudo-columns every night has. */
export const NIGHTLY_COLUMNS: readonly string[] = ['date', 'rate', 'base', 'qty', 'tags'];

/** A code printed in groups of four (`K7QX-M2PD`), as a person reads it out; on a code column only. */
const formSchema = z.literal('grouped').optional();

export const slotMappingSchema = z.union([
  z.object({ column: refSchema, form: formSchema }).strict(),
  z.object({ via: refSchema, column: refSchema, form: formSchema }).strict(),
  z.object({ collection: z.union([tableSourceSchema, nightlySourceSchema]) }).strict(),
  /** One list from several sources, in order (a folio's nights, extras and charges). */
  z.object({ collections: z.array(z.union([tableSourceSchema, nightlySourceSchema])).min(1).max(4) }).strict(),
]);
export type SlotMapping = z.infer<typeof slotMappingSchema>;

/** The rows a statement lists for its one row, and the columns it reads of them. */
const statementSourceSchema = z
  .object({
    table: refSchema,
    via: refSchema,
    date: refSchema,
    amount: refSchema,
    number: refSchema.optional(),
    where: whereSchema.optional(),
    /** A row whose column is true (or set) is left out: a voided payment. */
    unless: refSchema.optional(),
  })
  .strict();

export const appDocumentSchema = z
  .object({
    kind: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a document kind'),
    addOn: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an add-on key'),
    table: refSchema,
    name: textOrLabels,
    mapping: z.record(slotId, slotMappingSchema),
    statement: z.object({ documents: statementSourceSchema, payments: statementSourceSchema }).strict().optional(),
    /** The feature this document belongs to (see `addOns.features`). */
    feature: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/).optional(),
    /**
     * The slots the app's own screen may fill when it asks for the document
     * (a label sheet's `count`), and no others: a slot nothing maps, with no
     * default, holding a number or a text. Anything a request sends for a slot
     * not listed here is refused.
     */
    requestValues: z.array(slotId).min(1).max(8).optional(),
    /** Only rows whose column holds one of the values have this document (a receipt for money taken, not given back). */
    where: whereSchema.optional(),
  })
  .strict();
export type AppDocument = z.infer<typeof appDocumentSchema>;

type TableSource = z.infer<typeof tableSourceSchema>;
type NightlySource = z.infer<typeof nightlySourceSchema>;

/**
 * What the checks read of a price by the night: the table's column priced
 * that way, and the foreign key its rate is read through. Absent where
 * nothing can be priced by the night (an add-on's shapes).
 */
export type PerNightOf = (table: string) => ReadonlyMap<string, { rateVia: string }>;

/** A child-row source of one list: the table, its link to the row, and each column it reads. */
function tableSourceIssues(table: string, c: TableSource, index: TableIndex, here: (...rest: (string | number)[]) => (string | number)[], unlisted?: Unlisted): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  if (index.table(c.table) === undefined) return [{ path: here('table'), message: `"${c.table}" is not a table of this manifest` }];
  const via = index.column(c.table, c.via);
  if (via?.type !== 'fk' || via.references !== table) out.push({ path: here('via'), message: `"${c.table}.${c.via}" does not point at "${table}"` });
  const plain = Object.values(c.columns).filter((column): column is string => typeof column === 'string');
  for (const ref of [...plain, ...[c.orderBy, c.where?.column, c.unless].filter((r) => r !== undefined)]) {
    if (!index.has(c.table, ref)) out.push({ path: here(), message: `"${c.table}" has no column "${ref}"` });
  }
  for (const [slotColumn, column] of Object.entries(c.columns)) {
    if (typeof column === 'string') continue;
    const list = column.list;
    const at = (...rest: (string | number)[]) => here('columns', slotColumn, 'list', ...rest);
    if (index.table(list.table) === undefined) {
      out.push({ path: at('table'), message: `"${list.table}" is not a table of this manifest` });
      continue;
    }
    const link = index.column(list.table, list.via);
    if (link?.type !== 'fk' || link.references !== c.table) out.push({ path: at('via'), message: `"${list.table}.${list.via}" does not point at "${c.table}"` });
    const name = index.column(list.table, list.column);
    if (name === undefined) out.push({ path: at('column'), message: `"${list.table}" has no column "${list.column}"` });
    else if (name.type !== 'text' && name.type !== 'enum') out.push({ path: at('column'), message: `"${list.table}.${list.column}" is not a text column, so it lists no names` });
    else {
      const kept = unlisted?.(list.table, list.column) ?? null;
      if (kept !== null) out.push({ path: at('column'), message: `"${list.table}.${list.column}" is ${kept}, which a document never lists from another row` });
    }
    if (list.orderBy !== undefined && !index.has(list.table, list.orderBy)) out.push({ path: at('orderBy'), message: `"${list.table}" has no column "${list.orderBy}"` });
  }
  return out;
}

/** A nightly source: a price by the night of the document's row, and the night's columns it reads. */
function nightlySourceIssues(
  table: string,
  n: NightlySource,
  index: TableIndex,
  perNight: PerNightOf | undefined,
  here: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  if (perNight === undefined) return [{ path: here('nightly'), message: 'a shape does not price by the night' }];
  const priced = perNight(table).get(n.nightly);
  if (priced === undefined) return [{ path: here('nightly'), message: `"${table}.${n.nightly}" is not priced by the night` }];
  const out: ReferenceIssue[] = [];
  const target = index.column(table, priced.rateVia)?.references;
  for (const [slotColumn, column] of Object.entries(n.columns)) {
    if (!column.includes('.')) {
      if (!NIGHTLY_COLUMNS.includes(column)) out.push({ path: here('columns', slotColumn), message: `a night has no "${column}"; it has ${NIGHTLY_COLUMNS.join(', ')}, or <rate via>.<column>` });
      continue;
    }
    const [via, ref] = column.split('.') as [string, string];
    if (via !== priced.rateVia) out.push({ path: here('columns', slotColumn), message: `a night reads the row its rate comes from, through "${priced.rateVia}", not "${via}"` });
    else if (target === undefined || !index.has(target, ref)) out.push({ path: here('columns', slotColumn), message: `"${target ?? via}" has no column "${ref}"` });
  }
  return out;
}

/** A code's groups are read of a code column only: a text column with a `code` rule. */
function formIssues(index: TableIndex, table: string, column: string, here: (...rest: (string | number)[]) => (string | number)[]): ReferenceIssue[] {
  const found = index.column(table, column) as { type?: string; rules?: { code?: unknown } } | undefined;
  return found?.type === 'text' && found.rules?.code !== undefined ? [] : [{ path: here('form'), message: `"${table}.${column}" is not a code column, so it is not printed in groups` }];
}

/** Why a column of another row may never be listed one level down, or null (see `unlistedColumn`). */
export type Unlisted = (table: string, column: string) => string | null;

/** Every column a mapping names, against the manifest's tables. */
export function mappingIssues(
  table: string,
  mapping: Readonly<Record<string, SlotMapping>>,
  index: TableIndex,
  at: (...rest: (string | number)[]) => (string | number)[],
  /** The app's prices by the night; absent for an add-on's shapes, which have none. */
  perNight?: PerNightOf,
  /** The app's columns no list may print; absent for an add-on's shapes, which list nothing of an app's. */
  unlisted?: Unlisted,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  for (const [slot, source] of Object.entries(mapping)) {
    const here = (...rest: (string | number)[]) => at('mapping', slot, ...rest);
    if ('collections' in source) {
      source.collections.forEach((one, k) => {
        const there = (...rest: (string | number)[]) => here('collections', k, ...rest);
        out.push(...('nightly' in one ? nightlySourceIssues(table, one, index, perNight, there) : tableSourceIssues(table, one, index, there, unlisted)));
      });
    } else if ('collection' in source) {
      const c = source.collection;
      const there = (...rest: (string | number)[]) => here('collection', ...rest);
      out.push(...('nightly' in c ? nightlySourceIssues(table, c, index, perNight, there) : tableSourceIssues(table, c, index, there, unlisted)));
    } else if ('via' in source) {
      const via = index.column(table, source.via);
      if (via?.type !== 'fk' || via.references === undefined) {
        out.push({ path: here('via'), message: `"${source.via}" is not a foreign key of "${table}"` });
      } else if (!index.has(via.references, source.column)) {
        out.push({ path: here('column'), message: `"${via.references}" has no column "${source.column}"` });
      } else if (source.form !== undefined) out.push(...formIssues(index, via.references, source.column, here));
    } else if (!index.has(table, source.column)) {
      out.push({ path: here('column'), message: `"${table}" has no column "${source.column}"` });
    } else if (source.form !== undefined) out.push(...formIssues(index, table, source.column, here));
  }
  return out;
}

/** Everything wrong with an app's `documents` against its tables and add-on needs. */
export function appDocumentIssues(
  documents: readonly AppDocument[],
  ctx: { index: TableIndex; addOns: ReadonlySet<string>; features: ReadonlySet<string>; perNight?: PerNightOf; unlisted?: Unlisted },
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const kinds = new Set<string>();
  documents.forEach((doc, d) => {
    const at = (...rest: (string | number)[]) => ['documents', d, ...rest];
    const key = `${doc.table}|${doc.kind}`;
    if (kinds.has(key)) out.push({ path: at('kind'), message: `"${doc.table}" already has a "${doc.kind}" document` });
    kinds.add(key);
    if (!ctx.addOns.has(doc.addOn)) out.push({ path: at('addOn'), message: `"${doc.addOn}" is neither required nor suggested by the app` });
    if (doc.feature !== undefined && !ctx.features.has(doc.feature)) out.push({ path: at('feature'), message: `"${doc.feature}" is not one of the app's addOns.features` });
    if (ctx.index.table(doc.table) === undefined) {
      out.push({ path: at('table'), message: `"${doc.table}" is not a table of this app` });
      return;
    }
    out.push(...mappingIssues(doc.table, doc.mapping, ctx.index, at, ctx.perNight ?? (() => new Map()), ctx.unlisted));
    if (doc.where !== undefined && !ctx.index.has(doc.table, doc.where.column)) out.push({ path: at('where', 'column'), message: `"${doc.table}" has no column "${doc.where.column}"` });
    (doc.requestValues ?? []).forEach((slot, n) => {
      if (doc.requestValues!.indexOf(slot) !== n) out.push({ path: at('requestValues', n), message: `"${slot}" is listed twice` });
      // A mapped slot prints the row; a value sent for it would print something the row does not say.
      else if (doc.mapping[slot] !== undefined) out.push({ path: at('requestValues', n), message: `"${slot}" is mapped, so a request may not fill it` });
    });
    if (doc.statement !== undefined) {
      for (const part of ['documents', 'payments'] as const) {
        const s = doc.statement[part];
        const here = (...rest: (string | number)[]) => at('statement', part, ...rest);
        if (ctx.index.table(s.table) === undefined) {
          out.push({ path: here('table'), message: `"${s.table}" is not a table of this app` });
          continue;
        }
        const via = ctx.index.column(s.table, s.via);
        if (via?.type !== 'fk' || via.references !== doc.table) out.push({ path: here('via'), message: `"${s.table}.${s.via}" does not point at "${doc.table}"` });
        for (const ref of [s.date, s.amount, s.number, s.unless, s.where?.column]) {
          if (ref !== undefined && !ctx.index.has(s.table, ref)) out.push({ path: here(), message: `"${s.table}" has no column "${ref}"` });
        }
      }
    }
  });
  return out;
}
