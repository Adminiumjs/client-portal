/*
 * VENDORED VERBATIM from packages/manifest/src/table-shapes.ts.
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
 * Tables two apps may share — the shapes Adminium itself writes down.
 *
 * A table declared with `"shape": "menu@1"` may be the SAME table another
 * app declared with that shape (a till and an online shop reading and
 * writing one menu). Sharing is safe only while both apps agree on the
 * columns, so each shape is written down here, column by column, and every
 * table that claims it is checked against it:
 *
 *  - the table is one of the shape's parts, by its ref;
 *  - every column of the part is there, declared exactly as the part declares
 *    it (labels and the `semantic` hint aside); the only rule an app may add
 *    to a part's column is `enumLabels` — a narrowing rule would refuse the
 *    other app's writes;
 *  - a part's link points at the table declared as the part it links to, so
 *    an app shares a menu's categories before its items;
 *  - a column an app adds is one the other app can ignore: nullable or with a
 *    default, not unique, filled by no running number or code, and linking
 *    nowhere outside the shape;
 *  - the table carries no rule that decides over the other app's rows: no
 *    states, capacity, booking or unique set.
 *
 * `menu@1` is Point of Sale 0.2.2's four menu tables, as that release
 * declares them. Pure: no I/O.
 */
import type { ColumnRules } from './schema.ts';
import { shapeConformanceIssues, type ShapeColumn, type ShapeDefinitionView } from './shapes.ts';

const id: ShapeColumn = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number | undefined, nullable = true): ShapeColumn => ({
  ref,
  type: 'text',
  ...(maxLength === undefined ? {} : { maxLength }),
  ...(nullable ? { nullable: true } : {}),
});
const position: ShapeColumn = { ref: 'position', type: 'int', default: 0 };

/** The menu a till and a shop share: categories, items, modifier groups and their modifiers. */
const MENU_V1: ShapeDefinitionView = {
  name: 'menu',
  version: 1,
  parts: {
    menu_categories: {
      columns: [id, text('slug', 48), text('name', 80, false), position, text('icon', 40), text('tint', 32)],
    },
    menu_items: {
      columns: [
        id,
        { ref: 'category_id', type: 'fk', references: 'menu_categories', nullable: true },
        text('slug', 64),
        text('name', 80, false),
        text('short_name', 24),
        text('description', 280),
        { ref: 'price', type: 'money', default: 0 },
        text('image', undefined),
        { ref: 'available', type: 'bool', default: true },
        { ref: 'featured', type: 'bool', default: false },
        text('tags', 120),
        position,
        text('barcode', 64),
      ],
    },
    modifier_groups: {
      columns: [
        id,
        { ref: 'item_id', type: 'fk', references: 'menu_items' },
        text('slug', 48),
        text('name', 80, false),
        { ref: 'kind', type: 'enum', enum: ['radio', 'check'], default: 'radio' },
        { ref: 'min', type: 'int', default: 0 },
        { ref: 'max', type: 'int', default: 1 },
        text('hint', 120),
        position,
      ],
    },
    modifiers: {
      columns: [
        id,
        { ref: 'group_id', type: 'fk', references: 'modifier_groups' },
        text('slug', 48),
        text('name', 80, false),
        { ref: 'price_delta', type: 'money', default: 0 },
        { ref: 'available', type: 'bool', default: true },
        position,
      ],
    },
  },
};

/** Every shape Adminium writes down, by `<name>@<version>`. */
export const TABLE_SHAPES: ReadonlyMap<string, ShapeDefinitionView> = new Map([['menu@1', MENU_V1]]);

/** The only rule an app may add to a shared column: it labels, and narrows nothing. */
const ADDABLE_TO_SHARED: ReadonlySet<string> = new Set(['enumLabels']);

/** What these checks read of a table. */
interface SharedTableView {
  ref: string;
  shape?: string | undefined;
  columns: readonly (ShapeColumn & { label?: unknown; semantic?: unknown })[];
  states?: unknown;
  capacity?: unknown;
  booking?: unknown;
  unique?: unknown;
}

export interface TableShapeIssue {
  code: 'TABLE_SHAPE_UNKNOWN' | 'TABLE_SHAPE_PART' | 'TABLE_SHAPE_MISMATCH' | 'TABLE_SHAPE_REFERENCE' | 'TABLE_SHAPE_EXTRA' | 'TABLE_SHAPE_TABLE_RULE';
  path: string;
  message: string;
}

