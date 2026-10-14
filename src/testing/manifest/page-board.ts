/*
 * VENDORED VERBATIM from packages/manifest/src/page-board.ts.
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
 * A board page's columns: `config.board` on a `page-board` page.
 *
 * Left to itself Adminium draws a board over the workflow enum it finds on the
 * table, so a board's columns were a fixed list written into the app: a sales
 * team could not add a stage of its own. An app says what the columns are
 * instead:
 *
 * ```json
 * "config": { "board": {
 *   "column": "stage_id",
 *   "columnsFrom": { "table": "crm_stages", "label": "name", "order": "position", "badge": { "column": "odds", "as": "percent" } },
 *   "title": "name",
 *   "totals": [{ "column": "amount", "fn": "sum" }, { "column": "weighted_value", "fn": "sum" }],
 *   "only": { "state": "open" },
 *   "card": { "link": "company_id.name", "person": "owner_id", "amount": "amount", "daysSince": { "column": "entered_stage_at", "warnFrom": 14, "alertFrom": 30 }, "date": "expected_close" },
 *   "note": { "text": "Columns come from Stages", "href": "/p/crm-stages" }
 * } }
 * ```
 *
 *  - `column` (required): the column of the page's table a card is placed by.
 *    With `columnsFrom` it is a link to that table; without, an enum column,
 *    and the board's columns are the enum's values;
 *  - `columnsFrom`: the table whose rows are the board's columns — every row,
 *    a row with no card too — headed by its `label` column and ordered by its
 *    `order` column (left out: by its key). `badge` names one more column of
 *    those rows, shown small beside the heading: `as: "percent"` writes a
 *    share kept as a fraction (0.1) as "10%", `"number"` a plain number, and
 *    left out it is written as it is kept;
 *  - `title`: the column of the page's table a card is titled with;
 *  - `totals` (at most two): a number or money column of the page's table,
 *    summed or averaged over each column's cards and shown in its header;
 *  - `only` (one to three columns): which cards are on the board — a card is
 *    one when each column named holds its value, or one of its values. Both
 *    the cards listed and each header's count and totals are of those cards.
 *
 *  - `card`: what a card shows under its title, each from a column of the
 *    page's table: `link` (`<link column>.<column of the row it points at>`:
 *    the company's name), `person` (a staff column, shown as the person's
 *    name), `amount` (a number or money), `daysSince` (days from a date or
 *    time column to today, by the server's clock; from `warnFrom` days the
 *    figure is amber and from `alertFrom` red; the longest-waiting cards come
 *    first) and `date` (a date or time, as a day);
 *  - `note`: one sentence drawn above the board, in the page's language
 *    (`text`, and `texts` by language as a page's `titles` are), with an
 *    optional `href` the whole note opens.
 *
 * Every figure and every name on the board is the READER's: a count and a
 * total are of the cards their roles reach, a looked-up name is empty when
 * its row is out of their reach, and a person is named as the people list
 * names them.
 *
 * Every name is the app's own (a column ref), checked here against
 * `requiredSchema`, so an app's CI refuses a typo long before an install.
 */
import { z } from 'zod';

import { NUMERIC_TYPES, refSchema, valueFits, type ColumnShape, type ReferenceIssue, type TableIndex } from './refs.ts';

/** How a header's figure is worked out of its cards. */
export const PAGE_BOARD_TOTAL_FNS = ['sum', 'avg'] as const;

/** The most figures a column's header shows beside its count. */
export const PAGE_BOARD_TOTALS_MAX = 2;

/** The most columns `only` tests, and the most values one of them lists. */
export const PAGE_BOARD_ONLY_MAX = 3;
export const PAGE_BOARD_ONLY_VALUES_MAX = 20;

/** Column types `only` compares: a choice, a yes/no, a link, text, a whole number. */
export const PAGE_BOARD_ONLY_TYPES: readonly string[] = ['enum', 'bool', 'fk', 'text', 'int', 'bigint'];

/** Column types a card's `daysSince` and `date` read. */
export const PAGE_BOARD_DAY_TYPES: readonly string[] = ['date', 'timestamp', 'timestamptz', 'datetime'];

const onlyValueSchema = z.union([z.string().min(1).max(200), z.number().finite(), z.boolean()]);

export const pageBoardOnlySchema = z
  .record(refSchema, z.union([onlyValueSchema, z.array(onlyValueSchema).min(1).max(PAGE_BOARD_ONLY_VALUES_MAX)]))
  .refine((only) => Object.keys(only).length >= 1 && Object.keys(only).length <= PAGE_BOARD_ONLY_MAX, {
    message: `only names one to ${String(PAGE_BOARD_ONLY_MAX)} columns`,
  });

/** One `only` entry's values as a list, whichever way it was written. */
export function pageBoardOnlyValues(value: z.infer<typeof onlyValueSchema> | z.infer<typeof onlyValueSchema>[]): (string | number | boolean)[] {
  return Array.isArray(value) ? value : [value];
}

