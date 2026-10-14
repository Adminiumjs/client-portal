/*
 * VENDORED VERBATIM from packages/manifest/src/modules.ts.
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
 * `modules` — the parts of an app its owner switches on and off.
 *
 * ```json
 * "modules": [
 *   { "id": "selling", "label": { "en-US": "Selling" }, "default": "always" },
 *   { "id": "jobs",    "label": { "en-US": "Jobs on site" }, "default": "off" },
 *   { "id": "quotes",  "label": { "en-US": "Quotes" }, "default": "on", "feature": "quotes" }
 * ]
 * ```
 *
 * The screens say "parts"; the word here is `modules`, because `part`
 * already names a piece of a shape. A table, a page, a rule, a document, an
 * outbox producer and a public entry each name ONE module (`"module": "jobs"`);
 * a role names several (`"modules": ["jobs", "fleet"]`) and is offered while
 * any of them is on.
 *
 * WHAT "OFF" MEANS. The module's pages are not in the menu and are refused by
 * address; its rules are not run, its documents not drawn, its emails not
 * queued, its public entries closed. Its tables and rows stay. A role's grant
 * on a table lapses while the table's module is off, when the role is itself
 * of that module; a role of another module that is granted the table goes on
 * reading it.
 *
 * `default` is what a new install starts with: `on`, `off` (both are ticks
 * the installer may change), or `always` (never offered as a switch). A
 * module that names a `feature` is also off while that feature's add-ons are
 * not connected, whatever its switch says.
 *
 * A PART THAT IS LEFT OUT. A table built on an add-on's shape cannot be made
 * without the add-on. Such a table makes its add-on required — unless it
 * sits in a module whose feature needs that add-on. Then the app installs
 * without the add-on and the whole module is left out: its tables are not
 * made, and what names them elsewhere goes with them ({@link withoutModules}).
 * When the add-on is connected later the module is put in. The manifest must
 * still be valid with the module left out, which is checked with the rest.
 */
import { z } from 'zod';

import { bcp47TagSchema, labelsSchema, type ReferenceIssue } from './refs.ts';

export const moduleIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a module id is kebab-case');

export const MODULE_DEFAULTS = ['on', 'off', 'always'] as const;
export type ModuleDefault = (typeof MODULE_DEFAULTS)[number];

export const modulesSchema = z
  .array(
    z
      .object({
        id: moduleIdSchema,
        label: labelsSchema,
        default: z.enum(MODULE_DEFAULTS),
        /** Also off while this feature's add-ons are not connected (see `addOns.features`). */
        feature: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a feature id').optional(),
      })
      .strict(),
  )
  .min(1)
  .max(16);
export type ManifestModule = z.infer<typeof modulesSchema>[number];

/** A role's name in other languages, keyed by BCP 47 tag; `name` stays the English. */
export const roleNamesSchema = z.record(bcp47TagSchema, z.string().min(1).max(80));

type Doc = Record<string, unknown>;
const isDoc = (value: unknown): value is Doc => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** The blocks whose entries name one module, with the words an issue uses for an entry. */
const MODULE_BLOCKS = ['pages', 'automations', 'documents', 'publicAccess', 'navLinks'] as const;

/** Module id → the add-ons its feature needs (none when it names no feature). */
function featureNeeds(document: Doc): Map<string, string[]> {
  const features = new Map<string, string[]>();
  for (const feature of list(isDoc(document['addOns']) ? document['addOns']['features'] : undefined)) {
    if (isDoc(feature) && typeof feature['id'] === 'string') features.set(feature['id'], list(feature['requires']).filter((key): key is string => typeof key === 'string'));
  }
  const out = new Map<string, string[]>();
  for (const module of list(document['modules'])) {
    if (!isDoc(module) || typeof module['id'] !== 'string') continue;
    out.set(module['id'], typeof module['feature'] === 'string' ? (features.get(module['feature']) ?? []) : []);
  }
  return out;
}

const tablesOf = (document: Doc): Doc[] => list(isDoc(document['requiredSchema']) ? document['requiredSchema']['tables'] : undefined).filter(isDoc);

const shapeAddOn = (table: Doc): string | undefined => text(table['builtOn'])?.split('/')[0];

/**
 * Whether a table built on `addOn`'s shape may be made without the app
 * requiring the add-on: it sits in a module whose feature needs that add-on.
 */
export function shapeIsOptional(document: unknown, table: { module?: string | undefined }, addOn: string): boolean {
  if (!isDoc(document) || table.module === undefined) return false;
  return (featureNeeds(document).get(table.module) ?? []).includes(addOn);
}

