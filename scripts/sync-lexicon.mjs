#!/usr/bin/env node
/**
 * Copy the release sweep's word list into `src/testing/lexicon.ts`.
 *
 * The list lives in the add-ons repo's host kit
 * (`packages/host-kit/src/guards/lexicon.ts`), beside guards for apps that host
 * add-on slots. This app hosts none, so it takes the list alone — the banned
 * substrings, the ideas in each language and the homographs allowed — and
 * `manifest-lexicon.test.ts` holds every word the manifest ships to it.
 *
 * `--check` fails when the copy differs from the kit; with no add-ons checkout
 * beside this repo (or at `ADD_ONS_REPO`) there is nothing to compare, and it
 * says so.
 *
 *   node scripts/sync-lexicon.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const addOns = process.env.ADD_ONS_REPO ?? join(repo, '..', 'add-ons');
const source = join(addOns, 'packages', 'host-kit', 'src', 'guards', 'lexicon.ts');
const dest = join(repo, 'src', 'testing', 'lexicon.ts');
const check = process.argv.includes('--check');

if (!existsSync(source)) {
  console.info(`[sync-lexicon] no add-ons checkout at ${addOns}. Clone it beside this repo or set ADD_ONS_REPO. Nothing to compare.`);
  process.exit(0);
}

const text = readFileSync(source, 'utf8');
const start = text.indexOf('export const SUBSTRING_BANNED');
const endMarker = 'export const TIERING_PATTERNS';
const endLine = text.indexOf('\n', text.indexOf(endMarker));
if (start < 0 || endLine < 0 || endLine < start) {
  console.error(`✖ ${source} no longer has the word list between SUBSTRING_BANNED and TIERING_PATTERNS.`);
  process.exit(1);
}
const header = `/*
 * COPIED from add-ons/packages/host-kit/src/guards/lexicon.ts by scripts/sync-lexicon.mjs.
 * Never hand-edit: change the kit and re-run the script. Tests only; nothing that ships imports it.
 */
`;
const next = `${header}${text.slice(start, endLine + 1)}`;
const current = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
if (current === next) {
  console.log('✓ src/testing/lexicon.ts matches the host kit.');
} else if (check) {
  console.error('✖ src/testing/lexicon.ts is out of date with the host kit. Run node scripts/sync-lexicon.mjs.');
  process.exit(1);
} else {
  writeFileSync(dest, next);
  console.log('↻ src/testing/lexicon.ts ← host-kit/src/guards/lexicon.ts');
}
