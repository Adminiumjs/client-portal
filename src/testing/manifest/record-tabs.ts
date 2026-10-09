/*
 * VENDORED VERBATIM from packages/add-on-contracts/src/record-tabs.ts.
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
 * A RECORD TAB — an add-on's rows shown on another table's record page.
 *
 * An add-on keeps rows that belong to rows of tables it does not own: the
 * stock links of a menu item, the cards used on an order. It finds them by a
 * pair it stores on each row — a table's stored name and a row's key — and a
 * record tab is how those rows appear where their owner is looked at: a tab
 * on that record's page, listing the add-on's rows for it.
 *
 * The tab is declared, not coded: which of the add-on's tables, which two
 * columns hold the pair, which columns to show and which may be edited there.
 * Adminium draws it with the page's own parts and the reader's own grants.
 *
 * This file is the shape, and the checks an add-on's manifest can make of it
 * by itself.
 */
import { z } from 'zod';

import { i18nMessageSchema, wordsByLanguageSchema } from './common.ts';

const ref = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be a snake_case identifier');
const kebab = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a kebab-case id');

/** The most tabs one add-on declares, and the most columns one tab shows. */
export const RECORD_TABS_MAX = 6;
export const RECORD_TAB_COLUMNS_MAX = 8;

/** A picker of the tab's "add": a row of another own table this one links to, shown by one of its columns. */
const pickSchema = z.object({ table: ref, label: ref }).strict();

/** A button in the tab's head that makes a row of another own table for the same record ("Use stock"). */
const tabActionSchema = z.object({ id: kebab, label: i18nMessageSchema, labels: wordsByLanguageSchema.optional(), child: z.object({ table: ref, form: z.array(ref).min(1).max(RECORD_TAB_COLUMNS_MAX) }).strict() }).strict();

export const recordTabSchema = z
  .object({
    id: kebab,
    label: i18nMessageSchema,
    /** The label in the other languages: a tab is drawn on a record before any code of the add-on runs. */
    labels: wordsByLanguageSchema.optional(),
    /** The add-on's own table whose rows the tab lists. */
    table: ref,
    /** Its two columns that say which record a row belongs to: a table's stored name, and a row's key. */
    match: z.object({ table: ref, row: ref }).strict(),
    /**
     * Where the tab appears: `linked` — on every table that has a rule into
     * this add-on — or on the tables named, by their stored names.
     */
    on: z.union([z.literal('linked'), z.array(z.string().min(1).max(128)).min(1).max(24)]),
    columns: z.array(ref).min(1).max(RECORD_TAB_COLUMNS_MAX),
    /** The columns a reader who may change the rows edits in place. */
    edit: z.array(ref).min(1).max(RECORD_TAB_COLUMNS_MAX).optional(),
    /** A row is added by picking a row of another own table (an item, or an item or a kit). */
    add: z.object({ pick: z.union([pickSchema, z.array(pickSchema).min(1).max(2)]) }).strict().optional(),
    remove: z.literal(true).optional(),
    /** One row, edited as a form, in place of a list. */
    form: z.array(ref).min(1).max(RECORD_TAB_COLUMNS_MAX).optional(),
    empty: i18nMessageSchema.optional(),
    /** `empty` in the other languages. */
    empties: wordsByLanguageSchema.optional(),
    /** A stock-words id of the add-on whose answer heads the tab. */
    summary: z.object({ words: kebab }).strict().optional(),
    actions: z.array(tabActionSchema).min(1).max(2).optional(),
  })
  .strict();
export type RecordTab = z.infer<typeof recordTabSchema>;

export const recordTabsSchema = z
  .array(recordTabSchema)
  .min(1)
  .max(RECORD_TABS_MAX)
  .refine((tabs) => new Set(tabs.map((tab) => tab.id)).size === tabs.length, { message: 'two record tabs share an id' });

/** What the checks read of one of the add-on's tables. */
export interface RecordTabTable {
  ref: string;
  columns: readonly {
    ref: string;
    type: string;
    role?: string | undefined;
    references?: string | undefined;
    rules?: Readonly<Record<string, unknown>> | undefined;
  }[];
}

/** The rules through which Adminium fills a column itself: nobody edits it. */
const DECIDING = ['copy', 'sequence', 'code', 'rollup', 'stamp', 'formula', 'format', 'lookup', 'perNight', 'customerKey', 'codeLast4'];

/**
 * Everything wrong with an add-on's record tabs that its own manifest can
 * see: a table or a column that is not its own, a pair that is not a stored
 * table name and a row's key, a column edited that Adminium decides, a picker
 * the table does not link to, a summary that names no words.
 */
