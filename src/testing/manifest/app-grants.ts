/*
 * VENDORED VERBATIM from packages/manifest/src/app-grants.ts.
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
 * WHAT AN APP'S ROLE MAY BE GIVEN OF AN ADD-ON'S TABLE (`appGrants`).
 *
 * An app gives its roles a hold on an add-on's tables (`roles[].tables`): a
 * hotel's housekeeping moves stock between places, a sales team reads what is
 * in stock. The table is the add-on's, so the add-on says how far an app may
 * go on it, on the table itself:
 *
 * ```json
 * { "ref": "suppliers", "columns": [ … ],
 *   "appGrants": { "actions": ["read"], "readable": ["id", "name", "lead_days", "active"] } }
 * ```
 *
 *  - `actions`: the most an app's role is given here (read, create, update);
 *  - `readable`: the only columns an app's read shows; absent, every column
 *    but those `never` names;
 *  - `writable` / `creatable`: the only columns an app's update may change
 *    and a new row may be given — named whenever the action is allowed: a
 *    write is never "every column";
 *  - `never`: columns no app's grant reaches, whatever else is listed.
 *
 * An add-on that says this of one table says it of all of them: a table
 * without `appGrants` is then given to no app's role. An add-on that says it
 * of none is held only by its own shape, as before the word: no hold on a
 * ledger's receipts, read only on a table a ledger's code writes.
 *
 * The grant an app asks for is cut to fit (`roleTableHold`): an action or a
 * column outside the add-on's words is left out and said, by name; a grant on
 * a table with `appGrants` is always written with its column lists, never
 * whole. The key and the table's links to other rows are read with any read,
 * as with every read limit: a link says which row, never what is in it.
 *
 * Pure: no I/O, and nothing imported from the manifest's own schema file, so
 * that file may import this one.
 */
import { z } from 'zod';

import { refSchema, type ReferenceIssue } from './refs.ts';
import { reachList, ROLE_ADD_ON_ACTIONS, type RoleAddOnTable, type RoleLimit } from './roles.ts';

export type RoleAddOnAction = (typeof ROLE_ADD_ON_ACTIONS)[number];

export const appGrantsSchema = z
  .object({
    /** The most an app's role may be given on this table. */
    actions: z.array(z.enum(ROLE_ADD_ON_ACTIONS)).min(1).max(3),
    /** The only columns an app's read shows (with the key and the links); absent, every column but `never`'s. */
    readable: z.array(refSchema).min(1).max(200).optional(),
    /** The only columns an app's update may change. Named whenever `update` is allowed. */
    writable: z.array(refSchema).min(1).max(200).optional(),
    /** The only columns a new row an app's role makes may be given. Named whenever `create` is allowed. */
    creatable: z.array(refSchema).min(1).max(200).optional(),
    /** Columns no app's grant reaches, whatever else is listed. */
    never: z.array(refSchema).min(1).max(200).optional(),
  })
  .strict();
export type AppGrants = z.infer<typeof appGrantsSchema>;

/** One of the add-on's tables, as the ceiling reads it. */
export interface AppGrantTableShape {
  ref: string;
  columns: readonly { ref: string; type: string; role?: string | undefined; rules?: { secret?: boolean | undefined } | undefined }[];
  appGrants?: AppGrants | undefined;
}

/** One of the add-on's ledgers, as the ceiling reads it. */
export interface AppGrantLedgerShape {
  receipts: string;
  writes?: Readonly<Record<string, unknown>> | undefined;
}

/** Whether the add-on says, of any of its tables, what an app's role may be given. */
export const declaresAppGrants = (tables: readonly AppGrantTableShape[]): boolean => tables.some((table) => table.appGrants !== undefined);

const LIST_OF: Record<RoleAddOnAction, 'readable' | 'writable' | 'creatable'> = { read: 'readable', update: 'writable', create: 'creatable' };

