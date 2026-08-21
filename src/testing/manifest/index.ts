/**
 * The vendored `@adminium/manifest` surface this repo's suite uses.
 *
 * The five modules beside this one are verbatim copies of the monorepo's
 * `packages/manifest` and `packages/add-on-contracts` sources — see the header
 * each carries, and `scripts/sync-manifest-validator.mjs`, which writes them.
 * Never hand-edit one: run that script, or `--check` it in CI.
 *
 * WHY A COPY. `@adminium/manifest` is not published to npm and this app is a
 * standalone repo that must build from a clean clone, so it cannot depend on
 * the monorepo. It lives under `testing/` because `zod` is a devDependency
 * here and a runtime dependency the app does not carry — nothing in the
 * shipped bundle's import graph may reach it, which `manifest.test.ts` gates
 * for itself rather than relying on a suite this repo does not have.
 */

export {
  FIRST_PARTY_PUBLISHER_ID,
  MANIFEST_CAPABILITIES,
  MANIFEST_CATEGORIES,
  MANIFEST_KINDS,
  MANIFEST_VERSION,
  RESERVED_KEYS,
  appManifestSchema,
  isAddOnManifest,
  manifestSchema,
  type AppManifest,
  type Manifest,
} from "./schema.ts";
export {
  validateManifest,
  type ManifestIssue,
  type ValidateManifestResult,
} from "./validate.ts";
