/*
 * VENDORED VERBATIM from packages/manifest/src/key-bytes.ts.
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
 * HOW WIDE A KEY IS, as MySQL counts it. The planner refuses a unique rule or
 * an index too wide to make, and the validator refuses a receipt table whose
 * derived key is; both count with these. Its own file so neither has to
 * import the other.
 */
import type { RequiredColumn } from './schema.ts';

/**
 * MySQL indexes at most 3072 bytes of a key, and counts four bytes for each
 * character of a `varchar` (utf8mb4): a unique text column of more than 768
 * characters cannot be made, on a new table or an existing one.
 */
export const MYSQL_UNIQUE_KEY_BYTES = 3072;

/** The width of a text column that is unique on its own (declared so, or a code), or null. */
export function uniqueTextWidth(column: RequiredColumn): number | null {
  if (column.type !== 'text') return null;
  const code = column.rules?.code;
  if (column.unique !== true && code === undefined) return null;
  return column.maxLength ?? (code === undefined ? null : (code.prefix ?? '').length + code.length);
}

/**
 * The bytes MySQL's key over a set of columns takes: four a character of
 * text (a code's own width), four a character of an enum's values (32 or 64),
 * a uuid's 36 characters (its own, or a linked key's), eight for anything else.
 */
export function uniqueSetBytes(set: readonly string[], table: { columns: readonly RequiredColumn[] }, tables: readonly { ref: string; columns: readonly RequiredColumn[] }[]): number {
  let bytes = 0;
  for (const ref of set) {
    const column = table.columns.find((c) => c.ref === ref);
    if (column === undefined) continue;
    if (column.type === 'text') {
      const code = column.rules?.code;
      bytes += 4 * (column.maxLength ?? (code === undefined ? 0 : (code.prefix ?? '').length + code.length));
    } else if (column.type === 'enum') {
      bytes += 4 * ((column.enum ?? []).every((value) => value.length <= 32) ? 32 : 64);
    } else if (column.type === 'fk') {
      const target = tables.find((t) => t.ref === column.references)?.columns.find((c) => c.role === 'pk');
      bytes += target?.type === 'uuid' ? 4 * 36 : 8;
    } else if (column.type === 'uuid') {
      // MySQL keeps a uuid as CHAR(36).
      bytes += 4 * 36;
    } else {
      bytes += 8;
    }
  }
  return bytes;
}

