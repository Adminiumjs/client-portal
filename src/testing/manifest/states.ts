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
 *   is in those states (payments on a sent invoice) — or, apart, `createIn`
 *   for a new child and `changeIn` for a change or a delete of one (a payment
 *   taken only on a live stay, and voided on a cancelled one too); `clearOnCreate` empties
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
 * - A move may also wait for the row one of its links points at
 *   (`requires.linked`), for a window on the clock (`requires.time`, read from
 *   moments — see `refs.ts`) and for a value of the settings row
 *   (`requires.setting`).
 * - `strict`: a write naming the state the row already holds is refused
 *   (a ticket let in once), repeating up to four columns of the row.
 * - `late`: a move made inside some time before a moment sets a flag, or is
 *   refused.
 * - `timed`: listed moves Adminium makes by itself once a moment of the row
 *   has passed (a held order expiring).
 * - `effects`: a move that moves the row one of its links points at too, by a
 *   move that table lists (a guest checked out turns the room to cleaning).
 * - `create`: what a new row must meet to be created — the conditions a move
 *   waits for, judged when the row is written (a check-in only for a paid
 *   ticket, on its day).
 * - A timed move may also write fixed values to other columns (`set`).
 *
 * Adding sample data and importing past records are history: they write any
 * state their rows were in.
 */
import { z } from 'zod';

import { stateActionIssues, stateActionsSchema } from './state-actions.ts';

import {
  momentIssues,
  momentOffsetSchema,
  momentSchema,
  refSchema,
  scalarSchema,
  valueFits,
  type ColumnShape,
  type Moment,
  type MomentOffset,
  type ReferenceIssue,
  type TableIndex,
} from './refs.ts';

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

/** Conditions on the row one of this row's links points at (the order a ticket belongs to is paid). */
export const linkedConditionSchema = z
  .object({
    /** This row's foreign key. */
    via: refSchema,
    where: z.array(stateConditionSchema).min(1).max(8),
  })
  .strict();
export type LinkedCondition = z.infer<typeof linkedConditionSchema>;

/** A move allowed only after one moment, before another, or between the two. */
export const timeConditionSchema = z
  .object({ after: momentSchema.optional(), before: momentSchema.optional() })
  .strict()
  .refine((t) => t.after !== undefined || t.before !== undefined, { message: 'a time condition says after, before or both' });
export type TimeCondition = z.infer<typeof timeConditionSchema>;

/** A value of the app's one-row settings table a move waits for (door sales switched on). */
export const settingConditionSchema = z.object({ table: refSchema, column: refSchema, eq: scalarSchema }).strict();
export type SettingCondition = z.infer<typeof settingConditionSchema>;

export const stateMoveSchema = z.union([
  stateName,
  z
    .object({
      to: stateName,
      /**
       * What must be true first: at least n child rows of a table, conditions
       * on the row, on the rows its links point at, on the settings row, and
       * a window in time.
       */
      requires: z
        .object({
          children: z.record(refSchema, z.number().int().min(1).max(1000)).optional(),
          where: z.array(stateConditionSchema).min(1).max(8).optional(),
          linked: z.array(linkedConditionSchema).min(1).max(4).optional(),
          time: timeConditionSchema.optional(),
          setting: z.array(settingConditionSchema).min(1).max(4).optional(),
        })
        .strict()
        .optional(),
      /** Only people holding one of these app roles may make this move. */
      roles: z.array(roleKey).min(1).max(8).optional(),
      /**
       * The move takes back the listed move the other way (ready → preparing
       * after preparing → ready): made only by a write that names the state
       * it saw the row in, judged on the row as it stands, and emptying the
       * stamps the move it takes back wrote (`stamp.clearOnBack`) while the
       * stamps of the state it returns to keep what they had.
       */
      undo: z.literal(true).optional(),
      /**
       * An undo's further columns it empties, beside its stamps (how a hand-over
       * taken back was paid): emptied by the move, and open to the table's lock
       * for that move only. Only on a move marked `undo`.
       */
      clears: z.array(refSchema).min(1).max(8).optional(),
      /**
       * The move is made only by a ledger's own planned update (an order
       * received when its last line is in): no person and no role makes it,
       * no button offers it, and no timed rule reaches it.
       */
      planned: z.literal(true).optional(),
    })
    .strict(),
]);
export type StateMove = z.infer<typeof stateMoveSchema>;

