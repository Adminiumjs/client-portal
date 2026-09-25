/*
 * VENDORED VERBATIM from packages/add-on-contracts/src/add-on-block.ts.
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
 * The `addOn` manifest block and its validation rules. Lives here rather than
 * in `@adminium/manifest` because the rules are assertions ABOUT the registries
 * in this package — a slot id or a contract id is only meaningful against the
 * closed lists in `slots.ts` / `contracts.ts`.
 *
 * `@adminium/manifest` imports this to build the `kind: "add-on"` branch of its
 * discriminated union.
 */

import { z } from 'zod';

import { contractIdSchema, hasContractVersion } from './contracts.ts';
import { slotIdSchema } from './slots.ts';
import { BUILTIN_NAV_GROUP_KEYS, type BuiltinNavGroupKey } from './nav-groups.ts';

/**
 * Add-ons get their OWN closed category vocabulary (D2), because an add-on is
 * not a vertical and forcing it into the app facet set would make a carrier a
 * "commerce" product. Wave 4 uses two of the five; the other three exist so a
 * second add-on wave does not have to reopen the vocabulary.
 */
export const ADD_ON_CATEGORIES = ['artwork', 'delivery', 'payments', 'email', 'data'] as const;
export const addOnCategorySchema = z.enum(ADD_ON_CATEGORIES);
export type AddOnCategory = (typeof ADD_ON_CATEGORIES)[number];

/** How the shop supplies credentials, if at all. */
export const CONNECT_KINDS = ['none', 'api-key', 'oauth2'] as const;
export const connectKindSchema = z.enum(CONNECT_KINDS);
export type ConnectKind = (typeof CONNECT_KINDS)[number];