/**
 * The add-ons the app can be installed without although a table is built on
 * their shape, each with the modules that are left out while it is absent.
 */
export function optionalShapeAddOns(document: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!isDoc(document)) return out;
  const required = new Set(list(isDoc(document['addOns']) ? document['addOns']['requires'] : undefined).flatMap((need) => (isDoc(need) && typeof need['key'] === 'string' ? [need['key']] : [])));
  const needs = featureNeeds(document);
  for (const table of tablesOf(document)) {
    const addOn = shapeAddOn(table);
    const module = text(table['module']);
    if (addOn === undefined || module === undefined || required.has(addOn)) continue;
    if (!(needs.get(module) ?? []).includes(addOn)) continue;
    const modules = out.get(addOn) ?? [];
    if (!modules.includes(module)) modules.push(module);
    out.set(addOn, modules);
  }
  return out;
}

/** The modules left out of an install where `has` says which add-ons are connected. */
export function modulesLeftOut(document: unknown, has: (addOn: string) => boolean): string[] {
  const out: string[] = [];
  for (const [addOn, modules] of optionalShapeAddOns(document)) {
    if (has(addOn)) continue;
    for (const module of modules) if (!out.includes(module)) out.push(module);
  }
  return out;
}

/**
 * The manifest with some modules left out: what is installed while the add-on
 * a module's tables are built on is not connected.
 *
 * Gone with a module: its tables, pages, rules, documents, outbox producers
 * and public entries — and a browser key (`publicKeys`) every entry of which
 * went, so a share link's key is made only with the part it opens. Gone with its tables, wherever they are named: a link
 * column into one (and an index or a way of belonging that reads the column),
 * a kept total over one (the column stays, empty), a page bound to one, a
 * role's grants and limits on one, a rule or a public entry on one, an
 * outbox link and producer on one, a starting row for one. A role left with
 * no module is gone too. The modules themselves stay declared: one that is
 * left out is simply off.
 */
