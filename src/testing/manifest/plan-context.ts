/*
 * VENDORED VERBATIM from packages/manifest/src/plan-context.ts.
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
 * Planning an APP install with what the server knows about this connection:
 * the app's prefix, the tables it already recorded here, what other apps
 * record here, and the operator's answers for the tables whose names are taken.
 *
 * ─── Why a context at all ───────────────────────────────────────────────────
 *
 * Without one, a table either exists (reuse) or does not (create), and that
 * was the whole plan. It could not tell the app's own table from an earlier
 * install apart from another app's table of the same name, could not offer
 * to rename a stranger's table out of the way, and could not give an app its
 * own prefix. Each table is now CLASSIFIED first, then given an ACTION:
 *
 *   new           the real name is free                     → create
 *   own-leftover  this app recorded it (an earlier install) → reuse (default)
 *   shared        another app records a table of the SAME shape (`menu@1`)
 *                 and short name, whatever its real name     → share (default)
 *                 or keep a separate one (`separate`)
 *   taken         it exists and nothing records it as this app's
 *                                                            → the operator chooses
 *
 * For a taken table the operator chooses: REUSE it (offered only when it is
 * not another app's in disguise and every change it needs is safe), RENAME the
 * existing table out of the way (only when no other install records it), or
 * give the whole app a DIFFERENT PREFIX (always offered, and it applies to
 * every table at once). Until each taken table has an answer, the plan is not
 * installable and says which table is waiting.
 *
 * ─── Edits ─────────────────────────────────────────────────────────────────
 *
 * A reused table may need changes before the app can write to it. Only changes
 * that cannot lose data are ever offered: adding a missing column (nullable),
 * widening a type along a fixed list (a longer varchar, varchar to text, int
 * to bigint, a wider enum column), giving an int key the identity it lacks, and
 * adding enum values. Anything else is refused on this screen, by name.
 *
 * Pure, like the planner it extends: no I/O. The server gathers the context.
 */

import type {
  ExistingColumnView,
  InstallPlan,
  InstallTablePlan,
  PlanContext,
  PlanProblem,
  SchemaModelView,
  ShareOffer,
  TableClass,
} from './plan-model.ts';
import { MYSQL_UNIQUE_KEY_BYTES, uniqueSetBytes, uniqueTextWidth } from './key-bytes.ts';
import { ledgerIndexes } from './ledger-indexes.ts';
import { typeConflict } from './plan-types.ts';
import { installsLikeAnApp, type Manifest, type RequiredColumn, type RequiredTable } from './schema.ts';

export type {
  ContextTableAction as TableAction,
  InstallTablePlan,
  PlanContext,
  PlanEdit,
  ShareChoice,
  ShareOffer,
  TableChoice,
  TableClass,
  TableOffer,
} from './plan-model.ts';


/** The longest identifier each engine accepts, in bytes. SQLite has none; the portable 63 holds. */
export const IDENTIFIER_LIMIT: Readonly<Record<PlanContext['dialect'], number>> = {
  postgres: 63,
  mysql: 64,
  sqlite: 63,
};

/** `adminium_roles.slug` is 40 characters. */
export const ROLE_SLUG_LIMIT = 40;

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** The type a declared column is created with, for an edit's `to` — the installer's own vocabulary. */
function declaredShape(column: RequiredColumn): string {
  if (column.type === 'text' && column.maxLength !== undefined) return `varchar(${String(column.maxLength)})`;
  if (column.type === 'enum') {
    const width = (column.enum ?? []).every((value) => value.length <= 32) ? 32 : 64;
    return `varchar(${String(width)})`;
  }
  return column.type;
}

/**
 * The widening that would let an existing column hold what the manifest
 * stores, or null when there is no such safe change.
 */
function wideningFor(
  declared: RequiredColumn,
  have: ExistingColumnView,
  dialect: PlanContext['dialect'],
): { from: string; to: string } | null {
  const type = have.logicalType;
  const width = typeof have.maxLength === 'number' ? have.maxLength : null;
  if (declared.type === 'text' && type === 'varchar' && width !== null) {
    return { from: `varchar(${String(width)})`, to: declaredShape(declared) };
  }
  if (declared.type === 'enum' && type === 'varchar' && width !== null) {
    return { from: `varchar(${String(width)})`, to: declaredShape(declared) };
  }
  if (declared.type === 'bigint' && type === 'integer') {
    // MySQL cannot change the type of a key another table's foreign key points
    // at; a primary key is where that is all but certain.
    if (dialect === 'mysql' && have.isPrimaryKey === true) return null;
    return { from: 'integer', to: 'bigint' };
  }
  return null;
}