export const stateChildSchema = z
  .object({
    /** The child's foreign key to this row. */
    via: refSchema,
    lock: z.literal(true).optional(),
    /** Written only while this row is in one of these states: `createIn` and `changeIn` together. */
    parentIn: z.array(stateName).min(1).max(16).optional(),
    /** Added only while this row is in one of these states (a payment taken on a stay still booked or in house). */
    createIn: z.array(stateName).min(1).max(16).optional(),
    /** Changed or deleted only while this row is in one of these states (a payment voided on a cancelled stay too). */
    changeIn: z.array(stateName).min(1).max(16).optional(),
    clearOnCreate: z.array(refSchema).min(1).max(8).optional(),
    /** While this row is in one of `when`, a locked child may still EMPTY these columns of its own, and change nothing else. */
    release: z.object({ when: z.array(stateName).min(1).max(16), columns: z.array(refSchema).min(1).max(8) }).strict().optional(),
    /** A child's link column → the columns of the row it points at that stay as they are while it points there. */
    lockLinked: z.record(refSchema, z.array(refSchema).min(1).max(16)).optional(),
  })
  .strict()
  .refine((c) => c.lock === undefined || (c.parentIn === undefined && c.createIn === undefined && c.changeIn === undefined), {
    message: 'a child is locked with its parent, or writable only in some of its states — not both',
  })
  .refine((c) => c.parentIn === undefined || (c.createIn === undefined && c.changeIn === undefined), {
    message: 'parentIn says createIn and changeIn at once: say parentIn, or createIn and changeIn, not both',
  })
  .refine((c) => c.release === undefined || c.lock === true, { message: 'a child is released only from its parent\'s lock (lock: true)' })
  .refine((c) => c.lockLinked === undefined || (Object.keys(c.lockLinked).length >= 1 && Object.keys(c.lockLinked).length <= 8), {
    message: 'lockLinked names 1 to 8 link columns',
  });
export type StateChild = z.infer<typeof stateChildSchema>;

// ── once means once, late moves, timed moves, moves of a linked row ─────────

/**
 * `strict`: a write that names the state the row already holds is refused
 * instead of passing silently (a ticket scanned twice). `show` names up to
 * four columns of the row the refusal repeats (the door it came in by);
 * never a personal or secret column.
 */
export const strictStatesSchema = z.union([
  z.literal(true),
  z.object({ show: z.array(refSchema).min(1).max(4) }).strict(),
]);

/**
 * A move to `to` (from one of `from`, or from anywhere) made inside `within`
 * before `moment`: `flag` lets it through and sets the bool column `flag`;
 * `refuse` turns it away — for public writers, or with `refuse: 'everyone'`
 * for every writer.
 */
export const lateMoveSchema = z
  .object({
    to: stateName,
    from: z.array(stateName).min(1).max(16).optional(),
    moment: momentSchema,
    within: momentOffsetSchema,
    mode: z.enum(['flag', 'refuse']),
    flag: refSchema.optional(),
    refuse: z.enum(['public', 'everyone']).optional(),
    /** Only a move whose row, as the write leaves it, meets these (a cancellation by the house is never late). */
    where: z.array(stateConditionSchema).min(1).max(8).optional(),
  })
  .strict()
  .refine((l) => (l.mode === 'flag') === (l.flag !== undefined), {
    message: 'a flag names its column, and only mode "flag" has one',
    path: ['flag'],
  })
  .refine((l) => l.refuse === undefined || l.mode === 'refuse', {
    message: 'who is refused is said only by mode "refuse"',
    path: ['refuse'],
  });
export type LateMove = z.infer<typeof lateMoveSchema>;

/**
 * A listed move Adminium makes by itself once `at` has passed, for a row still
 * in `from`. `set` writes fixed values to other columns of the row in the same
 * move (why an order still open at closing was cancelled).
 */
export const timedMoveSchema = z
  .object({
    from: stateName,
    to: stateName,
    at: momentSchema,
    set: z
      .record(refSchema, z.union([scalarSchema, z.null()]))
      .refine((set) => Object.keys(set).length >= 1 && Object.keys(set).length <= 8, { message: 'a timed move sets 1 to 8 columns' })
      .optional(),
  })
  .strict();
export type TimedMove = z.infer<typeof timedMoveSchema>;

/**
 * What a row must meet to be created at all: a value of its own
 * (`where`), of the row one of its links points at (`linked`), of the
 * settings row (`setting`), and a window on the clock (`time`) — the same
 * shapes a move waits for. A check-in recorded only for a paid ticket, on
 * its day, from half an hour before the doors.
 */
