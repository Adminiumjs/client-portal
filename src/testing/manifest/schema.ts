/*
 * VENDORED VERBATIM from packages/manifest/src/schema.ts.
 * Never hand-edit this copy: change the monorepo package and re-run
 * `node scripts/sync-manifest-validator.mjs`.
 *
 * WHY A COPY. `@adminium/manifest` is not published to npm and this app is a
 * standalone repo that must build from a clean clone, so it cannot depend on
 * the monorepo. It lives under `testing/` because `zod` is a devDependency
 * here and a runtime dependency the host does not carry (24 D7) — nothing in
 * the shipped bundle's import graph may reach it, which sources.test.ts gates.
 *
 * The only edits are import specifiers: `.js` becomes `.ts`, and the
 * `@adminium/add-on-contracts` package import becomes relative ones.
 */
/**
 * Manifest spec v1 (13-marketplace.md §2), frozen at `manifestVersion: 1` for
 * all of Adminium 1.x. Pure Zod v4 + types — no `node:` imports — so the
 * storefront and the Electron shell can validate a manifest in the browser
 * (01-architecture.md §3, the `@adminium/manifest` package row).
 *
 * This module is the envelope: every block's shape and the cross-block rules.
 * The install PLANNER (planInstall / requiredSchema → create-or-map diff) and
 * the server-side installer are later layers that consume a validated manifest.
 */

import { addOnBlockSchema, addOnCategorySchema, type AddOnBlock } from './add-on-block.ts';
import { isSlotId } from './slots.ts';
import { z } from 'zod';

/** Integer spec version, frozen at 1 for Adminium 1.x (§2, 01 §8). */
export const MANIFEST_VERSION = 1;

/**
 * What kind of thing this manifest describes (24 §5.2). OPTIONAL, defaulting to
 * `"app"` — which is the whole reason `manifestVersion` does not move: every
 * manifest written before wave 4 stays valid unchanged, and an additive
 * optional field with a back-compatible default is how a frozen spec grows
 * without lying about its version.
 */
export const MANIFEST_KINDS = ['app', 'add-on'] as const;
export const manifestKindSchema = z.enum(MANIFEST_KINDS);
export type ManifestKind = (typeof MANIFEST_KINDS)[number];

/** strict semver — `major.minor.patch` with optional pre-release/build. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const semver = z.string().regex(SEMVER, 'must be strict semver (major.minor.patch)');

/** An i18n message: a catalog key plus the English fallback rendered if absent. */
export const i18nMessageSchema = z
  .object({
    key: z.string().min(1).max(120),
    fallback: z.string().min(1).max(400),
  })
  .strict();
export type I18nMessage = z.infer<typeof i18nMessageSchema>;

// ── §2.3 identity ────────────────────────────────────────────────────────────

/** Closed v1 storefront facet set (§2.3). */
export const MANIFEST_CATEGORIES = [
  'commerce',
  'hospitality',
  'operations',
  'crm',
  'internal-tools',
] as const;
export const categorySchema = z.enum(MANIFEST_CATEGORIES);

/** The one publisher id v1 accepts unless `third-party-publishers` is on (§2.3/§9). */
export const FIRST_PARTY_PUBLISHER_ID = 'adminium';

export const publisherSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'publisher id must be ^[a-z][a-z0-9-]{1,39}$'),
    name: z.string().min(1).max(80),
    url: z.url().max(200).optional(),
  })
  .strict();
export type Publisher = z.infer<typeof publisherSchema>;

/**
 * Everything both kinds share. `categories` is deliberately NOT here: it splits
 * by kind (an add-on is not a vertical — D2), so each branch adds its own.
 */
export const identityShape = {
  key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'key must be ^[a-z][a-z0-9-]{1,79}$'),
  name: z.string().min(1).max(80),
  version: semver,
  publisher: publisherSchema,
  // SPDX id — the FRONTEND's license (informational; core is AGPL-3.0).
  license: z.string().min(1).max(80),
  description: i18nMessageSchema,
};

export const identitySchema = z
  .object({
    ...identityShape,
    categories: z.array(categorySchema).min(1),
  })
  .strict();

/**
 * Keys no app or add-on may ever take, because they would shadow a storefront
 * route or a data file (D17). Apps and add-ons share one key namespace.
 */
export const RESERVED_KEYS = ['apps', 'add-on', 'add-ons', 'demo', 'index', 'search'] as const;

// ── §2.11 capabilities ───────────────────────────────────────────────────────