/** How a column's badge is written. */
export const PAGE_BOARD_BADGE_AS = ['text', 'number', 'percent'] as const;

/** The most days a card's `warnFrom` / `alertFrom` names. */
export const PAGE_BOARD_DAYS_MAX = 3650;

const localeTag = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

export const pageBoardCardSchema = z
  .object({
    link: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    person: refSchema.optional(),
    amount: refSchema.optional(),
    daysSince: z
      .object({ column: refSchema, warnFrom: z.number().int().min(1).max(PAGE_BOARD_DAYS_MAX).optional(), alertFrom: z.number().int().min(1).max(PAGE_BOARD_DAYS_MAX).optional() })
      .strict()
      .refine((days) => days.warnFrom === undefined || days.alertFrom === undefined || days.warnFrom < days.alertFrom, { message: 'warnFrom comes before alertFrom' })
      .optional(),
    date: refSchema.optional(),
  })
  .strict()
  .refine((card) => Object.keys(card).length > 0, { message: 'a card names at least one thing to show' });

export const pageBoardNoteSchema = z
  .object({
    text: z.string().min(1).max(200),
    texts: z.record(localeTag, z.string().min(1).max(200)).optional(),
    // A path of this workspace: never an address elsewhere, and never a script.
    href: z.string().regex(/^\/(?!\/)[^\s\\]{0,299}$/).optional(),
  })
  .strict();

export const pageBoardSchema = z
  .object({
    column: refSchema,
    columnsFrom: z
      .object({ table: refSchema, label: refSchema, order: refSchema.optional(), badge: z.object({ column: refSchema, as: z.enum(PAGE_BOARD_BADGE_AS).optional() }).strict().optional() })
      .strict()
      .optional(),
    card: pageBoardCardSchema.optional(),
    note: pageBoardNoteSchema.optional(),
    title: refSchema.optional(),
    totals: z
      .array(z.object({ column: refSchema, fn: z.enum(PAGE_BOARD_TOTAL_FNS) }).strict())
      .min(1)
      .max(PAGE_BOARD_TOTALS_MAX)
      .optional(),
    only: pageBoardOnlySchema.optional(),
  })
  .strict();
export type PageBoard = z.infer<typeof pageBoardSchema>;

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

