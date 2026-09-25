/*
 * VENDORED VERBATIM from packages/manifest/src/schema.ts.
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
 * Manifest spec v1, frozen at `manifestVersion: 1` for all of Adminium 1.x.
 * Pure Zod v4 + types — no `node:` imports — so the storefront and the
 * Electron shell can validate a manifest in the browser (the
 * `@adminium/manifest` package row).
 *
 * This module is the envelope: every block's shape and the cross-block rules.
 * The install PLANNER (planInstall / requiredSchema → create-or-map diff) and
 * the server-side installer are later layers that consume a validated manifest.
 */

import { addOnBlockSchema, addOnCategorySchema, i18nMessageSchema, type AddOnBlock, type I18nMessage } from './add-on-block.ts';
import { isSlotId } from './slots.ts';
import { z } from 'zod';

import { addOnNeedsIssues, addOnsSchema, requiresAddOn, type AddOnNeeds } from './add-ons.ts';
import { bookingIssues, bookingSchema } from './booking.ts';
import { appDocumentIssues, appDocumentSchema, mappingIssues, type AppDocument } from './documents.ts';
import { formulaExprSchema, tableFormulaIssues } from './formula.ts';
import { pageCalendarIssues } from './page-calendar.ts';
import { emailTemplateSchema, outboxIssues, outboxProducerSchema, outboxSchema } from './outbox.ts';
import { publicAccessIssues, publicAccessSchema, publicKeysSchema, type PublicAccess } from './public-access.ts';
import { roleLimitIssues, roleLimitsSchema, type RoleShape } from './roles.ts';
import { statesIssues, statesSchema, type States } from './states.ts';
import {
  NUMERIC_TYPES,
  labelsSchema,
  numberOrSetting,
  refSchema,
  scalarSchema,
  settingSourceSchema,
  tableIndex,
  textOrLabels,
  valueFits,
  type SettingSource,
} from './refs.ts';
import { compareSemver, parseSemverRange } from './semver.ts';

export { compareSemver };

/** Integer spec version, frozen at 1 for Adminium 1.x. */
export const MANIFEST_VERSION = 1;

/**
 * What kind of thing this manifest describes. OPTIONAL, defaulting to `"app"` —
 * which is the whole reason `manifestVersion` does not move: every manifest
 * written before wave 4 stays valid unchanged, and an additive optional field
 * with a back-compatible default is how a frozen spec grows without lying about
 * its version.
 */
export const MANIFEST_KINDS = ['app', 'add-on'] as const;
export const manifestKindSchema = z.enum(MANIFEST_KINDS);
export type ManifestKind = (typeof MANIFEST_KINDS)[number];

/** strict semver — `major.minor.patch` with optional pre-release/build. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const semver = z.string().regex(SEMVER, 'must be strict semver (major.minor.patch)');

/**
 * An i18n message: a catalog key plus the English fallback rendered if absent.
 *
 * DEFINED IN `@adminium/add-on-contracts` since 51a and re-exported here under
 * its own name, so every importer of `@adminium/manifest` is unchanged. It
 * moved because an add-on's page title and nav-group label are written in a
 * manifest and read by a host through the contracts package — one shape, one
 * definition, rather than two that drift a `max()` apart.
 */
export { i18nMessageSchema, type I18nMessage };

// ── identity ─────────────────────────────────────────────────────────────────

/** Closed v1 storefront facet set. */
export const MANIFEST_CATEGORIES = [
  'commerce',
  'hospitality',
  'operations',
  'crm',
  'internal-tools',
] as const;
export const categorySchema = z.enum(MANIFEST_CATEGORIES);

/** The one publisher id v1 accepts unless `third-party-publishers` is on. */
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
 *
 * `dashboard` joined them for a different reason: it is the HOST KEY a stock
 * Adminium deployment attaches an add-on under, so an add-on `attaches:
 * [{app: '*'}]` resolves against it and the consent dialog has something to
 * enable and disable. Treating an empty `attachTo` as "the dashboard" was the
 * alternative and leaves nothing to switch off. Reserving the literal means
 * no app can also be called `dashboard` and make an attachment ambiguous.
 */
export const RESERVED_KEYS = [
  'apps',
  'add-on',
  'add-ons',
  'dashboard',
  'demo',
  'index',
  'search',
] as const;

// ── capabilities ─────────────────────────────────────────────────────────────