export const MANIFEST_CAPABILITIES = [
  'hosted-only',
  'offline-required',
  'receipt-printer',
  'barcode-scanner',
  'payments',
  'file-storage',
  'email-delivery',
  'realtime',
  // Added by wave 4 (24 D3). Adding a capability key is a THREE-place change
  // and all three land together: here, `CAP_ICONS` in the website's
  // marketplace data (note `CAP_META` derives from it), and a
  // `marketplaceData.cap.<key>` label in all eight locales.
  /** The add-on's server code calls a third-party API. */
  'outbound-http',
  /** The host runs an OAuth 2.0 authorization-code flow on the add-on's behalf. */
  'oauth-connect',
] as const;
export const capabilitySchema = z.enum(MANIFEST_CAPABILITIES);
export type Capability = z.infer<typeof capabilitySchema>;

// ── §2.4 compatibility ───────────────────────────────────────────────────────

/** The three meta/data engines Adminium can talk to (01-architecture.md §2.3). */
export const MANIFEST_ENGINES = ['postgres', 'mysql', 'sqlite'] as const;

export const compatibilitySchema = z
  .object({
    minAdminiumVersion: semver,
    maxAdminiumVersion: semver.optional(), // exclusive upper bound
    /**
     * Which data engines this app's `requiredSchema` actually works on.
     *
     * ADDED rather than dropped from the manifests (28-T21). Thirteen shipped
     * manifests already carried `engines` and this `.strict()` schema rejected
     * every one — it is a spec field (13 §2.4) that never reached the code. The
     * information is real: an app whose schema uses Postgres-only DDL cannot be
     * installed against SQLite, and deleting the field to satisfy the validator
     * would have thrown away the only place that is written down.
     *
     * Optional and additive, so nothing that validated before stops.
     */
    engines: z.array(z.enum(MANIFEST_ENGINES)).min(1).optional(),
    requires: z.array(capabilitySchema).optional(),
  })
  .strict();

// ── §2.5 requiredSchema (create-or-map) ──────────────────────────────────────

/** Abstract column types the introspection engine emits (§2.5, research §15.2). */
export const COLUMN_TYPES = [
  'id',
  'text',
  'int',
  'bigint',
  'decimal',
  'money',
  'float',
  'bool',
  'enum',
  'json',
  'date',
  'timestamptz',
  'uuid',
  'fk',
  'blob',
] as const;

/** Optional semantic pre-seed so widgets auto-instantiate (§2.5). */
export const COLUMN_SEMANTICS = [
  'name',
  'money',
  'image',
  'email',
  'avatar',
  'geo-lat',
  'geo-lng',
] as const;

/** Structural role markers (§2.5). */
export const COLUMN_ROLES = ['pk', 'created_at', 'updated_at'] as const;

export const requiredColumnSchema = z
  .object({
    ref: z.string().regex(/^[a-z][a-z0-9_]*$/, 'column ref must be a snake_case identifier'),
    type: z.enum(COLUMN_TYPES),
    semantic: z.enum(COLUMN_SEMANTICS).optional(),
    role: z.enum(COLUMN_ROLES).optional(),
    nullable: z.boolean().optional(),
    // enum values when `type: 'enum'`; fk target ref when `type: 'fk'`.
    enum: z.array(z.string().min(1)).optional(),
    references: z.string().optional(),
  })
  .strict()
  .refine((c) => c.type !== 'enum' || (c.enum !== undefined && c.enum.length > 0), {
    message: 'an enum column must list its enum values',
    path: ['enum'],
  })
  .refine((c) => c.type !== 'fk' || c.references !== undefined, {
    message: 'a fk column must name its references target',
    path: ['references'],
  });

export const requiredTableSchema = z
  .object({
    ref: z.string().regex(/^[a-z][a-z0-9_]*$/, 'table ref must be a snake_case identifier'),
    columns: z.array(requiredColumnSchema).min(1),
  })
  .strict()
  .refine(
    (t) => new Set(t.columns.map((c) => c.ref)).size === t.columns.length,
    { message: 'duplicate column ref in table', path: ['columns'] },
  );

export const requiredSchemaSchema = z
  .object({
    tables: z.array(requiredTableSchema).min(1),
  })
  .strict()
  .refine((s) => new Set(s.tables.map((t) => t.ref)).size === s.tables.length, {
    message: 'duplicate table ref in requiredSchema',
    path: ['tables'],
  });

// ── §2.6 pages ───────────────────────────────────────────────────────────────

export const pageNavSchema = z
  .object({
    group: z.string().min(1).max(80),
    icon: z.string().min(1).max(60),
    order: z.number().int(),
  })
  .strict();