export function withoutModules<T>(manifest: T, gone: readonly string[]): T {
  if (!isDoc(manifest) || gone.length === 0) return manifest;
  const out: Doc = structuredClone(manifest) as Doc;
  const off = new Set(gone);
  const inGone = (entry: unknown): boolean => isDoc(entry) && typeof entry['module'] === 'string' && off.has(entry['module']);

  const schema = isDoc(out['requiredSchema']) ? out['requiredSchema'] : undefined;
  const goneTables = new Set(tablesOf(out).filter(inGone).flatMap((table) => (typeof table['ref'] === 'string' ? [table['ref']] : [])));
  /** Table ref → the link columns it loses. */
  const lostColumns = new Map<string, Set<string>>();
  if (schema !== undefined) {
    schema['tables'] = tablesOf(out)
      .filter((table) => !inGone(table))
      .map((table) => {
        const ref = text(table['ref']) ?? '';
        const lost = new Set<string>();
        table['columns'] = list(table['columns']).filter((column) => {
          if (!isDoc(column)) return true;
          if (column['type'] === 'fk' && typeof column['references'] === 'string' && goneTables.has(column['references'])) {
            if (typeof column['ref'] === 'string') lost.add(column['ref']);
            return false;
          }
          const rules = isDoc(column['rules']) ? column['rules'] : undefined;
          if (rules !== undefined && isDoc(rules['rollup']) && typeof rules['rollup']['from'] === 'string' && goneTables.has(rules['rollup']['from'])) {
            delete rules['rollup'];
            if (Object.keys(rules).length === 0) delete column['rules'];
          }
          return true;
        });
        if (lost.size > 0) lostColumns.set(ref, lost);
        for (const key of ['indexes', 'unique'] as const) {
          if (!Array.isArray(table[key])) continue;
          const kept = list(table[key]).filter((set) => !list(set).some((column) => typeof column === 'string' && lost.has(column)));
          if (kept.length === 0) delete table[key];
          else table[key] = kept;
        }
        if (Array.isArray(table['belongs'])) {
          const kept = list(table['belongs']).filter((way) => {
            if (!isDoc(way)) return true;
            if (typeof way['via'] === 'string' && lost.has(way['via'])) return false;
            if (isDoc(way['through']) && typeof way['through']['table'] === 'string' && goneTables.has(way['through']['table'])) return false;
            return true;
          });
          if (kept.length === 0) delete table['belongs'];
          else table['belongs'] = kept;
        }
        if (isDoc(table['states']) && isDoc(table['states']['children'])) {
          for (const child of Object.keys(table['states']['children'])) if (goneTables.has(child)) delete table['states']['children'][child];
          if (Object.keys(table['states']['children']).length === 0) delete table['states']['children'];
        }
        return table;
      });
  }

  const onGoneTable = (ref: unknown): boolean => typeof ref === 'string' && goneTables.has(ref);

  const gonePages = new Set<string>();
  if (Array.isArray(out['pages'])) {
    out['pages'] = list(out['pages']).filter((page) => {
      if (!isDoc(page)) return true;
      const drop = inGone(page) || Object.values(isDoc(page['bindings']) ? page['bindings'] : {}).some(onGoneTable);
      if (drop && typeof page['ref'] === 'string') gonePages.add(page['ref']);
      return !drop;
    });
    // A dashboard's card of a part left out goes with it, and so does one that reads a table that is not made.
    for (const page of list(out['pages'])) {
      const layout = isDoc(page) && isDoc(page['config']) && isDoc(page['config']['layout']) ? page['config']['layout'] : undefined;
      if (layout === undefined || !Array.isArray(layout['items'])) continue;
      layout['items'] = list(layout['items']).filter((item) => !(inGone(item) || (isDoc(item) && cardTables(item['config']).some(onGoneTable))));
    }
  }

  // An entry of the section that belongs to a part goes with it; so does the address of a table that is not made.
  if (Array.isArray(out['navLinks'])) {
    const kept = list(out['navLinks']).filter((link) => !inGone(link));
    if (kept.length === 0) delete out['navLinks'];
    else out['navLinks'] = kept;
  }
  for (const frontend of list(out['frontends'])) {
    if (!isDoc(frontend) || !isDoc(frontend['records'])) continue;
    for (const ref of Object.keys(frontend['records'])) if (goneTables.has(ref)) delete frontend['records'][ref];
    if (Object.keys(frontend['records']).length === 0) delete frontend['records'];
  }

  if (Array.isArray(out['automations'])) {
    const kept = list(out['automations']).filter((rule) => {
      if (!isDoc(rule)) return true;
      const trigger = isDoc(rule['trigger']) ? rule['trigger'] : {};
      return !(inGone(rule) || onGoneTable(trigger['table']) || onGoneTable(isDoc(trigger['forEach']) ? trigger['forEach']['table'] : undefined));
    });
    out['automations'] = kept;
  }

  if (Array.isArray(out['documents'])) {
    const kept = list(out['documents']).filter((entry) => !(inGone(entry) || (isDoc(entry) && onGoneTable(entry['table']))));
    if (kept.length === 0) delete out['documents'];
    else out['documents'] = kept;
  }

  if (Array.isArray(out['publicAccess'])) {
    const served = (entries: readonly unknown[]) => new Set(entries.flatMap((entry) => (isDoc(entry) && typeof entry['key'] === 'string' ? [entry['key']] : [])));
    const before = served(list(out['publicAccess']));
    const kept = list(out['publicAccess']).filter((entry) => !(inGone(entry) || (isDoc(entry) && onGoneTable(entry['table']))));
    if (kept.length === 0) delete out['publicAccess'];
    else out['publicAccess'] = kept;
    // A key every entry of which went with a part goes with it: a key that serves nothing is no key of this install.
    // One that served nothing to begin with stays, for the validator to name.
    const after = served(kept);
    if (isDoc(out['publicKeys'])) {
      for (const name of Object.keys(out['publicKeys'])) if (name !== 'customer' && before.has(name) && !after.has(name)) delete out['publicKeys'][name];
      if (Object.keys(out['publicKeys']).length === 0) delete out['publicKeys'];
    }
  }

  if (Array.isArray(out['seeds'])) {
    const kept = list(out['seeds']).filter((seed) => !(isDoc(seed) && onGoneTable(seed['table'])));
    if (kept.length === 0) delete out['seeds'];
    else out['seeds'] = kept;
  }

  const outbox = isDoc(out['outbox']) ? out['outbox'] : undefined;
  if (outbox !== undefined && onGoneTable(outbox['table'])) {
    delete out['outbox'];
  } else if (outbox !== undefined) {
    const lost = lostColumns.get(text(outbox['table']) ?? '') ?? new Set<string>();
    if (isDoc(outbox['links'])) {
      for (const [name, column] of Object.entries(outbox['links'])) if (typeof column === 'string' && lost.has(column)) delete outbox['links'][name];
      if (Object.keys(outbox['links']).length === 0) delete outbox['links'];
    }
    if (Array.isArray(outbox['producers'])) {
      outbox['producers'] = list(outbox['producers']).filter((producer) => {
        if (!isDoc(producer)) return true;
        if (inGone(producer)) return false;
        if (typeof producer['link'] === 'string' && lost.has(producer['link'])) return false;
        return !['onChange', 'onCreate', 'schedule', 'from'].some((key) => isDoc(producer[key]) && onGoneTable((producer[key] as Doc)['table']));
      });
      const sent = new Set(list(outbox['producers']).flatMap((producer) => (isDoc(producer) && typeof producer['kind'] === 'string' ? [producer['kind']] : [])));
      // A kind nothing queues any more is not a kind of this install; one sent by hand keeps its place.
      const had = new Set(list((isDoc(manifest['outbox']) ? manifest['outbox']['producers'] : undefined) as unknown).flatMap((producer) => (isDoc(producer) && typeof producer['kind'] === 'string' ? [producer['kind']] : [])));
      if (isDoc(outbox['kinds'])) for (const kind of Object.keys(outbox['kinds'])) if (had.has(kind) && !sent.has(kind)) delete outbox['kinds'][kind];
    }
  }

  if (Array.isArray(out['roles'])) {
    out['roles'] = list(out['roles']).filter((role) => {
      if (!isDoc(role)) return true;
      if (Array.isArray(role['modules'])) {
        const kept = list(role['modules']).filter((id) => !(typeof id === 'string' && off.has(id)));
        if (kept.length === 0) return false;
        role['modules'] = kept;
      }
      if (Array.isArray(role['permissions'])) {
        role['permissions'] = list(role['permissions']).filter((grant) => {
          if (typeof grant !== 'string') return true;
          const [kind, ref] = grant.split(':');
          if (kind === 'table' && ref?.startsWith('@') === true) return !goneTables.has(ref.slice(1));
          if (kind === 'page' && ref?.startsWith('@') === true) return !gonePages.has(ref.slice(1));
          return true;
        });
      }
      if (isDoc(role['limits'])) {
        for (const ref of Object.keys(role['limits'])) if (goneTables.has(ref)) delete role['limits'][ref];
        if (Object.keys(role['limits']).length === 0) delete role['limits'];
      }
      return true;
    });
  }
  // A role that copied the grants of one that went stands on its own.
  if (Array.isArray(out['roles'])) {
    const kept = new Set(list(out['roles']).flatMap((role) => (isDoc(role) && typeof role['key'] === 'string' ? [role['key']] : [])));
    for (const role of list(out['roles'])) if (isDoc(role) && typeof role['cloneFrom'] === 'string' && !kept.has(role['cloneFrom'])) delete role['cloneFrom'];
  }
  return out as T;
}

