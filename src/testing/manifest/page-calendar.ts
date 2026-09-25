/*
 * VENDORED VERBATIM from packages/manifest/src/page-calendar.ts.
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
 * A calendar page's columns: `config.calendar` on a `page-calendar` page.
 *
 * Left to itself Adminium plots a calendar by the first date of the table it
 * reads and titles it with the table's display column — on a table of
 * appointments that also keeps a first visit's date of birth, every visit
 * landed on a birthday. An app says which columns instead:
 *
 * ```json
 * "config": { "calendar": { "start": "starts_at", "title": "patient_id.name", "category": "visit_type_id" } }
 * ```
 *
 *  - `start` (required) and `end`: a `date` or `timestamptz` column of the
 *    page's table;
 *  - `title`: a column of the page's table, or `<fk column>.<column>` — a
 *    column of the table that foreign key points at (the patient's name);
 *  - `category`: a column of the page's table, what the rows are coloured and
 *    filtered by.
 *
 * Every name is the app's own (a column ref), checked here against
 * `requiredSchema`, so an app's CI refuses a typo long before an install.
 * Without it, a table with a booking rule is plotted by the booking's `start`.
 */
import { z } from 'zod';

import { refSchema, type ColumnShape, type ReferenceIssue, type TableIndex } from './refs.ts';

/** `patient_id.name`: a column of the table a foreign key points at. */
const titleSchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/, 'a column, or <fk column>.<column>');

export const pageCalendarSchema = z
  .object({
    start: refSchema,
    end: refSchema.optional(),
    title: titleSchema.optional(),
    category: refSchema.optional(),
  })
  .strict();
export type PageCalendar = z.infer<typeof pageCalendarSchema>;

const DATE_TYPES: readonly string[] = ['date', 'timestamptz'];

/** What the check reads of a page. */
interface PageShape {
  template: string;
  bindings?: Readonly<Record<string, string>> | undefined;
  config?: Readonly<Record<string, unknown>> | undefined;
}

/** The table a page reads: its one binding, or the one keyed `rows`. */
function pageTable(page: PageShape): string | undefined {
  const entries = Object.values(page.bindings ?? {});
  return entries.length === 1 ? entries[0] : page.bindings?.['rows'];
}

/** Every problem with the pages' `config.calendar`, against the app's own tables. */
export function pageCalendarIssues<C extends ColumnShape>(pages: readonly PageShape[], index: TableIndex<C>): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  pages.forEach((page, p) => {
    const raw = page.config?.['calendar'];
    if (raw === undefined) return;
    const at = (...rest: (string | number)[]) => ['pages', p, 'config', 'calendar', ...rest];
    const parsed = pageCalendarSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) out.push({ path: at(...issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key))), message: issue.message });
      return;
    }
    if (page.template !== 'page-calendar') {
      out.push({ path: at(), message: `only a page-calendar plots by named columns, not a ${page.template}` });
      return;
    }
    const table = pageTable(page);
    if (table === undefined || index.table(table) === undefined) {
      out.push({ path: at(), message: 'a calendar names its columns on a page bound to a table of the app' });
      return;
    }
    const calendar = parsed.data;
    for (const key of ['start', 'end'] as const) {
      const name = calendar[key];
      if (name === undefined) continue;
      const column = index.column(table, name);
      if (column === undefined) out.push({ path: at(key), message: `"${table}" has no column "${name}"` });
      else if (!DATE_TYPES.includes(column.type)) out.push({ path: at(key), message: `"${table}.${name}" is not a date or a timestamptz` });
    }
    if (calendar.category !== undefined && !index.has(table, calendar.category)) {
      out.push({ path: at('category'), message: `"${table}" has no column "${calendar.category}"` });
    }
    if (calendar.title !== undefined) {
      const [own, through] = calendar.title.split('.') as [string, string | undefined];
      const column = index.column(table, own);
      if (column === undefined) out.push({ path: at('title'), message: `"${table}" has no column "${own}"` });
      else if (through !== undefined) {
        if (column.type !== 'fk' || column.references === undefined) out.push({ path: at('title'), message: `"${table}.${own}" is not a foreign key` });
        else if (!index.has(column.references, through)) out.push({ path: at('title'), message: `"${column.references}" has no column "${through}"` });
      }
    }
  });
  return out;
}
