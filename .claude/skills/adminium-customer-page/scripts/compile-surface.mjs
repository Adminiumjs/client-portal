#!/usr/bin/env node
/**
 * The skill's mandatory first action.
 *
 * Reads the repo's `manifest.json` and prints what a page may actually use:
 * the sides, the resources, their columns and the row types. It STOPS if the
 * manifest does not validate, because every line written after that point is a
 * guess about a schema nobody has seen.
 *
 * It needs no network and no running Adminium — the manifest is the contract,
 * and checking it offline is the whole point.
 *
 *   node scripts/compile-surface.mjs [path/to/repo]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repo = resolve(process.argv[2] ?? process.cwd());
const manifestPath = join(repo, 'manifest.json');

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

if (!existsSync(manifestPath)) {
  fail(
    `no manifest.json in ${repo}\n\n` +
      '  This does not look like an Adminium micro-SaaS repo. Run the script from the app\n' +
      '  repo, or pass its path.',
  );
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  fail(`manifest.json is not valid JSON: ${error.message}`);
}

/*
 * The real validator when it can be reached, a structural check when it cannot.
 *
 * `@adminiumjs/manifest` on npm currently predates the `frontends[]` schema, so
 * a version check is not enough — resolve it only if the caller has it, and
 * otherwise assert the shape this skill depends on. Being explicit about which
 * of the two ran matters: a structural pass is weaker and should not read as a
 * full validation.
 */
let validate = null;
try {
  ({ validateManifest: validate } = await import('@adminiumjs/manifest'));
} catch {
  /* not installed — fall through to the structural check */
}

const problems = [];
if (validate !== null) {
  const result = validate(manifest);
  if (!result.ok) {
    for (const issue of result.issues.slice(0, 12)) {
      problems.push(`${issue.path ?? issue.code ?? '?'}: ${issue.message ?? ''}`);
    }
    if (result.issues.length > 12) problems.push(`…and ${result.issues.length - 12} more`);
  }
} else {
  if (manifest.kind !== 'app') problems.push('kind is not "app"');
  if (!Array.isArray(manifest.frontends) || manifest.frontends.length === 0) {
    problems.push('no frontends[] — this app declares neither a staff nor a customer side');
  }
  if (!Array.isArray(manifest.requiredSchema?.tables)) {
    problems.push('requiredSchema.tables is not an array');
  }
  if (!Array.isArray(manifest.pages) || manifest.pages.length === 0) {
    problems.push('no pages[] — this is a contract manifest, not an installable app');
  }
}

if (problems.length > 0) {
  console.error(`\n✖ ${manifest.key ?? 'this manifest'} does not validate:\n`);
  for (const p of problems) console.error(`   · ${p}`);
  console.error(
    '\n  STOP HERE. Fix the manifest before writing any page code — everything you would\n' +
      '  write next is a guess about a schema that has not been agreed.\n' +
      (validate === null
        ? '\n  (Structural check only — `@adminiumjs/manifest` is not installed here.)\n'
        : '\n'),
  );
  process.exit(1);
}

const TYPE_TO_TS = {
  id: 'string | number', text: 'string', int: 'number', bigint: 'string',
  decimal: 'string', money: 'string', float: 'number', bool: 'boolean',
  enum: 'string', json: 'unknown', date: 'string', timestamptz: 'string',
  uuid: 'string', fk: 'string | number', blob: 'string',
};

console.log(`\n${manifest.name ?? manifest.key}  (${manifest.key})`);
console.log('─'.repeat(64));

console.log('\nSIDES');
for (const f of manifest.frontends) {
  const routes = Object.keys(f.routes ?? {});
  console.log(`  ${f.side.padEnd(9)} ${f.kind}${routes.length > 0 ? `  routes: ${routes.join(', ')}` : ''}`);
}
console.log('  dashboard  (mandatory — comes from Adminium, never built here)');

console.log('\nTABLES the manifest declares');
for (const t of manifest.requiredSchema.tables) {
  console.log(`\n  ${t.ref}`);
  for (const c of t.columns) {
    const bits = [c.type];
    if (c.semantic) bits.push(c.semantic);
    if (c.role) bits.push(c.role);
    if (c.nullable) bits.push('nullable');
    if (c.references) bits.push(`→ ${c.references}`);
    console.log(`    ${c.ref.padEnd(22)} ${bits.join(' · ')}`);
  }
}

console.log('\nROW TYPES (what a public read would give you)');
for (const t of manifest.requiredSchema.tables) {
  const name = t.ref.replace(/(^|_)([a-z])/g, (_, __, ch) => ch.toUpperCase()).replace(/s$/, '');
  console.log(`\n  interface ${name}Row {`);
  for (const c of t.columns) {
    const ts = TYPE_TO_TS[c.type] ?? 'unknown';
    console.log(`    ${c.ref}${c.nullable ? '?' : ''}: ${ts}${c.nullable ? ' | null' : ''};`);
  }
  console.log('  }');
}

console.log(
  '\n─'.repeat(1) +
    '─'.repeat(63) +
    '\nNOTE: the manifest says what the app NEEDS. What a key may actually reach is the\n' +
    "operator's scope, which is narrower and is authored in Studio → Public API. Fetch\n" +
    '/api/v1/public/config at boot and fail loudly if a ref you need is missing.\n',
);
