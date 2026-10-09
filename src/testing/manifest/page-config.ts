/*
 * VENDORED VERBATIM from packages/manifest/src/page-config.ts.
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
 * What a records page says of itself beside its form: `config.tabs`,
 * `config.filters` and `config.bulk` on a `page-crud` page.
 *
 *  - `tabs` words a tab the page already has for a child table: what it says
 *    while empty, and whether it offers "New". It makes no tab and renames
 *    none.
 *  - `filters` names the columns the list is filtered by, at most six.
 *  - `bulk` is an action on the rows ticked in the list: one row of a child
 *    table for each ("Reorder" on a list of stock points).
 *
 * Every name is the manifest's own (a table or column ref), checked here
 * against `requiredSchema`, so a typo is refused long before an install.
 */
import { z } from 'zod';

import { refSchema, scalarSchema, textOrLabels, wordsOrLabels, valueFits, type ColumnShape, type ReferenceIssue, type TableIndex } from './refs.ts';

/** The controls a filter may use (the widgets' own list). */
export const PAGE_FILTER_CONTROLS = ['one-of', 'any-of', 'yes-no', 'record', 'date-range', 'number-range'] as const;
export type PageFilterControl = (typeof PAGE_FILTER_CONTROLS)[number];

export const pageTabsSchema = z.record(
  refSchema,
  z.object({ empty: textOrLabels.optional(), emptyBody: wordsOrLabels.optional(), noNew: z.literal(true).optional() }).strict(),
);
export type PageTabs = z.infer<typeof pageTabsSchema>;

export const pageFiltersSchema = z
  .array(z.object({ column: refSchema, control: z.enum(PAGE_FILTER_CONTROLS).optional(), label: textOrLabels.optional() }).strict())
  .max(6);
export type PageFilters = z.infer<typeof pageFiltersSchema>;

export const pageBulkActionSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a kebab-case id'),
    label: textOrLabels,
    /** The row made for each ticked row: of `table`, pointing back through `via`, with `form` typed once for all of them. */
    child: z.object({ table: refSchema, via: refSchema, form: z.array(refSchema).max(4) }).strict(),
    set: z.record(refSchema, scalarSchema).optional(),
    /** Only the ticked rows that hold this value get one. */
    where: z.object({ column: refSchema, eq: scalarSchema }).strict().optional(),
    confirm: z.object({ title: textOrLabels, body: wordsOrLabels, columns: z.array(refSchema).max(8) }).strict(),
    done: textOrLabels,
  })
  .strict();
export type PageBulkAction = z.infer<typeof pageBulkActionSchema>;

export const pageBulkSchema = z
  .array(pageBulkActionSchema)
  .min(1)
  .max(2)
  .refine((actions) => new Set(actions.map((action) => action.id)).size === actions.length, { message: 'two bulk actions share an id' });

/** What the checks read of a column: its rules too. */
interface RuledColumn extends ColumnShape {
  rules?: Readonly<Record<string, unknown>> | undefined;
  secret?: boolean | undefined;
}

interface PageShape {
  template: string;
  bindings?: Readonly<Record<string, string>> | undefined;
  config?: Readonly<Record<string, unknown>> | undefined;
}

function pageTable(page: PageShape): string | undefined {
  const entries = Object.values(page.bindings ?? {});
  return entries.length === 1 ? entries[0] : page.bindings?.['rows'];
}

const NUMBERS: readonly string[] = ['int', 'bigint', 'decimal', 'money', 'float'];
const DATES: readonly string[] = ['date', 'timestamptz'];

/** The controls a column of the manifest may be filtered with; none for a column that cannot be. */
export function pageFilterControls(column: RuledColumn): PageFilterControl[] {
  if (column.role === 'pk' || column.type === 'json' || column.type === 'blob') return [];
  if (column.type === 'fk') return ['record'];
  if (column.type === 'bool') return ['yes-no'];
  if (column.type === 'enum' || column.rules?.['options'] !== undefined) return ['one-of', 'any-of'];
  if (DATES.includes(column.type)) return ['date-range'];
  if (NUMBERS.includes(column.type)) return ['number-range'];
  return [];
}

/** Why a column is kept from staff, or null: a secret, a code nobody reads, a code only its last four are shown of. */
export function keptFromStaff(table: { columns: readonly RuledColumn[] }, ref: string): string | null {
  const column = table.columns.find((candidate) => candidate.ref === ref);
  if (column === undefined) return null;
  if (column.secret === true || column.rules?.['secret'] === true) return 'a secret';
  if ((column.rules?.['code'] as { hiddenFromStaff?: unknown } | undefined)?.hiddenFromStaff === true) return 'a code staff never see';
  const shown = table.columns.some((other) => (other.rules?.['codeLast4'] as { of?: unknown } | undefined)?.of === ref);
  return shown ? 'a code only its last four characters are shown of' : null;
}

/** Every `{name}` a message carries, whichever of its forms it is written in. */
function placeholdersOf(message: unknown): string[] {
  const texts = typeof message === 'string' ? [message] : typeof message === 'object' && message !== null ? Object.values(message).filter((value): value is string => typeof value === 'string') : [];
  return texts.flatMap((text) => [...text.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] ?? ''));
}

