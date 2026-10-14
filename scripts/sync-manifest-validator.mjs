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
 * Which files are copied is computed too (see "THE FILE LIST" below).
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
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
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

/*
 * ── THE FILE LIST IS COMPUTED, NOT WRITTEN DOWN ─────────────────────────────
 * [Changed 2026-10-11.] This script used to carry a hand-kept list of the
 * files to copy. The product's `schema.ts` kept being split into new modules,
 * the list was never told, and by 0.3.26 `--check` aborted in all fifteen app
 * repos on the first import it could not place. Two versions of the list
 * existed, both behind.
 *
 * So the list is now the import graph itself: start at the two modules the
 * suite uses, follow every relative import inside `packages/manifest/src`, and
 * follow each `@adminium/add-on-contracts` import to the file that defines the
 * symbol and on through that package's own relative imports. A module the
 * product adds tomorrow is copied tomorrow, with no edit here.
 */
const MANIFEST_SRC = 'packages/manifest/src';
const CONTRACTS_SRC = 'packages/add-on-contracts/src';
const CONTRACTS_PACKAGE = '@adminium/add-on-contracts';
/** Where the walk starts. `index.ts` beside the copies re-exports from these. */
const ROOTS = ['schema.ts', 'validate.ts'];
/** Hand-written beside the copies; never a copy itself. */
const NOT_A_COPY = new Set(['index.ts']);

/**
 * Every module specifier in a source, in all three forms that resolve one.
 *
 * `from "x"` was the only one this script used to look at. An ES module reaches
 * outside itself three ways, and the other two - a side-effect import with no
 * bindings, and a dynamic import() - are exactly the ones a reader skims past.
 */
