/*
 * VENDORED VERBATIM from packages/manifest/src/states.ts.
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
 * `table.states` — the life of a document, kept by Adminium for every writer.
 *
 * ```json
 * "states": {
 *   "column": "status", "initial": "draft",
 *   "moves": {
 *     "draft": [{ "to": "sent", "requires": { "children": { "invoice_lines": 1 }, "where": [{ "column": "total", "gt": 0 }] } }, "void"],
 *     "sent": [{ "to": "void", "requires": { "where": [{ "column": "paid", "eq": 0 }] }, "roles": ["studio-manager"] }]
 *   },
 *   "lock": { "when": ["sent", "void"], "except": ["due_on", "ladder"] },
 *   "children": {
 *     "invoice_lines": {
 *       "via": "document_id", "lock": true,
 *       "release": { "when": ["void"], "columns": ["time_entry_id"] },
 *       "lockLinked": { "time_entry_id": ["hours", "date"] }
 *     },
 *     "payments": { "via": "document_id", "parentIn": ["sent"], "clearOnCreate": ["client_paid_at"] }
 *   },
 *   "noDelete": { "when": "numbered" },
 *   "onlyLater": ["valid_until"]
 * }
 * ```
 *
 * - `moves`: from each state, the states a write may move a row to. A move
 *   may ask for something first — child rows, a column's value — and may be
 *   kept for some of the app's roles. A move not listed is refused.
 * - `lock`: while a row is in one of `when`, only `except` (and the state
 *   itself, through a move) may change. Adminium's own columns (totals,
 *   stamps) keep being written by Adminium.
 * - `children`: child tables tied to this row's state. `lock` refuses their
 *   writes while the row is locked; `parentIn` allows them only while the row
 *   is in those states (payments on a sent invoice); `clearOnCreate` empties
 *   columns of this row when one of them is created (a recorded payment
 *   clears the client's "I've sent it"). `release` opens a locked child a
 *   little while its parent is in some of the lock's states: a change that
 *   only EMPTIES the listed columns (a void invoice's line letting go of the
 *   time it billed, so the time can be billed again), and only in a state no
 *   move leaves. `lockLinked` keeps the
 *   listed columns of the row a child's link points at from changing while
 *   the child points at it (the hours of time on an invoice) — unless the
 *   parent is in a state that releases that link.
 * - `lockedWhenReferencedBy`: this row locks once a row of another table in
 *   one of the states points at it (a terms version once a proposal naming it
 *   is sent).
 * - `noDelete`: rows in these states, or any row with a number
 *   (`"numbered"`), are never deleted — voided instead.
 * - `onlyLater`: date columns that may move later and never earlier.
 *
 * Adding sample data and importing past records are history: they write any
 * state their rows were in.
 */
import { z } from 'zod';

import { refSchema, scalarSchema, valueFits, type ColumnShape, type ReferenceIssue, type TableIndex } from './refs.ts';

const stateName = z.string().min(1).max(64);
const roleKey = z.string().regex(/^[a-z][a-z0-9-]*$/, 'a role key');

/** A condition on the row itself, checked in the same statement that changes it. */
export const stateConditionSchema = z
  .object({
    column: refSchema,
    eq: scalarSchema.optional(),
    in: z.array(scalarSchema).min(1).max(32).optional(),
    isNull: z.boolean().optional(),
    gt: z.number().finite().optional(),
    gte: z.number().finite().optional(),
    lt: z.number().finite().optional(),
    lte: z.number().finite().optional(),
  })
  .strict()
  .refine((c) => [c.eq, c.in, c.isNull, c.gt, c.gte, c.lt, c.lte].filter((part) => part !== undefined).length === 1, {
    message: 'a condition says one of eq, in, isNull, gt, gte, lt or lte',
  });
export type StateCondition = z.infer<typeof stateConditionSchema>;