/** Every problem with the pages' `config.tabs`, `config.filters` and `config.bulk`, against the manifest's own tables. */
export function pageConfigIssues<C extends RuledColumn>(pages: readonly PageShape[], index: TableIndex<C>): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  pages.forEach((page, p) => {
    const at = (...rest: (string | number)[]) => ['pages', p, 'config', ...rest];
    const parse = <T>(key: string, schema: z.ZodType<T>): T | undefined => {
      const raw = page.config?.[key];
      if (raw === undefined) return undefined;
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) out.push({ path: at(key, ...issue.path.map((part) => (typeof part === 'symbol' ? String(part) : part))), message: issue.message });
        return undefined;
      }
      if (page.template !== 'page-crud') {
        out.push({ path: at(key), message: `only a page-crud takes "${key}", not a ${page.template}` });
        return undefined;
      }
      if (own === undefined || index.table(own) === undefined) {
        out.push({ path: at(key), message: `"${key}" is read on a page bound to a table of the manifest` });
        return undefined;
      }
      return parsed.data;
    };
    const own = pageTable(page);
    /** A foreign key of `child` to the page's table. */
    const pointsHere = (child: string, via: string): boolean => {
      const column = index.column(child, via);
      return column !== undefined && column.type === 'fk' && column.references === own;
    };

    const tabs = parse('tabs', pageTabsSchema);
    for (const ref of Object.keys(tabs ?? {})) {
      const child = index.table(ref);
      if (child === undefined) out.push({ path: at('tabs', ref), message: `"${ref}" is not a table of the manifest` });
      else if (!child.columns.some((column) => column.type === 'fk' && column.references === own)) out.push({ path: at('tabs', ref), message: `"${ref}" has no foreign key to "${own!}", so the page has no tab for it` });
    }

    const filters = parse('filters', pageFiltersSchema);
    const filtered = new Set<string>();
    (filters ?? []).forEach((filter, f) => {
      const column = index.column(own!, filter.column);
      if (column === undefined) {
        out.push({ path: at('filters', f, 'column'), message: `"${filter.column}" is not a column of the page's table "${own!}"` });
        return;
      }
      if (filtered.has(filter.column)) out.push({ path: at('filters', f, 'column'), message: `"${filter.column}" is named twice` });
      filtered.add(filter.column);
      const controls = pageFilterControls(column);
      if (controls.length === 0) out.push({ path: at('filters', f, 'column'), message: `"${own!}.${filter.column}" cannot be filtered that way: a list filters by a link, a yes/no, a choice, a date or a number` });
      else if (filter.control !== undefined && !controls.includes(filter.control)) out.push({ path: at('filters', f, 'control'), message: `"${own!}.${filter.column}" cannot be filtered that way: it takes ${controls.map((control) => `"${control}"`).join(' or ')}` });
    });

    const bulk = parse('bulk', pageBulkSchema);
    (bulk ?? []).forEach((action, b) => {
      const here = (...rest: (string | number)[]) => at('bulk', b, ...rest);
      const table = index.table(own!)!;
      const { child } = action;
      const made = index.table(child.table);
      if (made === undefined) {
        out.push({ path: here('child', 'table'), message: `"${child.table}" is not a table of the manifest` });
      } else {
        if (!pointsHere(child.table, child.via)) out.push({ path: here('child', 'via'), message: `"${child.table}.${child.via}" is not a foreign key to the page's table "${own!}"` });
        const seen = new Set<string>();
        child.form.forEach((ref, i) => {
          if (!index.has(child.table, ref)) out.push({ path: here('child', 'form', i), message: `"${child.table}" has no column "${ref}"` });
          else if (ref === child.via) out.push({ path: here('child', 'form', i), message: `"${ref}" is the link to the ticked row: nobody types it` });
          if (seen.has(ref)) out.push({ path: here('child', 'form', i), message: `"${ref}" is named twice` });
          seen.add(ref);
        });
        for (const [ref, value] of Object.entries(action.set ?? {})) {
          const column = index.column(child.table, ref);
          if (column === undefined) out.push({ path: here('set', ref), message: `"${child.table}" has no column "${ref}"` });
          else if (ref === child.via) out.push({ path: here('set', ref), message: `"${ref}" is the link to the ticked row: it is never set` });
          else if (seen.has(ref)) out.push({ path: here('set', ref), message: `"${ref}" is typed in the form or set, not both` });
          else if (!valueFits(column, value)) out.push({ path: here('set', ref), message: `${JSON.stringify(value)} is not a value "${child.table}.${ref}" takes` });
        }
      }
      const shown = (ref: string, path: (string | number)[]): void => {
        if (!index.has(own!, ref)) {
          out.push({ path, message: `"${ref}" is not a column of the page's table "${own!}"` });
          return;
        }
        const kept = keptFromStaff(table, ref);
        if (kept !== null) out.push({ path, message: `"${own!}.${ref}" is ${kept}: a bulk action neither reads nor shows it` });
      };
      if (action.where !== undefined) {
        shown(action.where.column, here('where', 'column'));
        const column = index.column(own!, action.where.column);
        if (column !== undefined && !valueFits(column, action.where.eq)) out.push({ path: here('where', 'eq'), message: `${JSON.stringify(action.where.eq)} is not a value "${own!}.${action.where.column}" takes` });
      }
      action.confirm.columns.forEach((ref, c) => shown(ref, here('confirm', 'columns', c)));
      for (const [key, message] of [['confirm.title', action.confirm.title], ['confirm.body', action.confirm.body], ['done', action.done]] as const) {
        for (const name of placeholdersOf(message)) {
          if (name !== 'count') out.push({ path: here(...key.split('.')), message: `{${name}} is not a value these words may name: {count}, the number of rows, is the only one` });
        }
      }
    });
  });
  return out;
}
