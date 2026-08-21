#!/usr/bin/env node
/**
 * Re-vendor `src/testing/manifest/` from the Adminium product checkout.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * `src/testing/manifest/` is a verbatim copy of `packages/manifest` and the
 * part of `packages/add-on-contracts` it needs, taken because
 * `@adminium/manifest` is on no registry and this app must build from a clean
 * clone. `manifest.test.ts` already asks the sharp question — do the copy and
 * the original AGREE? — but there was nothing to ANSWER it with: the add-ons
 * one directory over have `sync-add-ons.sh` and the validator had no
 * equivalent, so the only repair for a drift report was a hand-copy nobody
 * had written down.
 *
 * That is how it drifted a schema behind the product: the manifest moved to
 * `frontends[]` and this copy still knew `frontend`, so seven cases failed
 * with no documented way to fix them.
 *
 * ── WHAT IT DOES, AND THE ONLY EDITS IT MAKES ──────────────────────────────
 * The copies differ from their sources in exactly three ways, and every one is
 * mechanical — which is why a script can own them and a human should not:
 *
 *   1. The SPDX line becomes a provenance header naming the source path.
 *   2. Relative specifiers lose `.js` for `.ts` (the copies are not built).
 *   3. `@adminium/add-on-contracts` becomes relative imports, split by where
 *      each symbol is actually defined — computed by scanning that package's
 *      exports, not hardcoded, so a symbol that MOVES is followed rather than
 *      silently mis-imported.
 *
 * Anything else is a refusal, not a guess: an import this script cannot place
 * inside the vendored set aborts the sync with the specifier named. A copy that
 * is subtly wrong is worse than one that is openly stale.
 *
 *   node scripts/sync-manifest-validator.mjs [--check]
 *
 * `--check` writes nothing and exits non-zero if any copy is out of date, which
 * is what CI wants.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const product = process.env.ADMINIUM_REPO ?? join(repo, '..', 'adminium');
const dest = join(repo, 'src', 'testing', 'manifest');
const check = process.argv.includes('--check');

if (!existsSync(product)) {
  console.info(
    `[sync-manifest-validator] no Adminium checkout at ${product}. Clone it beside this repo ` +
      'or set ADMINIUM_REPO. Nothing to do.',
  );
  process.exit(0);
}

/** source path (relative to the product) → vendored basename. */
const FILES = [
  ['packages/manifest/src/schema.ts', 'schema.ts'],
  ['packages/manifest/src/validate.ts', 'validate.ts'],
  ['packages/add-on-contracts/src/add-on-block.ts', 'add-on-block.ts'],
  ['packages/add-on-contracts/src/contracts.ts', 'contracts.ts'],
  ['packages/add-on-contracts/src/slots.ts', 'slots.ts'],
];
const VENDORED = new Set(FILES.map(([, base]) => base));

/**
 * Every module specifier in a source, in all three forms that resolve one.
 *
 * `from "x"` was the only one this script used to look at. An ES module reaches
 * outside itself three ways, and the other two - a side-effect import with no
 * bindings, and a dynamic import() - are exactly the ones a reader skims past.
 */
function specifiersIn(text) {
  const out = [];
  const patterns = [
    /(?:^|[^\w$.])(?:import|export)\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|[^\w$.])import\s*['"]([^'"]+)['"]/g,
    /(?:^|[^\w$.])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const [, spec] of text.matchAll(pattern)) out.push(spec);
  }
  return out;
}

/**
 * `symbol -> basename` for everything the add-on-contracts sources export.
 *
 * -- IT REFUSES A DUPLICATE, BECAUSE THE HEADER PROMISES IT FOLLOWS A MOVE --
 *
 * [Hardened 2026-08-20 by an adversarial pass.] This used to set() blindly, so
 * when two files exported the same name the LAST entry in FILES won and nothing
 * was said. That is exactly the case the header claims is handled - "a symbol
 * that MOVES is followed rather than silently mis-imported" - and it is the
 * commonest way a symbol moves in practice: the new home is added while a
 * deprecated alias is left behind in the old one. The copy would then import
 * from whichever file happened to come later in the list.
 *
 * It also reads `export { a, b as c }` lists, not just declarations. A symbol
 * this cannot place becomes a refusal downstream, which is the safe direction:
 * an openly failed sync beats a subtly wrong copy.
 */
function exportIndex() {
  const index = new Map();
  for (const [src, base] of FILES) {
    if (!src.includes('add-on-contracts')) continue;
    const text = readFileSync(join(product, src), 'utf8');
    const names = [];
    const declared =
      /^export\s+(?:declare\s+)?(?:const|let|var|function|type|interface|class|enum)\s+([A-Za-z0-9_$]+)/gm;
    for (const [, name] of text.matchAll(declared)) names.push(name);
    for (const [, list] of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
      for (const entry of list.split(',')) {
        const parts = entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
        const exported = (parts[parts.length - 1] ?? '').trim();
        if (exported !== '') names.push(exported);
      }
    }
    for (const name of names) {
      const already = index.get(name);
      if (already !== undefined && already !== base) {
        throw new Error(
          `"${name}" is exported by BOTH ${already} and ${base}. The vendored copy would ` +
            'import it from whichever came last in FILES, which is a guess. Resolve the ' +
            'duplicate in the product (or narrow FILES) before syncing.',
        );
      }
      index.set(name, base);
    }
  }
  return index;
}