/**
 * The tables a dashboard card's queries read, as the manifest names them: a
 * query's `source`, a list's `counts.table` and a team's `team.target.table`.
 */
function cardTables(value: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isDoc(node)) return;
    if (node['shape'] !== undefined && isDoc(node['source']) && typeof node['source']['name'] === 'string') {
      out.push(node['source']['name']);
      if (isDoc(node['counts']) && typeof node['counts']['table'] === 'string') out.push(node['counts']['table']);
      const target = isDoc(node['team']) && isDoc(node['team']['target']) ? node['team']['target'] : undefined;
      if (typeof target?.['table'] === 'string') out.push(target['table']);
    }
    Object.values(node).forEach(walk);
  };
  walk(value);
  return out;
}

/** The refs of the tables `withoutModules(document, gone)` would not make. */
export function tablesLeftOut(document: unknown, gone: readonly string[]): string[] {
  if (!isDoc(document)) return [];
  const off = new Set(gone);
  return tablesOf(document).flatMap((table) => (typeof table['module'] === 'string' && off.has(table['module']) && typeof table['ref'] === 'string' ? [table['ref']] : []));
}

/** The link columns `withoutModules(document, gone)` takes off the tables it keeps, by table ref. */
export function columnsLeftOut(document: unknown, gone: readonly string[]): Record<string, string[]> {
  if (!isDoc(document)) return {};
  const tables = new Set(tablesLeftOut(document, gone));
  const out: Record<string, string[]> = {};
  for (const table of tablesOf(document)) {
    if (typeof table['ref'] !== 'string' || tables.has(table['ref'])) continue;
    const lost = list(table['columns']).flatMap((column) => (isDoc(column) && column['type'] === 'fk' && typeof column['references'] === 'string' && tables.has(column['references']) && typeof column['ref'] === 'string' ? [column['ref']] : []));
    if (lost.length > 0) out[table['ref']] = lost;
  }
  return out;
}

