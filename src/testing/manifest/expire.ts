/*
 * VENDORED VERBATIM from packages/manifest/src/expire.ts.
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
 * A TABLE WHOSE ROWS ARE LET GO SOME DAYS AFTER A MOMENT OF THEIRS (`expire`).
 *
 * An add-on keeps rows a stranger made and may never come back to: a design
 * saved and never ordered holds a person's words, photos and logos, and
 * keeping it for nothing is keeping personal data for nothing. A table of
 * the add-on's own says so:
 *
 *     expire: { after: 'updated_at', days: 90, unless: { column: 'state', equals: 'ordered' } }
 *
 * Once a day the server removes each row whose `after` lies more than `days`
 * days back, unless its `unless` column holds the value given (an ordered
 * design stays, whatever its age). A row whose `after` is empty is kept: no
 * moment, no age. The row's files go the way any removed row's do.
 *
 * Only an add-on's own table may say it: an app's rows are its owner's to
 * keep, and a person's are erased by name.
 *
 * Pure.
 */
import { z } from 'zod';

import { refSchema, scalarSchema } from './refs.ts';

/** The fewest and the most days a row may be kept. */
export const EXPIRE_DAYS_MIN = 1;
export const EXPIRE_DAYS_MAX = 3650;

export const expireSchema = z
  .object({
    /** The moment the age is counted from: a date or a moment column of the table. */
    after: refSchema,
    days: z.number().int().min(EXPIRE_DAYS_MIN).max(EXPIRE_DAYS_MAX),
    /** A row whose column holds this value is kept. */
    unless: z.object({ column: refSchema, equals: scalarSchema }).strict().optional(),
  })
  .strict();
export type Expire = z.infer<typeof expireSchema>;

/** The types a moment an age is counted from may be kept in. */
const MOMENTS = ['timestamptz', 'date'];

/** Everything wrong with one table's `expire` that the table alone shows. */
export function expireIssues(table: { expire?: Expire | undefined; columns: readonly { ref: string; type: string; enum?: readonly string[] | undefined }[] }): { path: (string | number)[]; message: string }[] {
  const expire = table.expire;
  if (expire === undefined) return [];
  const out: { path: (string | number)[]; message: string }[] = [];
  const after = table.columns.find((column) => column.ref === expire.after);
  if (after === undefined) out.push({ path: ['expire', 'after'], message: `the table has no column "${expire.after}"` });
  else if (!MOMENTS.includes(after.type)) out.push({ path: ['expire', 'after'], message: `"${expire.after}" is not a date or a moment (timestamptz), so a row's age is not counted from it` });
  if (expire.unless !== undefined) {
    const kept = table.columns.find((column) => column.ref === expire.unless!.column);
    if (kept === undefined) out.push({ path: ['expire', 'unless', 'column'], message: `the table has no column "${expire.unless.column}"` });
    else if (kept.type === 'enum' && !(kept.enum ?? []).includes(String(expire.unless.equals))) {
      out.push({ path: ['expire', 'unless', 'equals'], message: `"${String(expire.unless.equals)}" is not one of the values of "${kept.ref}"` });
    }
  }
  return out;
}