/** A refusal is an ANSWER, not a crash: print it as one. */
function abort(error) {
  console.error(`\n\u2716 ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

let symbols;
try {
  symbols = exportIndex();
} catch (error) {
  abort(error);
}

function vendor(srcRel, base) {
  const text = readFileSync(join(product, srcRel), 'utf8');
  const header =
    `/*\n * VENDORED VERBATIM from ${srcRel}.\n` +
    ` * Never hand-edit this copy: change the monorepo package and re-run\n` +
    ` * \`node scripts/sync-manifest-validator.mjs\`.\n` +
    ` *\n` +
    ` * WHY A COPY. \`@adminium/manifest\` is not published to npm and this app is a\n` +
    ` * standalone repo that must build from a clean clone, so it cannot depend on\n` +
    ` * the monorepo. It lives under \`testing/\` because \`zod\` is a devDependency\n` +
    ` * here and a runtime dependency the host does not carry (24 D7) — nothing in\n` +
    ` * the shipped bundle's import graph may reach it, which sources.test.ts gates.\n` +
    ` *\n` +
    ` * The only edits are import specifiers: \`.js\` becomes \`.ts\`, and the\n` +
    ` * \`@adminium/add-on-contracts\` package import becomes relative ones.\n */`;

  let out = text.replace(/^\/\/ SPDX-License-Identifier:[^\n]*\n/, `${header}\n`);
  if (out === text) out = `${header}\n${text}`;

  // 3. The cross-package import, split by where each symbol is defined.
  out = out.replace(
    /import\s*\{([\s\S]*?)\}\s*from\s*['"]@adminium\/add-on-contracts['"];?/g,
    (_whole, names) => {
      const byFile = new Map();
      for (const raw of names.split(',')) {
        const spec = raw.trim();
        if (spec === '') continue;
        const bare = spec.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        const file = symbols.get(bare);
        if (file === undefined) {
          throw new Error(
            `cannot place "${bare}" (imported by ${srcRel}) inside the vendored set. ` +
              `Add the file that exports it to FILES in scripts/sync-manifest-validator.mjs.`,
          );
        }
        (byFile.get(file) ?? byFile.set(file, []).get(file)).push(spec);
      }
      return [...byFile.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([file, specs]) => `import { ${specs.join(', ')} } from './${file}';`)
        .join('\n');
    },
  );

  /*
   * 2. Relative specifiers are not built here, so they carry `.ts`.
   *
   * [Widened 2026-08-20.] This matched only `from "..."`, so a side-effect
   * import or a dynamic one kept its `.js` and resolved to a file that does
   * not exist in the copy. The backreference makes the quotes match.
   */
  out = out.replace(/(['"])(\.{1,2}\/[^'"]*?)\.js\1/g, '$1$2.ts$1');

  /*
   * AND EVERY SPECIFIER IS CHECKED, NOT JUST THE ONES WITH `from`.
   *
   * The same adversarial pass found that `import "./x.js"` and
   * `import("./x.js")` slipped past both refusal loops as well, so the script
   * emitted a copy it had promised to refuse and exited 0. This header says a
   * subtly wrong copy is worse than an openly stale one; this makes that true.
   */
  for (const spec of specifiersIn(out)) {
    if (spec.startsWith('.')) {
      const base = spec.replace(/^\.\//, '');
      if (!VENDORED.has(base)) {
        throw new Error(`${srcRel} imports "${spec}", which is not one of the vendored files.`);
      }
    } else if (spec !== 'zod') {
      throw new Error(`${srcRel} imports the package "${spec}", which this copy cannot carry.`);
    }
  }
  return out;
}

let stale = 0;
for (const [srcRel, base] of FILES) {
  let next;
  try {
    next = vendor(srcRel, base);
  } catch (error) {
    // The stack trace buries the specifier, which is the only thing a reader
    // of a failed sync actually needs.
    abort(error);
  }
  const path = join(dest, base);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (current === next) continue;
  stale += 1;
  if (check) {
    console.error(`✖ ${base} is out of date with ${srcRel}`);
  } else {
    writeFileSync(path, next);
    console.log(`↻ ${base}  ← ${srcRel}`);
  }
}

if (stale === 0) console.log('✓ the vendored validator matches the product.');
else if (check) {
  console.error('\nRun `node scripts/sync-manifest-validator.mjs` to re-vendor.');
  process.exit(1);
}