/** Every dashboard card of the document's pages (`pages[].config.layout.items[]`), with where it is written. */
function cardsOf(document: Doc): { item: Doc; path: (string | number)[] }[] {
  return list(document['pages']).flatMap((page, p) => {
    const layout = isDoc(page) && isDoc(page['config']) && isDoc(page['config']['layout']) ? page['config']['layout'] : undefined;
    return list(layout?.['items']).flatMap((item, i) => (isDoc(item) ? [{ item, path: ['pages', p, 'config', 'layout', 'items', i] }] : []));
  });
}

/** Everything wrong with an app's `modules` and the `module` keys that name them. */
export function moduleIssues(document: unknown): ReferenceIssue[] {
  if (!isDoc(document)) return [];
  const out: ReferenceIssue[] = [];
  const declared = new Set<string>();
  const features = new Set(list(isDoc(document['addOns']) ? document['addOns']['features'] : undefined).flatMap((feature) => (isDoc(feature) && typeof feature['id'] === 'string' ? [feature['id']] : [])));
  list(document['modules']).forEach((module, i) => {
    if (!isDoc(module) || typeof module['id'] !== 'string') return;
    if (declared.has(module['id'])) out.push({ path: ['modules', i, 'id'], message: `"${module['id']}" is declared twice` });
    declared.add(module['id']);
    if (typeof module['feature'] === 'string' && !features.has(module['feature'])) {
      out.push({ path: ['modules', i, 'feature'], message: `"${module['feature']}" is not one of the app's addOns.features` });
    }
  });
  const named = (id: unknown, path: (string | number)[]): void => {
    if (typeof id === 'string' && !declared.has(id)) out.push({ path, message: `"${id}" is not one of the app's modules` });
  };
  tablesOf(document).forEach((table, t) => named(table['module'], ['requiredSchema', 'tables', t, 'module']));
  for (const block of MODULE_BLOCKS) {
    list(document[block]).forEach((entry, e) => {
      if (isDoc(entry)) named(entry['module'], [block, e, 'module']);
    });
  }
  list(isDoc(document['outbox']) ? document['outbox']['producers'] : undefined).forEach((producer, p) => {
    if (isDoc(producer)) named(producer['module'], ['outbox', 'producers', p, 'module']);
  });
  cardsOf(document).forEach(({ item, path }) => named(item['module'], [...path, 'module']));
  list(document['roles']).forEach((role, r) => {
    if (!isDoc(role) || role['modules'] === undefined) return;
    const seen = new Set<string>();
    list(role['modules']).forEach((id, k) => {
      named(id, ['roles', r, 'modules', k]);
      if (typeof id === 'string' && seen.has(id)) out.push({ path: ['roles', r, 'modules', k], message: `"${id}" is named twice` });
      if (typeof id === 'string') seen.add(id);
    });
  });
  return out;
}

/** A `module`, a `modules` or a role's `names` in an add-on's manifest: an app's words only. */
export function addOnModuleIssues(document: unknown): ReferenceIssue[] {
  if (!isDoc(document)) return [];
  const out: ReferenceIssue[] = [];
  const refuse = (path: (string | number)[]): void => {
    out.push({ path, message: 'parts are an app’s: an add-on declares no module' });
  };
  tablesOf(document).forEach((table, t) => {
    if (table['module'] !== undefined) refuse(['requiredSchema', 'tables', t, 'module']);
  });
  for (const block of MODULE_BLOCKS) {
    list(document[block]).forEach((entry, e) => {
      if (isDoc(entry) && entry['module'] !== undefined) refuse([block, e, 'module']);
    });
  }
  list(isDoc(document['outbox']) ? document['outbox']['producers'] : undefined).forEach((producer, p) => {
    if (isDoc(producer) && producer['module'] !== undefined) refuse(['outbox', 'producers', p, 'module']);
  });
  cardsOf(document).forEach(({ item, path }) => {
    if (item['module'] !== undefined) refuse([...path, 'module']);
  });
  list(document['roles']).forEach((role, r) => {
    if (isDoc(role) && role['modules'] !== undefined) refuse(['roles', r, 'modules']);
  });
  return out;
}
