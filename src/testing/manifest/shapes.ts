/*
 * VENDORED VERBATIM from packages/manifest/src/shapes.ts.
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
 * Tables built on an add-on's shape — whether an app's table really is one.
 *
 * An add-on defines a shape (`addOn.shapes`): named parts, each a set of
 * columns and the rules Adminium keeps on them (a document's numbers, totals
 * and states; its lines; its payments). An app builds its own tables on it:
 * `"builtOn": "invoices/invoice@1", "part": "document"`, spelling out every
 * column and rule of the part beside its own. Spelling them out keeps every
 * check of the app a function of its own manifest — its CI, an upload and the
 * catalogue know nothing of the add-on — and this module is what holds the
 * two together: given the shapes (the installed add-on's, or an app's
 * vendored copy), is each table what its part says?
 *
 * What an app may do to a part, and nothing else:
 *  - add columns of its own;
 *  - relabel, and add display rules (`enumLabels`, `personal`) and narrowing
 *    ones (`validation`, `required`, `requiredWhen`, `notAfter`, `notBefore`)
 *    to the part's columns;
 *  - put a `copy` in front of a column the part fills from a setting (a
 *    client's own tax rate before the add-on's default): the part's fill
 *    still answers whenever the copy comes back empty;
 *  - add to a lock's exceptions (its own columns a client may still write),
 *    give a move to some roles only, tie more child tables to the state, and
 *    empty more of its own columns when a child is created.
 *
 * Everything else — a column's type, a rule that decides a value, a move —
 * must be exactly the part's, or the install is refused `SHAPE_MISMATCH`
 * naming the column.
 *
 * Pure: no I/O, no import of the schema at run time.
 */
import type { ColumnRules } from './schema.ts';
import type { States } from './states.ts';

/** A column as a shape and an app both declare it. */
export interface ShapeColumn {
  ref: string;
  type: string;
  role?: string | undefined;
  nullable?: boolean | undefined;
  enum?: readonly string[] | undefined;
  references?: string | undefined;
  maxLength?: number | undefined;
  scale?: number | 'currency' | undefined;
  unique?: true | undefined;
  default?: string | number | boolean | undefined;
  rules?: ColumnRules | undefined;
}

export interface ShapePart {
  columns: readonly ShapeColumn[];
  states?: States | undefined;
}

export interface ShapeDefinitionView {
  name: string;
  version: number;
  parts: Readonly<Record<string, ShapePart>>;
  outbox?: { producers: readonly { kind: string }[] } | undefined;
}

export interface ShapeIssue {
  code: 'SHAPE_UNKNOWN' | 'SHAPE_MISMATCH';
  path: string;
  message: string;
}

/** `invoices` + `invoice@1` → `invoices/invoice@1`, the way an app names it. */
export function shapeKey(addOn: string, shape: { name: string; version: number }): string {
  return `${addOn}/${shape.name}@${String(shape.version)}`;
}

/** Rules an app may add to a part's column: they label or narrow, never decide. */
const ADDABLE_RULES: ReadonlySet<string> = new Set(['enumLabels', 'personal', 'secret', 'validation', 'required', 'requiredWhen', 'options', 'notAfter', 'notBefore']);

/** JSON with sorted keys, so two spellings of one value compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

interface AppTableView {
  ref: string;
  builtOn?: string | undefined;
  part?: string | undefined;
  columns: readonly (ShapeColumn & { label?: unknown })[];
  states?: States | undefined;
}

/**
 * Every way the app's tables built on a shape differ from it. `shapes` maps
 * `<addOn>/<name>@<version>` to its definition; a table built on a shape that
 * is not there is `SHAPE_UNKNOWN`.
 */