/** Everything wrong with an add-on's `appGrants`, against its own tables and ledgers. */
export function appGrantsIssues(tables: readonly AppGrantTableShape[], ledgers: readonly AppGrantLedgerShape[]): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  tables.forEach((table, t) => {
    const grants = table.appGrants;
    if (grants === undefined) return;
    const at = (...rest: (string | number)[]): (string | number)[] => ['requiredSchema', 'tables', t, 'appGrants', ...rest];
    if (new Set(grants.actions).size !== grants.actions.length) out.push({ path: at('actions'), message: 'an action is listed once' });
    if (ledgers.some((ledger) => ledger.receipts === table.ref)) {
      out.push({ path: at(), message: `"${table.ref}" is a ledger's receipt table, which no app's role ever holds: take "appGrants" off it` });
      return;
    }
    if (ledgers.some((ledger) => Object.prototype.hasOwnProperty.call(ledger.writes ?? {}, table.ref))) {
      grants.actions.forEach((action, a) => {
        if (action !== 'read') out.push({ path: at('actions', a), message: `a ledger's code writes "${table.ref}": an app's role may only read it` });
      });
    }
    const columns = new Map(table.columns.map((column) => [column.ref, column]));
    for (const action of ROLE_ADD_ON_ACTIONS) {
      const key = LIST_OF[action];
      const listed = grants[key];
      const allowed = grants.actions.includes(action);
      if (listed !== undefined && !allowed) out.push({ path: at(key), message: `"${action}" is not allowed here, so there is nothing for "${key}" to name` });
      // A write is never "every column": the add-on names what an app may change.
      if (listed === undefined && allowed && action !== 'read') out.push({ path: at(key), message: `an app's role may ${action === 'update' ? 'change rows' : 'add rows'} here: name the columns it may ${action === 'update' ? 'change' : 'fill'} ("${key}")` });
      (listed ?? []).forEach((ref, c) => {
        if (!columns.has(ref)) out.push({ path: at(key, c), message: `"${table.ref}" has no column "${ref}"` });
        else if ((grants.never ?? []).includes(ref)) out.push({ path: at(key, c), message: `"${ref}" is listed in "never" too` });
      });
      if (listed !== undefined && new Set(listed).size !== listed.length) out.push({ path: at(key), message: 'a column is listed once' });
    }
    (grants.never ?? []).forEach((ref, c) => {
      const column = columns.get(ref);
      if (column === undefined) out.push({ path: at('never', c), message: `"${table.ref}" has no column "${ref}"` });
      // Every read shows the key and the links: naming one here would promise what no read keeps.
      else if (column.role === 'pk' || column.type === 'fk') out.push({ path: at('never', c), message: `"${ref}" is the table's key or a link, which every read shows: leave it out of "writable" and "creatable" instead` });
    });
  });
  return out;
}

/** Why an entry, or part of it, was left out. */
export type RoleTableSkip = 'unknown-table' | 'unknown-column' | 'ledger-table' | 'not-offered' | 'ceiling';

/** What an app asked of a table and does not get: whole actions, and columns of an action. */
export interface RoleTableNarrowed {
  actions: string[];
  readable?: string[];
  writable?: string[];
  creatable?: string[];
}

/** What one app's grant on an add-on's table comes to, against the add-on's words. */
export interface RoleTableHold {
  /** What the role holds of the table by this grant. */
  actions: RoleAddOnAction[];
  /** The columns each kept action reaches; absent, every column (only on a table of an add-on that sets no `appGrants`). */
  readable?: string[];
  writable?: string[];
  creatable?: string[];
  /** The limit the grant is written with: the app's, cut to fit. Absent, the grant is whole. */
  limit?: RoleLimit;
  /** What the app asked for and does not get: actions, and each kept or cut action's columns. */
  narrowed?: RoleTableNarrowed;
  skipped?: RoleTableSkip;
}

const kept = (asked: readonly string[], allowed: ReadonlySet<string>): string[] => [...new Set(asked)].filter((ref) => allowed.has(ref));
const pickKeys = <T>(record: Readonly<Record<string, T>> | undefined, keys: readonly string[]): Record<string, T> | undefined => {
  if (record === undefined) return undefined;
  const out = Object.fromEntries(Object.entries(record).filter(([key]) => keys.includes(key)));
  return Object.keys(out).length === 0 ? undefined : out;
};

