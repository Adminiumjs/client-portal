/*
 * VENDORED VERBATIM from packages/add-on-contracts/src/record-panels.ts.
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
 * A RECORD PANEL — an add-on's own screen on another table's record page.
 *
 * An add-on keeps rows that rows of an app's tables link to (an order line's
 * design, a product's set-up). A record tab lists such rows where they are
 * declared; a panel is the add-on's own code drawn there instead: an editor
 * of the linked row, a preview of it. It is plan 51's add-on page, drawn in
 * a tab of the record page rather than on a page of its own:
 *
 *  - declared here, beside the add-on's pages and record tabs: `on` names the
 *    add-on's own table that host rows link into (`rules.addOnLink`), and the
 *    panel shows on the record page of every table with such a link;
 *  - shown, and its code served, only to a reader who reads the host row,
 *    holds a grant on the `on` table, and holds the panel's own permission
 *    (`page:<id>:view`, granted as a role grants one of the add-on's pages);
 *  - handed the host table and row, the key of the row it links to (empty
 *    when the link is), and the data kit of the add-on's own tables. It reads
 *    the host's rows as the kit's hosts do and writes only its own tables.
 *
 * This file is the shape, and the checks an add-on's manifest can make of it
 * by itself.
 */
import { z } from 'zod';

import { i18nMessageSchema, wordsByLanguageSchema } from './common.ts';

const ref = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be a snake_case identifier');

/** The most panels one add-on declares. */
export const RECORD_PANELS_MAX = 6;

export const recordPanelSchema = z
  .object({
    /** The panel's address and its permission's name (`page:<id>:view`): kebab-case, under the add-on's key, apart from its pages. */
    id: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/, 'a panel id is a kebab-case identifier'),
    /** The add-on's own table that host rows link into. */
    on: ref,
    /** A path the panel's route will serve; its default export is the panel. */
    client: z.string().min(1),
    title: i18nMessageSchema,
    /** The title in the other languages: a panel's tab is named before any code of the add-on runs. */
    titles: wordsByLanguageSchema.optional(),
    /** Where its tab stands among the record's other panels: the lowest first, then by id. */
    order: z.number().int().min(0).max(999).optional(),
  })
  .strict();
export type RecordPanel = z.infer<typeof recordPanelSchema>;

export const recordPanelsSchema = z
  .array(recordPanelSchema)
  .min(1)
  .max(RECORD_PANELS_MAX)
  .refine((panels) => new Set(panels.map((panel) => panel.id)).size === panels.length, { message: 'two record panels share an id' });

/** What a panel's default export is handed. */
export interface RecordPanelProps {
  connectionId: string;
  /** The host table's id, as the data routes take it, and the host row's key. */
  table: string;
  row: string;
  /** The key of the add-on's row the host row links to, or null when the link is empty. */
  linked: string | null;
}

/**
 * Everything wrong with an add-on's record panels that its own manifest can
 * see: a table that is not its own, an id outside its key's address space or
 * shared with one of its pages, a file a page or a slot fill is built into.
 */
export function recordPanelIssues(m: { key: string; panels: readonly RecordPanel[]; tables: readonly { ref: string }[]; pages: readonly { ref: string; client: string }[]; slots: readonly { client: string }[] }): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const own = new Set(m.tables.map((table) => table.ref));
  const pages = new Set(m.pages.map((page) => page.ref));
  // A panel's file is served behind its own three gates: one a page or a slot fill also names would be served past them.
  const shared = new Set([...m.pages.map((page) => page.client), ...m.slots.map((slot) => slot.client)]);
  m.panels.forEach((panel, p) => {
    const at = (...rest: (string | number)[]) => ['addOn', 'panels', p, ...rest];
    if (!own.has(panel.on)) out.push({ path: at('on'), message: `"${panel.on}" is not one of this add-on's own tables` });
    if (panel.id !== m.key && !panel.id.startsWith(`${m.key}-`)) out.push({ path: at('id'), message: `a panel of "${m.key}" is addressed under its key: name it "${m.key}-…", not "${panel.id}"` });
    if (pages.has(panel.id)) out.push({ path: at('id'), message: `"${panel.id}" is one of this add-on's pages: a panel's id is its own` });
    if (shared.has(panel.client)) out.push({ path: at('client'), message: `"${panel.client}" is a page's or a slot fill's file: a panel's code is a file of its own` });
  });
  return out;
}
