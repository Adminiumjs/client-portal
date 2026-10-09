/*
 * VENDORED VERBATIM from packages/manifest/src/look-up.ts.
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
 * LOOK-UP — what an add-on lets a typed code find: `addOn.lookUp`.
 *
 * A desk types or scans a code; Adminium, not the add-on's code, reads the
 * row. The add-on says which of its tables hold codes (`kinds`, tried in
 * order), which columns of the found row the answer may carry (`show`), one
 * table of history per kind (`rows`), and, when a customer's address can stand
 * in for a code, where addresses are kept (`address`).
 *
 * The answer never carries the code itself, a secret, or a code staff never
 * see: the page shows what was typed.
 *
 * Typed loosely in the contracts package (it cannot see the manifest's
 * tables); parsed and checked in full here.
 */
import { z } from 'zod';

import { keptFromStaff } from './page-config.ts';
import { refSchema, scalarSchema, valueFits, type ColumnShape, type ReferenceIssue } from './refs.ts';

const lookUpWhereSchema = z
  .object({ column: refSchema, eq: scalarSchema.optional(), in: z.array(scalarSchema).min(1).max(16).optional() })
  .strict()
  .refine((where) => (where.eq === undefined) !== (where.in === undefined), { message: 'a condition compares with one value (eq) or a list (in)' });

export const lookUpKindSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a kind id is kebab-case'),
    table: refSchema,
    /** The column the typed value is compared with. */
    code: refSchema,
    /** A typed value starting so is this kind's and no other's. */
    prefix: z.string().regex(/^[A-Z]{2}-$/, 'two capitals and a dash, as "GC-"').optional(),
    where: z.array(lookUpWhereSchema).min(1).max(2).optional(),
    show: z.array(refSchema).min(1).max(16),
    /** One table of history, newest first. */
    rows: z.object({ table: refSchema, via: refSchema, columns: z.array(refSchema).min(1).max(8) }).strict().optional(),
  })
  .strict();
export type LookUpKind = z.infer<typeof lookUpKindSchema>;

export const lookUpSchema = z
  .object({
    kinds: z.array(lookUpKindSchema).min(1).max(6),
    address: z.object({ table: refSchema, column: refSchema, show: z.array(refSchema).min(1).max(16) }).strict().optional(),
  })
  .strict();
export type LookUp = z.infer<typeof lookUpSchema>;

interface LookUpColumn extends ColumnShape {
  unique?: true | undefined;
  secret?: boolean | undefined;
  rules?: Readonly<Record<string, unknown>> | undefined;
}
export interface LookUpTable {
  ref: string;
  columns: readonly LookUpColumn[];
}