const VERSION = String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?`;
const COMPARATOR = new RegExp(`^(>=|<=|>|<|=|\\^|~)?${VERSION}$`);

/**
 * A semver range over an app's version: `^0.2.0`, `~0.2.1`, `0.2.0`, `*`,
 * `>=0.2.0`, `>=0.2.0 <1.0.0` (spaces join, `||` separates alternatives).
 * The same grammar `@adminium/manifest`'s `parseSemverRange` reads — written
 * again here because that package imports this one, not the reverse. In 0.x
 * `^0.2.0` stops before 0.3.0, so an add-on that means "0.2 and later" writes
 * `>=0.2.0`.
 */
export function isSemverRange(range: string): boolean {
  if (range.length === 0 || range.length > 120) return false;
  return range.split('||').every((alternative) => {
    const words = alternative.trim().split(/\s+/);
    if (words.length === 1 && words[0] === '*') return true;
    return words.length > 0 && words.every((word) => word !== '' && COMPARATOR.test(word));
  });
}

/**
 * Exact hostname — no wildcards, no bare IPs, no ports, no scheme (D14).
 *
 * The final label is alphabetic on purpose: it is what makes `203.0.113.10`
 * fail. Every real TLD is alphabetic, and an egress allow-list that quietly
 * accepts a literal IP is an allow-list with a hole in it.
 */
const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/;

export const attachTargetSchema = z
  .object({
    /** A known app key, or `"*"` when the contract is not host-specific. */
    app: z.union([z.literal('*'), z.string().regex(/^[a-z][a-z0-9-]{1,79}$/)]),
    range: z.string().refine(isSemverRange, 'range must be a semver range such as "^1.0.0", ">=0.2.0" or "*"').optional(),
    /** Only for `record.editor.panel`: which host tables the panel mounts on. */
    table: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  })
  .strict();

export const providesSchema = z
  .object({
    contract: contractIdSchema,
    version: z.number().int().positive(),
    server: z.string().min(1),
  })
  .strict();

export const consumesSchema = z
  .object({
    contract: contractIdSchema,
    version: z.number().int().positive(),
  })
  .strict();

export const slotFillSchema = z
  .object({
    slot: slotIdSchema,
    client: z.string().min(1),
    order: z.number().int(),
  })
  .strict();

export const addOnEventSchema = z
  .object({
    on: z.string().min(1).max(80),
    server: z.string().min(1),
  })
  .strict();

export const addOnConnectSchema = z
  .object({
    kind: connectKindSchema,
    authorizeUrl: z.url().optional(),
    tokenUrl: z.url().optional(),
    scopes: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const addOnNetworkSchema = z
  .object({
    allow: z.array(z.string().regex(HOSTNAME, 'must be an exact https hostname')),
  })
  .strict();

// ── pages and navigation ─────────────────────────────────────────────────────

/**
 * An i18n message: a catalog key plus the English fallback rendered when the
 * key is absent.
 *
 * MOVED HERE FROM `@adminium/manifest` by 51a, which now re-exports it under
 * the same name. One definition rather than two, because both ends need it: a
 * page title and a nav-group label are written in a manifest and validated
 * there, and read back by a host through the schemas in THIS package. Two
 * four-line copies of the same shape are exactly the duplicate that drifts in a
 * field nobody reads — `max(400)` here and `max(200)` there — and then the
 * stricter copy refuses first, for a reason no message names.
 */
export const i18nMessageSchema = z
  .object({
    key: z.string().min(1).max(120),
    fallback: z.string().min(1).max(400),
  })
  .strict();
export type I18nMessage = z.infer<typeof i18nMessageSchema>;

/**
 * THE RAIL'S BUILT-IN GROUPS now live in `nav-groups.ts`, re-exported here so
 * this module's public surface is unchanged. They moved so that a host needing
 * only the five keys — the dashboard's entry-chunk `app/bootstrap.ts` — can
 * import them without making this whole module, and everything the barrel
 * reaches from it, statically reachable. See that file's note.
 */
export { BUILTIN_NAV_GROUP_KEYS, type BuiltinNavGroupKey } from './nav-groups.ts';

/**
 * Where a page goes when its manifest asks for no group (the owner's ruling,
 * 51 D-nav). Applied at PARSE, so what a host reads is already resolved and the
 * rail never has to guess.
 *
 * The alternative is what generated pages do today, and it is worse: an app
 * page whose `navGroup` is not in the closed set is dropped into `hidden` at
 * `bootstrap/handlers.ts:146` — the page exists, nothing links to it, and
 * nothing says why. An add-on that omits a group has not made a mistake, so it
 * gets a home rather than a silence.
 */
export const DEFAULT_NAV_GROUP: BuiltinNavGroupKey = 'library';

/**
 * A group key, built-in or declared. Kebab-case, because it appears in no URL
 * but is compared against the built-in five, which are kebab.
 */
export const navGroupKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}$/, 'a nav group key must be kebab-case, 1–40 characters');

/**
 * The host API an add-on's client code is written against.
 *
 * A version rather than a boolean because publishing `Modal` and `useNavigate`
 * to code the engine did not build makes them public API: the day that surface
 * changes shape, an add-on built against the old one must be REFUSED with its
 * version named, not mounted into a blank screen. `z.literal(1)` becomes a
 * union the first time there is a 2 — and there is deliberately no `"*"`.
 */
export const hostApiVersionSchema = z.literal(1);
export const HOST_API_VERSION = 1;

/**
 * A rail row. Omit `nav` entirely and the page is routable but unlisted —
 * a detail screen an add-on links to itself.
 */
export const addOnPageNavSchema = z
  .object({
    group: navGroupKeySchema.default(DEFAULT_NAV_GROUP),
    order: z.number().int(),
    /** Same audience the engine's own admin-only rail rows have. */
    adminOnly: z.boolean().optional(),
  })
  .strict();

/**
 * A page an add-on renders from its OWN bundle.
 *
 * NOT `pageSchema` in `@adminium/manifest`, which is a generated page: a
 * `template` the engine renders with `bindings` and `config`. This is code. The
 * two deliberately do not share a name in the same document — an add-on's live
 * under `addOn.pages` — because "page" meaning both a template row and a
 * JavaScript module in one manifest is how a reader ends up writing `template`
 * here and waiting for a screen that never comes.
 */
export const addOnPageSchema = z
  .object({
    /** The last segment of `/add-ons/<key>/<ref>`. */
    ref: z.string().regex(/^[a-z][a-z0-9-]*$/, 'page ref must be a kebab-case identifier'),
    title: i18nMessageSchema,
    icon: z.string().min(1).max(60),
    /** A path the bundle route will serve; its default export is the page. */
    client: z.string().min(1),
    nav: addOnPageNavSchema.optional(),
    /** Reserve `/add-ons/<key>/<ref>/*` for the page's own sub-routes. */
    detail: z.boolean().optional(),
  })
  .strict();