export const MANIFEST_CAPABILITIES = [
  'hosted-only',
  'offline-required',
  'receipt-printer',
  'barcode-scanner',
  'payments',
  'file-storage',
  'email-delivery',
  'realtime',
  // Added by wave 4. Adding a capability key is a THREE-place change
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

// ── compatibility ────────────────────────────────────────────────────────────

/** The three meta/data engines Adminium can talk to. */
export const MANIFEST_ENGINES = ['postgres', 'mysql', 'sqlite'] as const;

export const compatibilitySchema = z
  .object({
    minAdminiumVersion: semver,
    maxAdminiumVersion: semver.optional(), // exclusive upper bound
    /**
     * Which data engines this app's `requiredSchema` actually works on.
     *
     * ADDED rather than dropped from the manifests. Thirteen shipped manifests
     * already carried `engines` and this `.strict()` schema rejected every one
     * — it is a spec field that never reached the code. The information is
     * real: an app whose schema uses Postgres-only DDL cannot be installed
     * against SQLite, and deleting the field to satisfy the validator would
     * have thrown away the only place that is written down.
     *
     * Optional and additive, so nothing that validated before stops.
     */
    engines: z.array(z.enum(MANIFEST_ENGINES)).min(1).optional(),
    requires: z.array(capabilitySchema).optional(),
    /**
     * The installed versions this release can update in place, as a semver
     * range (`>=0.2.0`). An install outside it is not offered the update and
     * is refused one: a release whose tables changed shape says so here, and
     * the operator is told to uninstall first rather than left with an update
     * that fails half-way. Absent means any older version.
     */
    updatesFrom: z
      .string()
      .min(1)
      .max(120)
      .refine((range) => parseSemverRange(range) !== null, {
        message: 'a semver range such as ">=0.2.0", "^0.2.0" or ">=0.2.0 <1.0.0"',
      })
      .optional(),
  })
  .strict();

// ── requiredSchema (create-or-map) ───────────────────────────────────────────

/** Abstract column types the introspection engine emits (research). */
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

/** Optional semantic pre-seed so widgets auto-instantiate. */
export const COLUMN_SEMANTICS = [
  'name',
  'money',
  'image',
  'email',
  'avatar',
  'geo-lat',
  'geo-lng',
] as const;

/** Structural role markers. */
export const COLUMN_ROLES = ['pk', 'created_at', 'updated_at'] as const;

export { labelsSchema };

/**
 * The rules an app asks Adminium to keep on a column (written as column-rule
 * overrides at install). The first five are the rules an operator can set in
 * the column inspector; the rest are the ones Adminium DECIDES for a public
 * write, so a browser never picks a price, a number or a code:
 *
 *  - `copy`: take the value from the linked row (`via` is this table's
 *    foreign-key column, `from` a column of the row it points at).
 *  - `sequence`: the next number in this column's own counter.
 *  - `code`: a short random code (Crockford base 32), unique in the column.
 *  - `rollup`: a total over child rows, kept in step as they change.
 *  - `venueLocal`: a wall time with no zone is read in the venue's zone.
 *  - `personal`: whether the column is personal data, overriding the guess
 *    Adminium makes from its name.
 *  - `secret`: whether the column is a secret no response ever carries,
 *    overriding the same guess (a `…token…` name reads as one).
 */
/** A child list a fingerprint covers: its rows in `orderBy` order, then by key. */
const hashChildSchema = z
  .object({ table: refSchema, via: refSchema, columns: z.array(refSchema).min(1).max(24), orderBy: refSchema.optional() })
  .strict();

/**
 * What a stamp writes:
 *
 *  - `now` (a timestamptz), `today` (a date, on the venue's calendar),
 *    `user-name`, `user-id`;
 *  - `byOrigin`: one value for a public write, another for staff — or, with no
 *    `staff`, whatever the staff writer chose (a desk records how a client
 *    approved; the portal always says "portal");
 *  - `copy`: another column of the same row as it stands at that moment (a
 *    client's first answer, kept when they edit it later);
 *  - `claim`: a column of the signed-in person's own row (their email, their
 *    name) on a public write; on a staff write, `staff` says what instead;
 *  - `addDays`: a date so many days after another (`due_on` = `issued_on` +
 *    the terms' days, `map` giving each term its days);
 *  - `hashOf`: a fingerprint — SHA-256 over the named columns, child rows and
 *    a linked row's text, in a canonical form anyone can recompute.
 */
export const stampSetSchema = z.union([
  z.enum(['now', 'today', 'user-name', 'user-id']),
  z.object({ byOrigin: z.object({ public: z.string().min(1), staff: z.string().min(1).optional() }).strict() }).strict(),
  z.object({ claim: refSchema, staff: z.enum(['user-name', 'user-id']).optional() }).strict(),
  z.object({ copy: refSchema }).strict(),
  z
    .object({
      addDays: z
        .object({
          date: refSchema,
          days: z.union([refSchema, z.number().int().min(0).max(3650)]),
          map: z.record(z.string().min(1), z.number().int().min(0).max(3650)).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      hashOf: z
        .object({
          columns: z.array(refSchema).min(1).max(24),
          children: z.array(hashChildSchema).max(4).optional(),
          linked: z
            .array(
              z
                .object({
                  via: refSchema,
                  table: refSchema,
                  columns: z.array(refSchema).min(1).max(24),
                  children: z.array(hashChildSchema).max(4).optional(),
                })
                .strict(),
            )
            .max(4)
            .optional(),
        })
        .strict(),
    })
    .strict(),
]);

/** When a stamp is written: on create, when a column changes to a value, or when a column is first filled. */
export const stampTriggerSchema = z.union([
  z.literal('create'),
  z.object({ column: refSchema, values: z.array(scalarSchema).min(1).max(16) }).strict(),
  z.object({ column: refSchema, filled: z.literal(true) }).strict(),
]);

export const columnRulesSchema = z
  .object({
    options: z
      .union([
        z.object({ list: z.string().min(1).max(120) }).strict(),
        z
          .object({
            values: z
              .array(
                z
                  .object({ value: z.string().min(1).max(256), label: textOrLabels.optional(), tone: z.string().max(32).optional() })
                  .strict(),
              )
              .min(1)
              .max(500),
          })
          .strict(),
      ])
      .optional(),
    enumLabels: z
      .object({
        labels: z.record(z.string().min(1), textOrLabels),
        tones: z.record(z.string().min(1), z.string().max(32)).optional(),
      })
      .strict()
      .optional(),
    required: z.literal(true).optional(),
    /**
     * Required only while another column of the same row holds one of `in`
     * (`person_id` when `kind` is `away`). The row as the write leaves it is
     * judged: a change of either column that leaves this one empty is refused.
     */
    requiredWhen: z
      .object({ column: refSchema, in: z.array(scalarSchema).min(1).max(32) })
      .strict()
      .optional(),
    validation: z
      .object({
        format: z.enum(['email', 'url', 'phone']).optional(),
        min: z.number().optional(),
        max: z.number().optional(),
        minLength: z.number().int().nonnegative().optional(),
        maxLength: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    copy: z
      .object({ via: refSchema, from: refSchema, mode: z.enum(['default', 'always']).optional() })
      .strict()
      .optional(),
    /**
     * A value filled on create when the writer gives none (and a `copy` on the
     * same column came back empty): the connection's currency, a column of the
     * app's settings row, or a setting of an add-on the app requires.
     */
    default: z
      .object({ from: z.union([z.literal('connection.currency'), settingSourceSchema]) })
      .strict()
      .optional(),
    /**
     * A running number. `gapless` numbers are taken inside the write that
     * creates the row, so the series never skips or repeats (an invoice's);
     * `scope` numbers per parent row (a deliverable's versions v1, v2 …);
     * `startSetting` reads the first number from a setting.
     */
    sequence: z
      .object({
        start: z.number().int().min(1).optional(),
        gapless: z.literal(true).optional(),
        startSetting: settingSourceSchema.optional(),
        scope: refSchema.optional(),
      })
      .strict()
      .optional(),
    /**
     * A text column written from a running number of the same row: the
     * prefix, then the digits padded (`INV-2042`). The prefix may come from a
     * setting, so a studio can change it; a change applies to the next number.
     */
    format: z
      .object({
        from: refSchema,
        prefix: z.string().regex(/^[A-Za-z0-9_/.-]{0,12}$/, 'a prefix of up to 12 letters, digits and - _ / .').optional(),
        prefixSetting: settingSourceSchema.optional(),
        pad: z.number().int().min(0).max(12).optional(),
      })
      .strict()
      .optional(),
    code: z
      .object({
        prefix: z.string().regex(/^[A-Z][A-Z0-9]{0,5}-?$/, 'an upper-case prefix, e.g. MR-').optional(),
        length: z.number().int().min(4).max(16),
      })
      .strict()
      .optional(),
    /** A value Adminium works out from the row's other columns (see `formula.ts`). */
    formula: formulaExprSchema.optional(),
    /**
     * How a text value is stored whoever writes it: `trim` without spaces at
     * either end, `email` trimmed and in lower case — so a unique address and
     * a person signing in with it agree on every database.
     */
    normalize: z.enum(['trim', 'email']).optional(),
    rollup: z
      .object({
        /** The child table, its foreign key back to this row, and what to add up. */
        from: refSchema,
        via: refSchema,
        sum: refSchema,
        /** Multiplied into `sum` per child row, e.g. `qty`. */
        times: refSchema.optional(),
        /** A child row whose column holds a value is left out — a voided line (`voided_at`). */
        unlessSet: refSchema.optional(),
        /** Only child rows whose column equals the value are added up (`voided = false`). */
        where: z.object({ column: refSchema, eq: scalarSchema }).strict().optional(),
        /**
         * A second column of this row kept in step: `of − Σminus − total`
         * (`balance = fee − waived − paid`). Adminium writes it; nobody else may.
         */
        balance: z
          .object({ column: refSchema, of: refSchema, minus: z.array(refSchema).max(4).optional() })
          .strict()
          .optional(),
        /** A child write that would take the balance below zero is refused. */
        cap: z.literal(true).optional(),
      })
      .strict()
      .optional(),
    /**
     * A value Adminium writes when something happens: the moment, or who did
     * it, on a create or when another column changes to one of `values`
     * (`checked_in_at` when `status` becomes `checked_in`). `byOrigin` writes
     * one value for a public write and another for staff. A public write never
     * stamps a person: a browser key is nobody.
     */
    stamp: z
      .object({
        set: stampSetSchema,
        on: z.union([stampTriggerSchema, z.array(stampTriggerSchema).min(2).max(3)]),
      })
      .strict()
      .optional(),
    venueLocal: z.literal(true).optional(),
    /**
     * Whether the column holds personal data, when the app knows better than
     * a guess from its name: a venue's own `phone` and `address` are a
     * business's, and its guest page may show them. The operator can still
     * mark it otherwise.
     */
    personal: z.boolean().optional(),
    /**
     * Whether the column is a secret no response ever carries, when the app
     * knows better than a guess from its name: a `share_token` whose `code`
     * is the link a studio sends is shown to the staff who read the table.
     * A `code` column is not taken for a secret by its name alone; `true`
     * makes it one, as it makes any other column one.
     */
    secret: z.boolean().optional(),
    /**
     * A date that may never be later than today, on the venue's calendar — a
     * payment is recorded when it came in, not when it might.
     */
    notAfter: z.literal('today').optional(),
    /**
     * A date that may never be earlier than another: a column of the same row,
     * or — with `via`, a foreign key of this row — a column of the row it
     * points at (a payment is never dated before its invoice was issued).
     */
    notBefore: z.object({ column: refSchema, via: refSchema.optional() }).strict().optional(),
  })
  .strict();
export type ColumnRules = z.infer<typeof columnRulesSchema>;

/**
 * A limit on how much of a slot rows may take — the booking guard. Only rows
 * whose `countWhere` column holds one of its values count (a cancelled booking
 * holds no seats).
 */
export const capacitySchema = z
  .object({
    slot: refSchema,
    amount: refSchema,
    perSlot: numberOrSetting,
    countWhere: z.object({ column: refSchema, values: z.array(z.string().min(1)).min(1) }).strict().optional(),
    slotMinutes: numberOrSetting,
    windowDays: numberOrSetting.optional(),
    opens: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.object({ table: refSchema, column: refSchema }).strict()]).optional(),
    closes: z.union([z.string().regex(/^\d{2}:\d{2}$/), z.object({ table: refSchema, column: refSchema }).strict()]).optional(),
    /** A table, a room: the limit applies per value of this column too. */
    resource: refSchema.optional(),
    /**
     * How many hours before its time a guest may still cancel through the
     * public API; later, only the venue can. Staff are never held to it.
     */
    cancelHours: numberOrSetting.optional(),
  })
  .strict();

/** The longest `maxLength` a text column may ask for (see `maxLength` below). */
export const MAX_TEXT_LENGTH = 1000;

/**
 * Why a column's `default` cannot be created, or `null` when it can.
 *
 * The rules are the ones every one of the three databases can honour with the
 * same meaning, so a manifest that validates installs the same everywhere:
 *
 *  - `now` only on a `timestamptz`, and a timestamp takes nothing else. A
 *    literal timestamp default is a fixed moment, which is never what a
 *    manifest author means.
 *  - `text` needs `maxLength`: MySQL gives an unbounded TEXT column no literal
 *    default, and a manifest must not install on two engines and fail on the
 *    third.
 *  - `json`, `blob`, `date`, keys and foreign keys take none.
 *  - an enum's default is one of its values, a number is a number, a boolean a
 *    boolean.
 */
export function defaultIssue(c: {
  type: string;
  role?: string | undefined;
  enum?: readonly string[] | undefined;
  maxLength?: number | undefined;
  default?: string | number | boolean | undefined;
}): string | null {
  const value = c.default;
  if (value === undefined) return null;
  if (c.role === 'pk') return 'a primary key takes no default; an int key numbers itself';
  switch (c.type) {
    case 'timestamptz':
      return value === 'now' ? null : 'a timestamptz default must be "now"';
    case 'text':
      if (typeof value !== 'string') return 'a text default must be a string';
      if (c.maxLength === undefined) return 'a text default needs maxLength (MySQL gives TEXT no default)';
      return value.length <= c.maxLength ? null : 'the default is longer than maxLength';
    case 'enum':
      return typeof value === 'string' && (c.enum ?? []).includes(value)
        ? null
        : 'an enum default must be one of its values';
    case 'int':
    case 'bigint':
      return typeof value === 'number' && Number.isInteger(value) ? null : 'an integer default must be a whole number';
    case 'decimal':
    case 'money':
    case 'float':
      return typeof value === 'number' ? null : 'a numeric default must be a number';
    case 'bool':
      return typeof value === 'boolean' ? null : 'a bool default must be true or false';
    default:
      return `a ${c.type} column takes no default`;
  }
}

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
    /**
     * The value the DATABASE fills when an insert leaves the column out. A
     * literal of the column's own type, or the string `now` on a
     * `timestamptz` column. Without one, a NOT NULL column refuses every insert
     * that omits it — which is every insert an operator makes from a form that
     * does not show that column.
     *
     * Additive and optional: an older server refuses a manifest carrying it
     * (every block is `.strict()`), so an app that uses it raises
     * `minAdminiumVersion` to the release that reads it.
     */
    default: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
    /**
     * `text` only: a `varchar(n)` instead of unbounded `text`. Short text is
     * what a form, a unique index and MySQL's key limit all want. At most 1000
     * characters — MySQL counts four bytes per character against one 65,535-byte
     * row, so a few long columns would refuse the table.
     */
    maxLength: z.number().int().min(1).max(MAX_TEXT_LENGTH).optional(),
    /**
     * `decimal` / `money` only: the places kept after the point, 0–4, or
     * `"currency"` — the decimals of the row's own `currency` column (JPY 0,
     * EUR 2, KWD 3), else the connection's currency, else 2. Without it a
     * decimal keeps four places. Totals, rollups and formulas round to it.
     */
    scale: z.union([z.number().int().min(0).max(4), z.literal('currency')]).optional(),
    /**
     * No two rows may hold the same value (empty values excepted). A text
     * column needs `maxLength`: MySQL indexes no unbounded text.
     */
    unique: z.literal(true).optional(),
    /** Rules Adminium keeps on the column once installed (see `columnRulesSchema`). */
    rules: columnRulesSchema.optional(),
    /**
     * What a person calls the column — a form's field, a list's heading — in
     * every language the app speaks. Installed as the column's label, which
     * the operator can rename like any other.
     */
    label: textOrLabels.optional(),
  })
  .strict()
  .refine((c) => c.type !== 'enum' || (c.enum !== undefined && c.enum.length > 0), {
    message: 'an enum column must list its enum values',
    path: ['enum'],
  })
  .refine((c) => c.type !== 'fk' || c.references !== undefined, {
    message: 'a fk column must name its references target',
    path: ['references'],
  })
  .refine((c) => c.maxLength === undefined || c.type === 'text', {
    message: 'maxLength applies to a text column only',
    path: ['maxLength'],
  })
  .refine((c) => c.scale === undefined || c.type === 'decimal' || c.type === 'money', {
    message: 'scale applies to a decimal or money column only',
    path: ['scale'],
  })
  .refine((c) => c.unique === undefined || (c.role !== 'pk' && !['json', 'blob'].includes(c.type) && (c.type !== 'text' || c.maxLength !== undefined)), {
    message: 'unique needs a column that can be indexed: not the key, not json or blob, text with maxLength',
    path: ['unique'],
  })
  .superRefine((c, ctx) => {
    const issue = defaultIssue(c);
    if (issue !== null) ctx.addIssue({ code: 'custom', message: issue, path: ['default'] });
  });

export const requiredTableSchema = z
  .object({
    ref: z.string().regex(/^[a-z][a-z0-9_]*$/, 'table ref must be a snake_case identifier'),
    columns: z.array(requiredColumnSchema).min(1),
    /**
     * A shape other apps may share, `<name>@<version>` (`menu@1`). Two apps
     * that declare the same shape can use one table between them.
     */
    shape: z.string().regex(/^[a-z][a-z0-9-]*@\d+$/, 'a shape is <name>@<version>').optional(),
    capacity: capacitySchema.optional(),
    /** Booking people: no two counted rows of one resource may overlap (see `booking.ts`). */
    booking: bookingSchema.optional(),
    /** States, the moves between them, locks and no-delete (see `states.ts`). */
    states: statesSchema.optional(),
    /**
     * A table built on a shape an add-on defines, `<addOn>/<name>@<version>`
     * (`invoices/invoice@1`), and which part of it (`document`, `lines`).
     * The table spells out the shape's columns and rules beside its own; the
     * install checks them against the installed add-on. Not the same as
     * `shape`, which lets apps SHARE one table: two apps built on one shape
     * get a table each.
     */
    builtOn: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,79}\/[a-z][a-z0-9-]*@[1-9]\d*$/, 'builtOn is <add-on key>/<shape name>@<version>')
      .optional(),
    part: z.string().regex(/^[a-z][a-z0-9_]*$/, 'a part of the shape').optional(),
    /**
     * What a person calls ONE row ("Category") and the table ("Categories"),
     * in every language the app speaks: a form's title and button, a page's
     * empty state, a link's field. Installed as the table's label. Without
     * them Adminium names the table from its real name (`pos_menu_categories`).
     */
    label: textOrLabels.optional(),
    labelPlural: textOrLabels.optional(),
    /** The column that names a row wherever another table links to it (a category's `name`). */
    keyField: z.string().regex(/^[a-z][a-z0-9_]*$/, 'a column ref').optional(),
  })
  .strict()
  .refine(
    (t) => new Set(t.columns.map((c) => c.ref)).size === t.columns.length,
    { message: 'duplicate column ref in table', path: ['columns'] },
  )
  .refine((t) => t.keyField === undefined || t.columns.some((c) => c.ref === t.keyField), {
    message: 'keyField must name one of the table’s columns',
    path: ['keyField'],
  })
  .refine((t) => t.labelPlural === undefined || t.label !== undefined, {
    message: 'labelPlural needs a label',
    path: ['labelPlural'],
  })
  .refine((t) => t.capacity === undefined || t.booking === undefined, {
    message: 'a table has a capacity or a booking rule, not both',
    path: ['booking'],
  })
  .refine((t) => (t.builtOn === undefined) === (t.part === undefined), {
    message: 'a table built on a shape names the part it is, and only such a table does',
    path: ['part'],
  })
  .refine((t) => t.builtOn === undefined || t.shape === undefined, {
    message: 'a table is built on an add-on\'s shape or shared under a shape, not both',
    path: ['builtOn'],
  });

