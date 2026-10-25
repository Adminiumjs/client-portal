/*
 * VENDORED VERBATIM from packages/manifest/src/removal.ts.
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
 * What a table keeps of its removed rows, and a column whose earlier values
 * staff never read back.
 *
 * `removal` (a table word, opt-in):
 * - `reason: true | "required"`: every door a person removes a row through
 *   (the delete route, a bulk delete, the add-on kit's `remove`) takes a
 *   reason, written into the removal's audit entry; `"required"` refuses a
 *   removal without one. Every other removal (an undo, a cascade, a rule's or
 *   a move's delete) is recorded with no reason.
 * - `history: true`: a removed row stays readable, through a row it linked to
 *   that the reader reads now (a deal's removed member, a job's cancelled
 *   visit), masked as a live read is, until an undo brings it back. Never on
 *   a private table: its rows are read by their own people only, and a
 *   removed row has nobody it belongs to any more.
 *
 * `history: "audit"` (a column rule): the column's earlier values stay out of
 * record history, a rule's `{{was.<column>}}`, a removed row's history and
 * live frames; only the audit log, which the install's owner reads, keeps
 * them (a removed message's text).
 */
import { z } from 'zod';

export const removalSchema = z
  .object({
    reason: z.union([z.literal(true), z.literal('required')]).optional(),
    history: z.literal(true).optional(),
  })
  .strict()
  .refine((rule) => rule.reason !== undefined || rule.history !== undefined, { message: 'a removal rule says "reason", "history", or both' });
export type RemovalRule = z.infer<typeof removalSchema>;

/** The longest reason a removal keeps, in characters. */
export const REMOVAL_REASON_MAX = 500;

/** The column rule's one value: earlier values kept for the audit log only. */
export const columnHistorySchema = z.literal('audit');

interface RemovalTableShape {
  ref: string;
  private?: true | undefined;
  removal?: RemovalRule | undefined;
  columns: readonly { ref: string; type: string; role?: string | undefined; references?: unknown; rules?: { history?: 'audit' | undefined; secret?: unknown } | undefined }[];
}

/** Everything wrong with the tables' `removal` words and their columns' `history` rules. */
export function removalIssues(tables: readonly RemovalTableShape[]): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  tables.forEach((table, t) => {
    const at = (...rest: (string | number)[]) => ['requiredSchema', 'tables', t, ...rest];
    if (table.removal?.history === true) {
      if (table.private === true) out.push({ path: at('removal', 'history'), message: 'a private table\'s rows are read by their own people only: its removed rows are kept for nobody' });
      // Read through a row it linked to: a table with no link has no such row.
      if (!table.columns.some((column) => column.type === 'fk' && column.references !== undefined)) {
        out.push({ path: at('removal', 'history'), message: `a removed row is read through a row it linked to, and "${table.ref}" links to none` });
      }
    }
    table.columns.forEach((column, c) => {
      if (column.rules?.history === undefined) return;
      // How a row's history is found: its key is never left out of it.
      if (column.role === 'pk') out.push({ path: at('columns', c, 'rules', 'history'), message: 'a row\'s key is how its history is found: it is never kept for the audit log only' });
    });
  });
  return out;
}

/** The columns of a table whose earlier values only the audit log keeps. */
export function auditOnlyColumns(table: Pick<RemovalTableShape, 'columns'>): string[] {
  return table.columns.filter((column) => column.rules?.history === 'audit').map((column) => column.ref);
}
