/*
 * VENDORED VERBATIM from packages/add-on-contracts/src/nav-groups.ts.
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
 * THE RAIL'S BUILT-IN GROUPS — the canonical list, and as of 51a the only one
 * that is allowed to grow a copy.
 *
 * The same five keys were written out in five places: the bootstrap
 * schema's `z.enum`, its handler, the dashboard's mirror, the Studio page
 * editor's options and `SidebarNav`, where a `satisfies` made a sixth group a
 * compile error. That closure was deliberate and it was right while the set
 * could only ever be these five. The owner's 2026-09-19 ruling opens it — an
 * add-on may declare a group of its own — so the compile-time guard has to
 * become a refusal that names the bad key instead, and the five have to have
 * one home. 51b rewires the other copies to import this; until then a test at
 * each end holds them equal, which is the same protection with none of the risk.
 *
 * WHY THIS IS ITS OWN MODULE, and why the package exports it as its own
 * subpath (`@adminium/add-on-contracts/nav-groups`). It lived in
 * `add-on-block.ts`, and the dashboard's `app/bootstrap.ts` — which is in the
 * entry chunk — imported it through the package's barrel. One value import of
 * five strings therefore made the WHOLE package statically reachable from the
 * entry: `slots`, `document-render`, `product-personalizer`,
 * `shipping-carrier`, `artwork-source` and `contracts`, plus the zod schemas
 * and ui components they reach, for 10.2 KiB of it that a sidebar cannot use.
 * A host that needs only the group keys must be able to take only the group
 * keys, so they get a module with no imports of their own.
 */
export const BUILTIN_NAV_GROUP_KEYS = ['workspace', 'library', 'planning', 'people', 'account'] as const;
export type BuiltinNavGroupKey = (typeof BUILTIN_NAV_GROUP_KEYS)[number];