export const requiredSchemaSchema = z
  .object({
    tables: z.array(requiredTableSchema).min(1),
    /**
     * Adminium names every table `<app key>_<ref>` (`pos_tickets`), and tells
     * the app the real names at boot. Opt-in, because an app built before it
     * hard-codes its table names. Apps only: an add-on uses its host's tables.
     */
    prefixed: z.literal(true).optional(),
  })
  .strict()
  .refine((s) => new Set(s.tables.map((t) => t.ref)).size === s.tables.length, {
    message: 'duplicate table ref in requiredSchema',
    path: ['tables'],
  });

// ── shapes an add-on defines ──────────────────────────────────────────────────

/**
 * One part of a shape: its columns and the rules on them, and the table's
 * states. A column's `references` names another part of the same shape
 * (`document`), or a part of another of the add-on's shapes
 * (`quote@1/document`).
 */
export const shapePartSchema = z
  .object({
    columns: z.array(requiredColumnSchema).min(1).max(60),
    states: statesSchema.optional(),
  })
  .strict()
  .refine((p) => new Set(p.columns.map((c) => c.ref)).size === p.columns.length, {
    message: 'duplicate column ref in part',
    path: ['columns'],
  });

/**
 * A shape an add-on defines for apps to build their tables on (see
 * `shapes.ts`): named parts, the document profiles made for an app's tables
 * at install (in part and column names), and the messages it sends.
 */