/** Everything wrong with a look-up, against the add-on's own tables. */
export function lookUpIssues(lookUp: LookUp, tables: readonly LookUpTable[]): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const byRef = new Map(tables.map((table) => [table.ref, table]));
  const column = (table: LookUpTable, ref: string) => table.columns.find((candidate) => candidate.ref === ref);
  /** The columns an answer carries: each exists, once, and none is kept from staff. */
  const shown = (table: LookUpTable, refs: readonly string[], path: (string | number)[], codes: readonly string[]): void => {
    const seen = new Set<string>();
    refs.forEach((ref, i) => {
      if (column(table, ref) === undefined) out.push({ path: [...path, i], message: `"${table.ref}" has no column "${ref}"` });
      else if (codes.includes(ref)) out.push({ path: [...path, i], message: `"${table.ref}.${ref}" is the code itself: the answer never carries it (the page shows what was typed)` });
      else {
        const kept = keptFromStaff(table, ref);
        if (kept !== null) out.push({ path: [...path, i], message: `"${table.ref}.${ref}" is ${kept}: a look-up never answers it` });
      }
      if (seen.has(ref)) out.push({ path: [...path, i], message: `"${ref}" is listed twice` });
      seen.add(ref);
    });
  };

  const ids = new Set<string>();
  const prefixes = new Set<string>();
  /** The code columns the kinds name, per table: none of them is ever shown. */
  const codesOf = (table: string): string[] => lookUp.kinds.filter((kind) => kind.table === table).map((kind) => kind.code);
  lookUp.kinds.forEach((kind, k) => {
    const at = (...rest: (string | number)[]) => ['addOn', 'lookUp', 'kinds', k, ...rest];
    if (ids.has(kind.id)) out.push({ path: at('id'), message: `two kinds are called "${kind.id}"` });
    ids.add(kind.id);
    if (kind.prefix !== undefined) {
      if (prefixes.has(kind.prefix)) out.push({ path: at('prefix'), message: `two kinds claim the prefix "${kind.prefix}": a typed value is one kind's and no other's` });
      prefixes.add(kind.prefix);
    }
    const table = byRef.get(kind.table);
    if (table === undefined) {
      out.push({ path: at('table'), message: `"${kind.table}" is not a table of this add-on` });
      return;
    }
    const code = column(table, kind.code);
    if (code === undefined) out.push({ path: at('code'), message: `"${kind.table}" has no column "${kind.code}"` });
    else if ((code.rules?.['code'] as { hiddenFromStaff?: unknown } | undefined)?.hiddenFromStaff === true) out.push({ path: at('code'), message: `"${kind.table}.${kind.code}" is a code staff never see: no desk looks it up` });
    else if (code.type !== 'text' || (code.rules?.['code'] === undefined && code.unique !== true)) out.push({ path: at('code'), message: `"${kind.table}.${kind.code}" is compared with what was typed: it is a text column with a code rule, or a unique one` });
    (kind.where ?? []).forEach((where, w) => {
      const found = column(table, where.column);
      if (found === undefined) {
        out.push({ path: at('where', w, 'column'), message: `"${kind.table}" has no column "${where.column}"` });
        return;
      }
      for (const value of where.in ?? [where.eq]) {
        if (!valueFits(found, value)) out.push({ path: at('where', w), message: `${JSON.stringify(value)} is not a value "${kind.table}.${where.column}" takes` });
      }
    });
    // Two kinds on one table are told apart by what they ask of the row.
    lookUp.kinds.slice(0, k).forEach((other) => {
      if (other.table === kind.table && JSON.stringify(other.where ?? null) === JSON.stringify(kind.where ?? null)) {
        out.push({ path: at('where'), message: `"${kind.id}" and "${other.id}" both read "${kind.table}" and ask the same of its rows: give them a "where" that differs` });
      }
    });
    shown(table, kind.show, at('show'), codesOf(kind.table));
    if (kind.rows !== undefined) {
      const history = byRef.get(kind.rows.table);
      if (history === undefined) {
        out.push({ path: at('rows', 'table'), message: `"${kind.rows.table}" is not a table of this add-on` });
        return;
      }
      const via = column(history, kind.rows.via);
      if (via === undefined || via.type !== 'fk' || via.references !== kind.table) out.push({ path: at('rows', 'via'), message: `"${kind.rows.table}.${kind.rows.via}" is not a foreign key to "${kind.table}"` });
      shown(history, kind.rows.columns, at('rows', 'columns'), codesOf(kind.rows.table));
    }
  });

  if (lookUp.address !== undefined) {
    const { address } = lookUp;
    const at = (...rest: (string | number)[]) => ['addOn', 'lookUp', 'address', ...rest];
    const table = byRef.get(address.table);
    if (table === undefined) {
      out.push({ path: at('table'), message: `"${address.table}" is not a table of this add-on` });
      return out;
    }
    const found = column(table, address.column);
    if (found === undefined) out.push({ path: at('column'), message: `"${address.table}" has no column "${address.column}"` });
    else if (found.rules?.['normalize'] !== 'email') out.push({ path: at('column'), message: `"${address.table}.${address.column}" is compared as an address: give it normalize "email"` });
    shown(table, address.show, at('show'), codesOf(address.table));
  }
  return out;
}