export const pageSchema = z
  .object({
    ref: z.string().regex(/^[a-z][a-z0-9-]*$/, 'page ref must be a kebab-case identifier'),
    template: z.string().min(1).max(80),
    title: i18nMessageSchema,
    nav: pageNavSchema,
    // page-local table ref → requiredSchema table ref (resolved at install).
    bindings: z.record(z.string(), z.string()).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// ── §2.7 roles ───────────────────────────────────────────────────────────────

export const roleSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]*$/, 'role key must be a kebab-case identifier'),
    name: z.string().min(1).max(80),
    cloneFrom: z.string().optional(),
    // grant strings validated against the RBAC grammar at install time.
    permissions: z.array(z.string().min(1)).optional(),
  })
  .strict();

// ── §2.8 settings ────────────────────────────────────────────────────────────

const settingBase = {
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'setting key must be snake_case'),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
  label: i18nMessageSchema.optional(),
};

export const settingSchema = z.discriminatedUnion('type', [
  z.object({ ...settingBase, type: z.literal('string'), default: z.string().optional() }).strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('number'),
      default: z.number().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      unit: z.string().max(20).optional(),
    })
    .strict(),
  z.object({ ...settingBase, type: z.literal('boolean'), default: z.boolean().optional() }).strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('enum'),
      enum: z.array(z.string().min(1)).min(1),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      ...settingBase,
      type: z.literal('file'),
      accept: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z.object({ ...settingBase, type: z.literal('json'), default: z.unknown().optional() }).strict(),
]);

// ── §2.9 seeds ───────────────────────────────────────────────────────────────

export const seedSchema = z
  .object({
    table: z.string().min(1),
    // inline rows, or a reference to a bundled seeds/<file> dataset (§2.9).
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    file: z.string().min(1).optional(),
  })
  .strict()
  .refine((s) => (s.rows === undefined) !== (s.file === undefined), {
    message: 'a seed provides exactly one of `rows` or `file`',
  });

// ── §2.10 widgets (optional custom bundles) ──────────────────────────────────

export const manifestWidgetSchema = z
  .object({
    id: z.string().min(1).max(80),
    entry: z.string().min(1),
  })
  .strict();

// ── §2.12 frontend ───────────────────────────────────────────────────────────

export const FRONTEND_KINDS = ['spa', 'electron', 'none'] as const;

export const frontendEnvVarSchema = z
  .object({
    required: z.boolean(),
    example: z.string().optional(),
  })
  .strict();

/**
 * Which of the three sides a frontend is (28-public-surface.md §4).
 *
 * The product rule this exists to make CHECKABLE: a micro-SaaS is the Adminium
 * dashboard (mandatory, and never declared here — it comes from introspection)
 * plus a staff side, a customer side, or both. At least one, or it is not a
 * micro-SaaS but somebody's own build.
 */
export const FRONTEND_SIDES = ['staff', 'customer'] as const;

export const frontendSchema = z
  .object({
    /**
     * REQUIRED, and the whole point of the array form. Without it the split
     * lives only in prose and nothing can enforce §4's rule.
     */
    side: z.enum(FRONTEND_SIDES),
    kind: z.enum(FRONTEND_KINDS),
    entry: z.string().min(1).optional(),
    env: z.record(z.string(), frontendEnvVarSchema).optional(),
    /**
     * The view names this side owns, e.g. `{ book, visits }`.
     *
     * RE-ADMITTED, not newly invented. Eleven shipped manifests already carry
     * this key and the `.strict()` schema rejected every one of them — while
     * being, per the 28-T33 fleet audit, "the only machine-readable record of
     * the staff/customer split anywhere in the fleet". Deleting it during
     * normalization was the tempting move and would have made §4's rule
     * permanently uncheckable.
     */
    routes: z.record(z.string(), z.string()).optional(),
  })
  .strict();

// ── the manifest envelope ─────────────────────────────────────────────────────

/**
 * The two envelope-wide rules, as plain predicates over the shape both branches
 * share. They are attached to EACH BRANCH below rather than to the union: a
 * `.refine()` on a `z.discriminatedUnion` would run against the union type and
 * lose the narrowing, and moving them up there is how they get silently dropped
 * (24 §5.2's first implementer note).
 */
interface SharedEnvelope {
  capabilities?: Capability[] | undefined;
  compatibility: z.infer<typeof compatibilitySchema>;
}

/** §2.11 — hosted-only and offline-required are mutually exclusive. */
const capabilitiesNotContradictory = (m: SharedEnvelope): boolean =>
  !(
    (m.capabilities?.includes('hosted-only') ?? false) &&
    (m.capabilities?.includes('offline-required') ?? false)
  );