export const shapeDefinitionSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a shape name is kebab-case'),
    version: z.number().int().min(1).max(99),
    parts: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/, 'a part name is snake_case'), shapePartSchema),
    documentProfiles: z
      .array(appDocumentSchema.omit({ addOn: true, table: true, feature: true }).extend({ part: refSchema }).strict())
      .max(8)
      .optional(),
    outbox: z
      .object({
        producers: z.array(outboxProducerSchema).min(1).max(16),
        templates: z
          .array(emailTemplateSchema.omit({ key: true }).extend({ kind: z.string().min(1).max(40) }).strict())
          .max(16)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((d) => Object.keys(d.parts).length > 0, { message: 'a shape has at least one part', path: ['parts'] });
export type ShapeDefinition = z.infer<typeof shapeDefinitionSchema>;

/**
 * Everything wrong inside an add-on's shapes: each part is checked as the
 * app's tables are, with the parts of all its shapes as the tables (another
 * shape's part as `<name>@<version>/<part>`), and its rules may read only the
 * add-on's own settings.
 */
export function shapeDefinitionIssues(
  addOn: string,
  settings: readonly string[],
  shapes: readonly ShapeDefinition[],
): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const seen = new Set<string>();
  shapes.forEach((shape, s) => {
    const id = `${shape.name}@${String(shape.version)}`;
    if (seen.has(id)) out.push({ path: ['addOn', 'shapes', s], message: `"${id}" is declared twice` });
    seen.add(id);
    const own = Object.entries(shape.parts).map(([ref, part]) => ({ ref, columns: part.columns, states: part.states }));
    const others = shapes
      .filter((other) => other !== shape)
      .flatMap((other) => Object.entries(other.parts).map(([ref, part]) => ({ ref: `${other.name}@${String(other.version)}/${ref}`, columns: part.columns })));
    const parts = own.map((p) => p.ref);
    const issues = appReferenceIssues({ key: addOn, requiredSchema: { tables: [...own, ...others] } }, { addOn, settings });
    for (const issue of issues) {
      const [, , t, ...rest] = issue.path;
      if (typeof t !== 'number' || t >= parts.length) continue;
      out.push({ path: ['addOn', 'shapes', s, 'parts', parts[t]!, ...rest], message: issue.message });
    }
    const index = tableIndex([...own, ...others]);
    (shape.documentProfiles ?? []).forEach((profile, d) => {
      const at = (...rest: (string | number)[]) => ['addOn', 'shapes', s, 'documentProfiles', d, ...rest];
      if (shape.parts[profile.part] === undefined) {
        out.push({ path: at('part'), message: `"${id}" has no part "${profile.part}"` });
        return;
      }
      out.push(...mappingIssues(profile.part, profile.mapping, index, at));
    });
    (shape.outbox?.producers ?? []).forEach((producer, p) => {
      const source = 'onCreate' in producer ? producer.onCreate : 'onChange' in producer ? producer.onChange : producer.before;
      if (shape.parts[source.table] === undefined) {
        out.push({ path: ['addOn', 'shapes', s, 'outbox', 'producers', p], message: `"${id}" has no part "${source.table}"` });
      }
    });
    const kinds = new Set((shape.outbox?.producers ?? []).map((producer) => producer.kind));
    (shape.outbox?.templates ?? []).forEach((template, k) => {
      if (!kinds.has(template.kind)) out.push({ path: ['addOn', 'shapes', s, 'outbox', 'templates', k, 'kind'], message: `no producer sends "${template.kind}"` });
    });
  });
  return out;
}

// ── pages ────────────────────────────────────────────────────────────────────

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
    /**
     * The page's title in other languages, keyed by BCP 47 tag (`de-DE`)
     *. `title.fallback` stays the English; the sidebar shows the
     * operator's language until the operator renames the page.
     */
    titles: z
      .record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'titles are keyed by BCP 47 tag'), z.string().min(1).max(120))
      .optional(),
    /** The page shows only while this feature's add-ons are there (see `addOns.features`). */
    feature: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a feature id').optional(),
  })
  .strict();

// ── roles ────────────────────────────────────────────────────────────────────

export const roleSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]*$/, 'role key must be a kebab-case identifier'),
    name: z.string().min(1).max(80),
    cloneFrom: z.string().optional(),
    // grant strings validated against the RBAC grammar at install time.
    permissions: z.array(z.string().min(1)).optional(),
    /** Opens the app's own screens and never the dashboard (a till cashier). */
    screensOnly: z.boolean().optional(),
    /** Per table, what the role's update there may write (roles.ts). */
    limits: roleLimitsSchema.optional(),
  })
  .strict();

// ── settings ─────────────────────────────────────────────────────────────────

const settingBase = {
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'setting key must be snake_case'),
  required: z.boolean().optional(),
  secret: z.boolean().optional(),
  label: i18nMessageSchema.optional(),
  /*
   * The sentence UNDER the field, where a label alone cannot carry the
   * answer. Every variant below is `.strict()`, so a manifest that wrote
   * `help` without this line was rejected rather than ignored — which is why
   * it rides the same release as `RESERVED_KEYS` above rather than waiting
   * for a settings form to need it.
   */
  help: i18nMessageSchema.optional(),
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

// ── seeds ────────────────────────────────────────────────────────────────────

export const seedSchema = z
  .object({
    table: z.string().min(1),
    // inline rows, or a reference to a bundled seeds/<file> dataset.
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    file: z.string().min(1).optional(),
  })
  .strict()
  .refine((s) => (s.rows === undefined) !== (s.file === undefined), {
    message: 'a seed provides exactly one of `rows` or `file`',
  });