/**
 * The columns a declared column must be unique with, as a table made with it
 * is: alone (`[]`) when declared `unique`, a code, or a number without gaps
 * across the table; with its parent row when the number counts per parent;
 * null when it need not be unique.
 */
export function uniqueWithOf(column: RequiredColumn): string[] | null {
  const sequence = column.rules?.sequence;
  if (sequence?.gapless === true) return sequence.scope === undefined ? [] : [sequence.scope];
  return column.unique === true || column.rules?.code !== undefined ? [] : null;
}

/**
 * Whether a column that is there can carry a foreign key to the key a link
 * points at: the live table's own key where the table is there, else the key
 * the manifest declares for a table this plan makes. Their logical types must
 * be the same; and on MySQL their own types too, to the letter — it reads
 * `int` and `int unsigned` (and `smallint`) all as integers, and refuses a
 * foreign key between any two of them. False when it cannot be told (a key
 * over several columns, a type no plain column carries): no link is offered.
 */
function carriesLinkTo(
  have: ExistingColumnView,
  references: string,
  required: readonly RequiredTable[],
  names: Readonly<Record<string, string>>,
  live: ReadonlyMap<string, { columns: readonly ExistingColumnView[] }>,
  dialect: PlanContext['dialect'],
): boolean {
  const existing = live.get(names[references] ?? references);
  if (existing !== undefined) {
    const keys = existing.columns.filter((c) => c.isPrimaryKey === true);
    const key = keys.length === 1 ? keys[0]! : null;
    if (key === null || key.logicalType === undefined || key.logicalType !== have.logicalType) return false;
    if (dialect !== 'mysql') return true;
    // Not told of either: nothing is offered on a guess.
    return key.dbType !== undefined && have.dbType !== undefined && key.dbType.trim().toLowerCase() === have.dbType.trim().toLowerCase();
  }
  const keys = (required.find((t) => t.ref === references)?.columns ?? []).filter((c) => c.role === 'pk');
  if (keys.length !== 1) return false;
  const made = keys[0]!.type === 'int' ? 'integer' : keys[0]!.type === 'bigint' ? 'bigint' : keys[0]!.type === 'uuid' ? 'uuid' : null;
  return made !== null && have.logicalType === made;
}

/**
 * Whether the table keeps `columns` unique together already: a unique on
 * exactly those columns, or (for one column) the column read back as unique.
 * Unknown counts as kept, so nothing is offered on a guess.
 */
function keepsUnique(table: SchemaModelView['tables'][number] | undefined, have: ExistingColumnView, columns: readonly string[]): boolean {
  if (columns.length === 1 && have.isUnique !== undefined) return have.isUnique;
  if (table?.uniques === undefined) return true;
  const wanted = [...columns].sort().join('\u0000');
  return table.uniques.some((unique) => [...unique].sort().join('\u0000') === wanted);
}

/** Whether the table keeps these columns unique together already; unknown counts as kept. */
function keepsSet(table: SchemaModelView['tables'][number] | undefined, columns: readonly string[]): boolean {
  if (table?.uniques === undefined) return true;
  const wanted = [...columns].sort().join('\u0000');
  return table.uniques.some((unique) => [...unique].sort().join('\u0000') === wanted);
}

/**
 * A column an update can add to a table that exists. A link (`fk`) can, when
 * it is nullable: every existing row starts unlinked, and the schema editor
 * adds the foreign key beside it. A required link cannot — the rows already
 * there would have nothing to point at.
 */
function isOfferable(column: RequiredColumn): boolean {
  if (column.type === 'fk') return column.nullable === true;
  return column.type !== 'id' && column.type !== 'blob';
}

/** The states in which another app's record means its table is there, in use. */
const SHARING_STATES: ReadonlySet<string> = new Set(['created', 'adopted', 'shared']);

/**
 * This app's record of a table it shared and left behind (uninstalled, tables
 * kept) that another app still uses under the same shape: never the app's
 * own. A reinstall is offered that app's tables again, as a first install is.
 */
function leftShare(record: PlanContext['records'][string] | undefined, shape: string | undefined, context: PlanContext): boolean {
  if (record === undefined || record.state !== 'released' || record.owned || shape === undefined) return false;
  return context.others.some((o) => o.table === record.table && o.shape === shape && SHARING_STATES.has(o.state));
}

