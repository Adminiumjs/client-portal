#!/usr/bin/env node
/**
 * Re-vendor the Invoices & Receipts add-on's shapes into
 * `src/manifest/vendored/invoices-shapes.json`.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Five of this app's tables are BUILT ON the add-on's shapes (`invoice@1`,
 * `quote@1`): they spell out the shape's columns and rules beside their own,
 * and when the app is installed Adminium checks them against the add-on it
 * actually has, refusing a table that differs (`SHAPE_MISMATCH`). This app's
 * own CI cannot see that add-on — it is not on npm — so it checks the same
 * thing against a copy of the shapes kept here, and `manifest.test.ts` runs
 * the same conformance check Adminium runs.
 *
 * A copy drifts. `--check` compares it with the add-on's source and fails
 * when they differ; the copy records the add-on version it was taken from,
 * which is the version this app's manifest requires.
 *
 *   node scripts/sync-shapes.mjs [--check]
 *
 * The add-ons checkout is found beside this repo (`../add-ons`) or at
 * `ADD_ONS_REPO`. Without one there is nothing to compare, and it says so.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const addOns = process.env.ADD_ONS_REPO ?? join(repo, '..', 'add-ons');
const source = join(addOns, 'packages', 'invoices', 'manifest.json');
const dest = join(repo, 'src', 'manifest', 'vendored', 'invoices-shapes.json');
const check = process.argv.includes('--check');

if (!existsSync(source)) {
  console.info(`[sync-shapes] no add-ons checkout at ${addOns}. Clone it beside this repo or set ADD_ONS_REPO. Nothing to compare.`);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(source, 'utf8'));
const shapes = manifest.addOn?.shapes;
if (!Array.isArray(shapes) || shapes.length === 0) {
  console.error(`✖ ${source} defines no shapes.`);
  process.exit(1);
}
const next = `${JSON.stringify({ addOn: manifest.key, version: manifest.version, shapes }, null, 2)}\n`;
const current = existsSync(dest) ? readFileSync(dest, 'utf8') : null;

if (current === next) {
  console.log(`✓ the vendored shapes match ${manifest.key} ${manifest.version}.`);
} else if (check) {
  console.error(`✖ src/manifest/vendored/invoices-shapes.json is out of date with ${manifest.key} ${manifest.version}. Run node scripts/sync-shapes.mjs.`);
  process.exit(1);
} else {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, next);
  console.log(`↻ src/manifest/vendored/invoices-shapes.json ← ${manifest.key} ${manifest.version}`);
}