// ── widgets (optional custom bundles) ────────────────────────────────────────

export const manifestWidgetSchema = z
  .object({
    id: z.string().min(1).max(80),
    entry: z.string().min(1),
  })
  .strict();

// ── frontend ─────────────────────────────────────────────────────────────────

export const FRONTEND_KINDS = ['spa', 'electron', 'none'] as const;

export const frontendEnvVarSchema = z
  .object({
    required: z.boolean(),
    example: z.string().optional(),
  })
  .strict();

/**
 * Which of the three sides a frontend is.
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
     * lives only in prose and nothing can enforce rule.
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
     * being, per the fleet audit, "the only machine-readable record of the
     * staff/customer split anywhere in the fleet". Deleting it during
     * normalization was the tempting move and would have made rule
     * permanently uncheckable.
     */
    routes: z.record(z.string(), z.string()).optional(),
    /**
     * Where a STAFF side opens by default: inside the dashboard, or on its own
     * address (a till). The operator can change it; absent means inside.
     */
    placement: z.enum(['internal', 'external']).optional(),
    /** Whether the side starts switched on. Absent means on. */
    enabled: z.boolean().optional(),
  })
  .strict();

// ── the app's sidebar, public access and sample data ─────────────────────────

/** A heading in the app's own sidebar section; pages name it in `nav.group`. */
/**
 * A list of answers the app ships, for a column's `options: {list}`. Installed
 * as the option list `<appKey>-<name>`, which the operator can then edit like
 * any other; a list of that key they already made is left alone.
 */