export const createRequiresSchema = z
  .object({
    requires: z
      .object({
        where: z.array(stateConditionSchema).min(1).max(8).optional(),
        linked: z.array(linkedConditionSchema).min(1).max(4).optional(),
        time: timeConditionSchema.optional(),
        setting: z.array(settingConditionSchema).min(1).max(4).optional(),
      })
      .strict()
      .refine((r) => [r.where, r.linked, r.time, r.setting].some((part) => part !== undefined), {
        message: 'a create requires where, linked, time or setting',
      }),
  })
  .strict();
export type CreateRequires = z.infer<typeof createRequiresSchema>;

/** The one column an effect sets on the linked row (that table's state), and the state it moves to. */
const effectSetSchema = z
  .record(refSchema, stateName)
  .refine((set) => Object.keys(set).length === 1, { message: 'an effect sets one column: the linked table\'s state' });

/**
 * When this row moves to `on.to`, the row its link `via` points at moves too,
 * in the same write: `set` names that table's state column and the state it
 * moves to, one of the moves that table lists (a guest checked out turns the
 * room to cleaning). One link, never a chain.
 */
export const moveEffectSchema = z
  .object({
    on: z.object({ to: stateName }).strict(),
    via: refSchema,
    set: effectSetSchema,
  })
  .strict();
export type MoveEffect = z.infer<typeof moveEffectSchema>;

/**
 * When the link `on.change` really changes — while this row is in one of
 * `on.in` before and after the write — the row it pointed at moves by `old`
 * and the row it now points at by `new`, in the same write (a guest moved to
 * another room: the old room to cleaning, the new one to occupied, which only
 * a ready room may be). Each is that table's declared move; a new row already
 * in `new`'s state refuses the write. Either side may be left out, and a link
 * emptied or first set moves only the side there is.
 */
export const changeEffectSchema = z
  .object({
    on: z.object({ change: refSchema, in: z.array(stateName).min(1).max(16).optional() }).strict(),
    old: z.object({ set: effectSetSchema }).strict().optional(),
    new: z.object({ set: effectSetSchema }).strict().optional(),
  })
  .strict()
  .refine((e) => e.old !== undefined || e.new !== undefined, { message: 'an effect of a changed link moves the old row, the new one, or both' });
export type ChangeEffect = z.infer<typeof changeEffectSchema>;

export type StateEffect = MoveEffect | ChangeEffect;

/** Whether an effect is set off by a changed link rather than by a move. */
export function isChangeEffect(effect: StateEffect): effect is ChangeEffect {
  return 'change' in effect.on;
}

/**
 * An effect, parsed by the schema of the form written (a move's, or a changed
 * link's), so a mistake is named where it is: a union of the two would only
 * say the input is invalid.
 */
export const stateEffectSchema = z.custom<StateEffect>().superRefine((value, ctx) => {
  const on = typeof value === 'object' && value !== null ? (value as { on?: unknown }).on : undefined;
  const change = typeof on === 'object' && on !== null && 'change' in on;
  const parsed = (change ? changeEffectSchema : moveEffectSchema).safeParse(value);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: [...issue.path], continue: false } as never);
});

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
    /** Dates that may move later and never earlier: always, or (`{column, in}`) only while the row is in one of `in`. */
    onlyLater: z
      .array(z.union([refSchema, z.object({ column: refSchema, in: z.array(stateName).min(1).max(16) }).strict()]))
      .min(1)
      .max(8)
      .optional(),
    /** A move to the state a row already holds is refused, naming when it got there (see {@link strictStatesSchema}). */
    strict: strictStatesSchema.optional(),
    /** A move made close to a moment sets a flag, or is refused (see {@link lateMoveSchema}). */
    late: z.array(lateMoveSchema).min(1).max(4).optional(),
    /** Moves Adminium makes on its own when a moment passes (see {@link timedMoveSchema}). */
    timed: z.array(timedMoveSchema).min(1).max(8).optional(),
    /** A move that moves the row one of its links points at too (see {@link stateEffectSchema}). */
    effects: z.array(stateEffectSchema).min(1).max(8).optional(),
    /** What a new row must meet to be created (see {@link createRequiresSchema}). */
    create: createRequiresSchema.optional(),
    /** The buttons a generated record page offers for a row (see `state-actions.ts`). */
    actions: stateActionsSchema.optional(),
  })
  .strict();
export type States = z.infer<typeof statesSchema>;


/** A move written as a bare state is a move with nothing asked first. */
/**
 * Whether a state is reached only by moves marked `undo`: made only by a
 * person naming the state they saw — never by a door that names none (a
 * timed move, an effect, an email's `onSent`, a guest's writable value).
 */
