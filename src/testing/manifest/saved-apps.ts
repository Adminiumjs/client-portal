/*
 * VENDORED VERBATIM from packages/manifest/src/saved-apps.ts.
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
 * WHAT A FILE MADE FROM A DASHBOARD CARRIES BESIDE AN ORDINARY APP.
 *
 * Three words only a self-made app (`publisher: local`) may use: a page's
 * whole `envelope` (what a person arranged on a page the generator would not
 * make again), its shared `views`, and the file's `provenance` (where and when
 * it was saved). The published catalogue never carries them. Nor a table's
 * real `name` and `schema` (`table-names.ts`), which only such an app gives.
 *
 * The envelope is typed loosely here — its version, kind, template and body —
 * because the engine's own page schema judges it on the server, at plan, where
 * the template registry is. What a target must make its own (the page's id,
 * its source, its access and its address) is not in it: the install makes them.
 *
 * And the checks that read more than one block: a table's switch names its
 * own postings, a left-out table has no page, an existing-customers mark sits
 * on a people table, a campaign is never what an outbox or a rule sends.
 */
import { z } from 'zod';

import { SNAKE_REF } from './refs.ts';

/** The publisher of an app made on an install (`LOCAL_PUBLISHER_ID` in `schema.ts`, which reads this file). */
const LOCAL_PUBLISHER_ID = 'local';

/** A page's envelope as the dashboard keeps it, without what the target makes its own. */
export const pageEnvelopeFieldSchema = z
  .object({
    v: z.number().int().min(1).max(99),
    kind: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a page kind').max(40),
    template: z.string().min(1).max(80),
    config: z.record(z.string(), z.unknown()),
    /** Page chrome: the gutter and the content column, as the engine spells them. */
    padding: z.unknown().optional(),
    width: z.string().min(1).max(20).optional(),
  })
  .strict();
export type PageEnvelopeField = z.infer<typeof pageEnvelopeFieldSchema>;

/** The most shared views one page carries. */
export const PAGE_VIEWS_MAX = 24;

/** A shared view of a page, its stored config as is. */
export const pageViewSchema = z
  .object({
    v: z.number().int().min(1).max(99),
    /** `filters` (a list's saved state) or `layout` (a dashboard's arrangement). */
    kind: z.enum(['filters', 'layout']),
    name: z.string().min(1).max(120),
    isDefault: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();
export type PageView = z.infer<typeof pageViewSchema>;

export const pageViewsSchema = z
  .array(pageViewSchema)
  .min(1)
  .max(PAGE_VIEWS_MAX)
  .refine((views) => new Set(views.map((view) => `${view.kind}:${view.name}`)).size === views.length, { message: 'a page names each view once' })
  .refine((views) => ['filters', 'layout'].every((kind) => views.filter((view) => view.kind === kind && view.isDefault === true).length <= 1), {
    message: 'a page has one default view of each kind at most',
  });

/**
 * Where a self-made app came from: the dashboard's lineage (a random id drawn
 * at its first save, never an id of the instance), when and on which Adminium
 * it was saved, the save's label, and the names of the workspaces its database
 * was in — offered on the target as names, nothing more.
 */
export const provenanceSchema = z
  .object({
    lineage: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'a lineage is 8 to 64 letters, digits, - or _'),
    savedAt: z.iso.datetime({ offset: true }),
    adminiumVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'an Adminium version'),
    label: z.string().min(1).max(120).optional(),
    workspaces: z.array(z.string().min(1).max(80)).max(32).optional(),
  })
  .strict();
export type Provenance = z.infer<typeof provenanceSchema>;

/**
 * A self-made app's icon: a lucide icon's name, as the product's icon set
 * names it (`coffee`, `shopping-bag`). Where it is installed, the app is shown
 * with it; a name the target's set does not hold falls back to its default.
 */
export const APP_ICON_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const appIconSchema = z.string().max(60).regex(APP_ICON_PATTERN, 'an icon is a lucide icon name in kebab case, such as "coffee"');

interface Issue {
  path: (string | number)[];
  message: string;
}

interface SavedAppShape {
  kind: string;
  publisher: { id: string };
  provenance?: unknown;
  icon?: unknown;
  pages?: readonly { ref: string; template: string; config?: unknown; bindings?: Readonly<Record<string, string>> | undefined; envelope?: { template: string } | undefined; views?: unknown }[] | undefined;
  requiredSchema?: {
    prefixed?: true | undefined;
    tables: readonly {
      ref: string;
      name?: string | undefined;
      schema?: string | undefined;
      columns?: readonly { ref: string }[] | undefined;
      exclude?: true | undefined;
      existingCustomers?: true | undefined;
      switchedOff?: { postings?: readonly string[] | undefined; adjust?: true | undefined } | undefined;
      postings?: readonly { id: string }[] | undefined;
      adjust?: unknown;
    }[];
  } | undefined;
  people?: readonly { table: string }[] | undefined;
  emailTemplates?: readonly { key: string; kind?: 'template' | 'campaign' | undefined }[] | undefined;
  outbox?: { kinds?: Readonly<Record<string, unknown>> | undefined } | undefined;
  automations?: unknown;
}

/** The template keys a rule's steps send, at any depth. */
function ruleTemplateKeys(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) ruleTemplateKeys(item, out);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'templateKey' && typeof value === 'string') out.add(value);
    else ruleTemplateKeys(value, out);
  }
}

/**
 * A table's real `name` and `schema`: a self-made app's only, never beside a
 * prefix (which names every table itself), and no two tables under one name
 * once letters are folded — MySQL (`lower_case_table_names`) and SQLite take
 * `Orders` and `orders` for one table.
 */
