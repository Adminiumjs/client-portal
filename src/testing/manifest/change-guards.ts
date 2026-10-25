/*
 * VENDORED VERBATIM from packages/manifest/src/change-guards.ts.
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
 * `rules.changes` — WHEN, AND BY WHOM, A COLUMN MAY CHANGE.
 *
 * A quote's approval may become approved or refused only from asked, and
 * never by the person who asked for it nor by the deal's owner:
 *
 * ```json
 * "approval": { "rules": { "changes": [
 *   { "to": ["approved", "refused"], "from": ["asked"], "notBy": ["asked_by_id", "deal_id.owner_id"] }
 * ] } }
 * ```
 *
 * An enquiry's deal may be set only while the enquiry is claimed, and only
 * by the person who claimed it:
 *
 * ```json
 * "deal_id": { "rules": { "changes": [
 *   { "while": { "column": "state", "in": ["claimed"] }, "by": "claimed_by_id" }
 * ] } }
 * ```
 *
 * Each guard holds a change of the column — to one of `to`, or, without it,
 * any change (a new row's value is a change from nothing) — and every guard
 * that holds a change is met, or the write is refused:
 *
 *  - `from`: the row held one of these values before the change (a new row
 *    held none, so it is never made with such a value);
 *  - `while`: another column of the row holds one of some values (or is
 *    empty, or not), before the change and as the change leaves it;
 *  - `by`: the person writing is the one this staff column names — of the
 *    row (`claimed_by_id`), or of the row one of its links names
 *    (`deal_id.owner_id`) — as the row stood before the change;
 *  - `notBy`: the person writing is none of the ones these name, before the
 *    change or as it leaves the row (naming somebody else in the same
 *    write changes nothing).
 *
 * The server judges it on every way a row is written — a change on a page,
 * a bulk edit, a file brought in, a record's button, the public API, a
 * rule — except history (an undo, the app's sample and seed rows). `by` and
 * `notBy` judge a person: a write Adminium makes by itself (a rule, a move
 * when a moment passes) has nobody to judge and is held to `from` and
 * `while` only. A refusal is 403 `COLUMN_FORBIDDEN` naming the column and
 * the reason.
 */
import { z } from 'zod';

import { listingWhileSchema, personPathIssue, personPathSchema } from './roles.ts';
import { scalarSchema, valueFits, type ColumnShape, type ReferenceIssue, type TableIndex } from './refs.ts';

/** One guard on a column's changes. */
export const changeGuardSchema = z
  .object({
    /** The values a change to is held; absent, every change of the column. */
    to: z.array(scalarSchema).min(1).max(32).optional(),
    /** The values the row must hold before the change. */
    from: z.array(scalarSchema).min(1).max(32).optional(),
    /** Another column of the row that holds one of some values (or is empty, or not), before the change and after it. */
    while: listingWhileSchema.optional(),
    /** The only person who makes the change: the one this staff column (or `<link>.<staff column>`) names. */
    by: personPathSchema.optional(),
    /** The people who never make the change: the ones these staff columns (or `<link>.<staff column>`) name. */
    notBy: z.array(personPathSchema).min(1).max(4).optional(),
  })
  .strict()
  .refine((guard) => guard.from !== undefined || guard.while !== undefined || guard.by !== undefined || guard.notBy !== undefined, {
    message: 'a guard says what a change waits for: "from", "while", "by" or "notBy"',
  });
export type ChangeGuard = z.infer<typeof changeGuardSchema>;

/** A column's guards: every one that holds a change is met. */
export const changeGuardsSchema = z.array(changeGuardSchema).min(1).max(8);

/** The column rules through which Adminium decides a column's value: nobody changes one, so no guard holds anything there. */
const DECIDED: readonly string[] = ['copy', 'sequence', 'code', 'rollup', 'stamp', 'formula', 'format', 'lookup', 'perNight', 'customerKey', 'codeLast4'];

interface GuardedColumn extends ColumnShape {
  rules?: Record<string, unknown> | undefined;
}

/** Everything wrong with one column's `changes`, as the manifest can see it. */
export function changeGuardIssues<C extends ColumnShape>(
  index: TableIndex<C>,
  table: string,
  column: GuardedColumn,
  guards: readonly ChangeGuard[],
  here: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const decider = DECIDED.find((name) => column.rules?.[name] !== undefined);
  if (decider !== undefined) out.push({ path: here('changes'), message: `Adminium decides "${table}.${column.ref}" (its ${decider} rule), so no writer changes it and a guard holds nothing` });
  const secret = (of: C | undefined): boolean => (of as GuardedColumn | undefined)?.rules?.['secret'] === true;
  guards.forEach((guard, g) => {
    const at = (...rest: (string | number)[]) => here('changes', g, ...rest);
    for (const side of ['to', 'from'] as const) {
      (guard[side] ?? []).forEach((value, v) => {
        if (!valueFits(column, value)) out.push({ path: at(side, v), message: `${JSON.stringify(value)} is not a value of "${table}.${column.ref}"` });
      });
    }
    // A change from a value to the same value is no change: the guard would never hold one.
    if (guard.to !== undefined && guard.from !== undefined && guard.to.every((value) => guard.from!.includes(value))) {
      out.push({ path: at('from'), message: 'a change to a value is never a change from that same value: name the values it comes from' });
    }
    if (guard.while !== undefined) {
      const other = index.column(table, guard.while.column);
      if (other === undefined) out.push({ path: at('while', 'column'), message: `"${table}" has no column "${guard.while.column}"` });
      else if (other.ref === column.ref) out.push({ path: at('while', 'column'), message: 'a change is held by another column: what this one holds before the change is "from"' });
      // A refusal says whether the row holds the value: never asked of a column kept from every reader.
      else if (secret(other)) out.push({ path: at('while', 'column'), message: `"${table}.${other.ref}" is a secret, and a change is never judged by one` });
      else if ('in' in guard.while) {
        guard.while.in.forEach((value, v) => {
          if (!valueFits(other, value)) out.push({ path: at('while', 'in', v), message: `${JSON.stringify(value)} is not a value of "${table}.${other.ref}"` });
        });
      }
    }
    if (guard.by !== undefined) {
      const issue = personPathIssue(index, table, guard.by);
      if (issue !== null) out.push({ path: at('by'), message: `${issue}: "by" names the person who makes the change` });
      if (guard.notBy?.includes(guard.by) === true) out.push({ path: at('notBy'), message: `"${guard.by}" is both the person who makes the change and one who never does` });
    }
    (guard.notBy ?? []).forEach((path, p) => {
      const issue = personPathIssue(index, table, path);
      if (issue !== null) out.push({ path: at('notBy', p), message: `${issue}: "notBy" names a person who never makes the change` });
      if (guard.notBy!.indexOf(path) !== p) out.push({ path: at('notBy', p), message: `"${path}" is named twice` });
    });
  });
  return out;
}