function specifiersIn(text) {
  const out = [];
  /*
   * A keyword that directly follows a quote is the inside of a string, not a
   * statement. [Added 2026-10-12.] `['export', 'import'] as const` in the
   * product's `roles.ts` read as a side-effect import whose "specifier" ran to
   * the next quote in the file, and the sync refused a package of that name.
   */
  const patterns = [
    /(?:^|[^\w$.'"`])(?:import|export)\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|[^\w$.'"`])import\s*['"]([^'"]+)['"]/g,
    /(?:^|[^\w$.'"`])import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const [, spec] of text.matchAll(pattern)) out.push(spec);
  }
  return out;
}

/** `import { a, type b as c } from '<package>'`, with or without a leading `type`. */
const PACKAGE_IMPORT = new RegExp(
  `import\\s+(type\\s+)?\\{([\\s\\S]*?)\\}\\s*from\\s*['"]${CONTRACTS_PACKAGE}['"];?`,
  'g',
);

/** The bare names an import list brings in: `type X as Y` gives `X`. */
function importedNames(list) {
  const out = [];
  for (const raw of list.split(',')) {
    const spec = raw.trim();
    if (spec === '') continue;
    out.push({ spec, bare: spec.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim() });
  }
  return out;
}

/**
 * `symbol -> file` for everything the add-on-contracts sources DEFINE.
 *
 * -- A DUPLICATE IS REFUSED WHEN IT IS ASKED FOR ----------------------------
 * [Hardened 2026-08-20 by an adversarial pass.] When two files export the same
 * name, the copy would import it from whichever was read last, which is a
 * guess. Every top-level file of the package is scanned now, so two unrelated
 * files may share a name nobody here imports: the refusal is raised at the
 * import that needs the name, not at the scan.
 *
 * It also reads `export { a, b as c }` lists, not just declarations. A RE-export
 * (`export { a } from './b.js'`) is skipped: it names the symbol's home rather
 * than being one, and that home is scanned in its own right.
 */
function exportIndex() {
  const index = new Map();
  const dir = join(product, CONTRACTS_SRC);
  for (const base of readdirSync(dir).sort()) {
    if (!base.endsWith('.ts') || base.endsWith('.test.ts') || base === 'index.ts') continue;
    const text = readFileSync(join(dir, base), 'utf8');
    const names = [];
    const declared =
      /^export\s+(?:declare\s+)?(?:const|let|var|function|type|interface|class|enum)\s+([A-Za-z0-9_$]+)/gm;
    for (const [, name] of text.matchAll(declared)) names.push(name);
    for (const [, list] of text.matchAll(/^export\s*\{([^}]*)\}(?!\s*from\b)/gm)) {
      for (const entry of list.split(',')) {
        const parts = entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
        const exported = (parts[parts.length - 1] ?? '').trim();
        if (exported !== '') names.push(exported);
      }
    }
    for (const name of names) {
      const homes = index.get(name) ?? index.set(name, new Set()).get(name);
      homes.add(base);
    }
  }
  return index;
}

/** The one file that defines a contracts symbol, or a refusal that names it. */
function homeOf(symbols, bare, srcRel) {
  const homes = symbols.get(bare);
  if (homes === undefined) {
    throw new Error(
      `cannot place "${bare}" (imported by ${srcRel}): no top-level file of ${CONTRACTS_SRC} defines it.`,
    );
  }
  if (homes.size > 1) {
    throw new Error(
      `"${bare}" (imported by ${srcRel}) is exported by ${[...homes].join(' AND ')}. Picking one ` +
        'would be a guess. Resolve the duplicate in the product before syncing.',
    );
  }
  return [...homes][0];
}

/**
 * The files to copy: `[source path relative to the product, vendored basename]`.
 *
 * The copies sit in one flat directory, and the two packages each have a
 * `steps.ts`. A contracts file whose name a manifest file already has is
 * written as `add-on-<name>`; `renamed` carries that for the import rewrite.
 */
function fileSet(symbols) {
  const manifest = new Set();
  const contracts = new Set();
  const visit = (pkg, base) => {
    const set = pkg === MANIFEST_SRC ? manifest : contracts;
    if (set.has(base)) return;
    const path = join(product, pkg, base);
    if (!existsSync(path)) throw new Error(`${pkg}/${base} is imported and does not exist.`);
    set.add(base);
    const text = readFileSync(path, 'utf8');
    for (const spec of specifiersIn(text)) {
      if (spec.startsWith('./')) visit(pkg, spec.slice(2).replace(/\.js$/, '.ts'));
    }
    for (const [, , list] of text.matchAll(PACKAGE_IMPORT)) {
      for (const { bare } of importedNames(list)) {
        visit(CONTRACTS_SRC, homeOf(symbols, bare, `${pkg}/${base}`));
      }
    }
  };
  for (const root of ROOTS) visit(MANIFEST_SRC, root);
  // A copy an earlier sync wrote stays in step even when the roots stopped reaching it.
  if (existsSync(dest)) {
    for (const base of readdirSync(dest)) {
      if (NOT_A_COPY.has(base) || !base.endsWith('.ts')) continue;
      if (existsSync(join(product, MANIFEST_SRC, base))) visit(MANIFEST_SRC, base);
    }
  }
  const renamed = new Map();
  const files = [...manifest].sort().map((base) => [`${MANIFEST_SRC}/${base}`, base]);
  for (const base of [...contracts].sort()) {
    const as = manifest.has(base) ? `add-on-${base}` : base;
    if (manifest.has(as)) throw new Error(`no free name for ${CONTRACTS_SRC}/${base}.`);
    if (as !== base) renamed.set(base, as);
    files.push([`${CONTRACTS_SRC}/${base}`, as]);
  }
  return { files, renamed };
}

/** A refusal is an ANSWER, not a crash: print it as one. */
function abort(error) {
  console.error(`\n\u2716 ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

let symbols;
let FILES;
let RENAMED;
try {
  symbols = exportIndex();
  ({ files: FILES, renamed: RENAMED } = fileSet(symbols));
} catch (error) {
  abort(error);
}
const VENDORED = new Set(FILES.map(([, base]) => base));

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
    ` * here and a runtime dependency the host does not carry — nothing in\n` +
    ` * the shipped bundle's import graph may reach it, which sources.test.ts gates.\n` +
    ` *\n` +
    ` * The only edits are import specifiers: \`.js\` becomes \`.ts\`, and the\n` +
    ` * \`@adminium/add-on-contracts\` package import becomes relative ones.\n */`;

  let out = text.replace(/^\/\/ SPDX-License-Identifier:[^\n]*\n/, `${header}\n`);
  if (out === text) out = `${header}\n${text}`;

  // 3. The cross-package import, split by where each symbol is defined.
  const fromContracts = srcRel.startsWith(CONTRACTS_SRC);
  out = out.replace(PACKAGE_IMPORT, (_whole, typeOnly, names) => {
    const byFile = new Map();
    for (const { spec, bare } of importedNames(names)) {
      const home = homeOf(symbols, bare, srcRel);
      const file = RENAMED.get(home) ?? home;
      (byFile.get(file) ?? byFile.set(file, []).get(file)).push(spec);
    }
    const keyword = typeOnly === undefined ? 'import' : 'import type';
    return [...byFile.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, specs]) => `${keyword} { ${specs.join(', ')} } from './${file}';`)
      .join('\n');
  });
  // A contracts file's own neighbour, when that neighbour was written under another name.
  if (fromContracts) {
    for (const [from, to] of RENAMED) {
      const js = from.replace(/\.ts$/, '.js');
      out = out.split(`'./${js}'`).join(`'./${to.replace(/\.ts$/, '.js')}'`);
    }
  }

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