/** Every problem with the pages' `config.board`, against the app's own tables. */
export function pageBoardIssues<C extends ColumnShape>(pages: readonly PageShape[], index: TableIndex<C>): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  pages.forEach((page, p) => {
    const raw = page.config?.['board'];
    if (raw === undefined) return;
    const at = (...rest: (string | number)[]) => ['pages', p, 'config', 'board', ...rest];
    const parsed = pageBoardSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) out.push({ path: at(...issue.path.map((key) => (typeof key === 'symbol' ? String(key) : key))), message: issue.message });
      return;
    }
    if (page.template !== 'page-board') {
      out.push({ path: at(), message: `only a page-board takes its columns from config.board, not a ${page.template}` });
      return;
    }
    const table = pageTable(page);
    if (table === undefined || index.table(table) === undefined) {
      out.push({ path: at(), message: 'a board names its columns on a page bound to a table of the app' });
      return;
    }
    const board = parsed.data;
    const column = index.column(table, board.column);
    const from = board.columnsFrom;
    if (column === undefined) out.push({ path: at('column'), message: `"${table}" has no column "${board.column}"` });
    else if (from === undefined) {
      if (column.type !== 'enum') out.push({ path: at('column'), message: `"${table}.${board.column}" is not an enum: name the table its columns come from in columnsFrom, or place cards by an enum column` });
    } else if (column.type !== 'fk' || column.references !== from.table) {
      out.push({ path: at('column'), message: `"${table}.${board.column}" is not a link to "${from.table}"` });
    }
    if (from !== undefined) {
      if (index.table(from.table) === undefined) out.push({ path: at('columnsFrom', 'table'), message: `the app has no table "${from.table}"` });
      else {
        for (const key of ['label', 'order'] as const) {
          const name = from[key];
          if (name !== undefined && !index.has(from.table, name)) out.push({ path: at('columnsFrom', key), message: `"${from.table}" has no column "${name}"` });
        }
        const badge = from.badge === undefined ? undefined : index.column(from.table, from.badge.column);
        if (from.badge !== undefined && badge === undefined) out.push({ path: at('columnsFrom', 'badge', 'column'), message: `"${from.table}" has no column "${from.badge.column}"` });
        else if (badge !== undefined && from.badge?.as !== undefined && from.badge.as !== 'text' && !NUMERIC_TYPES.includes(badge.type)) {
          out.push({ path: at('columnsFrom', 'badge', 'as'), message: `"${from.table}.${badge.ref}" is not a number, so it cannot be written as a ${from.badge.as}` });
        }
      }
    }
    if (board.title !== undefined && !index.has(table, board.title)) {
      out.push({ path: at('title'), message: `"${table}" has no column "${board.title}"` });
    }
    (board.totals ?? []).forEach((total, t) => {
      const summed = index.column(table, total.column);
      if (summed === undefined) out.push({ path: at('totals', t, 'column'), message: `"${table}" has no column "${total.column}"` });
      else if (!NUMERIC_TYPES.includes(summed.type)) out.push({ path: at('totals', t, 'column'), message: `"${table}.${total.column}" is not a number or money, so it cannot be totalled` });
      if ((board.totals ?? []).findIndex((other) => other.column === total.column && other.fn === total.fn) !== t) {
        out.push({ path: at('totals', t), message: `"${total.column}" is totalled this way twice` });
      }
    });
    const card = board.card ?? {};
    if (card.link !== undefined) {
      const [via, shown] = card.link.split('.') as [string, string];
      const link = index.column(table, via);
      if (link === undefined) out.push({ path: at('card', 'link'), message: `"${table}" has no column "${via}"` });
      else if (link.type !== 'fk' || link.references === undefined) out.push({ path: at('card', 'link'), message: `"${table}.${via}" is not a link, so a card has no row to read "${shown}" from` });
      // A link to a table the manifest cannot see (an add-on's) is judged at the install, by the real table.
      else if (index.table(link.references) !== undefined && !index.has(link.references, shown)) out.push({ path: at('card', 'link'), message: `"${link.references}" has no column "${shown}"` });
    }
    if (card.person !== undefined) {
      const person = index.column(table, card.person) as (C & { rules?: { staff?: unknown } }) | undefined;
      if (person === undefined) out.push({ path: at('card', 'person'), message: `"${table}" has no column "${card.person}"` });
      else if (person.rules?.staff !== true) out.push({ path: at('card', 'person'), message: `"${table}.${card.person}" is not a staff column (rules.staff), so it holds no person to name` });
    }
    if (card.amount !== undefined) {
      const amount = index.column(table, card.amount);
      if (amount === undefined) out.push({ path: at('card', 'amount'), message: `"${table}" has no column "${card.amount}"` });
      else if (!NUMERIC_TYPES.includes(amount.type)) out.push({ path: at('card', 'amount'), message: `"${table}.${card.amount}" is not a number or money` });
    }
    for (const [key, name] of [['daysSince', card.daysSince?.column], ['date', card.date]] as const) {
      if (name === undefined) continue;
      const day = index.column(table, name);
      const here = key === 'daysSince' ? at('card', 'daysSince', 'column') : at('card', 'date');
      if (day === undefined) out.push({ path: here, message: `"${table}" has no column "${name}"` });
      else if (!PAGE_BOARD_DAY_TYPES.includes(day.type)) out.push({ path: here, message: `"${table}.${name}" is a ${day.type}, not a date or a time` });
    }
    for (const [name, written] of Object.entries(board.only ?? {})) {
      const tested = index.column(table, name);
      if (tested === undefined) {
        out.push({ path: at('only', name), message: `"${table}" has no column "${name}"` });
        continue;
      }
      if (name === board.column) {
        out.push({ path: at('only', name), message: `"${name}" is what the board's columns are: leave a column out of the board by its own table or enum, not by only` });
        continue;
      }
      if (!PAGE_BOARD_ONLY_TYPES.includes(tested.type)) {
        out.push({ path: at('only', name), message: `"${table}.${name}" is a ${tested.type}: only compares a choice, a yes/no, a link, text or a whole number` });
        continue;
      }
      const values = pageBoardOnlyValues(written);
      /*
       * A link holds the key of the row it points at: a whole number or text,
       * whichever that table is keyed by. Where the table is one of the app's
       * own its key is known, and a value of the other kind is refused here:
       * installed, the server could not compare it with the column, and every
       * read of the board's columns would fail. A link to a table the manifest
       * cannot see takes either, and the install judges it by the real column.
       */
      const linked = tested.type !== 'fk' || tested.references === undefined ? undefined : index.table(tested.references);
      const key = linked === undefined ? undefined : (index.pk(linked.ref) ?? index.column(linked.ref, 'id'));
      const fits = (value: string | number | boolean): boolean =>
        tested.type !== 'fk'
          ? valueFits(tested, value)
          : key === undefined
            ? typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value))
            : valueFits({ ref: key.ref, type: key.type }, value);
      const whole = key !== undefined && (key.type === 'int' || key.type === 'bigint');
      for (const value of values) {
        if (fits(value)) continue;
        out.push({
          path: at('only', name),
          message:
            tested.type === 'enum' && typeof value === 'string'
              ? `"${value}" is not one of the values of "${table}.${name}" (${(tested.enum ?? []).join(', ')})`
              : key !== undefined && linked !== undefined
                ? `${JSON.stringify(value)} is not a value "${table}.${name}" can hold: it links to "${linked.ref}", whose key is ${whole ? 'a whole number' : 'text'}`
                : `${JSON.stringify(value)} is not a value "${table}.${name}" (${tested.type}) can hold`,
        });
      }
      if (new Set(values).size !== values.length) out.push({ path: at('only', name), message: `"${name}" lists a value twice` });
    }
  });
  return out;
}