export function reachedOnlyByUndo(states: { moves: Readonly<Record<string, readonly StateMove[]>> } | undefined, state: unknown): boolean {
  if (states === undefined) return false;
  const moves = Object.values(states.moves).flatMap((list) => list.filter((move) => moveTarget(move) === String(state)));
  return moves.length > 0 && moves.every((move) => typeof move === 'object' && move.undo === true);
}

export function moveTarget(move: StateMove): string {
  return typeof move === 'string' ? move : move.to;
}

interface StatesContext<C extends ColumnShape> {
  index: TableIndex<C>;
  /** The app's role keys, when the manifest declares roles (an add-on's shape has none to name). */
  roles?: readonly string[] | undefined;
  /** A column of this table decides "numbered": a gapless running number. */
  numbered: boolean;
  /** Why a column of this table is kept from readers (a secret, personal data, a shared link's code), or null. */
  keptFromReaders?: ((column: string) => string | null) | undefined;
  /** Whether another rule already writes a column of this table. */
  decided?: ((column: string) => boolean) | undefined;
  /** This table's booking cancellation, which keeps a late flag of its own. */
  bookingCancel?: { column: string; to: string } | undefined;
  /** Another table's states, which an effect moves. */
  statesOf?: ((table: string) => States | undefined) | undefined;
  /** Whether another table keeps a booking guard (`table.booking`), whose lock an effect's write cannot take. */
  bookedOf?: ((table: string) => boolean) | undefined;
  /** The table whose states another table's rows are tied to as its lines (`states.children`), or undefined. */
  lineOf?: ((table: string) => string | undefined) | undefined;
  /** The app's outbox table, whose rows move only by the outbox's own moves. */
  outboxTable?: string | undefined;
  /** The manifest's generated page refs and, for an add-on, its code page refs: what a state action's link may open. */
  pages?: ReadonlySet<string> | undefined;
  codePages?: ReadonlySet<string> | undefined;
}

/** A column of the table as the judge of an undo's `clears` needs it. */
export interface UndoColumn {
  /** The table's key. */
  key: boolean;
  nullable: boolean;
}

/**
 * Everything wrong with what a table's undo moves empty (`clears`), and with a
 * move that another move to the same state comes before — the judge takes the
 * first, so a later one marked `undo` or naming `clears` would never be made.
 * Paths are relative to the states. The one judge for an app's manifest and a
 * states rule saved in Studio (the server's `statesRuleIssue`).
 */
