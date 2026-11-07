/*
 * VENDORED VERBATIM from packages/manifest/src/app-requires.ts.
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
 * `apps.requires` — the other apps a self-made app needs on its database.
 *
 * ```json
 * "apps": {
 *   "requires": [{ "publisher": "adminium", "key": "point-of-sale", "range": ">=1.2.0",
 *                  "tables": ["orders", "order_lines"] }]
 * }
 * ```
 *
 * A dashboard saved with pages on a catalogue app's tables never carries that
 * app: it names it here, and the install needs it already installed on the
 * same database, by the same publisher, at a version in `range` (any version
 * when there is none). Publisher AND key: a key alone is matched by any file
 * that says it is `pos`, a self-made one among them.
 *
 * `tables` names the app's own `requiredSchema.tables` that are the required
 * app's, by the same ref. The install makes none of them: it uses the
 * required app's tables and records its use of them, so the required app's
 * uninstall never drops a table this app still reads.
 *
 * A self-made app (`publisher: local`) is never a requirement: `local` says
 * where a file was made, not which app it is, so it proves nothing.
 *
 * Only a self-made app carries the block; the published catalogue never does.
 */
import { z } from 'zod';

import { refSchema } from './refs.ts';
import { parseSemverRange } from './semver.ts';

const LOCAL_PUBLISHER_ID = 'local';

/** The most apps one app may require. */
export const REQUIRED_APPS_MAX = 8;

const rangeSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((range) => parseSemverRange(range) !== null, { message: 'a semver range such as ">=1.1.0" or "^1.1.0"' });

export const requiredAppSchema = z
  .object({
    /** The publisher's id, as the required app's own manifest gives it. */
    publisher: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'a publisher id'),
    key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an app key'),
    /** The versions that will do: any, when absent. */
    range: rangeSchema.optional(),
    /** This app's tables that are the required app's own, by the same ref. */
    tables: z.array(refSchema).min(1).max(64).optional(),
  })
  .strict();
export type RequiredApp = z.infer<typeof requiredAppSchema>;

export const appsBlockSchema = z
  .object({
    requires: z.array(requiredAppSchema).min(1).max(REQUIRED_APPS_MAX),
  })
  .strict();
export type AppsBlock = z.infer<typeof appsBlockSchema>;

interface Issue {
  path: (string | number)[];
  message: string;
}

/** Everything wrong with an app's `apps` block that its shape alone cannot see. */
export function requiredAppIssues(m: {
  key: string;
  publisher: { id: string };
  apps?: AppsBlock | undefined;
  requiredSchema?: { tables: readonly { ref: string }[] } | undefined;
}): Issue[] {
  const out: Issue[] = [];
  if (m.apps === undefined) return out;
  if (m.publisher.id !== LOCAL_PUBLISHER_ID) {
    out.push({ path: ['apps'], message: `"apps" is carried only by a self-made app (publisher "${LOCAL_PUBLISHER_ID}")` });
  }
  const own = new Set((m.requiredSchema?.tables ?? []).map((table) => table.ref));
  const keys = new Set<string>();
  const named = new Map<string, string>();
  m.apps.requires.forEach((need, n) => {
    const at = ['apps', 'requires', n];
    if (need.key === m.key) out.push({ path: [...at, 'key'], message: 'an app does not require itself' });
    if (keys.has(need.key)) out.push({ path: [...at, 'key'], message: `"${need.key}" is required twice` });
    keys.add(need.key);
    if (need.publisher === LOCAL_PUBLISHER_ID) {
      out.push({
        path: [...at, 'publisher'],
        message: `a self-made app cannot be required: "${LOCAL_PUBLISHER_ID}" says where a file was made, not which app it is`,
      });
    }
    (need.tables ?? []).forEach((ref, t) => {
      if (!own.has(ref)) out.push({ path: [...at, 'tables', t], message: `"${ref}" is not one of the app's tables (requiredSchema.tables)` });
      const earlier = named.get(ref);
      if (earlier !== undefined) out.push({ path: [...at, 'tables', t], message: `"${ref}" is already "${earlier}"'s table` });
      named.set(ref, need.key);
    });
  });
  return out;
}

/** This app's tables that are another app's, by ref, with the app they belong to. */
export function requiredAppTables(apps: AppsBlock | undefined): Map<string, RequiredApp> {
  const out = new Map<string, RequiredApp>();
  for (const need of apps?.requires ?? []) for (const ref of need.tables ?? []) out.set(ref, need);
  return out;
}
