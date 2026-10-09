/*
 * VENDORED VERBATIM from packages/manifest/src/state-actions.ts.
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
 * STATE ACTIONS — the buttons of a generated record page.
 *
 * A table with states says which moves exist; its `actions` say which of them
 * (and what else) a person is offered on the row's own page, in the words the
 * app or the add-on chooses: "Send", "Mark received", "Top up". Four forms:
 *
 *  - `move`  moves the row to a state, optionally asking for a few columns in
 *            the confirm and setting others;
 *  - `set`   writes columns and moves nothing ("Send again");
 *  - `link`  opens another page for the row;
 *  - `child` opens a small form that adds a row of a child table.
 *
 * `set` is always a key of the action itself. On a move or a set action it
 * names columns of the row; on a child action, columns of the new child row.
 *
 * Pure. Nothing imported from the states file, which imports this one.
 */
import { z } from 'zod';

import { refSchema, scalarSchema, textOrLabels, valueFits, wordsOrLabels, type ReferenceIssue } from './refs.ts';

const kebab = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a kebab-case id');
const stateName = z.string().min(1).max(40);
const tone = z.enum(['primary', 'neutral', 'danger']);
const now = z.object({ now: z.literal(true) }).strict();
const setRow = z.record(refSchema, z.union([scalarSchema, now]));
const setChild = z.record(refSchema, scalarSchema);

/** The most actions one table offers. */
export const STATE_ACTIONS_MAX = 12;

export const stateActionSchema = z.union([
  z
    .object({
      id: kebab,
      label: textOrLabels,
      move: z.object({ to: stateName }).strict(),
      tone: tone.optional(),
      confirm: wordsOrLabels.optional(),
      set: setRow.optional(),
      /** Columns typed in the confirm, before the move is made. */
      ask: z.array(refSchema).min(1).max(4).optional(),
    })
    .strict(),
  z
    .object({
      id: kebab,
      label: textOrLabels,
      set: setRow,
      in: z.array(stateName).min(1).max(16),
      tone: tone.optional(),
      confirm: wordsOrLabels.optional(),
      ask: z.array(refSchema).min(1).max(4).optional(),
    })
    .strict(),
  z
    .object({
      id: kebab,
      label: textOrLabels,
      /** A generated page of the manifest, or a code page (`<ref>`, or `<add-on key>:<ref>`), opened with the row's key as `param`. */
      link: z
        .object({
          page: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a page ref').optional(),
          addOnPage: z.string().regex(/^([a-z][a-z0-9-]{1,79}:)?[a-z][a-z0-9-]*$/, '<ref>, or <add-on key>:<ref>').optional(),
          param: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/, 'a snake_case parameter name'),
        })
        .strict()
        .refine((link) => (link.page === undefined) !== (link.addOnPage === undefined), { message: 'a link opens one page: "page" or "addOnPage"' }),
      in: z.array(stateName).min(1).max(16),
      tone: tone.optional(),
    })
    .strict(),
  z
    .object({
      id: kebab,
      label: textOrLabels,
      child: z.object({ table: refSchema, via: refSchema, form: z.array(refSchema).max(6) }).strict(),
      set: setChild.optional(),
      in: z.array(stateName).min(1).max(16),
      tone: tone.optional(),
      confirm: wordsOrLabels.optional(),
    })
    .strict(),
]);
export type StateAction = z.infer<typeof stateActionSchema>;

export const stateActionsSchema = z
  .array(stateActionSchema)
  .min(1)
  .max(STATE_ACTIONS_MAX)
  .refine((actions) => new Set(actions.map((action) => action.id)).size === actions.length, { message: 'two actions share an id' });

/** Which of the four an action is. */
export function stateActionKind(action: StateAction): 'move' | 'set' | 'link' | 'child' {
  return 'move' in action ? 'move' : 'link' in action ? 'link' : 'child' in action ? 'child' : 'set';
}

