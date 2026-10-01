/*
 * VENDORED VERBATIM from packages/manifest/src/roles.ts.
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
 * `roles[].limits` — what a role's `update` on one of the app's tables may
 * write, when it may not write everything.
 *
 * A clinician moves a visit along and does nothing else to it:
 *
 * ```json
 * "limits": {
 *   "appointments": {
 *     "writable": ["status"],
 *     "writableValues": { "status": ["roomed", "with_clinician", "ready"] }
 *   }
 * }
 * ```
 *
 * The names are the public-access entries' (`writable`, `writableValues`).
 * A limit narrows the role's own `table:@<ref>:update`, so a role must grant
 * that update (itself or through `cloneFrom`) for a limit on the table to
 * mean anything. Roles add up: someone who also holds a role with a plain
 * update on the table is not held to the limit. Creating rows is not limited.
 *
 * `readable` limits the role's READ of the table to some columns, the same
 * way: housekeeping reads a stay's room and dates, and none of its guest or
 * its money. The key and the table's links to other rows are always read (a
 * screen moves through them). A column the role may not read is not written
 * through it either, unless `writable` names it.
 */
import { z } from 'zod';

import { refSchema, scalarSchema, valueFits, type ColumnShape, type ReferenceIssue, type TableIndex } from './refs.ts';

/** One table's limit. */
export const roleLimitSchema = z
  .object({
    /** The only columns the update may change. */
    writable: z.array(refSchema).min(1).optional(),
    /** For some of those columns, the only values it may set. */
    writableValues: z.record(refSchema, z.array(scalarSchema).min(1).max(32)).optional(),
    /** The only columns the read shows (with the key and the links to other rows). */
    readable: z.array(refSchema).min(1).max(200).optional(),
    /** The only columns a new row it creates may be given (the rest take their defaults). */
    creatable: z.array(refSchema).min(1).optional(),
    /** For some of those columns, the only values a new row may be given. */
    creatableValues: z.record(refSchema, z.array(scalarSchema).min(1).max(32)).optional(),
  })
  .strict()
  .refine((limit) => limit.writable !== undefined || limit.readable !== undefined || limit.creatable !== undefined, {
    message: 'a limit names what the role may write (writable), read (readable) or create with (creatable)',
  });
export type RoleLimit = z.infer<typeof roleLimitSchema>;

/** Per table ref, the limit on the role's update there. */
export const roleLimitsSchema = z.record(refSchema, roleLimitSchema);

/** What the checks read of a role. */
export interface RoleShape {
  key: string;
  cloneFrom?: string | undefined;
  permissions?: readonly string[] | undefined;
  limits?: Readonly<Record<string, RoleLimit>> | undefined;
}

/** The grants a role ends up with: its own and the ones of the role it clones. */
function grantsOf(role: RoleShape, roles: readonly RoleShape[]): Set<string> {
  const from = role.cloneFrom === undefined ? undefined : roles.find((other) => other.key === role.cloneFrom);
  return new Set([...(from?.permissions ?? []), ...(role.permissions ?? [])]);
}

/** Every `limits` problem across the app's roles. */
export function roleLimitIssues<C extends ColumnShape>(roles: readonly RoleShape[], index: TableIndex<C>): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  roles.forEach((role, r) => {
    const grants = grantsOf(role, roles);
    for (const [ref, limit] of Object.entries(role.limits ?? {})) {
      const at = (...rest: (string | number)[]) => ['roles', r, 'limits', ref, ...rest];
      if (index.table(ref) === undefined) {
        out.push({ path: at(), message: `"${ref}" is not a table of this app` });
        continue;
      }
      if (limit.writable !== undefined && !grants.has(`table:@${ref}:update`)) {
        out.push({ path: at(), message: `the role does not grant table:@${ref}:update, so there is nothing to limit` });
      }
      if (limit.writable === undefined && limit.writableValues !== undefined) {
        out.push({ path: at('writableValues'), message: 'values are limited for the columns the role may write: name them (writable)' });
      }
      const writable = new Set(limit.writable ?? []);
      for (const column of limit.writable ?? []) {
        if (index.column(ref, column) === undefined) out.push({ path: at('writable'), message: `"${ref}" has no column "${column}"` });
      }
      if (limit.readable !== undefined) {
        if (!grants.has(`table:@${ref}:read`)) out.push({ path: at('readable'), message: `the role does not grant table:@${ref}:read, so there is nothing to limit` });
        limit.readable.forEach((column, c) => {
          if (index.column(ref, column) === undefined) out.push({ path: at('readable', c), message: `"${ref}" has no column "${column}"` });
          else if (limit.readable!.indexOf(column) !== c) out.push({ path: at('readable', c), message: `"${column}" is listed twice` });
        });
      }
      for (const [column, values] of Object.entries(limit.writableValues ?? {})) {
        if (!writable.has(column)) out.push({ path: at('writableValues', column), message: `"${column}" is not writable` });
        const found = index.column(ref, column);
        if (found === undefined) continue;
        for (const value of values) {
          if (!valueFits(found, value)) out.push({ path: at('writableValues', column), message: `${JSON.stringify(value)} is not a value of "${ref}.${column}"` });
        }
      }
      if (limit.creatable !== undefined && !grants.has(`table:@${ref}:create`)) {
        out.push({ path: at('creatable'), message: `the role does not grant table:@${ref}:create, so there is nothing to limit` });
      }
      if (limit.creatable === undefined && limit.creatableValues !== undefined) {
        out.push({ path: at('creatableValues'), message: 'values are limited for the columns a new row may be given: name them (creatable)' });
      }
      for (const column of limit.creatable ?? []) {
        if (index.column(ref, column) === undefined) out.push({ path: at('creatable'), message: `"${ref}" has no column "${column}"` });
      }
      const creatable = new Set(limit.creatable ?? []);
      for (const [column, values] of Object.entries(limit.creatableValues ?? {})) {
        if (!creatable.has(column)) out.push({ path: at('creatableValues', column), message: `"${column}" is not creatable` });
        const found = index.column(ref, column);
        if (found === undefined) continue;
        for (const value of values) {
          if (!valueFits(found, value)) out.push({ path: at('creatableValues', column), message: `${JSON.stringify(value)} is not a value of "${ref}.${column}"` });
        }
      }
    }
  });
  return out;
}