function tableNameIssues(m: SavedAppShape, local: boolean, onlyLocal: (path: Issue['path'], word: string) => void): Issue[] {
  const out: Issue[] = [];
  const tables = m.requiredSchema?.tables ?? [];
  const seen = new Map<string, string>();
  tables.forEach((table, t) => {
    for (const word of ['name', 'schema'] as const) {
      if (table[word] === undefined) continue;
      if (!local || m.kind !== 'app') onlyLocal(['requiredSchema', 'tables', t, word], word);
      if (m.requiredSchema?.prefixed === true) {
        out.push({ path: ['requiredSchema', 'tables', t, word], message: `a prefixed app names its tables itself: "${table.ref}" gives no ${word}` });
      }
    }
    const real = `${(table.schema ?? '').toLowerCase()}\u0000${(table.name ?? table.ref).toLowerCase()}`;
    const held = seen.get(real);
    if (held !== undefined) {
      out.push({ path: ['requiredSchema', 'tables', t, table.name === undefined ? 'ref' : 'name'], message: `"${table.ref}" and "${held}" are one table to a database that ignores case: name them apart` });
    } else seen.set(real, table.ref);
  });
  return out;
}

/**
 * A column's ref is snake_case, except in a self-made app, where a column
 * keeps the name it has in its own database (`orderDate`, `Order Date`): the
 * file names it the same way everywhere. Two columns of a table may not differ
 * by case alone, since MySQL and SQLite read them as one.
 */
function columnRefIssues(m: SavedAppShape, local: boolean): Issue[] {
  const out: Issue[] = [];
  (m.requiredSchema?.tables ?? []).forEach((table, t) => {
    const seen = new Map<string, string>();
    (table.columns ?? []).forEach((column, c) => {
      const at: Issue['path'] = ['requiredSchema', 'tables', t, 'columns', c, 'ref'];
      if (!SNAKE_REF.test(column.ref) && (!local || m.kind !== 'app')) {
        out.push({ path: at, message: `column ref must be a snake_case identifier ("${column.ref}" is a name only a self-made app may keep)` });
      }
      const folded = column.ref.toLowerCase();
      const held = seen.get(folded);
      if (held !== undefined && held !== column.ref) out.push({ path: at, message: `"${column.ref}" and "${held}" are one column to a database that ignores case: name them apart` });
      else seen.set(folded, column.ref);
    });
  });
  return out;
}

/** Everything wrong with the saved-app words that one block alone cannot see. */
export function savedAppIssues(m: SavedAppShape): Issue[] {
  const out: Issue[] = [];
  const local = m.publisher.id === LOCAL_PUBLISHER_ID;
  const onlyLocal = (path: Issue['path'], word: string) =>
    out.push({ path, message: `"${word}" is carried only by a self-made app (publisher "${LOCAL_PUBLISHER_ID}")` });
  if (m.provenance !== undefined && !local) onlyLocal(['provenance'], 'provenance');
  if (m.icon !== undefined && !local) onlyLocal(['icon'], 'icon');
  (m.pages ?? []).forEach((page, p) => {
    if (page.envelope !== undefined) {
      if (!local) onlyLocal(['pages', p, 'envelope'], 'envelope');
      if (page.envelope.template !== page.template) {
        out.push({ path: ['pages', p, 'envelope', 'template'], message: `the envelope's template is the page's own ("${page.template}")` });
      }
      if (page.config !== undefined) {
        out.push({ path: ['pages', p, 'config'], message: 'a page with an envelope carries its config there, not beside it' });
      }
    }
    if (page.views !== undefined && !local) onlyLocal(['pages', p, 'views'], 'views');
  });

  const tables = m.requiredSchema?.tables ?? [];
  out.push(...tableNameIssues(m, local, onlyLocal));
  out.push(...columnRefIssues(m, local));
  const excluded = new Set(tables.filter((table) => table.exclude === true).map((table) => table.ref));
  (m.pages ?? []).forEach((page, p) => {
    for (const [slot, ref] of Object.entries(page.bindings ?? {})) {
      if (excluded.has(ref)) out.push({ path: ['pages', p, 'bindings', slot], message: `"${ref}" is left out of Adminium (exclude): no page is bound to it` });
    }
  });
  const people = new Set((m.people ?? []).map((entry) => entry.table));
  tables.forEach((table, t) => {
    if (table.existingCustomers === true && !people.has(table.ref)) {
      out.push({ path: ['requiredSchema', 'tables', t, 'existingCustomers'], message: `existing customers are a people table's: list "${table.ref}" in people` });
    }
    const off = table.switchedOff;
    if (off === undefined) return;
    const own = new Set((table.postings ?? []).map((posting) => posting.id));
    for (const id of off.postings ?? []) {
      if (!own.has(id)) out.push({ path: ['requiredSchema', 'tables', t, 'switchedOff', 'postings'], message: `"${id}" is not a posting of "${table.ref}"` });
    }
    if (off.adjust === true && table.adjust === undefined) {
      out.push({ path: ['requiredSchema', 'tables', t, 'switchedOff', 'adjust'], message: `"${table.ref}" has no price rule (adjust) to switch off` });
    }
  });

  const campaigns = new Set((m.emailTemplates ?? []).filter((template) => template.kind === 'campaign').map((template) => template.key));
  if (campaigns.size > 0) {
    const sent = new Set<string>();
    for (const key of Object.values(m.outbox?.kinds ?? {})) if (typeof key === 'string') sent.add(key);
    ruleTemplateKeys(m.automations, sent);
    (m.emailTemplates ?? []).forEach((template, t) => {
      if (campaigns.has(template.key) && sent.has(template.key)) {
        out.push({ path: ['emailTemplates', t, 'kind'], message: `"${template.key}" is sent by the outbox or a rule, so it is a template, not a campaign` });
      }
    });
  }
  return out;
}