/** Every way the app's tables declared with a shape differ from it. */
export function tableShapeIssues(m: { requiredSchema?: { tables: readonly SharedTableView[] } | undefined }): TableShapeIssue[] {
  const out: TableShapeIssue[] = [];
  const tables = m.requiredSchema?.tables ?? [];
  const at = (t: number, ...rest: (string | number)[]) => ['requiredSchema', 'tables', t, ...rest].join('.');
  /** The app's tables that are a part of a shape we know, keyed `<shape>|<part>`. */
  const parts = new Set<string>();

  tables.forEach((table, t) => {
    if (table.shape === undefined) return;
    const shape = TABLE_SHAPES.get(table.shape);
    if (shape === undefined) {
      out.push({ code: 'TABLE_SHAPE_UNKNOWN', path: at(t, 'shape'), message: `"${table.shape}" is not a shape Adminium knows (${[...TABLE_SHAPES.keys()].join(', ')})` });
      return;
    }
    if (shape.parts[table.ref] === undefined) {
      out.push({ code: 'TABLE_SHAPE_PART', path: at(t, 'ref'), message: `"${table.ref}" is not a table of "${table.shape}" (${Object.keys(shape.parts).join(', ')})` });
      return;
    }
    parts.add(`${table.shape}|${table.ref}`);
  });

  // Each shaped table as a table built on its part, checked the way an add-on's shape is.
  // States are left out: a shared table keeps none (below), and a part has none to compare.
  const view = tables.map((table) =>
    parts.has(`${table.shape ?? ''}|${table.ref}`)
      ? { ref: table.ref, columns: table.columns, builtOn: table.shape, part: table.ref }
      : { ref: table.ref, columns: table.columns },
  );
  /** Column paths whose part link names a part the app does not declare: said once, as a reference. */
  const unreferenced = new Set<string>();
  tables.forEach((table, t) => {
    if (!parts.has(`${table.shape ?? ''}|${table.ref}`)) return;
    const part = TABLE_SHAPES.get(table.shape!)!.parts[table.ref]!;
    for (const want of part.columns) {
      if (want.references === undefined || parts.has(`${table.shape!}|${want.references}`)) continue;
      const c = table.columns.findIndex((column) => column.ref === want.ref);
      if (c === -1) continue;
      unreferenced.add(at(t, 'columns', c));
      out.push({
        code: 'TABLE_SHAPE_REFERENCE',
        path: at(t, 'columns', c),
        message: `"${table.ref}.${want.ref}" links to the "${table.shape!}" table "${want.references}", so the app declares that table too`,
      });
    }
  });
  for (const issue of shapeConformanceIssues({ requiredSchema: { tables: view } }, TABLE_SHAPES, { addable: ADDABLE_TO_SHARED })) {
    if (unreferenced.has(issue.path)) continue;
    out.push({ code: 'TABLE_SHAPE_MISMATCH', path: issue.path, message: issue.message });
  }

  tables.forEach((table, t) => {
    if (!parts.has(`${table.shape ?? ''}|${table.ref}`)) return;
    const shape = table.shape!;
    const part = TABLE_SHAPES.get(shape)!.parts[table.ref]!;
    const declared = new Set(part.columns.map((column) => column.ref));
    table.columns.forEach((column, c) => {
      if (declared.has(column.ref)) return;
      const here = at(t, 'columns', c);
      const extra = (why: string) => out.push({ code: 'TABLE_SHAPE_EXTRA', path: here, message: `"${table.ref}.${column.ref}" is a column the other app sharing "${shape}" never fills, so it ${why}` });
      const rules = column.rules as ColumnRules | undefined;
      if (column.nullable !== true && column.default === undefined) extra('is nullable or has a default');
      if (column.unique === true) extra('is not unique');
      if (rules?.code !== undefined || rules?.sequence !== undefined) extra('is not numbered or coded by Adminium');
      if (column.type === 'fk' && (column.references === undefined || !parts.has(`${shape}|${column.references}`))) extra(`links only to another table of "${shape}"`);
    });
    for (const rule of ['states', 'capacity', 'booking', 'unique'] as const) {
      if (table[rule] !== undefined) {
        out.push({ code: 'TABLE_SHAPE_TABLE_RULE', path: at(t, rule), message: `"${table.ref}" is shared under "${shape}", so it keeps no ${rule} rule over the other app's rows` });
      }
    }
  });
  return out;
}

/** The refs of the app's tables declared with each shape. */
export function shapeTables(m: { requiredSchema?: { tables: readonly { ref: string; shape?: string | undefined }[] } | undefined }): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const table of m.requiredSchema?.tables ?? []) {
    if (table.shape === undefined) continue;
    out.set(table.shape, [...(out.get(table.shape) ?? []), table.ref]);
  }
  return out;
}

/** The shape one of the app's tables is declared with, or null. */
export function tableShapeOf(m: { requiredSchema?: { tables: readonly { ref: string; shape?: string | undefined }[] } | undefined }, ref: string): string | null {
  return m.requiredSchema?.tables.find((table) => table.ref === ref)?.shape ?? null;
}