export type AddOnPage = z.infer<typeof addOnPageSchema>;

/**
 * A group this add-on brings with it. Its label travels WITH the add-on — a key
 * plus an English fallback, resolved against the add-on's own translations —
 * which is the whole reason the engine does not have to own
 * `nav.group.<whatever>` in eight locales to let somebody name a group.
 */
export const addOnNavGroupSchema = z
  .object({
    key: navGroupKeySchema,
    label: i18nMessageSchema,
    /** Orders the trailing add-on band only; built-in groups do not move. */
    order: z.number().int(),
  })
  .strict();
export type AddOnNavGroup = z.infer<typeof addOnNavGroupSchema>;

export const addOnBlockSchema = z
  .object({
    attaches: z.array(attachTargetSchema).min(1),
    provides: z.array(providesSchema).optional(),
    consumes: z.array(consumesSchema).optional(),
    slots: z.array(slotFillSchema).optional(),
    events: z.array(addOnEventSchema).optional(),
    connect: addOnConnectSchema,
    /** Grants over host + own tables, checked against SCOPE_OUT_OF_RANGE. */
    scopes: z.array(z.string().min(1)).optional(),
    network: addOnNetworkSchema.optional(),
    /** D15 — the only settings the client bundle may read. */
    publicSettings: z.array(z.string().min(1)).optional(),
    /** D11 — required to ship a demo that makes no real third-party call. */
    demoTransport: z.string().min(1).optional(),
    /**
     * Dashboard pages this add-on renders itself, and the groups it brings for
     * them. Both optional and additive: every manifest written before this
     * validates unchanged, which is the same promise `kind` kept when the
     * add-on branch itself was added.
     */
    pages: z.array(addOnPageSchema).min(1).optional(),
    navGroups: z.array(addOnNavGroupSchema).min(1).optional(),
    /** Required once `pages` is present; see {@link hostApiVersionSchema}. */
    hostApi: hostApiVersionSchema.optional(),
    /**
     * Shapes apps build their own tables on (an invoice with its lines and
     * payments). Only the name and version are typed here: a part's columns
     * and rules are the manifest's own vocabulary, which this package cannot
     * import, so `@adminium/manifest` checks the rest of each entry.
     */
    shapes: z
      .array(
        z.looseObject({
          name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a shape name is kebab-case'),
          version: z.number().int().min(1).max(99),
        }),
      )
      .min(1)
      .max(8)
      .optional(),
  })
  .strict()
  // A ref is a URL segment, so two pages sharing one is two screens at one
  // address — and the loser is whichever the host's lookup happens to find.
  .refine((b) => new Set((b.pages ?? []).map((p) => p.ref)).size === (b.pages ?? []).length, {
    message: 'duplicate page ref',
    path: ['pages'],
  })
  .refine((b) => new Set((b.navGroups ?? []).map((g) => g.key)).size === (b.navGroups ?? []).length, {
    message: 'duplicate nav group key',
    path: ['navGroups'],
  })
  // A declared group may not shadow a built-in one: the built-in label comes
  // from the engine's catalogue and the declared one from the add-on, so a
  // collision is two labels for one heading with no rule about which wins.
  .refine(
    (b) =>
      !(b.navGroups ?? []).some((g) =>
        (BUILTIN_NAV_GROUP_KEYS as readonly string[]).includes(g.key),
      ),
    {
      message: `a nav group key may not be one of the built-in groups (${BUILTIN_NAV_GROUP_KEYS.join(', ')})`,
      path: ['navGroups'],
    },
  )
  // NAV_GROUP_UNKNOWN, refused at parse rather than resolved at render. A group
  // nobody defines is the one failure this whole block exists to prevent: the
  // rail would draw a raw key as a heading, or drop the row into `hidden` the
  // way an unknown app group is dropped today, and both look like the add-on
  // simply not working.
  .refine(
    (b) =>
      (b.pages ?? []).every(
        (p) =>
          p.nav === undefined ||
          (BUILTIN_NAV_GROUP_KEYS as readonly string[]).includes(p.nav.group) ||
          (b.navGroups ?? []).some((g) => g.key === p.nav?.group),
      ),
    {
      message: 'a page names a nav group that is neither built in nor declared in navGroups',
      path: ['pages'],
    },
  )
  // The mirror of the rule above. A declared group no page uses renders as
  // nothing, so it is a typo in one of the two places — and refusing here names
  // it, where a silent empty heading would not.
  .refine(
    (b) =>
      (b.navGroups ?? []).every((g) => (b.pages ?? []).some((p) => p.nav?.group === g.key)),
    {
      message: 'a declared nav group is used by none of this add-on’s pages',
      path: ['navGroups'],
    },
  )
  // Pages are code the host runs against a published API surface. An add-on
  // that does not say which version it was built against cannot be refused
  // later on version grounds, which is the entire point of having a version.
  .refine((b) => b.pages === undefined || b.hostApi !== undefined, {
    message: 'an add-on that declares pages must declare the hostApi version it is built against',
    path: ['hostApi'],
  })
  // Every `provides[].contract` must be in the registry AT the declared version.
  .refine((b) => (b.provides ?? []).every((p) => hasContractVersion(p.contract, p.version)), {
    message: 'CONTRACT_UNKNOWN: a provided contract is not in the registry at that version',
    path: ['provides'],
  })
  .refine((b) => (b.consumes ?? []).every((c) => hasContractVersion(c.contract, c.version)), {
    message: 'CONTRACT_UNKNOWN: a consumed contract is not in the registry at that version',
    path: ['consumes'],
  })
  // An oauth2 connect must name where it authorizes.
  .refine(
    (b) =>
      b.connect.kind !== 'oauth2' ||
      (b.connect.authorizeUrl !== undefined && b.connect.tokenUrl !== undefined),
    {
      message: 'an oauth2 connect must declare authorizeUrl and tokenUrl',
      path: ['connect'],
    },
  );

export type AddOnBlock = z.infer<typeof addOnBlockSchema>;

/** Issue codes the validators emit. */
export const ADD_ON_ISSUE_CODES = [
  'ATTACH_TARGET_UNKNOWN',
  'SLOT_UNKNOWN',
  'CONTRACT_UNKNOWN',
  'SCOPE_OUT_OF_RANGE',
  'NETWORK_ALLOW_REQUIRED',
  'CAPABILITY_CONFLICT',
  'FRONTEND_SECRET_LEAK',
  'SLOT_CONFLICT',
  /*
   * 51a adds no code for a bad nav group on purpose. `addOnBlockSchema` refuses
   * an undeclared group itself, and the cross-block rules in
   * `@adminium/manifest` run only after that schema has parsed — so a code here
   * would name a state no manifest can be in. The refusal is a schema issue
   * carrying the message, which is what a reader gets either way.
   */
] as const;
export type AddOnIssueCode = (typeof ADD_ON_ISSUE_CODES)[number];