export const stateMoveSchema = z.union([
  stateName,
  z
    .object({
      to: stateName,
      /** What must be true first: at least n child rows of a table, and conditions on the row. */
      requires: z
        .object({
          children: z.record(refSchema, z.number().int().min(1).max(1000)).optional(),
          where: z.array(stateConditionSchema).min(1).max(8).optional(),
        })
        .strict()
        .optional(),
      /** Only people holding one of these app roles may make this move. */
      roles: z.array(roleKey).min(1).max(8).optional(),
    })
    .strict(),
]);
export type StateMove = z.infer<typeof stateMoveSchema>;

export const stateChildSchema = z
  .object({
    /** The child's foreign key to this row. */
    via: refSchema,
    lock: z.literal(true).optional(),
    parentIn: z.array(stateName).min(1).max(16).optional(),
    clearOnCreate: z.array(refSchema).min(1).max(8).optional(),
    /** While this row is in one of `when`, a locked child may still EMPTY these columns of its own, and change nothing else. */
    release: z.object({ when: z.array(stateName).min(1).max(16), columns: z.array(refSchema).min(1).max(8) }).strict().optional(),
    /** A child's link column → the columns of the row it points at that stay as they are while it points there. */
    lockLinked: z.record(refSchema, z.array(refSchema).min(1).max(16)).optional(),
  })
  .strict()
  .refine((c) => c.lock === undefined || c.parentIn === undefined, {
    message: 'a child is locked with its parent, or writable only in some of its states — not both',
  })
  .refine((c) => c.release === undefined || c.lock === true, { message: 'a child is released only from its parent\'s lock (lock: true)' })
  .refine((c) => c.lockLinked === undefined || (Object.keys(c.lockLinked).length >= 1 && Object.keys(c.lockLinked).length <= 8), {
    message: 'lockLinked names 1 to 8 link columns',
  });
export type StateChild = z.infer<typeof stateChildSchema>;

export const statesSchema = z
  .object({
    column: refSchema,
    initial: stateName,
    moves: z.record(stateName, z.array(stateMoveSchema).max(16)),
    lock: z
      .object({
        when: z.array(stateName).min(1).max(16),
        except: z.array(refSchema).max(32).optional(),
      })
      .strict()
      .optional(),
    children: z.record(refSchema, stateChildSchema).optional(),
    lockedWhenReferencedBy: z
      .array(z.object({ table: refSchema, via: refSchema, in: z.array(stateName).min(1).max(16) }).strict())
      .min(1)
      .max(4)
      .optional(),
    noDelete: z.object({ when: z.union([z.literal('numbered'), z.array(stateName).min(1).max(16)]) }).strict().optional(),
    onlyLater: z.array(refSchema).min(1).max(8).optional(),
  })
  .strict();
export type States = z.infer<typeof statesSchema>;

/** A move written as a bare state is a move with nothing asked first. */
export function moveTarget(move: StateMove): string {
  return typeof move === 'string' ? move : move.to;
}

interface StatesContext<C extends ColumnShape> {
  index: TableIndex<C>;
  /** The app's role keys, when the manifest declares roles (an add-on's shape has none to name). */
  roles?: readonly string[] | undefined;
  /** A column of this table decides "numbered": a gapless running number. */
  numbered: boolean;
}