export const optionListSchema = z
  .object({
    label: textOrLabels,
    values: z
      .array(
        z
          .object({ value: z.string().min(1).max(256), label: textOrLabels.optional(), tone: z.string().max(32).optional() })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const navGroupSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a nav group key is kebab-case'),
    label: labelsSchema,
    order: z.number().int(),
  })
  .strict();

/** What the app's public screens may do (see `public-access.ts`). */
export { publicAccessSchema, publicKeysSchema, type PublicAccess };

/** The bundled sample data file, inside the package's `seeds/` folder. */
export const sampleDataSchema = z
  .object({
    file: z.string().regex(/^seeds\/[a-z0-9][a-z0-9._-]*\.json$/, 'a file in seeds/, ending .json'),
  })
  .strict();

// ── the manifest envelope ─────────────────────────────────────────────────────

/**
 * The two envelope-wide rules, as plain predicates over the shape both branches
 * share. They are attached to EACH BRANCH below rather than to the union: a
 * `.refine()` on a `z.discriminatedUnion` would run against the union type and
 * lose the narrowing, and moving them up there is how they get silently dropped
 * (first implementer note).
 */
interface SharedEnvelope {
  capabilities?: Capability[] | undefined;
  compatibility: z.infer<typeof compatibilitySchema>;
}

/** Hosted-only and offline-required are mutually exclusive. */
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

/** The prefix Adminium gives an app's tables: its key, `-` as `_`, then `_`. */
export function prefixFor(appKey: string): string {
  return `${appKey.replace(/-/g, '_')}_`;
}

/** The longest real table name every engine accepts (Postgres: 63 bytes). */
export const MAX_TABLE_NAME = 63;

/**
 * Every name a manifest's own blocks use must name something the manifest
 * declares: a rule's columns, a capacity's or a booking's columns and tables,
 * a public table and the columns it reads and writes, the outbox and its
 * templates. Checked here so an app's CI refuses a typo long before an
 * operator's install would.
 */
export function appReferenceIssues(
  m: {
    key: string;
    requiredSchema: { tables: readonly RequiredTableShape[]; prefixed?: true | undefined };
    publicAccess?: readonly PublicAccess[] | undefined;
    publicKeys?: z.infer<typeof publicKeysSchema> | undefined;
    optionLists?: Readonly<Record<string, unknown>> | undefined;
    roles?: readonly RoleShape[] | undefined;
    outbox?: z.infer<typeof outboxSchema> | undefined;
    emailTemplates?: readonly z.infer<typeof emailTemplateSchema>[] | undefined;
    addOns?: AddOnNeeds | undefined;
    documents?: readonly AppDocument[] | undefined;
    pages?: readonly { feature?: string | undefined }[] | undefined;
  },
  /**
   * When the tables are an add-on's shape rather than an app's: the add-on's
   * own key and setting keys, which its rules may read, and no roles to name.
   */
  shapeOf?: { addOn: string; settings: readonly string[] },
): { path: (string | number)[]; message: string }[] {
  const out: { path: (string | number)[]; message: string }[] = [];
  const index = tableIndex(m.requiredSchema.tables);
  const tables = new Map(m.requiredSchema.tables.map((t) => [t.ref, t]));
  const has = index.has;
  /** A setting a rule reads must be there when the rule runs. */
  const settingIssue = (source: SettingSource, path: (string | number)[]) => {
    if ('addOn' in source) {
      if (shapeOf !== undefined) {
        if (source.addOn !== shapeOf.addOn) out.push({ path, message: `a shape reads only its own add-on's settings, not "${source.addOn}"` });
        else if (!shapeOf.settings.includes(source.setting)) out.push({ path, message: `"${source.addOn}" has no setting "${source.setting}"` });
      } else if (!requiresAddOn(m.addOns, source.addOn)) {
        out.push({ path, message: `"${source.addOn}" is not required by the app (addOns.requires), so its setting may not be there` });
      }
    } else if (!has(source.table, source.column)) {
      out.push({ path, message: `"${source.table}" has no column "${source.column}"` });
    }
  };
  /** The tables the app's signed-in people are rows of (its claim identities). */
  const identityTables = new Set((m.publicAccess ?? []).filter((e) => e.claim !== undefined).map((e) => e.table));
  /** Per table, the columns Adminium decides and no writer may set. */
  const decided = new Map<string, Set<string>>();
  const decide = (table: string, column: string) => {
    const set = decided.get(table) ?? new Set<string>();
    set.add(column);
    decided.set(table, set);
  };

  m.requiredSchema.tables.forEach((table, t) => {
    const at = (...rest: (string | number)[]) => ['requiredSchema', 'tables', t, ...rest];
    if (m.requiredSchema.prefixed === true && prefixFor(m.key).length + table.ref.length > MAX_TABLE_NAME) {
      out.push({ path: at('ref'), message: `"${prefixFor(m.key)}${table.ref}" is longer than ${String(MAX_TABLE_NAME)} characters` });
    }
    const balances = new Map<string, string>();
    table.columns.forEach((column) => {
      const balance = column.rules?.rollup?.balance;
      if (balance !== undefined) balances.set(balance.column, column.ref);
    });
    table.columns.forEach((column, c) => {
      const rules = column.rules;
      if (rules === undefined) return;
      const here = (...rest: (string | number)[]) => at('columns', c, 'rules', ...rest);
      const deciders = (['copy', 'sequence', 'code', 'rollup', 'stamp', 'formula', 'format', 'default'] as const).filter(
        (name) => rules[name] !== undefined,
      );
      if (deciders.length > 0) decide(table.ref, column.ref);
      // One rule decides a column; two would race for its value. A copy with
      // a default behind it is the one pair that means something.
      const racing = deciders.filter((name) => !(name === 'default' && rules.copy !== undefined) && !(name === 'copy' && rules.default !== undefined));
      if (racing.length > 1 && rules.stamp === undefined) {
        out.push({ path: here(), message: `a column is decided by one rule, and this one has ${racing.join(', ')}` });
      }
      if (rules.normalize !== undefined && column.type !== 'text') {
        out.push({ path: here('normalize'), message: 'only text is stored trimmed or in lower case' });
      }
      const dated = (type: string | undefined) => type === 'date' || type === 'timestamptz';
      if ((rules.notAfter !== undefined || rules.notBefore !== undefined) && !dated(column.type)) {
        out.push({ path: here(rules.notAfter !== undefined ? 'notAfter' : 'notBefore'), message: 'only a date is kept within dates' });
      }
      if (rules.notBefore !== undefined) {
        const bound = rules.notBefore;
        let owner = table.ref;
        if (bound.via !== undefined) {
          const via = index.column(table.ref, bound.via);
          if (via?.type !== 'fk' || via.references === undefined) {
            out.push({ path: here('notBefore', 'via'), message: `"${table.ref}.${bound.via}" is not a foreign key` });
            owner = '';
          } else {
            owner = via.references;
          }
        }
        if (owner !== '') {
          const other = index.column(owner, bound.column);
          if (other === undefined) out.push({ path: here('notBefore', 'column'), message: `"${owner}" has no column "${bound.column}"` });
          else if (!dated(other.type)) out.push({ path: here('notBefore', 'column'), message: `"${owner}.${bound.column}" is not a date` });
          else if (bound.via === undefined && other.ref === column.ref) out.push({ path: here('notBefore', 'column'), message: 'a date is bounded by another column' });
        }
      }
      if (rules.requiredWhen !== undefined) {
        const when = rules.requiredWhen;
        const other = index.column(table.ref, when.column);
        if (other === undefined) out.push({ path: here('requiredWhen', 'column'), message: `"${table.ref}" has no column "${when.column}"` });
        else if (other.ref === column.ref) out.push({ path: here('requiredWhen', 'column'), message: 'a column is required by another column' });
        else {
          for (const value of when.in) {
            if (!valueFits(other, value)) out.push({ path: here('requiredWhen', 'in'), message: `${JSON.stringify(value)} is not a value of "${table.ref}.${when.column}"` });
          }
        }
        // Never empty already, or always asked for: the condition would say nothing.
        if (column.nullable !== true) out.push({ path: here('requiredWhen'), message: 'a column required only sometimes may be empty the rest of the time, so make it nullable' });
        if (rules.required === true) out.push({ path: here('requiredWhen'), message: 'a column is required always, or only when another column says so, not both' });
        if (deciders.length > 0) out.push({ path: here('requiredWhen'), message: 'Adminium fills this column, so nobody is asked for it' });
      }
      if (rules.default !== undefined) {
        const from = rules.default.from;
        if (from === 'connection.currency') {
          if (column.type !== 'text' || (column.maxLength !== undefined && column.maxLength < 3)) {
            out.push({ path: here('default', 'from'), message: 'a currency is three letters: a text column of at least 3 characters' });
          }
        } else {
          settingIssue(from, here('default', 'from'));
        }
        if (column.nullable !== true) out.push({ path: here('default'), message: 'a column filled from elsewhere may start empty, so make it nullable' });
      }
      if (rules.sequence !== undefined) {
        const seq = rules.sequence;
        if (seq.start !== undefined && seq.startSetting !== undefined) out.push({ path: here('sequence'), message: 'a running number starts at start or at startSetting, not both' });
        if (seq.gapless === true) {
          if (column.type !== 'int' && column.type !== 'bigint') out.push({ path: here('sequence', 'gapless'), message: 'a number without gaps is a whole number: an int column' });
          // Rows added as samples, and rows imported with a number of their own, carry none.
          if (column.nullable !== true) out.push({ path: here('sequence', 'gapless'), message: 'a numbered column is nullable: sample rows carry no number' });
        } else if (seq.scope !== undefined || seq.startSetting !== undefined) {
          out.push({ path: here('sequence'), message: 'scope and startSetting number without gaps: add gapless' });
        }
        if (seq.startSetting !== undefined) settingIssue(seq.startSetting, here('sequence', 'startSetting'));
        if (seq.scope !== undefined) {
          const scope = index.column(table.ref, seq.scope);
          if (scope?.type !== 'fk') out.push({ path: here('sequence', 'scope'), message: `"${seq.scope}" is not a foreign key of "${table.ref}"` });
        }
      }
      if (rules.format !== undefined) {
        const f = rules.format;
        const from = index.column(table.ref, f.from);
        if (from?.rules?.sequence === undefined) out.push({ path: here('format', 'from'), message: `"${f.from}" is not a running number of "${table.ref}"` });
        if (column.type !== 'text') out.push({ path: here('format'), message: 'a number with a prefix is written into a text column' });
        if (f.prefix !== undefined && f.prefixSetting !== undefined) out.push({ path: here('format'), message: 'a prefix is written here or read from a setting, not both' });
        if (f.prefixSetting !== undefined) settingIssue(f.prefixSetting, here('format', 'prefixSetting'));
        if (column.maxLength !== undefined && (f.prefix ?? '').length + (f.pad ?? 0) > column.maxLength) {
          out.push({ path: here('format'), message: `"${table.ref}.${column.ref}" holds ${String(column.maxLength)} characters, fewer than the prefix and the padding` });
        }
        if (column.nullable !== true) out.push({ path: here('format'), message: 'a numbered column is nullable: sample rows carry their own text' });
      }
      // A list the app ships, or one Adminium has built in; nothing else exists
      // on every install.
      if (rules.options !== undefined && 'list' in rules.options) {
        const list = rules.options.list;
        if (!list.startsWith('builtin:') && m.optionLists?.[list] === undefined) {
          out.push({ path: here('options', 'list'), message: `"${list}" is not one of the app's option lists` });
        }
      }
      if (rules.copy !== undefined) {
        const via = table.columns.find((x) => x.ref === rules.copy!.via);
        if (via?.type !== 'fk' || via.references === undefined) {
          out.push({ path: here('copy', 'via'), message: `"${rules.copy.via}" is not a foreign key of "${table.ref}"` });
        } else if (!has(via.references, rules.copy.from)) {
          out.push({ path: here('copy', 'from'), message: `"${via.references}" has no column "${rules.copy.from}"` });
        }
      }
      if (rules.rollup !== undefined) {
        const r = rules.rollup;
        const child = tables.get(r.from);
        const via = child?.columns.find((x) => x.ref === r.via);
        if (child === undefined) {
          out.push({ path: here('rollup', 'from'), message: `"${r.from}" is not a table of this app` });
        } else if (via?.type !== 'fk' || via.references !== table.ref) {
          out.push({ path: here('rollup', 'via'), message: `"${r.from}.${r.via}" does not point at "${table.ref}"` });
        } else {
          for (const name of [r.sum, ...(r.times === undefined ? [] : [r.times]), ...(r.unlessSet === undefined ? [] : [r.unlessSet])]) {
            if (!has(r.from, name)) out.push({ path: here('rollup'), message: `"${r.from}" has no column "${name}"` });
          }
          if (r.where !== undefined) {
            const filter = index.column(r.from, r.where.column);
            if (filter === undefined) out.push({ path: here('rollup', 'where'), message: `"${r.from}" has no column "${r.where.column}"` });
            else if (!valueFits(filter, r.where.eq)) out.push({ path: here('rollup', 'where'), message: `${JSON.stringify(r.where.eq)} is not a value of "${r.from}.${r.where.column}"` });
            // An empty value equals nothing: a row left empty would drop out of the total unseen.
            else if (filter.nullable === true) out.push({ path: here('rollup', 'where'), message: `"${r.from}.${r.where.column}" may be empty, so a row could drop out of the total; make it not nullable` });
          }
        }
        if (r.balance !== undefined) {
          const b = r.balance;
          decide(table.ref, b.column);
          for (const [name, ref] of [['column', b.column], ['of', b.of], ...(b.minus ?? []).map((x) => ['minus', x] as const)] as const) {
            const found = index.column(table.ref, ref);
            if (found === undefined) out.push({ path: here('rollup', 'balance', name), message: `"${table.ref}" has no column "${ref}"` });
            else if (!NUMERIC_TYPES.includes(found.type)) out.push({ path: here('rollup', 'balance', name), message: `"${table.ref}.${ref}" is not a number` });
          }
          if ([b.of, ...(b.minus ?? [])].includes(b.column) || b.column === column.ref) {
            out.push({ path: here('rollup', 'balance', 'column'), message: 'the balance is a column of its own' });
          }
          if (index.column(table.ref, b.column)?.rules !== undefined) {
            out.push({ path: here('rollup', 'balance', 'column'), message: `"${b.column}" is the balance Adminium keeps; it takes no rules of its own` });
          }
        }
        // A cap holds a balance at zero: this rollup's, or the one that takes
        // this total away (a write-off is capped by the balance it lowers).
        if (r.cap === true && r.balance === undefined) {
          const capped = table.columns.some((x) => x.rules?.rollup?.balance?.minus?.includes(column.ref) === true);
          if (!capped) out.push({ path: here('rollup', 'cap'), message: 'a cap needs a balance: declare one here, or subtract this total in one' });
        }
      }
      if (rules.stamp !== undefined) {
        const stamp = rules.stamp;
        const set = stamp.set;
        if (set === 'now' && column.type !== 'timestamptz') {
          out.push({ path: here('stamp', 'set'), message: 'a "now" stamp needs a timestamptz column' });
        } else if (set === 'today' && column.type !== 'date') {
          out.push({ path: here('stamp', 'set'), message: 'a "today" stamp needs a date column' });
        } else if ((set === 'user-name' || set === 'user-id') && column.type !== 'text') {
          out.push({ path: here('stamp', 'set'), message: `a "${set}" stamp needs a text column` });
        } else if (typeof set === 'object' && 'byOrigin' in set) {
          for (const value of [set.byOrigin.public, ...(set.byOrigin.staff === undefined ? [] : [set.byOrigin.staff])]) {
            if (!valueFits(column, value)) out.push({ path: here('stamp', 'set'), message: `"${value}" is not a value of "${table.ref}.${column.ref}"` });
          }
        } else if (typeof set === 'object' && 'copy' in set) {
          const source = index.column(table.ref, set.copy);
          if (source === undefined) out.push({ path: here('stamp', 'set', 'copy'), message: `"${table.ref}" has no column "${set.copy}"` });
          else if (source.ref === column.ref) out.push({ path: here('stamp', 'set', 'copy'), message: 'a stamp copies another column' });
          else if (source.type !== column.type) out.push({ path: here('stamp', 'set', 'copy'), message: `"${table.ref}.${set.copy}" is a ${source.type}, and "${column.ref}" a ${column.type}` });
        } else if (typeof set === 'object' && 'claim' in set) {
          if (column.type !== 'text') out.push({ path: here('stamp', 'set'), message: 'a stamp from the signed-in person needs a text column' });
          if (![...identityTables].some((identity) => has(identity, set.claim))) {
            out.push({ path: here('stamp', 'set', 'claim'), message: `no table the app's people sign in as has a column "${set.claim}"` });
          }
        } else if (typeof set === 'object' && 'addDays' in set) {
          const a = set.addDays;
          if (column.type !== 'date') out.push({ path: here('stamp', 'set'), message: 'a date worked out from another needs a date column' });
          const from = index.column(table.ref, a.date);
          if (from === undefined) out.push({ path: here('stamp', 'set', 'addDays', 'date'), message: `"${table.ref}" has no column "${a.date}"` });
          else if (from.type !== 'date' && from.type !== 'timestamptz') out.push({ path: here('stamp', 'set', 'addDays', 'date'), message: `"${table.ref}.${a.date}" is not a date` });
          if (typeof a.days === 'string') {
            const days = index.column(table.ref, a.days);
            if (days === undefined) {
              out.push({ path: here('stamp', 'set', 'addDays', 'days'), message: `"${table.ref}" has no column "${a.days}"` });
            } else if (days.type === 'enum' || days.type === 'text') {
              const missing = (days.enum ?? []).filter((value) => a.map?.[value] === undefined);
              if (a.map === undefined || missing.length > 0) {
                out.push({ path: here('stamp', 'set', 'addDays', 'map'), message: `each value of "${table.ref}.${a.days}" needs its days${missing.length > 0 ? ` (${missing.join(', ')})` : ''}` });
              }
            } else if (days.type !== 'int' && days.type !== 'bigint') {
              out.push({ path: here('stamp', 'set', 'addDays', 'days'), message: `"${table.ref}.${a.days}" is neither a number of days nor a choice with a map` });
            }
          }
        } else if (typeof set === 'object' && 'hashOf' in set) {
          const h = set.hashOf;
          if (column.type !== 'text' || (column.maxLength !== undefined && column.maxLength < 64)) {
            out.push({ path: here('stamp', 'set'), message: 'a fingerprint is 64 characters: a text column of at least 64' });
          }
          for (const ref of h.columns) if (!has(table.ref, ref)) out.push({ path: here('stamp', 'set', 'hashOf', 'columns'), message: `"${table.ref}" has no column "${ref}"` });
          const childIssues = (parent: string, child: { table: string; via: string; columns: readonly string[]; orderBy?: string | undefined }, path: (string | number)[]) => {
            if (index.table(child.table) === undefined) {
              out.push({ path, message: `"${child.table}" is not a table of this manifest` });
              return;
            }
            const via = index.column(child.table, child.via);
            if (via?.type !== 'fk' || via.references !== parent) out.push({ path, message: `"${child.table}.${child.via}" does not point at "${parent}"` });
            for (const ref of [...child.columns, ...(child.orderBy === undefined ? [] : [child.orderBy])]) {
              if (!has(child.table, ref)) out.push({ path, message: `"${child.table}" has no column "${ref}"` });
            }
          };
          (h.children ?? []).forEach((child, k) => childIssues(table.ref, child, here('stamp', 'set', 'hashOf', 'children', k)));
          (h.linked ?? []).forEach((link, k) => {
            const path = here('stamp', 'set', 'hashOf', 'linked', k);
            const via = index.column(table.ref, link.via);
            if (via?.type !== 'fk' || via.references !== link.table) {
              out.push({ path, message: `"${table.ref}.${link.via}" does not point at "${link.table}"` });
              return;
            }
            for (const ref of link.columns) if (!has(link.table, ref)) out.push({ path, message: `"${link.table}" has no column "${ref}"` });
            (link.children ?? []).forEach((child, c2) => childIssues(link.table, child, [...path, 'children', c2]));
          });
        }
        const triggers = Array.isArray(stamp.on) ? stamp.on : [stamp.on];
        triggers.forEach((trigger, k) => {
          if (trigger === 'create') return;
          const path = Array.isArray(stamp.on) ? here('stamp', 'on', k) : here('stamp', 'on');
          const watched = index.column(table.ref, trigger.column);
          if (watched === undefined) {
            out.push({ path: [...path, 'column'], message: `"${table.ref}" has no column "${trigger.column}"` });
          } else if (watched.ref === column.ref) {
            out.push({ path: [...path, 'column'], message: 'a stamp watches another column' });
          } else if ('values' in trigger) {
            for (const value of trigger.values) {
              if (!valueFits(watched, value)) out.push({ path: [...path, 'values'], message: `${JSON.stringify(value)} is not a value of "${table.ref}.${watched.ref}"` });
            }
          } else if (watched.nullable !== true) {
            out.push({ path: [...path, 'filled'], message: `"${table.ref}.${watched.ref}" is never empty, so it is never first filled` });
          }
        });
        const others = (['copy', 'sequence', 'code', 'rollup', 'formula', 'format', 'default'] as const).filter((name) => rules[name] !== undefined);
        if (others.length > 0) out.push({ path: here('stamp'), message: `a stamped column is not also decided by ${others.join(', ')}` });
      }
      if ((rules.sequence !== undefined || rules.code !== undefined) && column.role === 'pk') {
        out.push({ path: here(), message: 'a primary key numbers itself; it takes no sequence or code rule' });
      }
    });
    const cap = table.capacity;
    if (cap !== undefined) {
      for (const [name, value] of [['slot', cap.slot], ['amount', cap.amount], ['resource', cap.resource], ['countWhere', cap.countWhere?.column]] as const) {
        if (value !== undefined && !has(table.ref, value)) {
          out.push({ path: at('capacity', name), message: `"${table.ref}" has no column "${value}"` });
        }
      }
      for (const [name, value] of Object.entries(cap)) {
        if (typeof value === 'object' && value !== null && 'table' in value && 'column' in value) {
          const setting = value as { table: string; column: string };
          if (!has(setting.table, setting.column)) {
            out.push({ path: at('capacity', name), message: `"${setting.table}" has no column "${setting.column}"` });
          }
        }
      }
    }
    if (table.booking !== undefined) {
      out.push(...bookingIssues(table, table.booking, index, at));
      // The late flag is Adminium's to set.
      if (table.booking.cancel?.flag !== undefined) decide(table.ref, table.booking.cancel.flag);
    }
    out.push(...tableFormulaIssues(table.columns, (c, ...rest) => at('columns', c, ...rest)));
    if (table.states !== undefined) {
      out.push(
        ...statesIssues(
          table.ref,
          table.states,
          {
            index,
            roles: shapeOf !== undefined ? undefined : (m.roles ?? []).map((role) => role.key),
            numbered: table.columns.some((c) => c.rules?.sequence?.gapless === true),
          },
          (...rest) => at('states', ...rest),
        ),
      );
    }
    if (table.builtOn !== undefined && shapeOf === undefined) {
      const addOn = table.builtOn.split('/')[0]!;
      if (!requiresAddOn(m.addOns, addOn)) {
        out.push({ path: at('builtOn'), message: `"${addOn}" defines the shape, so the app requires it (addOns.requires)` });
      }
    }
  });

  out.push(
    ...publicAccessIssues(m.publicAccess ?? [], {
      index,
      decided: (table) => decided.get(table) ?? new Set(),
      answersAvailability: (table) => tables.get(table)?.capacity !== undefined || tables.get(table)?.booking !== undefined,
      publicKeys: m.publicKeys,
      roles: m.roles ?? [],
    }),
  );
  out.push(...outboxIssues(m, index));
  out.push(...roleLimitIssues(m.roles ?? [], index));
  if (shapeOf === undefined) out.push(...addOnNeedsIssues(m));
  if (m.documents !== undefined) {
    out.push(
      ...appDocumentIssues(m.documents, {
        index,
        addOns: new Set([...(m.addOns?.requires ?? []), ...(m.addOns?.suggests ?? [])].map((need) => need.key)),
        features: new Set((m.addOns?.features ?? []).map((feature) => feature.id)),
      }),
    );
  }
  return out;
}

/** What `appReferenceIssues` reads of a table. */
export interface RequiredTableShape {
  ref: string;
  columns: readonly {
    ref: string;
    type: string;
    role?: string | undefined;
    nullable?: boolean | undefined;
    enum?: string[] | undefined;
    references?: string | undefined;
    maxLength?: number | undefined;
    rules?: ColumnRules | undefined;
  }[];
  capacity?: z.infer<typeof capacitySchema> | undefined;
  booking?: z.infer<typeof bookingSchema> | undefined;
  states?: States | undefined;
  builtOn?: string | undefined;
}

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
     * ONE OR MORE SIDES. Replaces the singular `frontend`.
     *
     * `minItems: 1` is the gate: a manifest declaring no side does not validate,
     * which is what turns "dashboard mandatory, staff optional, customer
     * optional, at least one" from a slogan into something CI can hold. Two
     * repos (factory-ops, hotel-reservations) could never validate under the old
     * required-singular shape however their `requiredSchema` was repaired.
     */
    frontends: z.array(frontendSchema).min(1),
    navGroups: z.array(navGroupSchema).max(12).optional(),
    /** Keyed by a kebab-case name; a column names one with `options: {list: name}`. */
    optionLists: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/, 'a list name is kebab-case'), optionListSchema).optional(),
    publicAccess: z.array(publicAccessSchema).max(32).optional(),
    /** Browser keys besides the app's own `customer` key (see `public-access.ts`). */
    publicKeys: publicKeysSchema.optional(),
    /** The app's emails: its outbox table and what queues rows in it (see `outbox.ts`). */
    outbox: outboxSchema.optional(),
    /** The templates the outbox sends, in each language the app ships. */
    emailTemplates: z.array(emailTemplateSchema).max(32).optional(),
    sampleData: sampleDataSchema.optional(),
    /** The add-ons the app needs, suggests, or needs for a feature (see `add-ons.ts`). */
    addOns: addOnsSchema.optional(),
    /** Document profiles on the app's own tables, drawn by an add-on (see `documents.ts`). */
    documents: z.array(appDocumentSchema).max(16).optional(),
  })
  .strict()
  .refine(capabilitiesNotContradictory, { ...CAPS_MESSAGE, path: [...CAPS_MESSAGE.path] })
  .refine(compatibilityWindowOrdered, { ...WINDOW_MESSAGE, path: [...WINDOW_MESSAGE.path] })
  .refine(sidesAreDistinct, { ...SIDES_MESSAGE, path: [...SIDES_MESSAGE.path] })
  .superRefine((m, ctx) => {
    for (const issue of appReferenceIssues(m)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
    // A calendar page's named columns, against the app's own tables.
    for (const issue of pageCalendarIssues(m.pages, tableIndex(m.requiredSchema.tables))) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
  });

/**
 * `pages`, `roles` and `frontends` are absent from this branch on purpose, and
 * leaving the fields off a `.strict()` schema entirely is a stronger guarantee
 * than a lint rule.
 *
 * WHAT CHANGED, AND WHAT DID NOT. An add-on may now own a dashboard page — but
 * it declares that page as CODE, inside `addOn.pages`, never as a `pages` entry
 * up here. The two are
 * different things wearing one word: a `pages` row is a generated page, a
 * `template` the engine renders with `bindings` and `config`, and an add-on
 * still cannot install one. Roles and frontends remain refused outright.
 *
 * So the absence of `pages` from this object is no longer "an add-on has no
 * pages". It is "an add-on's pages are not the engine's page templates", which
 * is a narrower promise and the one this shape actually keeps.
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
  .refine(compatibilityWindowOrdered, { ...WINDOW_MESSAGE, path: [...WINDOW_MESSAGE.path] })
  .refine((m) => m.requiredSchema?.prefixed !== true, {
    message: 'an add-on uses its host app\'s tables, so its own cannot be prefixed',
    path: ['requiredSchema', 'prefixed'],
  })
  .superRefine((m, ctx) => {
    // `addOn.shapes` is typed loosely in the contracts package (it cannot see
    // the column schema without importing this one); it is checked in full here.
    const raw = m.addOn.shapes ?? [];
    const shapes: ShapeDefinition[] = [];
    raw.forEach((candidate, s) => {
      const parsed = shapeDefinitionSchema.safeParse(candidate);
      if (parsed.success) shapes.push(parsed.data);
      else for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: ['addOn', 'shapes', s, ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))] });
    });
    if (shapes.length !== raw.length) return;
    for (const issue of shapeDefinitionIssues(m.key, (m.settings ?? []).map((setting) => setting.key), shapes)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path });
    }
  });

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

/** One table an add-on declares under `requiredSchema`. */
export type RequiredTable = z.infer<typeof requiredTableSchema>;
/** One column of a {@link RequiredTable}. */
export type RequiredColumn = z.infer<typeof requiredColumnSchema>;
export type Manifest = AppManifest | AddOnManifest;

export type { AddOnBlock };

/** Narrowing helper — the discriminant is the only thing worth branching on. */
export function isAddOnManifest(m: Manifest): m is AddOnManifest {
  return m.kind === 'add-on';
}

/**
 * Cross-block rules the envelope cannot express, each with its issue
 * code. Runs only for `kind: "add-on"`; returns [] for an app.
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

  /*
   * THERE IS NO NAV_GROUP_UNKNOWN CHECK HERE, AND THAT IS DELIBERATE.
   *
   * A page whose group is neither built in nor declared is refused by
   * `addOnBlockSchema` itself, and these cross-block rules run only on a
   * manifest that has already parsed — so a check here could never fire. It was
   * written, and removed once its own test proved it unreachable: the refusal
   * arrived as a schema issue with no code.
   *
   * SLOT_UNKNOWN above is the same shape and is kept, labelled "belt and
   * braces". One unreachable branch is not a reason for a second: this
   * repository has shipped four features that passed every test and could not
   * be called, and a validator branch nobody can reach is where that starts.
   */

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
