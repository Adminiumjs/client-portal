/*
 * VENDORED VERBATIM from packages/manifest/src/validate.ts.
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
 * Manifest validation entry point. Layers the envelope schema with the v1
 * publisher policy: the installer rejects any `publisher.id` other than
 * `adminium` unless the `third-party-publishers` feature flag is on (off
 * in v1). Pure — safe in the browser storefront.
 */

import {
  FIRST_PARTY_PUBLISHER_ID,
  RESERVED_KEYS,
  addOnIssues,
  cappedFormulaWarnings,
  manifestSchema,
  type Manifest,
} from './schema.ts';
import { plainTextLengthWarnings } from './public-access.ts';
import { tableShapeIssues } from './table-shapes.ts';

export interface ManifestIssue {
  /** Dotted path to the offending field, e.g. `publisher.id`. */
  path: string;
  message: string;
  /** Issue code for the add-on rules; absent for schema issues. */
  code?: string;
}

export interface ValidateManifestOptions {
  /**
   * Allow a non-`adminium` publisher. Wired to the `third-party-publishers`
   * feature flag; OFF in v1, so third-party manifests are rejected.
   *
   * For an add-on the gate matters MORE, not less: an add-on's server half runs
   * in the host process with no sandbox, so an unsandboxed in-process add-on
   * from an unknown publisher would be remote code execution with a marketplace
   * in front of it.
   */
  allowThirdPartyPublishers?: boolean;
  /** Installed app keys, so an add-on's `attaches` can be checked. */
  knownAppKeys?: readonly string[];
  /** The host app's table refs, so an add-on's `scopes` can be bounded. */
  hostTables?: readonly string[];
}

/**
 * A warning is advice, never a refusal: a manifest with warnings validates.
 * Kept apart from `issues` on purpose — every app repo compares its vendored
 * validator's issues with Adminium's, and a warning reported as an issue
 * would fail them all on their next push.
 */
export type ValidateManifestResult =
  | { ok: true; manifest: Manifest; warnings: ManifestIssue[] }
  | { ok: false; issues: ManifestIssue[]; warnings: ManifestIssue[] };

/** Rules that fill a column, so an insert may leave it out. */
const FILLING_RULES = ['copy', 'sequence', 'code', 'rollup', 'stamp', 'formula', 'format', 'default', 'lookup', 'perNight'] as const;

/** A setting key that reads like bank details (an IBAN, an account or routing number). */
const BANK_SETTING = /(^|_)(bank|iban|swift|routing)(_|$)|account_?(number|no|name)|sort_?code/i;

/**
 * Advice about an app that validates: a column with no default that is not
 * nullable is NOT NULL once installed, so every insert must give it a value —
 * a draft saved half-filled is refused. Every app round has hit this once.
 */
export function manifestWarnings(manifest: Manifest): ManifestIssue[] {
  if (manifest.kind !== 'app') return [];
  const out: ManifestIssue[] = [];
  (manifest.requiredSchema?.tables ?? []).forEach((table, t) => {
    table.columns.forEach((column, c) => {
      if (column.nullable === true || column.default !== undefined || column.role !== undefined) return;
      if (FILLING_RULES.some((rule) => column.rules?.[rule] !== undefined)) return;
      out.push({
        path: `requiredSchema.tables.${String(t)}.columns.${String(c)}`,
        message: `"${table.ref}.${column.ref}" has no default and is not nullable, so it will be required at install: every new row must give it a value`,
      });
    });
    // MySQL compares text ignoring case and accents; Postgres and SQLite do not.
    (table.unique ?? []).forEach((set, k) => {
      for (const ref of set) {
        const column = table.columns.find((c) => c.ref === ref);
        if (column?.type !== 'text' || column.rules?.normalize !== undefined || column.rules?.code !== undefined) continue;
        out.push({
          path: `requiredSchema.tables.${String(t)}.unique.${String(k)}`,
          message: `MySQL compares "${table.ref}.${ref}" ignoring case and accents, Postgres and SQLite do not: give it normalize "email" or "trim"`,
        });
      }
    });
  });
  // A plain-text column longer than its plain text takes: the end of what a guest types is refused.
  out.push(...plainTextLengthWarnings(manifest.publicAccess ?? [], manifest.requiredSchema?.tables ?? []));
  // A capped balance worked out from a formula whose columns stay open while the capped rows exist.
  for (const warning of cappedFormulaWarnings(manifest.requiredSchema?.tables ?? [])) out.push({ path: warning.path.map(String).join('.'), message: warning.message });
  /*
   * Every manifest setting that is not secret is published to the app's
   * customer side. Bank details belong in the app's settings table, read
   * only by a signed-in guest; one declared here must at least be secret.
   */
  (manifest.settings ?? []).forEach((setting, s) => {
    if (setting.secret === true || !BANK_SETTING.test(setting.key)) return;
    out.push({
      path: `settings.${String(s)}`,
      message: `"${setting.key}" reads like bank details, and a setting that is not secret is published to the customer side: keep them in the settings table, or mark it secret`,
    });
  });
  return out;
}