export function shapeConformanceIssues(
  app: { requiredSchema?: { tables: readonly AppTableView[] } | undefined; outbox?: { kinds: Readonly<Record<string, string>>; producers?: readonly { kind: string }[] | undefined } | undefined },
  shapes: ReadonlyMap<string, ShapeDefinitionView>,
): ShapeIssue[] {
  const out: ShapeIssue[] = [];
  const tables = app.requiredSchema?.tables ?? [];
  /** The app's table built on a part: `document` in the same shape, or `quote@1/document` in another of the add-on's. */
  const tableFor = (builtOn: string, ref: string): string | undefined => {
    const addOn = builtOn.split('/')[0]!;
    const [shape, part] = ref.includes('/') ? [`${addOn}/${ref.split('/')[0]!}`, ref.split('/')[1]!] : [builtOn, ref];
    return tables.find((t) => t.builtOn === shape && t.part === part)?.ref;
  };
  const usedShapes = new Set<string>();

  tables.forEach((table, t) => {
    if (table.builtOn === undefined || table.part === undefined) return;
    const at = (...rest: (string | number)[]) => ['requiredSchema', 'tables', t, ...rest].join('.');
    const shape = shapes.get(table.builtOn);
    if (shape === undefined) {
      out.push({ code: 'SHAPE_UNKNOWN', path: at('builtOn'), message: `"${table.builtOn}" is not a shape the add-on defines` });
      return;
    }
    usedShapes.add(table.builtOn);
    const part = shape.parts[table.part];
    if (part === undefined) {
      out.push({ code: 'SHAPE_MISMATCH', path: at('part'), message: `"${table.builtOn}" has no part "${table.part}"` });
      return;
    }
    const map = (ref: string): string => tableFor(table.builtOn!, ref) ?? `(no table built on ${ref})`;
    const mismatch = (path: string, message: string) => out.push({ code: 'SHAPE_MISMATCH', path, message });

    for (const want of part.columns) {
      const c = table.columns.findIndex((column) => column.ref === want.ref);
      const have = table.columns[c];
      if (have === undefined) {
        mismatch(at('columns'), `"${table.ref}" has no column "${want.ref}", which "${table.builtOn}" ${table.part} has`);
        continue;
      }
      const here = at('columns', c);
      const shapeOf = (column: ShapeColumn, references: string | undefined) =>
        canonical({
          type: column.type,
          role: column.role,
          nullable: column.nullable === true,
          enum: column.enum,
          references,
          maxLength: column.maxLength,
          scale: column.scale,
          unique: column.unique,
          default: column.default,
        });
      if (shapeOf(have, have.references) !== shapeOf(want, want.references === undefined ? undefined : map(want.references))) {
        mismatch(here, `"${table.ref}.${want.ref}" is not declared as the shape declares it`);
      }
      const wantRules = mapRules(want.rules, map);
      const haveRules = (have.rules ?? {}) as Record<string, unknown>;
      for (const [name, value] of Object.entries(wantRules)) {
        if (canonical(haveRules[name]) !== canonical(value)) {
          mismatch(`${here}.rules.${name}`, `"${table.ref}.${want.ref}" changes the shape's ${name} rule`);
        }
      }
      for (const name of Object.keys(haveRules)) {
        const copyBeforeFill = name === 'copy' && wantRules['default'] !== undefined && wantRules['copy'] === undefined;
        if (wantRules[name] === undefined && !ADDABLE_RULES.has(name) && !copyBeforeFill) {
          mismatch(`${here}.rules.${name}`, `"${table.ref}.${want.ref}" adds a ${name} rule the shape does not keep`);
        }
      }
    }

    if (part.states !== undefined || table.states !== undefined) {
      if (part.states === undefined) {
        // The part keeps no states: the app's own are its business.
      } else if (table.states === undefined) {
        mismatch(at('states'), `"${table.ref}" drops the shape's states`);
      } else {
        for (const message of statesDifferences(mapStates(part.states, map), table.states)) mismatch(at('states'), message);
      }
    }
  });

  // The shape's messages are part of it: an app built on it sends them.
  for (const key of usedShapes) {
    const shape = shapes.get(key)!;
    for (const producer of shape.outbox?.producers ?? []) {
      if (app.outbox?.kinds[producer.kind] === undefined || !(app.outbox.producers ?? []).some((p) => p.kind === producer.kind)) {
        out.push({ code: 'SHAPE_MISMATCH', path: 'outbox', message: `"${key}" sends "${producer.kind}", and the app's outbox does not` });
      }
    }
  }
  return out;
}