/** Whether a fixed value is one the column holds; a date or a time is written as one (`2026-01-31`, never a word such as "@now"). */
function fits(column: ActionColumn, value: unknown): boolean {
  if (column.type === 'date' || column.type === 'timestamptz') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
  return valueFits(column, value);
}

interface ActionColumn {
  ref: string;
  type: string;
  enum?: readonly string[] | undefined;
  role?: string | undefined;
  references?: string | undefined;
  rules?: Readonly<Record<string, unknown>> | undefined;
}

/** What the checks read of the table the actions are on, and of the manifest around it. */
export interface StateActionsContext {
  table: string;
  /** The states column, and the moves between its values. A move is a state's name, or an object with `to`. */
  states: { column: string; moves: Readonly<Record<string, readonly unknown[]>>; lock?: { when: readonly string[]; except?: readonly string[] | undefined } | undefined };
  column: (table: string, column: string) => ActionColumn | undefined;
  hasTable: (table: string) => boolean;
  /** Whether another rule already writes a column of the table. */
  decided: (column: string) => boolean;
  /** Why a column of the table is kept from readers, or null. */
  keptFromReaders: (column: string) => string | null;
  /** The manifest's generated page refs, and its code page refs when it is an add-on. */
  pages: ReadonlySet<string>;
  codePages: ReadonlySet<string>;
}

/**
 * Everything wrong with a table's state actions: a move nobody may make by
 * hand, a state that is none, a column that is not the row's to set, a child
 * that is no child, a page that is none.
 */