/**
 * Validate an untrusted manifest document. Returns the typed manifest on
 * success, or every issue found (schema + policy) on failure — never throws.
 */
export function validateManifest(
  input: unknown,
  opts: ValidateManifestOptions = {},
): ValidateManifestResult {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
      warnings: [],
    };
  }

  const manifest = parsed.data;
  const issues: ManifestIssue[] = [];

  if (!(opts.allowThirdPartyPublishers ?? false) && manifest.publisher.id !== FIRST_PARTY_PUBLISHER_ID) {
    issues.push({
      path: 'publisher.id',
      message: `third-party publishers are not accepted in v1 (expected "${FIRST_PARTY_PUBLISHER_ID}")`,
    });
  }

  // Apps and add-ons share one key namespace, and these keys shadow a
  // storefront route or a data file.
  if ((RESERVED_KEYS as readonly string[]).includes(manifest.key)) {
    issues.push({
      path: 'key',
      message: `"${manifest.key}" is reserved and cannot be used as an app or add-on key`,
    });
  }

  issues.push(
    ...addOnIssues(manifest, {
      ...(opts.knownAppKeys !== undefined ? { knownAppKeys: opts.knownAppKeys } : {}),
      ...(opts.hostTables !== undefined ? { hostTables: opts.hostTables } : {}),
    }),
  );

  issues.push(...sampleDataIssues(manifest));
  // A table shared under a shape Adminium writes down is what that shape says.
  if (manifest.kind === 'app') issues.push(...tableShapeIssues(manifest));

  const warnings = manifestWarnings(manifest);
  if (issues.length > 0) return { ok: false, issues, warnings };
  return { ok: true, manifest, warnings };
}

/** `sampleData.skipWhenShared` names the app's own tables, its `table` is one it shares, and no table left in links to a skipped one. */
function sampleDataIssues(manifest: Manifest): ManifestIssue[] {
  const rule = manifest.kind === 'app' ? manifest.sampleData?.skipWhenShared : undefined;
  if (rule === undefined) return [];
  const out: ManifestIssue[] = [];
  const tables = new Map((manifest.requiredSchema?.tables ?? []).map((table) => [table.ref, table]));
  const shared = tables.get(rule.table);
  if (shared === undefined) {
    out.push({ path: 'sampleData.skipWhenShared.table', message: `"${rule.table}" is not one of this app's tables` });
  } else if (shared.shape === undefined) {
    out.push({
      path: 'sampleData.skipWhenShared.table',
      message: `"${rule.table}" is built on no shape, so no other app can share it`,
    });
  }
  const seen = new Set<string>();
  rule.skip.forEach((ref, i) => {
    if (!tables.has(ref)) out.push({ path: `sampleData.skipWhenShared.skip.${String(i)}`, message: `"${ref}" is not one of this app's tables` });
    else if (seen.has(ref)) out.push({ path: `sampleData.skipWhenShared.skip.${String(i)}`, message: `"${ref}" is listed twice` });
    seen.add(ref);
  });
  /*
   * Closed under links: a table left in whose rows point at a skipped table
   * would point its sample rows at rows never added, so every add would fail.
   */
  for (const table of tables.values()) {
    if (seen.has(table.ref)) continue;
    for (const column of table.columns) {
      if (column.type !== 'fk' || column.references === undefined || !seen.has(column.references)) continue;
      out.push({
        path: 'sampleData.skipWhenShared.skip',
        message: `"${table.ref}" links to "${column.references}" (${column.ref}), which is skipped: skip "${table.ref}" too, or its sample rows point at rows never added`,
      });
    }
  }
  return out;
}

/** Throwing variant for trusted callers (build tooling); use the safe form at runtime. */
export function parseManifest(input: unknown, opts: ValidateManifestOptions = {}): Manifest {
  const result = validateManifest(input, opts);
  if (!result.ok) {
    const summary = result.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    throw new Error(`invalid manifest: ${summary}`);
  }
  return result.manifest;
}