export function recordTabIssues(m: { tabs: readonly RecordTab[]; tables: readonly RecordTabTable[]; words: readonly string[] }): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const tables = new Map(m.tables.map((table) => [table.ref, table]));
  m.tabs.forEach((tab, t) => {
    const at = (...rest: (string | number)[]) => ['addOn', 'recordTabs', t, ...rest];
    const table = tables.get(tab.table);
    if (table === undefined) {
      out.push({ path: at('table'), message: `"${tab.table}" is not one of this add-on's own tables` });
      return;
    }
    const column = (of: RecordTabTable, name: string) => of.columns.find((candidate) => candidate.ref === name);
    const decided = (of: RecordTabTable, name: string): boolean => {
      const found = column(of, name);
      return found === undefined || found.role === 'pk' || DECIDING.some((rule) => found.rules?.[rule] !== undefined) || of.columns.some((other) => (other.rules?.['rollup'] as { balance?: { column?: string } } | undefined)?.balance?.column === name);
    };
    /** The two columns that hold the pair, on any table that carries rows for a record. */
    const pair = (of: RecordTabTable, path: (string | number)[]) => {
      const name = column(of, tab.match.table);
      const row = column(of, tab.match.row);
      if (name === undefined || name.type !== 'text' || name.rules?.['tableRef'] !== true) {
        out.push({ path: [...path, 'table'], message: `"${of.ref}.${tab.match.table}" says which table a row belongs to: a text column with rules.tableRef` });
      }
      if (row === undefined || row.type !== 'text') out.push({ path: [...path, 'row'], message: `"${of.ref}.${tab.match.row}" holds the key of the row it belongs to: a text column` });
    };
    pair(table, at('match'));

    const shown = new Set(tab.columns);
    const matched = new Set([tab.match.table, tab.match.row]);
    tab.columns.forEach((name, c) => {
      if (column(table, name) === undefined) out.push({ path: at('columns', c), message: `"${tab.table}" has no column "${name}"` });
    });
    (tab.edit ?? []).forEach((name, e) => {
      if (!shown.has(name)) out.push({ path: at('edit', e), message: `"${name}" is edited where it is shown: list it in "columns" too` });
      else if (matched.has(name)) out.push({ path: at('edit', e), message: `"${name}" says which record the row belongs to: nobody edits it` });
      else if (decided(table, name)) out.push({ path: at('edit', e), message: `"${tab.table}.${name}" is decided by Adminium: nobody edits it` });
    });
    (tab.form ?? []).forEach((name, f) => {
      if (column(table, name) === undefined) out.push({ path: at('form', f), message: `"${tab.table}" has no column "${name}"` });
      else if (!shown.has(name)) out.push({ path: at('form', f), message: `the form is the same row the tab shows: list "${name}" in "columns" too` });
      else if (matched.has(name)) out.push({ path: at('form', f), message: `"${name}" says which record the row belongs to: no form asks for it` });
    });

    const picks = tab.add === undefined ? [] : Array.isArray(tab.add.pick) ? tab.add.pick : [tab.add.pick];
    const picked = new Set<string>();
    picks.forEach((pick, p) => {
      const path = at('add', 'pick', ...(Array.isArray(tab.add?.pick) ? [p] : []));
      const other = tables.get(pick.table);
      if (other === undefined) {
        out.push({ path: [...path, 'table'], message: `"${pick.table}" is not one of this add-on's own tables` });
        return;
      }
      if (picked.has(pick.table)) out.push({ path: [...path, 'table'], message: `"${pick.table}" is picked from twice` });
      picked.add(pick.table);
      const links = table.columns.filter((candidate) => candidate.type === 'fk' && candidate.references === pick.table);
      if (links.length !== 1) out.push({ path: [...path, 'table'], message: `a picked row is linked by one foreign key: "${tab.table}" has ${links.length === 0 ? 'none' : String(links.length)} to "${pick.table}"` });
      if (column(other, pick.label) === undefined) out.push({ path: [...path, 'label'], message: `"${pick.table}" has no column "${pick.label}"` });
    });

    if (tab.summary !== undefined && !m.words.includes(tab.summary.words)) {
      out.push({ path: at('summary', 'words'), message: `"${tab.summary.words}" is not one of this add-on's stock words (addOn.words)` });
    }
    const ids = new Set<string>();
    (tab.actions ?? []).forEach((action, a) => {
      const path = at('actions', a);
      if (ids.has(action.id)) out.push({ path: [...path, 'id'], message: `two actions of the tab share the id "${action.id}"` });
      ids.add(action.id);
      const child = tables.get(action.child.table);
      if (child === undefined) {
        out.push({ path: [...path, 'child', 'table'], message: `"${action.child.table}" is not one of this add-on's own tables` });
        return;
      }
      // The row it makes belongs to the same record, so it carries the same pair — which no form asks for.
      pair(child, [...path, 'child']);
      action.child.form.forEach((name, f) => {
        if (column(child, name) === undefined) out.push({ path: [...path, 'child', 'form', f], message: `"${child.ref}" has no column "${name}"` });
        else if (matched.has(name)) out.push({ path: [...path, 'child', 'form', f], message: `"${name}" says which record the row belongs to: no form asks for it` });
        else if (decided(child, name)) out.push({ path: [...path, 'child', 'form', f], message: `"${child.ref}.${name}" is decided by Adminium: no form asks for it` });
      });
    });
  });
  return out;
}