/** maxAdminiumVersion (exclusive) must be strictly above the min. */
const compatibilityWindowOrdered = (m: SharedEnvelope): boolean =>
  m.compatibility.maxAdminiumVersion === undefined ||
  compareSemver(m.compatibility.maxAdminiumVersion, m.compatibility.minAdminiumVersion) > 0;

const CAPS_MESSAGE = {
  message: 'hosted-only and offline-required are mutually exclusive',
  path: ['capabilities'] as const,
};
const WINDOW_MESSAGE = {
  message: 'maxAdminiumVersion must be greater than minAdminiumVersion',
  path: ['compatibility'] as const,
};

/**
 * At most one entry per side.
 *
 * Two `customer` frontends is not a richer app; it is an ambiguity — a
 * publishable key is minted against ONE side, so a second entry claiming the
 * same one leaves the installer and the key-minting UI with no way to say which
 * bundle a key belongs to.
 */
function sidesAreDistinct(m: { frontends: readonly { side: string }[] }): boolean {
  const seen = new Set<string>();
  for (const f of m.frontends) {
    if (seen.has(f.side)) return false;
    seen.add(f.side);
  }
  return true;
}

const SIDES_MESSAGE = {
  message: 'each side may appear at most once in `frontends`',
  path: ['frontends'] as const,
};

export const appManifestSchema = z
  .object({
    kind: z.literal('app'),
    manifestVersion: z.literal(MANIFEST_VERSION),
    ...identitySchema.shape,
    compatibility: compatibilitySchema,
    requiredSchema: requiredSchemaSchema,
    pages: z.array(pageSchema).min(1),
    roles: z.array(roleSchema).optional(),
    settings: z.array(settingSchema).optional(),
    seeds: z.array(seedSchema).optional(),
    widgets: z.array(manifestWidgetSchema).optional(),
    capabilities: z.array(capabilitySchema).optional(),
    /**
     * ONE OR MORE SIDES (28 §4, D12). Replaces the singular `frontend`.
     *
     * `minItems: 1` is the gate: a manifest declaring no side does not validate,
     * which is what turns "dashboard mandatory, staff optional, customer
     * optional, at least one" from a slogan into something CI can hold. Two
     * repos (factory-ops, hotel-reservations) could never validate under the old
     * required-singular shape however their `requiredSchema` was repaired.
     */
    frontends: z.array(frontendSchema).min(1),
  })
  .strict()
  .refine(capabilitiesNotContradictory, { ...CAPS_MESSAGE, path: [...CAPS_MESSAGE.path] })
  .refine(compatibilityWindowOrdered, { ...WINDOW_MESSAGE, path: [...WINDOW_MESSAGE.path] })
  .refine(sidesAreDistinct, { ...SIDES_MESSAGE, path: [...SIDES_MESSAGE.path] });

/**
 * `pages` and `frontend` are absent from this branch on purpose (24 §5.7 item
 * 6): an add-on cannot install pages, roles or a frontend, and leaving the
 * fields off the schema entirely is a stronger guarantee than a lint rule.
 */
export const addOnManifestSchema = z
  .object({
    kind: z.literal('add-on'),
    manifestVersion: z.literal(MANIFEST_VERSION),
    ...identityShape,
    categories: z.array(addOnCategorySchema).min(1),
    compatibility: compatibilitySchema,
    addOn: addOnBlockSchema,
    // An add-on may bring its own tables — kept on disconnect (D16).
    requiredSchema: requiredSchemaSchema.optional(),
    settings: z.array(settingSchema).optional(),
    capabilities: z.array(capabilitySchema).optional(),
    widgets: z.array(manifestWidgetSchema).optional(),
  })
  .strict()
  .refine(capabilitiesNotContradictory, { ...CAPS_MESSAGE, path: [...CAPS_MESSAGE.path] })
  .refine(compatibilityWindowOrdered, { ...WINDOW_MESSAGE, path: [...WINDOW_MESSAGE.path] });

/**
 * The envelope. A document with no `kind` is treated as an app before the union
 * discriminates, which is what keeps every pre-wave-4 manifest valid.
 */
export const manifestSchema = z.preprocess(
  (v) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Record<string, unknown>).kind === undefined
      ? { ...(v as Record<string, unknown>), kind: 'app' }
      : v,
  z.discriminatedUnion('kind', [appManifestSchema, addOnManifestSchema]),
);

export type AppManifest = z.infer<typeof appManifestSchema>;
export type AddOnManifest = z.infer<typeof addOnManifestSchema>;
export type Manifest = AppManifest | AddOnManifest;

export type { AddOnBlock };