export function stateActionIssues(actions: readonly StateAction[], ctx: StateActionsContext, at: (...rest: (string | number)[]) => (string | number)[]): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const { states, table } = ctx;
  const target = (move: unknown): string => (typeof move === 'string' ? move : String((move as { to: unknown }).to));
  const planned = (move: unknown): boolean => typeof move === 'object' && move !== null && (move as { planned?: unknown }).planned === true;
  const known = new Set<string>(Object.keys(states.moves));
  for (const moves of Object.values(states.moves)) for (const move of moves) known.add(target(move));
  /** The states a move to `to` may be made from by a person. */
  const sources = (to: string): string[] => Object.entries(states.moves).flatMap(([from, moves]) => (moves.some((move) => target(move) === to && !planned(move)) ? [from] : []));

  actions.forEach((action, a) => {
    const here = (...rest: (string | number)[]) => at('actions', a, ...rest);
    const kind = stateActionKind(action);
    // The states the action is offered in: where its move starts, or the ones it lists.
    let offered: string[];
    if ('move' in action) {
      offered = sources(action.move.to);
      if (offered.length === 0) {
        const only = Object.values(states.moves).some((moves) => moves.some((move) => target(move) === action.move.to));
        out.push({
          path: here('move', 'to'),
          message: only
            ? `every move to "${action.move.to}" is planned, which only a ledger's own update makes: no button offers it`
            : `no listed move goes to "${action.move.to}": add it to "moves", from each state the button is offered in`,
        });
      }
    } else {
      offered = action.in;
      action.in.forEach((state, s) => {
        if (!known.has(state)) out.push({ path: here('in', s), message: `"${state}" is not a state of "${table}" (neither a key nor a target of "moves")` });
      });
    }

    if (kind === 'move' || kind === 'set') {
      const set = Object.keys(('set' in action ? action.set : undefined) ?? {});
      const ask = ('ask' in action ? action.ask : undefined) ?? [];
      for (const ref of ask) if (set.includes(ref)) out.push({ path: here('ask'), message: `"${ref}" is set by the action or asked for in its confirm, not both` });
      // Where the table is locked in a state the action is offered in (or moves to), only what the lock leaves open is written.
      const lock = states.lock;
      const reaches = [...offered, ...('move' in action ? [action.move.to] : [])];
      const locked = lock !== undefined && reaches.some((state) => lock.when.includes(state));
      for (const [list, refs] of [['set', set], ['ask', ask]] as const) {
        refs.forEach((ref) => {
          const path = list === 'set' ? here('set', ref) : here('ask');
          const found = ctx.column(table, ref);
          if (found === undefined) {
            out.push({ path, message: `"${table}" has no column "${ref}"` });
            return;
          }
          if (ref === states.column) out.push({ path, message: `"${ref}" is the state itself: a move sets it, an action's "${list}" never does` });
          else if (found.role === 'pk') out.push({ path, message: `"${table}.${ref}" is the row's key` });
          // A stamp the write itself does not trigger is still the row's own column to set.
          else if (ctx.decided(ref) && !(found.rules?.['stamp'] !== undefined && Object.keys(found.rules).length === 1)) out.push({ path, message: `"${table}.${ref}" is decided by Adminium: an action cannot ${list === 'set' ? 'set' : 'ask for'} it` });
          if (list === 'ask') {
            const kept = ctx.keptFromReaders(ref);
            const hidden = (found.rules?.['code'] as { hiddenFromStaff?: unknown } | undefined)?.hiddenFromStaff === true;
            if (found.rules?.['secret'] === true || hidden || kept === 'a secret') out.push({ path, message: `"${table}.${ref}" is kept from staff: no confirm asks for it` });
          }
          if (list === 'set') {
            const value = (action as { set: Record<string, unknown> }).set[ref];
            if (typeof value === 'object' && value !== null) {
              if (found.type !== 'timestamptz') out.push({ path, message: `{"now": true} is the moment the action is made: "${table}.${ref}" is ${found.type}, not a timestamptz` });
            } else if (!fits(found, value)) out.push({ path, message: `${JSON.stringify(value)} is not a value "${table}.${ref}" takes` });
          }
          if (locked && !(lock?.except ?? []).includes(ref)) {
            out.push({ path, message: `"${table}" is locked in ${lock!.when.filter((state) => reaches.includes(state)).map((state) => `"${state}"`).join(', ')}, where this action is offered: add "${ref}" to lock.except, or the write is refused` });
          }
        });
      }
      return;
    }

    if ('child' in action) {
      const child = action.child;
      if (!ctx.hasTable(child.table)) {
        out.push({ path: here('child', 'table'), message: `"${child.table}" is not one of this manifest's tables` });
        return;
      }
      const via = ctx.column(child.table, child.via);
      if (via === undefined || via.type !== 'fk' || via.references !== table) out.push({ path: here('child', 'via'), message: `"${child.table}.${child.via}" is not a foreign key to "${table}"` });
      const set = Object.keys(action.set ?? {});
      child.form.forEach((ref, f) => {
        if (ref === child.via) out.push({ path: here('child', 'form', f), message: `"${ref}" links the new row to this one: the form never asks for it` });
        else if (ctx.column(child.table, ref) === undefined) out.push({ path: here('child', 'form', f), message: `"${child.table}" has no column "${ref}"` });
        else if (set.includes(ref)) out.push({ path: here('child', 'form', f), message: `"${ref}" is set by the action or asked for in its form, not both` });
      });
      for (const ref of set) {
        if (ref === child.via) out.push({ path: here('set', ref), message: `"${ref}" links the new row to this one: Adminium fills it` });
        else if (ctx.column(child.table, ref) === undefined) out.push({ path: here('set', ref), message: `"${child.table}" has no column "${ref}"` });
        else if (!fits(ctx.column(child.table, ref)!, action.set?.[ref])) out.push({ path: here('set', ref), message: `${JSON.stringify(action.set?.[ref])} is not a value "${child.table}.${ref}" takes` });
      }
      return;
    }

    // A link: a page of this manifest.
    const link = (action as Extract<StateAction, { link: unknown }>).link;
    if (link.page !== undefined && !ctx.pages.has(link.page)) out.push({ path: here('link', 'page'), message: `"${link.page}" is not one of this manifest's pages` });
    if (link.addOnPage !== undefined && !link.addOnPage.includes(':') && !ctx.codePages.has(link.addOnPage)) {
      out.push({ path: here('link', 'addOnPage'), message: `"${link.addOnPage}" is not one of this add-on's own pages (addOn.pages): name another add-on's page as "<add-on key>:<ref>"` });
    }
  });
  return out;
}