/** A record this app goes on using as its own: not dropped, and not a table it only shared and left. */
function holdsOwn(record: PlanContext['records'][string] | undefined, shape: string | undefined, context: PlanContext): boolean {
  return record !== undefined && record.state !== 'dropped' && !leftShare(record, shape, context);
}

/** Another app whose tables of one shape cover every table of that shape this app declares. */
interface ShareCandidate {
  appKey: string;
  /** This app's short name → that app's real table. */
  tables: Map<string, string>;
  /** When its first record of them was made: the first installed is recommended. */
  since: number;
}

/**
 * Per shape the app declares, the other apps whose tables of that shape it
 * may use, and the operator's answer applied: `targets` names each shared
 * table's real name by the app's short name.
 *
 * A candidate records every table of the shape the app declares, by the same
 * short name and shape, each one there. An app with any record of its own
 * for those tables (an update, a reinstall) is offered nothing: it keeps the
 * tables it has, and two menus are never merged. Two candidates that are the
 * same tables (one app already shares the other's) are offered once, as the
 * first installed.
 */
function shareTargetsOf(
  required: readonly RequiredTable[],
  model: SchemaModelView,
  context: PlanContext,
): { offers: ShareOffer[]; targets: Map<string, { appKey: string; table: string }>; problems: PlanProblem[] } {
  const offers: ShareOffer[] = [];
  const targets = new Map<string, { appKey: string; table: string }>();
  const problems: PlanProblem[] = [];
  const live = new Map(model.tables.map((t) => [t.ref, t]));
  const byShape = new Map<string, RequiredTable[]>();
  for (const table of required) {
    if (table.shape !== undefined) byShape.set(table.shape, [...(byShape.get(table.shape) ?? []), table]);
  }
  for (const [shape, tables] of byShape) {
    if (tables.some((t) => holdsOwn(context.records[t.ref], t.shape, context))) continue;
    const apps = new Map<string, ShareCandidate>();
    for (const o of context.others) {
      if (o.ref === undefined || o.shape !== shape || !SHARING_STATES.has(o.state) || !live.has(o.table)) continue;
      if (!tables.some((t) => t.ref === o.ref)) continue;
      const entry = apps.get(o.appKey) ?? { appKey: o.appKey, tables: new Map<string, string>(), since: Number.POSITIVE_INFINITY };
      entry.tables.set(o.ref, o.table);
      entry.since = Math.min(entry.since, o.createdAt ?? Number.POSITIVE_INFINITY);
      apps.set(o.appKey, entry);
    }
    const complete = [...apps.values()]
      .filter((a) => tables.every((t) => a.tables.has(t.ref)))
      .sort((a, b) => a.since - b.since || (a.appKey < b.appKey ? -1 : a.appKey > b.appKey ? 1 : 0));
    const seen = new Set<string>();
    const candidates = complete.filter((a) => {
      const key = tables.map((t) => a.tables.get(t.ref)!).join('\u0000');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (candidates.length === 0) continue;

    const answer = context.shares?.[shape];
    let chosen = candidates[0]!;
    if (answer?.action === 'share') {
      const picked = candidates.find((c) => c.appKey === answer.with);
      if (picked === undefined) {
        problems.push({
          code: 'TABLE_TAKEN',
          table: tables[0]!.ref,
          message: `"${answer.with}" has no "${shape}" tables this app can use here. Pick again.`,
        });
      } else chosen = picked;
    }
    const action = answer?.action === 'separate' ? 'separate' : 'share';
    const addColumns: ShareOffer['addColumns'] = [];
    for (const table of tables) {
      const real = chosen.tables.get(table.ref)!;
      const have = live.get(real)!;
      for (const column of table.columns) {
        if (!have.columns.some((c) => c.ref === column.ref) && isOfferable(column)) addColumns.push({ table: real, column: column.ref });
      }
      if (action === 'share') targets.set(table.ref, { appKey: chosen.appKey, table: real });
    }
    offers.push({
      shape,
      with: chosen.appKey,
      candidates: candidates.map((c) => c.appKey),
      action,
      tables: tables.map((t) => chosen.tables.get(t.ref)!),
      addColumns,
    });
  }
  return { offers, targets, problems };
}

/**
 * The context half of `planInstall`. Called by it when a context is given;
 * the returned plan keeps every field older callers read (`create`, `reuse`,
 * `references`, `problems`) and adds `tables` and `names`.
 */
export function planWithContext(
  manifest: Manifest,
  model: SchemaModelView,
  context: PlanContext,
): InstallPlan {
  const noun = manifest.kind === 'app' ? 'app' : 'add-on';
  const required: readonly RequiredTable[] = manifest.requiredSchema?.tables ?? [];
  const live = new Map(model.tables.map((t) => [t.ref, t]));
  const ledgerSets = ledgerIndexes(manifest);
  // Index and constraint names are per schema (Postgres) or per database (SQLite): a new rule's name takes none.
  const takenNames = new Set([...(model.indexNames ?? []), ...model.tables.flatMap((t) => t.indexNames ?? [])]);
  const limit = IDENTIFIER_LIMIT[context.dialect];
  const problems: PlanProblem[] = [];
  const prefix = context.prefix === null ? null : (context.altPrefix ?? context.prefix);

  if (context.altPrefix !== undefined && !/^[a-z][a-z0-9_]*_$/.test(context.altPrefix)) {
    problems.push({
      code: 'IDENTIFIER_TOO_LONG',
      table: context.altPrefix,
      message: `"${context.altPrefix}" is not a usable prefix: lower-case letters, digits and "_", ending in "_".`,
    });
  }

  // 0. Tables another app has under a shape this app declares, whatever their
  //    real names: offered to be used as this app's own (the first installed
  //    recommended), unless the operator keeps separate ones.
  const { offers: shareOffers, targets: shareTargets, problems: shareProblems } = shareTargetsOf(required, model, context);
  problems.push(...shareProblems);

  // 1. Real names. A record wins (it is what this app already uses here); a
  //    table shared with another app keeps that app's name; an alternative
  //    prefix re-names everything else.
  const names: Record<string, string> = {};
  for (const table of required) {
    const record = context.records[table.ref];
    const usable = record !== undefined && holdsOwn(record, table.shape, context);
    const target = shareTargets.get(table.ref);
    names[table.ref] =
      usable && (context.altPrefix === undefined || record.state === 'shared')
        ? record.table
        : target !== undefined
          ? target.table
          : prefix === null
            ? table.ref
            : `${prefix}${table.ref}`;
  }
  const realNames = new Set(Object.values(names));

  const tables: InstallTablePlan[] = [];
  for (const table of required) {
    const real = names[table.ref]!;
    const left = leftShare(context.records[table.ref], table.shape, context);
    const record = left ? undefined : context.records[table.ref];
    const existing = live.get(real);
    // What a ledger of the manifest needs of this table: its receipt key, the indexes its rows are read by.
    const derived = ledgerSets.filter((index) => index.table === table.ref);
    const holders = context.others.filter((o) => o.table === real && o.state !== 'dropped');
    const choice = context.choices?.[table.ref];

    if (byteLength(real) > limit) {
      problems.push({
        code: 'IDENTIFIER_TOO_LONG',
        table: table.ref,
        message: `"${real}" is longer than this database allows (${String(limit)} bytes). Choose a shorter prefix.`,
      });
    }
    for (const column of table.columns) {
      if (column.type !== 'fk') continue;
      const fk = `fk_${real}_${column.ref}`;
      if (byteLength(fk) > limit) {
        problems.push({
          code: 'IDENTIFIER_TOO_LONG',
          table: table.ref,
          column: column.ref,
          message: `The foreign key "${fk}" would be longer than this database allows (${String(limit)} bytes). Choose a shorter prefix.`,
        });
      }
    }

    // 2. Classify. A table this app already shares with another (an update)
    //    stays shared: it is never taken for the app's own.
    const sharedRecord = record !== undefined && record.state === 'shared';
    const ownRecord = record !== undefined && record.state !== 'dropped' && (context.altPrefix === undefined || sharedRecord);
    const target = shareTargets.get(table.ref);
    const sharer =
      target !== undefined
        ? { appKey: target.appKey }
        : table.shape === undefined
          ? undefined
          : holders.find((o) => o.shape === table.shape && o.state !== 'released');
    const klass: TableClass =
      existing === undefined
        ? 'new'
        : sharedRecord
          ? 'shared'
          : ownRecord
            ? 'own-leftover'
            : sharer !== undefined
              ? 'shared'
              : 'taken';

    // An update taking the shape off a table another app shares under it.
    if (ownRecord && existing !== undefined) {
      const partner = holders.find((o) => o.shape !== null && o.state !== 'released' && o.shape !== table.shape);
      if (partner !== undefined) {
        problems.push({
          code: 'SHAPE_IN_USE',
          table: table.ref,
          message:
            `"${real}" is shared with ${partner.appName ?? `"${partner.appKey}"`} as "${partner.shape!}", so this version must keep declaring it that way. ` +
            `Uninstall ${partner.appName ?? `"${partner.appKey}"`} first, or keep the shape.`,
        });
      }
    }

    // Two apps whose prefixed names meet. A declared shape both share is the
    // one way two apps may use one table.
    if (holders.length > 0 && sharer === undefined && !ownRecord) {
      problems.push({
        code: 'PREFIX_COLLISION',
        table: table.ref,
        message:
          `"${real}" is already "${holders[0]!.appKey}"'s table, so this ${noun} cannot use that name. ` +
          `Give this ${noun} a different prefix.`,
      });
    }

    // Why reuse is not safe for a stranger's table.
    const declaredColumns = new Set(table.columns.map((c) => c.ref));
    const foreign =
      existing === undefined
        ? []
        : existing.columns.filter(
            (c) =>
              !declaredColumns.has(c.ref) &&
              c.nullable === false &&
              c.hasDefault !== true &&
              c.isPrimaryKey !== true &&
              c.isGenerated !== true,
          );

    const plan: InstallTablePlan = {
      ref: table.ref,
      table: real,
      class: klass,
      action: 'create',
      offers: [],
      edits: [],
      blocked: [],
      ...(table.shape === undefined ? {} : { shape: table.shape }),
    };

    if (klass === 'new') {
      plan.action = 'create';
    } else if (klass === 'own-leftover') {
      // Never renamed while another app still uses it: that would move its table from under it.
      const used = holders.some((o) => o.state !== 'released');
      plan.offers = used ? ['reuse', 'alt-prefix'] : ['reuse', 'rename-existing', 'alt-prefix'];
      if (record?.owned === false) plan.adopted = true;
      plan.action = choice?.action === 'rename-existing' && !used ? 'rename-existing' : 'reuse';
    } else if (klass === 'shared' && sharedRecord) {
      // An update of an app that shares the table: it goes on sharing it,
      // with whichever app still keeps it (none, once that app has left).
      const live = holders.filter((o) => o.state !== 'released');
      const keeper = live.find((o) => o.state === 'created' || o.state === 'adopted') ?? live[0];
      plan.offers = ['share'];
      if (keeper !== undefined) plan.sharedWith = keeper.appKey;
      plan.action = 'share';
    } else if (klass === 'shared') {
      plan.offers = target !== undefined ? ['share', 'separate'] : ['share', 'alt-prefix'];
      plan.sharedWith = sharer!.appKey;
      plan.action = 'share';
    } else {
      plan.offers = ['alt-prefix'];
      if (foreign.length === 0) plan.offers.unshift('reuse');
      else {
        plan.reuseRefusal =
          `It requires ${foreign.map((c) => `"${c.ref}"`).join(', ')}, which this ${noun} never fills, ` +
          `so every row the ${noun} saves there would be refused.`;
      }
      if (holders.length === 0) plan.offers.splice(plan.offers.length - 1, 0, 'rename-existing');
      if (choice === undefined) plan.action = 'undecided';
      else if (choice.action === 'reuse' && plan.offers.includes('reuse')) plan.action = 'reuse';
      else if (choice.action === 'rename-existing' && plan.offers.includes('rename-existing')) plan.action = 'rename-existing';
      else plan.action = 'undecided';
    }

    if (plan.action === 'rename-existing') {
      const to = choice?.action === 'rename-existing' ? choice.to : `${real}_old`;
      plan.renameExistingTo = to;
      if (!IDENTIFIER.test(to) || byteLength(to) > limit || live.has(to) || realNames.has(to)) {
        problems.push({
          code: 'TABLE_TAKEN',
          table: table.ref,
          message: `"${to}" cannot be the existing table's new name: it must be a free, lower-case name of at most ${String(limit)} bytes.`,
        });
      }
    }

    if (plan.action === 'undecided') {
      problems.push({
        code: 'TABLE_TAKEN',
        table: table.ref,
        message: `"${real}" already exists and was made by hand. Pick what to do with it before you install.`,
      });
    }

    // 3. Edits, for a table the app will use as it is.
    if ((plan.action === 'reuse' || plan.action === 'share') && existing !== undefined) {
      for (const column of table.columns) {
        const have = existing.columns.find((c) => c.ref === column.ref);
        if (have === undefined) {
          if (isOfferable(column)) plan.edits.push({ kind: 'add-column', column: column.ref });
          else {
            plan.blocked.push({
              column: column.ref,
              reason: column.type === 'id' ? 'primary-key' : column.type === 'fk' ? 'foreign-key' : 'unsupported-type',
            });
          }
          continue;
        }
        const conflict = typeConflict(column, have, context.dialect);
        if (conflict !== null) {
          const widen = wideningFor(column, have, context.dialect);
          if (widen !== null) plan.edits.push({ kind: 'widen', column: column.ref, ...widen });
          else {
            problems.push({
              code: 'COLUMN_TYPE_CONFLICT',
              table: table.ref,
              column: column.ref,
              message: `"${real}.${column.ref}" already exists as ${conflict}, which cannot hold the ${column.type} values this ${noun} stores in it.`,
            });
          }
          continue;
        }
        if (column.role === 'pk' && (column.type === 'int' || column.type === 'bigint') && have.isIdentity === false) {
          plan.edits.push({ kind: 'set-identity', column: column.ref });
        }
        if (column.type === 'enum' && have.enumValues !== undefined) {
          const missing = (column.enum ?? []).filter((value) => !have.enumValues!.includes(value));
          if (missing.length > 0) plan.edits.push({ kind: 'enum-values', column: column.ref, values: missing });
        }
        /*
         * A column the app declares a link that the table keeps with no
         * foreign key: linked, as a fresh install links it. Left out, the
         * database knows no parent for the row, and everything that follows
         * the link (a rule that posts through it, a list under its parent)
         * finds nothing. Only on a table the app made, where the column's
         * type is the target key's, and the server first checks every row
         * points at a row that is there. A table the app took over from
         * somebody else (adopted) is left as its owner keeps it: a server
         * that may not edit such a table would refuse the whole update, and
         * one stray row in it would stop an update that asked for nothing.
         */
        if (plan.action === 'reuse' && plan.adopted !== true && column.type === 'fk' && column.references !== undefined && have.linksTo === null) {
          if (carriesLinkTo(have, column.references, required, names, live, context.dialect)) plan.edits.push({ kind: 'add-link', column: column.ref, to: column.references });
        }
        /*
         * A column the app keeps unique that the table does not: made so, as
         * a fresh install makes it. Left out, a column an earlier update added
         * without its rule (or a table the operator made) would take the same
         * value twice for good. Only on a table the app uses as its own, and
         * the server first checks no two rows already break it.
         */
        const uniqueWith = column.role === 'pk' ? null : uniqueWithOf(column);
        if (plan.action === 'reuse' && uniqueWith !== null && !keepsUnique(existing, have, [...uniqueWith, column.ref])) {
          plan.edits.push(uniqueWith.length === 0 ? { kind: 'add-unique', column: column.ref } : { kind: 'add-unique', column: column.ref, with: uniqueWith });
        }
      }
      /*
       * A set of columns the app keeps unique together that the table does
       * not: made so, by its own name, as a fresh install makes it — over
       * columns the same update adds too. Never on a table another app's
       * shape shares (a shaped table declares none).
       */
      if (plan.action === 'reuse') {
        // A plain index a limit or a total counts by, where the table has none leading with the column.
        for (const column of table.columns) {
          if (column.index !== true || existing.indexed === undefined || existing.indexed.includes(column.ref)) continue;
          const name = plainIndexName(real, column.ref, takenNames);
          takenNames.add(name);
          plan.edits.push({ kind: 'add-index', column: column.ref, name });
        }
        const reachable = (set: readonly string[]): boolean => set.every((ref) => existing.columns.some((c) => c.ref === ref) || plan.edits.some((e) => e.kind === 'add-column' && e.column === ref));
        // The sets the app declares, and the one key a ledger's receipt table is kept by.
        for (const set of [...(table.unique ?? []), ...derived.filter((index) => index.unique).map((index) => index.columns)]) {
          if (!reachable(set) || keepsSet(existing, set)) continue;
          const name = uniqueSetName(real, set, takenNames);
          takenNames.add(name);
          plan.edits.push({ kind: 'add-unique', column: set.at(-1)!, with: set.slice(0, -1), name });
        }
        /*
         * The plain indexes the table declares and the ones a ledger reads by,
         * where the table has none that starts with exactly those columns in
         * that order (one that goes on after them serves as well). Compared by
         * the whole list: (a) being indexed says nothing about (a, b).
         */
        if (existing.indexSets !== undefined) {
          const have = [...existing.indexSets.map((set) => [...set])];
          for (const edit of plan.edits) if (edit.kind === 'add-index') have.push([edit.column]);
          for (const set of [...(table.indexes ?? []), ...derived.filter((index) => !index.unique).map((index) => index.columns)]) {
            if (!reachable(set) || have.some((live) => set.every((ref, at) => live[at] === ref))) continue;
            const name = indexSetName(real, set, takenNames);
            takenNames.add(name);
            have.push([...set]);
            plan.edits.push({ kind: 'add-index', column: set.at(-1)!, ...(set.length === 1 ? {} : { with: set.slice(0, -1) }), name });
          }
        }
      }
      if (plan.blocked.length > 0) {
        problems.push({
          code: 'COLUMNS_REQUIRED',
          table: table.ref,
          column: plan.blocked[0]!.column,
          message:
            `"${real}" is missing ${plan.blocked.map((b) => `"${b.column}"`).join(', ')}, which cannot be added ` +
            `to a table that already exists. Rename that table out of the way, or use a different prefix.`,
        });
      }
    }
    /*
     * A unique text column wider than MySQL can index is refused here, on the
     * check, for an install and an update alike: made anyway, the table (or
     * the column an update adds) would go in and the rule would not.
     */
    if (context.dialect === 'mysql' && plan.action !== 'share' && plan.action !== 'undecided') {
      // An index is bounded as a unique rule is: the same key, the same bytes.
      for (const set of table.indexes ?? []) {
        const bytes = uniqueSetBytes(set, table, required);
        if (bytes <= MYSQL_UNIQUE_KEY_BYTES) continue;
        problems.push({
          code: 'UNIQUE_KEY_TOO_LONG',
          table: table.ref,
          column: set.at(-1)!,
          message:
            `"${real}" is indexed by ${set.join(', ')}, and MySQL can index at most ${String(MYSQL_UNIQUE_KEY_BYTES)} bytes ` +
            `together: these take up to ${String(bytes)}, so it cannot be used on MySQL. Make the text columns shorter.`,
        });
      }
      for (const set of table.unique ?? []) {
        const bytes = uniqueSetBytes(set, table, required);
        if (bytes <= MYSQL_UNIQUE_KEY_BYTES) continue;
        problems.push({
          code: 'UNIQUE_KEY_TOO_LONG',
          table: table.ref,
          column: set.at(-1)!,
          message:
            `"${real}" may hold the same ${set.join(', ')} only once, and MySQL can keep that only for at most ${String(MYSQL_UNIQUE_KEY_BYTES)} bytes ` +
            `together: these take up to ${String(bytes)}, so it cannot be used on MySQL. Make the text columns shorter.`,
        });
      }
      const most = MYSQL_UNIQUE_KEY_BYTES / 4;
      for (const column of table.columns) {
        const width = uniqueTextWidth(column);
        if (width === null || width <= most) continue;
        problems.push({
          code: 'UNIQUE_KEY_TOO_LONG',
          table: table.ref,
          column: column.ref,
          message:
            `"${real}.${column.ref}" may hold no value twice, and MySQL can keep that only for text of at most ${String(most)} ` +
            `characters: this ${noun} allows ${String(width)}, so it cannot be used on MySQL.`,
        });
      }
    }
    tables.push(plan);
  }

  // 4. References, against real names.
  const references: InstallPlan['references'] = [];
  const declared = new Set(required.map((t) => t.ref));
  for (const table of required) {
    for (const column of table.columns) {
      if (column.type !== 'fk' || column.references === undefined) continue;
      const target = column.references;
      const resolution = declared.has(target) ? 'internal' : live.has(target) ? 'host' : 'unresolved';
      references.push({ fromTable: table.ref, fromColumn: column.ref, to: target, resolution });
      if (resolution === 'unresolved') {
        problems.push({
          code: 'UNRESOLVED_REFERENCE',
          table: table.ref,
          column: column.ref,
          message:
            `"${table.ref}.${column.ref}" points at a table called "${target}", which this ` +
            `${noun} does not create and this database does not have. Connect a database that ` +
            `already has it, or create it first.`,
        });
      }
    }
  }

  // 5. Role slugs fit their column.
  if (manifest.kind === 'app' || installsLikeAnApp(manifest)) {
    for (const role of manifest.roles ?? []) {
      const slug = `${manifest.key}-${role.key}`;
      if (slug.length > ROLE_SLUG_LIMIT) {
        problems.push({
          code: 'IDENTIFIER_TOO_LONG',
          table: role.key,
          message: `The role "${slug}" is longer than ${String(ROLE_SLUG_LIMIT)} characters.`,
        });
      }
    }
  }

  for (const table of required) {
    if (table.ref.startsWith('adminium_') || names[table.ref]!.startsWith('adminium_')) {
      problems.push({
        code: 'RESERVED_TABLE',
        table: table.ref,
        message: `"${names[table.ref]!}" is in Adminium's own namespace.`,
      });
    }
  }

  const planned = (plan: InstallTablePlan) => {
    const spec = required.find((t) => t.ref === plan.ref)!;
    const have = live.get(plan.table);
    const missing = plan.action === 'reuse' || plan.action === 'share'
      ? spec.columns.filter((c) => have !== undefined && !have.columns.some((x) => x.ref === c.ref)).map((c) => c.ref)
      : [];
    return {
      ref: plan.ref,
      table: plan.table,
      action: plan.action === 'reuse' || plan.action === 'share' ? ('reuse' as const) : ('create' as const),
      columns: spec.columns.map((c) => ({ ref: c.ref, type: c.type, missing: missing.includes(c.ref) })),
      missingColumns: missing,
    };
  };

  return {
    addOnKey: manifest.key,
    version: manifest.version,
    ...(shareOffers.length === 0 ? {} : { shareOffers }),
    create: tables.filter((t) => t.action === 'create' || t.action === 'rename-existing').map(planned),
    reuse: tables.filter((t) => t.action === 'reuse' || t.action === 'share').map(planned),
    references,
    problems,
    installable: problems.length === 0,
    touchesData: required.length > 0,
    tables,
    names,
  };
}

/**
 * The name of the unique index a table's set of columns is kept by:
 * `uq_<table>_<a>_<b>`, as a column's own is named. When that is longer than
 * 63 bytes (the portable limit: Postgres cuts longer names short, MySQL
 * refuses them) or is already the name of an index or a constraint anywhere
 * in the database (`taken` — index names are per schema on Postgres and per
 * database on SQLite, so `uq_t_a_b` may be a column `b`'s of table `t_a`),
 * the table's name is cut short and a hash of the table and its columns
 * takes the columns' place. The same inputs always give the same name.
 */
export function uniqueSetName(realTable: string, columns: readonly string[], taken: ReadonlySet<string> = new Set()): string {
  return shortName('uq', realTable, columns, taken);
}

export { MYSQL_UNIQUE_KEY_BYTES, uniqueSetBytes } from './key-bytes.ts';

/** The name of a plain index on one column (`index: true`): `ix_<table>_<column>`, shortened and hashed like {@link uniqueSetName}. */
export function plainIndexName(realTable: string, column: string, taken: ReadonlySet<string> = new Set()): string {
  return shortName('ix', realTable, [column], taken);
}

/**
 * The name of a plain index over a set of columns a table declares, or a
 * ledger needs: `ix_<table>_<a>_<b>`, shortened and hashed like
 * {@link uniqueSetName}. Over one column it is the name {@link plainIndexName} gives.
 */
export function indexSetName(realTable: string, columns: readonly string[], taken: ReadonlySet<string> = new Set()): string {
  return shortName('ix', realTable, columns, taken);
}

/** `<kind>_<table>_<columns>`, or — too long, or taken — the table cut short and a hash of the table and columns. */
function shortName(kind: 'uq' | 'ix', realTable: string, columns: readonly string[], taken: ReadonlySet<string>): string {
  const plain = `${kind}_${realTable}_${columns.join('_')}`;
  if (byteLength(plain) <= IDENTIFIER_LIMIT.postgres && !taken.has(plain)) return plain;
  for (let salt = 0; ; salt += 1) {
    const hash = fnv1a32([realTable, ...columns, ...(salt === 0 ? [] : [String(salt)])].join('\u0000'));
    let head = realTable;
    while (byteLength(`${kind}_${head}_${hash}`) > IDENTIFIER_LIMIT.postgres) head = [...head].slice(0, -1).join('');
    const name = `${kind}_${head}_${hash}`;
    if (!taken.has(name)) return name;
  }
}

/** FNV-1a, 32 bits, over the UTF-8 bytes, as eight hex digits. */
function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