/** Narrowing helper — the discriminant is the only thing worth branching on. */
export function isAddOnManifest(m: Manifest): m is AddOnManifest {
  return m.kind === 'add-on';
}

/**
 * Cross-block rules the envelope cannot express, each with its issue code
 * (24 §5.3). Runs only for `kind: "add-on"`; returns [] for an app.
 */
export function addOnIssues(
  m: Manifest,
  ctx: {
    /** Installed app keys, so `attaches` can be checked. Omit to skip. */
    knownAppKeys?: readonly string[];
    /** The host app's `requiredSchema` table refs. Omit to skip the scope check. */
    hostTables?: readonly string[];
  } = {},
): { code: string; path: string; message: string }[] {
  if (!isAddOnManifest(m)) return [];
  const out: { code: string; path: string; message: string }[] = [];
  const block = m.addOn;

  // ATTACH_TARGET_UNKNOWN — every target is a known app key or "*".
  if (ctx.knownAppKeys !== undefined) {
    block.attaches.forEach((target, i) => {
      if (target.app !== '*' && !ctx.knownAppKeys!.includes(target.app)) {
        out.push({
          code: 'ATTACH_TARGET_UNKNOWN',
          path: `addOn.attaches.${i}.app`,
          message: `attaches to an unknown app key "${target.app}"`,
        });
      }
    });
  }

  // SLOT_UNKNOWN — belt and braces; the schema enum already refuses these.
  (block.slots ?? []).forEach((fill, i) => {
    if (!isSlotId(fill.slot)) {
      out.push({
        code: 'SLOT_UNKNOWN',
        path: `addOn.slots.${i}.slot`,
        message: `"${fill.slot}" is not in the closed slot registry`,
      });
    }
  });

  // SCOPE_OUT_OF_RANGE — a `records:<table>:<verb>` scope must name a table this
  // add-on can actually reach: one of the host app's, or one of its own.
  const reachable = new Set<string>([
    ...(m.requiredSchema?.tables ?? []).map((t) => t.ref),
    ...(ctx.hostTables ?? []),
  ]);
  (block.scopes ?? []).forEach((scope, i) => {
    const [domain, table] = scope.split(':');
    if (domain !== 'records') return;
    if (table === undefined || table.length === 0) {
      out.push({
        code: 'SCOPE_OUT_OF_RANGE',
        path: `addOn.scopes.${i}`,
        message: `"${scope}" names no table`,
      });
      return;
    }
    if (ctx.hostTables !== undefined && !reachable.has(table)) {
      out.push({
        code: 'SCOPE_OUT_OF_RANGE',
        path: `addOn.scopes.${i}`,
        message: `"${scope}" reaches a table neither the host app nor this add-on declares`,
      });
    }
  });

  // NETWORK_ALLOW_REQUIRED — outbound-http without an allow-list is a hole.
  const wantsHttp = m.capabilities?.includes('outbound-http') ?? false;
  if (wantsHttp && (block.network?.allow.length ?? 0) === 0) {
    out.push({
      code: 'NETWORK_ALLOW_REQUIRED',
      path: 'addOn.network.allow',
      message: 'outbound-http requires a non-empty allow-list of exact https hostnames',
    });
  }

  // CAPABILITY_CONFLICT — an oauth2 connect needs the capability that runs it.
  if (block.connect.kind === 'oauth2' && !(m.capabilities?.includes('oauth-connect') ?? false)) {
    out.push({
      code: 'CAPABILITY_CONFLICT',
      path: 'capabilities',
      message: 'connect.kind "oauth2" requires the oauth-connect capability',
    });
  }

  // FRONTEND_SECRET_LEAK — publicSettings may never name a secret setting.
  const secrets = new Set((m.settings ?? []).filter((s) => s.secret === true).map((s) => s.key));
  (block.publicSettings ?? []).forEach((key, i) => {
    if (secrets.has(key)) {
      out.push({
        code: 'FRONTEND_SECRET_LEAK',
        path: `addOn.publicSettings.${i}`,
        message: `"${key}" is marked secret and must never reach the client bundle`,
      });
    }
  });

  return out;
}

/**
 * Numeric semver compare on the release triple (pre-release/build ignored —
 * enough for the compatibility-window and upgrade ordering checks). Returns
 * <0, 0, >0. Exported for the installer's upgrade rule (§4.3).
 */
export function compareSemver(a: string, b: string): number {
  const triple = (v: string): number[] =>
    v
      .split('+')[0]!
      .split('-')[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10));
  const [a1 = 0, a2 = 0, a3 = 0] = triple(a);
  const [b1 = 0, b2 = 0, b3 = 0] = triple(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}
