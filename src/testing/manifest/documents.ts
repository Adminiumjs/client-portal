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
 * (`via`), or a list of child rows in order. The slots themselves are the
 * add-on's words; Adminium checks the columns here and the slots against the
 * add-on when the profile is made at install. A profile is the app's: made
 * with real table names when the app is installed, removed with it.
 *
 * A statement is a document over one row (a client) and a period: it lists
 * the documents and payments that point at that row, so it names them
 * instead of one child list.
 */
import { z } from 'zod';

import { refSchema, textOrLabels, type ReferenceIssue, type TableIndex } from './refs.ts';

const slotId = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'a slot id');

export const slotMappingSchema = z.union([
  z.object({ column: refSchema }).strict(),
  z.object({ via: refSchema, column: refSchema }).strict(),
  z
    .object({
      collection: z
        .object({
          table: refSchema,
          via: refSchema,
          orderBy: refSchema.optional(),
          columns: z.record(slotId, refSchema),
        })
        .strict(),
    })
    .strict(),
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
    /** Only rows whose column holds one of the values (sent invoices, not drafts). */
    where: z.object({ column: refSchema, in: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1).max(16) }).strict().optional(),
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
  })
  .strict();
export type AppDocument = z.infer<typeof appDocumentSchema>;

/** Every column a mapping names, against the manifest's tables. */
export function mappingIssues(
  table: string,
  mapping: Readonly<Record<string, SlotMapping>>,
  index: TableIndex,
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  for (const [slot, source] of Object.entries(mapping)) {
    const here = (...rest: (string | number)[]) => at('mapping', slot, ...rest);
    if ('collection' in source) {
      const c = source.collection;
      if (index.table(c.table) === undefined) {
        out.push({ path: here('collection', 'table'), message: `"${c.table}" is not a table of this manifest` });
        continue;
      }
      const via = index.column(c.table, c.via);
      if (via?.type !== 'fk' || via.references !== table) out.push({ path: here('collection', 'via'), message: `"${c.table}.${c.via}" does not point at "${table}"` });
      for (const ref of [...Object.values(c.columns), ...(c.orderBy === undefined ? [] : [c.orderBy])]) {
        if (!index.has(c.table, ref)) out.push({ path: here('collection'), message: `"${c.table}" has no column "${ref}"` });
      }
    } else if ('via' in source) {
      const via = index.column(table, source.via);
      if (via?.type !== 'fk' || via.references === undefined) {
        out.push({ path: here('via'), message: `"${source.via}" is not a foreign key of "${table}"` });
      } else if (!index.has(via.references, source.column)) {
        out.push({ path: here('column'), message: `"${via.references}" has no column "${source.column}"` });
      }
    } else if (!index.has(table, source.column)) {
      out.push({ path: here('column'), message: `"${table}" has no column "${source.column}"` });
    }
  }
  return out;
}

/** Everything wrong with an app's `documents` against its tables and add-on needs. */
export function appDocumentIssues(
  documents: readonly AppDocument[],
  ctx: { index: TableIndex; addOns: ReadonlySet<string>; features: ReadonlySet<string> },
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
    out.push(...mappingIssues(doc.table, doc.mapping, ctx.index, at));
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
