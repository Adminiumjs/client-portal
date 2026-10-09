/*
 * VENDORED VERBATIM from packages/manifest/src/plan-types.ts.
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
 * Whether an existing column can hold what a manifest stores in it — shared by
 * both halves of the planner.
 */

import type { ExistingColumnView, SchemaModelView } from './plan-model.ts';
import type { RequiredColumn } from './schema.ts';

/**
 * The logical types an existing column may have for each declared type, on
 * every engine. Deliberately generous: a column that can hold every value the
 * app writes is not a conflict, whatever it is called. A foreign key is judged
 * by the key it points at, which the DDL resolves, so it is never judged here.
 */
const ACCEPTS: Readonly<Record<RequiredColumn['type'], readonly string[] | null>> = {
  id: ['varchar', 'text', 'uuid'],
  text: ['text', 'varchar', 'enum'],
  int: ['integer', 'bigint'],
  bigint: ['bigint'],
  decimal: ['decimal'],
  money: ['decimal'],
  float: ['float', 'decimal'],
  bool: ['boolean'],
  enum: ['enum', 'varchar', 'text'],
  json: ['json'],
  date: ['date', 'timestamp', 'timestamptz'],
  timestamptz: ['timestamptz', 'timestamp'],
  uuid: ['uuid', 'varchar', 'text'],
  blob: ['binary'],
  fk: null,
};

/**
 * What SQLite reports for the columns the installer itself creates there: it
 * has four storage classes, so `bool` is an `integer`, `money` a `float` (REAL)
 * and `json` plain `text`. Without these, an app's own table would conflict
 * with the app on every SQLite reinstall.
 */
const SQLITE_ALSO: Partial<Record<RequiredColumn['type'], readonly string[]>> = {
  bigint: ['integer'],
  decimal: ['float'],
  money: ['float'],
  bool: ['integer'],
  json: ['text'],
};

/**
 * Why an existing column cannot hold what the manifest stores in it — its type,
 * named for a person — or `null` when it can (or cannot be judged).
 */
export function typeConflict(
  declared: RequiredColumn,
  existing: ExistingColumnView,
  dialect: SchemaModelView['dialect'],
): string | null {
  const accepts = ACCEPTS[declared.type];
  const have = existing.logicalType;
  if (accepts === null || have === undefined || have === 'unknown') return null;
  const also = dialect === 'sqlite' ? (SQLITE_ALSO[declared.type] ?? []) : [];
  if (!accepts.includes(have) && !also.includes(have)) return have;
  // A width narrower than the one the app declares. An app that declares no
  // width is not judged: the installer itself keys MySQL text as varchar(255).
  if (
    declared.type === 'text' &&
    have === 'varchar' &&
    typeof existing.maxLength === 'number' &&
    declared.maxLength !== undefined &&
    existing.maxLength < declared.maxLength
  ) {
    return `varchar(${String(existing.maxLength)})`;
  }
  // An enum column narrower than its longest value.
  if (declared.type === 'enum' && have === 'varchar' && typeof existing.maxLength === 'number') {
    const longest = Math.max(0, ...(declared.enum ?? []).map((value) => value.length));
    if (existing.maxLength < longest) return `varchar(${String(existing.maxLength)})`;
  }
  return null;
}