/** A part's rules with the part names they read replaced by the app's tables. */
function mapRules(rules: ColumnRules | undefined, map: (ref: string) => string): Record<string, unknown> {
  if (rules === undefined) return {};
  const out: Record<string, unknown> = { ...rules };
  if (rules.rollup !== undefined) out['rollup'] = { ...rules.rollup, from: map(rules.rollup.from) };
  const set = rules.stamp?.set;
  if (typeof set === 'object' && 'hashOf' in set) {
    const child = (c: { table: string }) => ({ ...c, table: map(c.table) });
    out['stamp'] = {
      ...rules.stamp,
      set: {
        hashOf: {
          ...set.hashOf,
          ...(set.hashOf.children === undefined ? {} : { children: set.hashOf.children.map(child) }),
          ...(set.hashOf.linked === undefined
            ? {}
            : { linked: set.hashOf.linked.map((l) => ({ ...child(l), ...(l.children === undefined ? {} : { children: l.children.map(child) }) })) }),
        },
      },
    };
  }
  return out;
}

function mapStates(states: States, map: (ref: string) => string): States {
  return {
    ...states,
    moves: Object.fromEntries(
      Object.entries(states.moves).map(([from, moves]) => [
        from,
        moves.map((move) =>
          typeof move === 'string' || move.requires?.children === undefined
            ? move
            : { ...move, requires: { ...move.requires, children: Object.fromEntries(Object.entries(move.requires.children).map(([ref, n]) => [map(ref), n])) } },
        ),
      ]),
    ),
    ...(states.children === undefined ? {} : { children: Object.fromEntries(Object.entries(states.children).map(([ref, rule]) => [map(ref), rule])) }),
    ...(states.lockedWhenReferencedBy === undefined
      ? {}
      : { lockedWhenReferencedBy: states.lockedWhenReferencedBy.map((ref) => ({ ...ref, table: map(ref.table) })) }),
  };
}

/** How an app's states differ from the part's, beyond what an app may add. */
function statesDifferences(want: States, have: States): string[] {
  const out: string[] = [];
  const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
  if (want.column !== have.column || want.initial !== have.initial) out.push('the state column and the first state are the shape\'s');
  const moveList = (moves: Readonly<Record<string, readonly unknown[]>>) =>
    Object.fromEntries(
      Object.entries(moves).map(([from, list]) => [
        from,
        list.map((move) => (typeof move === 'string' ? { to: move } : { ...(move as object), roles: undefined })),
      ]),
    );
  if (!same(moveList(want.moves), moveList(have.moves))) out.push('the moves between states are the shape\'s (an app may only keep a move for some roles)');
  if (want.lock !== undefined) {
    if (have.lock === undefined || !same(want.lock.when, have.lock.when)) out.push('the lock is the shape\'s');
    const missing = (want.lock.except ?? []).filter((ref) => !(have.lock?.except ?? []).includes(ref));
    if (missing.length > 0) out.push(`the lock keeps ${missing.join(', ')} open, as the shape does`);
  } else if (have.lock !== undefined) {
    out.push('the shape locks nothing');
  }
  for (const [ref, rule] of Object.entries(want.children ?? {})) {
    const own = have.children?.[ref];
    if (own === undefined || own.via !== rule.via || own.lock !== rule.lock || !same(own.parentIn, rule.parentIn)) {
      out.push(`"${ref}" is tied to the state as the shape ties it`);
      continue;
    }
    const cleared = (rule.clearOnCreate ?? []).filter((col) => !(own.clearOnCreate ?? []).includes(col));
    if (cleared.length > 0) out.push(`creating a "${ref}" row empties ${cleared.join(', ')}, as the shape says`);
  }
  for (const name of ['lockedWhenReferencedBy', 'noDelete', 'onlyLater'] as const) {
    if (!same(want[name], have[name])) out.push(`${name} is the shape's`);
  }
  return out;
}