/** Everything wrong with one table's `states` against the manifest's tables. */
export function statesIssues<C extends ColumnShape>(
  table: string,
  states: States,
  ctx: StatesContext<C>,
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const { index } = ctx;
  const column = index.column(table, states.column);
  let values: readonly string[] = [];
  if (column === undefined) {
    out.push({ path: at('column'), message: `"${table}" has no column "${states.column}"` });
  } else if (column.type !== 'enum') {
    out.push({ path: at('column'), message: `"${table}.${states.column}" is not an enum, so it cannot hold a state` });
  } else {
    values = column.enum ?? [];
  }
  const isState = (value: string) => values.length === 0 || values.includes(value);
  const known = (value: string, path: (string | number)[]) => {
    if (!isState(value)) out.push({ path, message: `"${value}" is not a value of "${table}.${states.column}"` });
  };
  known(states.initial, at('initial'));
  for (const [from, moves] of Object.entries(states.moves)) {
    known(from, at('moves', from));
    moves.forEach((move, m) => {
      const to = moveTarget(move);
      known(to, at('moves', from, m));
      if (to === from) out.push({ path: at('moves', from, m), message: 'a move goes to another state' });
      if (typeof move === 'string') return;
      for (const child of Object.keys(move.requires?.children ?? {})) {
        if (states.children?.[child] === undefined) {
          out.push({ path: at('moves', from, m, 'requires', 'children', child), message: `"${child}" is not one of this table's children` });
        }
      }
      (move.requires?.where ?? []).forEach((condition, w) => {
        out.push(...conditionIssues(table, condition, index, at('moves', from, m, 'requires', 'where', w)));
      });
      for (const role of move.roles ?? []) {
        if (ctx.roles !== undefined && !ctx.roles.includes(role)) {
          out.push({ path: at('moves', from, m, 'roles'), message: `"${role}" is not one of the app's roles` });
        }
      }
    });
  }
  if (states.lock !== undefined) {
    states.lock.when.forEach((value, i) => known(value, at('lock', 'when', i)));
    for (const ref of states.lock.except ?? []) {
      if (index.column(table, ref) === undefined) out.push({ path: at('lock', 'except'), message: `"${table}" has no column "${ref}"` });
      if (ref === states.column) out.push({ path: at('lock', 'except'), message: 'the state moves by its moves, never by the lock' });
    }
  }
  for (const [child, rule] of Object.entries(states.children ?? {})) {
    const here = (...rest: (string | number)[]) => at('children', child, ...rest);
    if (index.table(child) === undefined) {
      out.push({ path: here(), message: `"${child}" is not a table of this manifest` });
      continue;
    }
    const via = index.column(child, rule.via);
    if (via === undefined) out.push({ path: here('via'), message: `"${child}" has no column "${rule.via}"` });
    else if (via.type !== 'fk' || via.references !== table) out.push({ path: here('via'), message: `"${child}.${rule.via}" does not point at "${table}"` });
    if (rule.lock === true && states.lock === undefined) out.push({ path: here('lock'), message: 'a child is locked with its parent, and the parent has no lock' });
    (rule.parentIn ?? []).forEach((value, i) => known(value, here('parentIn', i)));
    for (const ref of rule.clearOnCreate ?? []) {
      const found = index.column(table, ref);
      if (found === undefined) out.push({ path: here('clearOnCreate'), message: `"${table}" has no column "${ref}"` });
      else if (found.nullable !== true) out.push({ path: here('clearOnCreate'), message: `"${table}.${ref}" is not nullable, so it cannot be emptied` });
    }
    if (rule.release !== undefined) {
      rule.release.when.forEach((value, i) => {
        known(value, here('release', 'when', i));
        if (states.lock !== undefined && !states.lock.when.includes(value)) {
          out.push({ path: here('release', 'when', i), message: `"${value}" is not a state the lock holds, so there is nothing to release` });
        }
        // A released link stops locking what it points at: a row that could move on from here would come back billing what that row no longer says.
        if ((states.moves[value] ?? []).length > 0) {
          out.push({ path: here('release', 'when', i), message: `"${value}" has moves out of it, so a line released there could come back billing a changed row; release only in a final state` });
        }
      });
      for (const ref of rule.release.columns) {
        const found = index.column(child, ref);
        if (found === undefined) out.push({ path: here('release', 'columns'), message: `"${child}" has no column "${ref}"` });
        else if (ref === rule.via) out.push({ path: here('release', 'columns'), message: `"${child}.${ref}" ties the row to this one, and is never released` });
        else if (found.role === 'pk') out.push({ path: here('release', 'columns'), message: `"${child}.${ref}" is the key, and is never emptied` });
        else if (found.nullable !== true) out.push({ path: here('release', 'columns'), message: `"${child}.${ref}" is not nullable, so it cannot be emptied` });
      }
    }
    for (const [link, columns] of Object.entries(rule.lockLinked ?? {})) {
      const found = index.column(child, link);
      if (found === undefined) {
        out.push({ path: here('lockLinked', link), message: `"${child}" has no column "${link}"` });
        continue;
      }
      if (found.type !== 'fk' || found.references === undefined || index.table(found.references) === undefined) {
        out.push({ path: here('lockLinked', link), message: `"${child}.${link}" does not point at a table of this manifest` });
        continue;
      }
      if (link === rule.via) out.push({ path: here('lockLinked', link), message: `"${child}.${link}" points at this row, whose own lock says what stays open` });
      const target = found.references;
      for (const ref of columns) {
        const column = index.column(target, ref);
        if (column === undefined) out.push({ path: here('lockLinked', link), message: `"${target}" has no column "${ref}"` });
        else if (column.role === 'pk') out.push({ path: here('lockLinked', link), message: `"${target}.${ref}" is the key, which never changes` });
      }
    }
    if (rule.lock === undefined && rule.parentIn === undefined && rule.clearOnCreate === undefined && rule.lockLinked === undefined) {
      out.push({ path: here(), message: 'a child says lock, parentIn, clearOnCreate or lockLinked' });
    }
  }
  (states.lockedWhenReferencedBy ?? []).forEach((ref, r) => {
    const here = (...rest: (string | number)[]) => at('lockedWhenReferencedBy', r, ...rest);
    if (index.table(ref.table) === undefined) {
      out.push({ path: here('table'), message: `"${ref.table}" is not a table of this manifest` });
      return;
    }
    const via = index.column(ref.table, ref.via);
    if (via?.type !== 'fk' || via.references !== table) out.push({ path: here('via'), message: `"${ref.table}.${ref.via}" does not point at "${table}"` });
    if (states.lock === undefined) out.push({ path: here(), message: 'a row locked by a reference needs a lock to say what stays open' });
  });
  if (states.noDelete !== undefined) {
    if (states.noDelete.when === 'numbered') {
      if (!ctx.numbered) out.push({ path: at('noDelete', 'when'), message: '"numbered" needs a column numbered without gaps (sequence.gapless)' });
    } else {
      states.noDelete.when.forEach((value, i) => known(value, at('noDelete', 'when', i)));
    }
  }
  for (const ref of states.onlyLater ?? []) {
    const found = index.column(table, ref);
    if (found === undefined) out.push({ path: at('onlyLater'), message: `"${table}" has no column "${ref}"` });
    else if (found.type !== 'date' && found.type !== 'timestamptz') out.push({ path: at('onlyLater'), message: `"${table}.${ref}" is not a date` });
  }
  return out;
}

function conditionIssues<C extends ColumnShape>(
  table: string,
  condition: StateCondition,
  index: TableIndex<C>,
  path: (string | number)[],
): ReferenceIssue[] {
  const found = index.column(table, condition.column);
  if (found === undefined) return [{ path, message: `"${table}" has no column "${condition.column}"` }];
  const out: ReferenceIssue[] = [];
  const values = condition.eq !== undefined ? [condition.eq] : (condition.in ?? []);
  for (const value of values) {
    if (!valueFits(found, value)) out.push({ path, message: `${JSON.stringify(value)} is not a value of "${table}.${condition.column}"` });
  }
  const ordered = [condition.gt, condition.gte, condition.lt, condition.lte].some((part) => part !== undefined);
  if (ordered && !['int', 'bigint', 'decimal', 'money', 'float'].includes(found.type)) {
    out.push({ path, message: `"${table}.${condition.column}" is not a number, so it cannot be compared` });
  }
  return out;
}