/**
 * What an app's grant on one of an add-on's tables comes to: the add-on's
 * shape (receipts, ledger tables), the columns it has, and its `appGrants`.
 * Narrower than asked, never wider; whatever is cut is named.
 */
export function roleTableHold(entry: RoleAddOnTable, addOn: { tables: readonly AppGrantTableShape[]; ledgers: readonly AppGrantLedgerShape[] }): RoleTableHold {
  const asked = [...new Set(entry.actions)] as RoleAddOnAction[];
  const none = (skipped: RoleTableSkip): RoleTableHold => ({ actions: [], narrowed: { actions: asked }, skipped });
  const shape = addOn.tables.find((table) => table.ref === entry.table);
  if (shape === undefined) return none('unknown-table');
  // No hold at all on a receipt.
  if (addOn.ledgers.some((ledger) => ledger.receipts === entry.table)) return none('ledger-table');
  const limit = entry.limit;
  const all = shape.columns.map((column) => column.ref);
  const columns = new Set(all);
  const named = [...(limit?.readable ?? []), ...(limit?.writable ?? []), ...(limit?.creatable ?? []), ...Object.keys(limit?.writableValues ?? {}), ...Object.keys(limit?.writableFrom ?? {}), ...Object.keys(limit?.creatableValues ?? {}), ...Object.values(limit?.rows ?? {}).flatMap((written) => reachList(written).flatMap((reach) => (reach.while === undefined ? [] : [reach.while.column])))];
  // A grant is never written without its limit: a limit that names a column the table has not skips the whole entry.
  const unknown = named.filter((column) => !columns.has(column));
  if (unknown.length > 0) return none('unknown-column');

  const ceilinged = declaresAppGrants(addOn.tables);
  const grants = shape.appGrants;
  if (ceilinged && grants === undefined) return none('not-offered');
  const written = addOn.ledgers.some((ledger) => Object.prototype.hasOwnProperty.call(ledger.writes ?? {}, entry.table));
  const cutByLedger = asked.filter((action) => written && action !== 'read');
  const cutActions = new Set<string>(cutByLedger);
  const cutColumns: Partial<Record<RoleAddOnAction, string[]>> = {};
  let byCeiling = false;
  let actions = asked.filter((action) => !cutActions.has(action));
  if (grants !== undefined) {
    for (const action of actions) {
      if (!grants.actions.includes(action)) {
        cutActions.add(action);
        byCeiling = true;
      }
    }
    actions = actions.filter((action) => !cutActions.has(action));
  }

  const never = new Set(grants?.never ?? []);
  const secret = new Set(shape.columns.filter((column) => column.rules?.secret === true).map((column) => column.ref));
  /** The columns the add-on lets an app's action reach: null, every column (an add-on with no `appGrants`). */
  const ceilingOf = (action: RoleAddOnAction): ReadonlySet<string> | null => {
    if (grants === undefined) return null;
    const listed = grants[LIST_OF[action]];
    if (listed !== undefined) return new Set(listed.filter((ref) => !never.has(ref)));
    // Only a read may be "every column": every one but `never`'s and the secrets no response carries.
    return action === 'read' ? new Set(all.filter((ref) => !never.has(ref) && !secret.has(ref))) : new Set();
  };
  /*
   * Which rows an action reaches, by a column's value, tells what that column
   * holds: a role that sees only the items whose cost is 0 has read their
   * cost. A row limit (`rows`, `writableFrom`) on a column an app's read may
   * not show leaves the whole entry out — dropping the limit would widen it.
   */
  if (grants !== undefined) {
    const shown = grants.actions.includes('read') ? (ceilingOf('read') ?? new Set<string>()) : new Set<string>();
    const judged = [...Object.keys(limit?.writableFrom ?? {}), ...Object.values(limit?.rows ?? {}).flatMap((written) => reachList(written).flatMap((reach) => (reach.while === undefined ? [] : [reach.while.column])))];
    if (judged.some((column) => !shown.has(column))) return none('ceiling');
  }
  const askedOf = (action: RoleAddOnAction): readonly string[] | undefined => (action === 'read' ? limit?.readable : action === 'update' ? limit?.writable : limit?.creatable);
  const lists: Partial<Record<RoleAddOnAction, string[]>> = {};
  for (const action of [...actions]) {
    const ceiling = ceilingOf(action);
    const wanted = askedOf(action);
    if (ceiling === null) {
      if (wanted !== undefined) lists[action] = [...new Set(wanted)];
      continue;
    }
    // Asked for every column: given the add-on's, and what it keeps back is said.
    const from = wanted ?? all;
    const fits = kept(from, ceiling);
    const cut = [...new Set(from)].filter((ref) => !ceiling.has(ref) && !(wanted === undefined && secret.has(ref)));
    if (cut.length > 0) {
      cutColumns[action] = cut;
      byCeiling = true;
    }
    if (fits.length === 0) {
      cutActions.add(action);
      byCeiling = true;
      actions = actions.filter((one) => one !== action);
      continue;
    }
    lists[action] = fits;
  }

  const has = (action: RoleAddOnAction): boolean => actions.includes(action);
  const writable = has('update') ? lists.update : undefined;
  const creatable = has('create') ? lists.create : undefined;
  const writableValues = writable === undefined ? undefined : pickKeys(limit?.writableValues, writable);
  const creatableValues = creatable === undefined ? undefined : pickKeys(limit?.creatableValues, creatable);
  // Which rows an action reaches only ever narrows it: kept for the actions kept.
  const rows = pickKeys(limit?.rows as Readonly<Record<string, unknown>> | undefined, actions) as RoleLimit['rows'];
  const written_: RoleLimit = {
    ...(has('read') && lists.read !== undefined ? { readable: lists.read } : {}),
    ...(writable === undefined ? {} : { writable }),
    ...(writableValues === undefined ? {} : { writableValues }),
    ...(has('update') && limit?.writableFrom !== undefined ? { writableFrom: limit.writableFrom } : {}),
    ...(creatable === undefined ? {} : { creatable }),
    ...(creatableValues === undefined ? {} : { creatableValues }),
    ...(rows === undefined ? {} : { rows }),
  };
  const narrowed: RoleTableNarrowed | undefined =
    cutActions.size + Object.keys(cutColumns).length === 0
      ? undefined
      : { actions: asked.filter((action) => cutActions.has(action)), ...Object.fromEntries(ROLE_ADD_ON_ACTIONS.flatMap((action) => (cutColumns[action] === undefined ? [] : [[LIST_OF[action], cutColumns[action]]]))) };
  const skipped: RoleTableSkip | undefined = byCeiling ? 'ceiling' : cutByLedger.length > 0 ? 'ledger-table' : undefined;
  return {
    actions,
    ...(has('read') && lists.read !== undefined ? { readable: lists.read } : {}),
    ...(writable === undefined ? {} : { writable }),
    ...(creatable === undefined ? {} : { creatable }),
    ...(Object.keys(written_).length === 0 ? {} : { limit: written_ }),
    ...(narrowed === undefined ? {} : { narrowed }),
    ...(skipped === undefined ? {} : { skipped }),
  };
}

/** Every column, in a list of what a grant reaches: the grant is whole there. */
export const EVERY_COLUMN = '*';

/**
 * What `after` holds of a table that `before` did not: actions, and columns
 * any of its actions reaches (`*`: every column, where before it was some or
 * none). Null when it holds nothing more.
 */
export function holdWider(before: Pick<RoleTableHold, 'actions' | 'readable' | 'writable' | 'creatable'> | null, after: Pick<RoleTableHold, 'actions' | 'readable' | 'writable' | 'creatable'>): { actions: string[]; columns: string[] } | null {
  const had = new Set<string>(before?.actions ?? []);
  const actions = after.actions.filter((action) => !had.has(action));
  const columns = new Set<string>();
  for (const action of after.actions) {
    const key = LIST_OF[action];
    const now = after[key];
    const was = had.has(action) ? (before?.[key] ?? null) : [];
    // null: every column.
    if (was === null) continue;
    if (now === undefined) {
      columns.add(EVERY_COLUMN);
      continue;
    }
    for (const ref of now) if (!was.includes(ref)) columns.add(ref);
  }
  return actions.length === 0 && columns.size === 0 ? null : { actions, columns: [...columns] };
}
