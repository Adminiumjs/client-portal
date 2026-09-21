/*
 * SYNCED FILE — source: adminium/workplan/tools/manifest-gate/manifest-pages.test.ts
 *
 * NOT installed by `apply.sh`: it fails a repo whose manifest pages are
 * unbound, so a repo gets it once every page there is bound. As of 2026-09-21
 * that is every app repo that declares pages. The shared ci.yml detects the
 * file and builds the engine it needs.
 */
/**
 * Every page this app declares can be built from this app's own tables.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * A manifest declares pages (a calendar, a list of services) and the tables
 * they read. Adminium builds those pages when the app is installed — and a page
 * with no `bindings`, or bound to a table that cannot back its template, is
 * created EMPTY: the install still succeeds, and the operator meets a page that
 * says it has no table. That is the right behaviour for an app already released;
 * it is the wrong thing to publish on purpose.
 *
 * So this runs the product's own check (`checkManifestPages`, the same fit the
 * Studio create screen uses) over this manifest, and refuses a release that
 * would ship an unbound, unknown or unfit page.
 *
 * ── WHERE THE CHECK COMES FROM ─────────────────────────────────────────────
 * The product's built `@adminium/engine`, loaded by path from a sibling
 * checkout — the same arrangement `manifest.test.ts` uses for the validator,
 * and the same CI step that checks the product out and builds it. A developer
 * with no product beside this repo sees the block skipped and told why; CI sets
 * `ADMINIUM_REQUIRE_VALIDATOR`, which turns the skip into a failure.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import manifest from "../manifest.json";

const PRODUCT_ROOT =
  process.env.ADMINIUM_REPO || fileURLToPath(new URL("../../adminium", import.meta.url));
const REAL_ENGINE = join(PRODUCT_ROOT, "packages", "engine", "dist", "index.js");
const available = existsSync(REAL_ENGINE);

/** CI sets this beside the product checkout; see .github/workflows/ci.yml. */
const REQUIRED = process.env.ADMINIUM_REQUIRE_VALIDATOR === "true";

interface PageIssue {
  page: string;
  code: string;
  message: string;
}

interface RealEngine {
  checkManifestPages: (manifest: unknown) => PageIssue[];
  pageSourceTable: (page: { ref: string; template: string; bindings?: Record<string, string> }) => string | null;
  isTableBoundTemplate: (template: string) => boolean;
}

if (!available) {
  console.info(
    `[manifest-pages] this app's pages were not checked against its tables: nothing at ` +
      `${REAL_ENGINE}. Clone the Adminium product beside this repo (or point ADMINIUM_REPO ` +
      "at it) and build packages/engine.",
  );
}

const loadEngine = async (): Promise<RealEngine> =>
  (await import(/* @vite-ignore */ pathToFileURL(REAL_ENGINE).href)) as RealEngine;

it.skipIf(!REQUIRED)("has the product engine that CI promised", () => {
  expect(
    available,
    `ADMINIUM_REQUIRE_VALIDATOR is set, so the product's engine must be built, and nothing ` +
      `is at ${REAL_ENGINE}. The checkout or build step did not run.`,
  ).toBe(true);
});

describe.skipIf(!available)("every page this app declares can be built from its own tables", () => {
  it("has no unbound, unknown or unfit page", async () => {
    const { checkManifestPages } = await loadEngine();
    // Each line names the page and says what is wrong, in the product's words.
    expect(checkManifestPages(manifest).map((issue) => `${issue.page}: ${issue.message}`)).toEqual([]);
  });

  it("binds every page it declares to a table it declares", async () => {
    // The control for the test above: a manifest whose pages were all
    // dropped would pass it vacuously.
    // A dashboard or a builder reads no single table; the product says which do.
    const { pageSourceTable, isTableBoundTemplate } = await loadEngine();
    const tables = new Set(manifest.requiredSchema.tables.map((table) => table.ref));
    const bound = manifest.pages.filter((page) => isTableBoundTemplate(page.template));
    expect(bound.length).toBeGreaterThan(0);
    for (const page of bound) {
      const table = pageSourceTable(page as Parameters<RealEngine["pageSourceTable"]>[0]);
      expect(table, `${page.ref} names no table`).not.toBeNull();
      expect(tables.has(table as string), `${page.ref} → ${String(table)}`).toBe(true);
    }
  });
});