export function undoMoveIssues(
  states: { column: string; moves: Readonly<Record<string, readonly StateMove[]>> },
  table: string,
  lookup: { column: (ref: string) => UndoColumn | undefined; decided: (ref: string) => boolean },
): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  for (const [from, moves] of Object.entries(states.moves)) {
    const marked = (candidate: StateMove | undefined) => typeof candidate === 'object' && (candidate.undo === true || candidate.clears !== undefined);
    moves.forEach((move, m) => {
      const to = moveTarget(move);
      // The judge takes the first move to a state: a second one, when either is an undo or empties columns, is never made.
      const first = moves.slice(0, m).find((other) => moveTarget(other) === to);
      if (first !== undefined && (marked(first) || marked(move))) {
        out.push({ path: ['moves', from, m], message: `another move from "${from}" to "${to}" comes first, so this one is never made` });
      }
      if (typeof move === 'string') return;
      if (move.clears !== undefined && move.undo !== true) {
        out.push({ path: ['moves', from, m, 'clears'], message: 'only a move marked undo empties columns as it goes' });
      }
      (move.clears ?? []).forEach((ref, c) => {
        const path = ['moves', from, m, 'clears', c];
        const found = lookup.column(ref);
        if (found === undefined) out.push({ path, message: `"${table}" has no column "${ref}"` });
        else if (ref === states.column) out.push({ path, message: 'the state moves by the move itself, not by what it empties' });
        else if (found.key) out.push({ path, message: `"${table}.${ref}" is the key, which never changes` });
        else if (!found.nullable) out.push({ path, message: `"${table}.${ref}" is not nullable, so an undo cannot empty it` });
        else if (lookup.decided(ref)) out.push({ path, message: `"${table}.${ref}" is written by another rule already` });
        if (move.clears!.indexOf(ref) !== c) out.push({ path, message: `"${ref}" is named twice` });
      });
    });
  }
  return out;
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
      if (move.planned === true) {
        // Made by a ledger's planned update alone: nothing a person does, so nothing a person's move carries.
        if (move.undo === true) out.push({ path: at('moves', from, m, 'planned'), message: 'an undo is made by a person, a planned move by a ledger: a move is one or the other' });
        if (move.roles !== undefined) out.push({ path: at('moves', from, m, 'roles'), message: 'a planned move is made by no role: take "roles" out' });
      }
      // An undo takes back a listed move: the one from where it goes to where it starts.
      if (move.undo === true && !(states.moves[to] ?? []).some((back) => moveTarget(back) === from)) {
        out.push({ path: at('moves', from, m, 'undo'), message: `no listed move goes from "${to}" to "${from}", so this move takes nothing back` });
      }
    });
  }
  // What an undo empties besides its stamps, and a move another to the same state hides: one judge with a states rule saved in Studio.
  for (const issue of undoMoveIssues(states, table, {
    column: (ref) => {
      const found = index.column(table, ref);
      return found === undefined ? undefined : { key: found.role === 'pk', nullable: found.nullable === true };
    },
    decided: (ref) => ctx.decided?.(ref) === true,
  })) {
    out.push({ path: at(...issue.path), message: issue.message });
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
    for (const key of ['parentIn', 'createIn', 'changeIn'] as const) (rule[key] ?? []).forEach((value, i) => known(value, here(key, i)));
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
    const tied = rule.parentIn !== undefined || rule.createIn !== undefined || rule.changeIn !== undefined;
    if (rule.lock === undefined && !tied && rule.clearOnCreate === undefined && rule.lockLinked === undefined) {
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
  (states.onlyLater ?? []).forEach((entry, i) => {
    const ref = typeof entry === 'string' ? entry : entry.column;
    const found = index.column(table, ref);
    if (found === undefined) out.push({ path: at('onlyLater', i), message: `"${table}" has no column "${ref}"` });
    else if (found.type !== 'date' && found.type !== 'timestamptz') out.push({ path: at('onlyLater', i), message: `"${table}.${ref}" is not a date` });
    if (typeof entry !== 'string') entry.in.forEach((state, s) => known(state, at('onlyLater', i, 'in', s)));
  });
  out.push(...conditionedMoveIssues(table, states, ctx, at, values));
  // The buttons a record page offers: moves a person may make, columns that are the row's to set, a child that is one.
  if (states.actions !== undefined) {
    out.push(
      ...stateActionIssues(
        states.actions,
        {
          table,
          states,
          column: (of, ref) => index.column(of, ref) as unknown as { ref: string; type: string } | undefined,
          hasTable: (of) => index.table(of) !== undefined,
          decided: (ref) => ctx.decided?.(ref) === true,
          keptFromReaders: (ref) => ctx.keptFromReaders?.(ref) ?? null,
          pages: ctx.pages ?? new Set(),
          codePages: ctx.codePages ?? new Set(),
        },
        at,
      ),
    );
  }
  return out;
}

/**
 * Everything wrong with the rules a move waits for or sets off: conditions on
 * a linked row, the settings row and the clock; the once-means-once refusal;
 * late moves; the moves Adminium makes when a moment passes; and the moves of
 * a linked row a move sets off.
 */
function conditionedMoveIssues<C extends ColumnShape>(
  table: string,
  states: States,
  ctx: StatesContext<C>,
  at: (...rest: (string | number)[]) => (string | number)[],
  values: readonly string[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const { index } = ctx;
  const known = (value: string, path: (string | number)[]) => {
    if (values.length > 0 && !values.includes(value)) out.push({ path, message: `"${value}" is not a value of "${table}.${states.column}"` });
  };
  /** The listed move from `from` to `to`, when there is one. */
  const listed = (from: string, to: string) => (states.moves[from] ?? []).find((move) => moveTarget(move) === to);
  const reached = (to: string) => Object.values(states.moves).some((moves) => moves.some((move) => moveTarget(move) === to));
  /** The table a link of this table points at, or an issue. */
  const linkTarget = (via: string, path: (string | number)[]): string | undefined => {
    const found = index.column(table, via);
    if (found === undefined) {
      out.push({ path, message: `"${table}" has no column "${via}"` });
      return undefined;
    }
    if (found.role === 'pk') {
      out.push({ path, message: `"${table}.${via}" is the key, and points at no other row` });
      return undefined;
    }
    if (found.type !== 'fk' || found.references === undefined || index.table(found.references) === undefined) {
      out.push({ path, message: `"${table}.${via}" does not point at a table of this manifest` });
      return undefined;
    }
    return found.references;
  };

  for (const [from, moves] of Object.entries(states.moves)) {
    moves.forEach((move, m) => {
      if (typeof move === 'string' || move.requires === undefined) return;
      const here = (...rest: (string | number)[]) => at('moves', from, m, 'requires', ...rest);
      (move.requires.linked ?? []).forEach((linked, l) => {
        const target = linkTarget(linked.via, here('linked', l, 'via'));
        if (target === undefined) return;
        linked.where.forEach((condition, w) => out.push(...conditionIssues(target, condition, index, here('linked', l, 'where', w))));
      });
      const time = move.requires.time;
      if (time?.after !== undefined) out.push(...momentIssues(table, time.after, index, here('time', 'after')));
      if (time?.before !== undefined) out.push(...momentIssues(table, time.before, index, here('time', 'before')));
      (move.requires.setting ?? []).forEach((setting, k) => {
        const path = here('setting', k);
        if (index.table(setting.table) === undefined) {
          out.push({ path, message: `"${setting.table}" is not a table of this manifest` });
          return;
        }
        const found = index.column(setting.table, setting.column);
        if (found === undefined) out.push({ path, message: `"${setting.table}" has no column "${setting.column}"` });
        else if (!valueFits(found, setting.eq)) out.push({ path, message: `${JSON.stringify(setting.eq)} is not a value of "${setting.table}.${setting.column}"` });
      });
    });
  }

  if (typeof states.strict === 'object') {
    states.strict.show.forEach((ref, i) => {
      const path = at('strict', 'show', i);
      if (index.column(table, ref) === undefined) {
        out.push({ path, message: `"${table}" has no column "${ref}"` });
        return;
      }
      const kept = ctx.keptFromReaders?.(ref) ?? null;
      if (kept !== null) out.push({ path, message: `"${table}.${ref}" is ${kept}, so a refusal never repeats it` });
    });
  }

  (states.late ?? []).forEach((late, i) => {
    const here = (...rest: (string | number)[]) => at('late', i, ...rest);
    known(late.to, here('to'));
    (late.from ?? []).forEach((from, f) => {
      known(from, here('from', f));
      if (listed(from, late.to) === undefined) out.push({ path: here('from', f), message: `no listed move goes from "${from}" to "${late.to}"` });
    });
    if (late.from === undefined && !reached(late.to)) out.push({ path: here('to'), message: `no listed move goes to "${late.to}"` });
    out.push(...momentIssues(table, late.moment, index, here('moment')));
    (late.where ?? []).forEach((condition, w) => out.push(...conditionIssues(table, condition, index, here('where', w))));
    if (late.flag !== undefined) {
      const flag = index.column(table, late.flag);
      if (flag === undefined) out.push({ path: here('flag'), message: `"${table}" has no column "${late.flag}"` });
      else if (flag.type !== 'bool') out.push({ path: here('flag'), message: `"${table}.${late.flag}" is not a bool` });
      else if (late.flag === states.column) out.push({ path: here('flag'), message: 'the flag is a column of its own, not the state' });
      if (ctx.decided?.(late.flag) === true) out.push({ path: here('flag'), message: `"${table}.${late.flag}" is written by another rule already` });
      if ((states.late ?? []).some((other, j) => j < i && other.flag === late.flag)) {
        out.push({ path: here('flag'), message: `"${late.flag}" is set by another late move of this table already` });
      }
    }
    const cancel = ctx.bookingCancel;
    if (cancel !== undefined && cancel.column === states.column && cancel.to === late.to) {
      out.push({ path: here('to'), message: `the booking rule already says when a move to "${late.to}" is late; one late rule per move` });
    }
    if ((states.late ?? []).some((other, j) => j < i && other.to === late.to)) {
      out.push({ path: here('to'), message: `another late rule already judges the move to "${late.to}"; one late rule per move` });
    }
  });

  (states.timed ?? []).forEach((timed, i) => {
    const here = (...rest: (string | number)[]) => at('timed', i, ...rest);
    known(timed.from, here('from'));
    known(timed.to, here('to'));
    const move = listed(timed.from, timed.to);
    if (move === undefined) out.push({ path: here('to'), message: `no listed move goes from "${timed.from}" to "${timed.to}"` });
    else if (typeof move === 'object' && move.undo === true) out.push({ path: here('to'), message: `the move from "${timed.from}" to "${timed.to}" is an undo, which only a person makes` });
    else if (typeof move === 'object' && move.planned === true) out.push({ path: here('to'), message: `the move from "${timed.from}" to "${timed.to}" is planned, which only a ledger's own update makes` });
    if ((states.timed ?? []).some((other, j) => j < i && other.from === timed.from)) {
      out.push({ path: here('from'), message: `another timed move already leaves "${timed.from}"` });
    }
    const vias = [timed.at, ...(timed.at.or ?? [])].some((moment) => moment.via !== undefined);
    if (vias) out.push({ path: here('at'), message: "a timed move reads its own row's time, never a linked row's" });
    else out.push(...momentIssues(table, timed.at, index, here('at')));
    // A move waiting for a time later than the one it is made at could never pass.
    const after = typeof move === 'object' ? move.requires?.time?.after : undefined;
    if (after !== undefined && neverPasses(after, timed.at)) {
      out.push({ path: here('at'), message: `the move from "${timed.from}" to "${timed.to}" waits until later than this, so it could never be made in time` });
    }
    for (const [ref, value] of Object.entries(timed.set ?? {})) {
      const path = here('set', ref);
      const found = index.column(table, ref);
      if (found === undefined) out.push({ path, message: `"${table}" has no column "${ref}"` });
      else if (ref === states.column) out.push({ path, message: 'the state moves by the timed move itself, not by what it sets' });
      else if (found.role === 'pk') out.push({ path, message: `"${table}.${ref}" is the key, which never changes` });
      else if (value === null ? found.nullable !== true : !valueFits(found, value)) out.push({ path, message: `${JSON.stringify(value)} is not a value of "${table}.${ref}"` });
      else if (ctx.decided?.(ref) === true) out.push({ path, message: `"${table}.${ref}" is written by another rule already` });
    }
  });

  const create = states.create?.requires;
  if (create !== undefined) {
    const here = (...rest: (string | number)[]) => at('create', 'requires', ...rest);
    (create.where ?? []).forEach((condition, w) => out.push(...conditionIssues(table, condition, index, here('where', w))));
    (create.linked ?? []).forEach((linked, l) => {
      const target = linkTarget(linked.via, here('linked', l, 'via'));
      if (target === undefined) return;
      linked.where.forEach((condition, w) => out.push(...conditionIssues(target, condition, index, here('linked', l, 'where', w))));
    });
    if (create.time?.after !== undefined) out.push(...momentIssues(table, create.time.after, index, here('time', 'after')));
    if (create.time?.before !== undefined) out.push(...momentIssues(table, create.time.before, index, here('time', 'before')));
    (create.setting ?? []).forEach((setting, k) => {
      const path = here('setting', k);
      if (index.table(setting.table) === undefined) {
        out.push({ path, message: `"${setting.table}" is not a table of this manifest` });
        return;
      }
      const found = index.column(setting.table, setting.column);
      if (found === undefined) out.push({ path, message: `"${setting.table}" has no column "${setting.column}"` });
      else if (!valueFits(found, setting.eq)) out.push({ path, message: `${JSON.stringify(setting.eq)} is not a value of "${setting.table}.${setting.column}"` });
    });
  }

  /** Everything wrong with an effect's move of a row of `target` (its states `theirs`) by `set`. */
  const effectMoveIssues = (target: string, theirs: States, set: Record<string, string>, here: (...rest: (string | number)[]) => (string | number)[]) => {
    for (const [column, state] of Object.entries(set)) {
      if (column !== theirs.column) {
        out.push({ path: here('set', column), message: `"${target}" moves by "${theirs.column}", not "${column}"` });
        continue;
      }
      const moves = Object.values(theirs.moves).flatMap((list) => list.filter((move) => moveTarget(move) === state));
      if (moves.length === 0) out.push({ path: here('set', column), message: `no move of "${target}" goes to "${state}"` });
      // An undo is made only by a person naming the state they saw; an effect names none.
      if (moves.length > 0 && moves.every((move) => typeof move === 'object' && move.undo === true)) {
        out.push({ path: here('set', column), message: `every move of "${target}" to "${state}" is an undo, which only a person makes` });
      }
      // The linked row is moved inside this write, after its own rows are held: its move may wait only for its own row.
      const reaches = moves.some((move) => {
        if (typeof move === 'string') return false;
        const time = move.requires?.time;
        const vias = [time?.after, time?.before].flatMap((m) => (m === undefined ? [] : [m, ...(m.or ?? [])])).some((m) => m.via !== undefined);
        return (move.requires?.linked?.length ?? 0) > 0 || vias;
      });
      if (reaches) out.push({ path: here('set', column), message: `the move of "${target}" to "${state}" waits for another row, so an effect cannot make it` });
      // Judged late by a time read through another row: that row would be read after this write's own rows.
      const lateThrough = (theirs.late ?? []).some((late) => late.to === state && [late.moment, ...(late.moment.or ?? [])].some((m) => m.via !== undefined));
      if (lateThrough) out.push({ path: here('set', column), message: `a move of "${target}" to "${state}" is judged late by another row's time, so an effect cannot make it` });
    }
  };
  /** Everything wrong with the table an effect moves a row of, whatever sets it off. */
  const effectTargetIssues = (target: string, theirs: States, path: (string | number)[]) => {
    if (target === ctx.outboxTable) out.push({ path, message: `"${target}" is the app's outbox, whose messages move only by the outbox's own moves` });
    // Moved inside this write, after its own rows are held: a lock taken per day, or a parent held first, would come too late.
    if (ctx.bookedOf?.(target) === true) out.push({ path, message: `"${target}" books people by the day, and its lock cannot be taken inside another row's write` });
    const parent = ctx.lineOf?.(target);
    if (parent !== undefined) out.push({ path, message: `"${target}" rows are lines of "${parent}", which would be held after this write's own rows` });
    if ((theirs.effects?.length ?? 0) > 0) out.push({ path, message: `"${target}" sets off effects of its own; an effect moves one row, never a chain` });
  };

  (states.effects ?? []).forEach((effect, i) => {
    const here = (...rest: (string | number)[]) => at('effects', i, ...rest);
    if (isChangeEffect(effect)) {
      (effect.on.in ?? []).forEach((state, k) => known(state, here('on', 'in', k)));
      if ((states.effects ?? []).some((other, j) => j < i && isChangeEffect(other) && other.on.change === effect.on.change)) {
        out.push({ path: here(), message: `another effect already moves the rows "${effect.on.change}" points at when it changes` });
      }
      if (effect.on.change === states.column) out.push({ path: here('on', 'change'), message: 'the state moves by its moves: an effect of a changed link watches a link' });
      const target = linkTarget(effect.on.change, here('on', 'change'));
      if (target === undefined) return;
      const theirs = ctx.statesOf?.(target);
      if (theirs === undefined) {
        out.push({ path: here('on', 'change'), message: `"${target}" declares no states, so its rows have no moves to make` });
        return;
      }
      if (effect.old !== undefined) effectMoveIssues(target, theirs, effect.old.set, (...rest) => here('old', ...rest));
      if (effect.new !== undefined) effectMoveIssues(target, theirs, effect.new.set, (...rest) => here('new', ...rest));
      effectTargetIssues(target, theirs, here('on', 'change'));
      return;
    }
    known(effect.on.to, here('on', 'to'));
    if (!reached(effect.on.to)) out.push({ path: here('on', 'to'), message: `no listed move goes to "${effect.on.to}", so nothing sets this off` });
    if ((states.effects ?? []).some((other, j) => j < i && !isChangeEffect(other) && other.on.to === effect.on.to && other.via === effect.via)) {
      out.push({ path: here(), message: `another effect already moves the row "${effect.via}" points at on a move to "${effect.on.to}"` });
    }
    const target = linkTarget(effect.via, here('via'));
    if (target === undefined) return;
    const theirs = ctx.statesOf?.(target);
    if (theirs === undefined) {
      out.push({ path: here('via'), message: `"${target}" declares no states, so its rows have no moves to make` });
      return;
    }
    effectMoveIssues(target, theirs, effect.set, here);
    effectTargetIssues(target, theirs, here('via'));
  });
  return out;
}

/** Minutes of a literal shift, or undefined when it is read from a setting. */
function literalMinutes(offset: MomentOffset | undefined): number | undefined {
  if (offset === undefined) return 0;
  const { minutes, hours, days } = offset;
  if (typeof minutes === 'number') return minutes;
  if (typeof hours === 'number') return hours * 60;
  if (typeof days === 'number') return days * 1440;
  return undefined;
}

/**
 * Whether `after` is certainly later than `at`: both the same own column,
 * no time of day, no fallback, and literal shifts. Anything else depends on
 * the row and the settings, and is the app's to get right.
 */
function neverPasses(after: Moment, at: Moment): boolean {
  const plain = (m: Moment) => m.via === undefined && m.time === undefined && m.or === undefined;
  if (!plain(after) || !plain(at) || after.column !== at.column) return false;
  const shift = (m: Moment): number | undefined => {
    if (m.plus !== undefined) return literalMinutes(m.plus);
    const back = literalMinutes(m.minus);
    return back === undefined ? undefined : -back;
  };
  const a = shift(after);
  const b = shift(at);
  return a !== undefined && b !== undefined && a > b;
}

export function conditionIssues<C extends ColumnShape>(
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
