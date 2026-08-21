/*
 * VENDORED VERBATIM from packages/manifest/src/validate.ts.
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
 * Manifest validation entry point (13-marketplace.md §2, §9). Layers the
 * envelope schema with the v1 publisher policy: the installer rejects any
 * `publisher.id` other than `adminium` unless the `third-party-publishers`
 * feature flag is on (off in v1). Pure — safe in the browser storefront.
 */

import {
  FIRST_PARTY_PUBLISHER_ID,
  RESERVED_KEYS,
  addOnIssues,
  manifestSchema,
  type Manifest,
} from './schema.ts';

export interface ManifestIssue {
  /** Dotted path to the offending field, e.g. `publisher.id`. */
  path: string;
  message: string;
  /** Issue code for the add-on rules (24 §5.3); absent for schema issues. */
  code?: string;
}

export interface ValidateManifestOptions {
  /**
   * Allow a non-`adminium` publisher. Wired to the `third-party-publishers`
   * feature flag (§9); OFF in v1, so third-party manifests are rejected.
   *
   * For an add-on the gate matters MORE, not less: an add-on's server half runs
   * in the host process with no sandbox (24 D13), so an unsandboxed in-process
   * add-on from an unknown publisher would be remote code execution with a
   * marketplace in front of it.
   */
  allowThirdPartyPublishers?: boolean;
  /** Installed app keys, so an add-on's `attaches` can be checked (24 §5.3). */
  knownAppKeys?: readonly string[];
  /** The host app's table refs, so an add-on's `scopes` can be bounded. */
  hostTables?: readonly string[];
}

export type ValidateManifestResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; issues: ManifestIssue[] };

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

  // D17 — apps and add-ons share one key namespace, and these keys shadow a
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

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, manifest };
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
