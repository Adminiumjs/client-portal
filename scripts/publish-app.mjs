// SPDX-License-Identifier: AGPL-3.0-only
//
// publish-app.mjs — publish this app's built surfaces as `@adminiumjs/app-<key>`
// and record what was published (47-app-installation.md §5, 4c).
//
// VENDORED. The canonical copy is `workplan/tools/app-release/publish-app.mjs`
// in the Adminium monorepo; `app-release.sh sync` copies it into every app repo.
// Edit it there, never here.
//
// ─── Why the package is staged rather than published from the repo root ──────
//
// This repo's root is its SOURCE — src/, db/, node_modules, the demo seed. What
// Adminium installs is `manifest.json` plus the built `dist-surface/<key>/<side>`
// directories, which the install path expects to find at `staff/` and
// `customer/` once npm's `package/` prefix is stripped. Staging produces exactly
// that and nothing else, so the published tarball cannot drift from what the
// server unpacks, and no `files` field here has to stay in step with a layout it
// does not own.
//
// ─── The ledger is the point of the second half ──────────────────────────────
//
// `RELEASES.json` records `{name, version, integrity}` for every publish. The
// marketplace feed cross-checks its rows against BOTH this ledger and the
// registry and fails its build on any disagreement, so a feed can never
// advertise bytes npm does not serve. The ledger therefore has to be committed
// and tagged — readable at a pinned SHA — rather than left as a build artifact.
//
// Usage:
//   node scripts/publish-app.mjs --dry-run   pack + X-ray; publishes nothing
//   node scripts/publish-app.mjs             publish, then write RELEASES.json
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const root = resolve('.');

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const { key, version, kind } = manifest;
if (kind !== 'app') throw new Error(`manifest.json declares kind "${String(kind)}" — this publishes apps`);
if (typeof key !== 'string' || typeof version !== 'string') throw new Error('manifest.json has no key/version');

const built = join(root, 'dist-surface', key);
const sides = ['staff', 'customer'].filter((side) => existsSync(join(built, side, 'index.html')));
if (sides.length === 0) {
  throw new Error(`no built surface under ${built} — run \`npm run build:surface\` first`);
}

const name = `@adminiumjs/app-${key}`;
const staging = mkdtempSync(join(tmpdir(), `app-publish-${key}-`));
let integrity;
try {
  writeFileSync(
    join(staging, 'package.json'),
    `${JSON.stringify(
      {
        name,
        version,
        description: manifest.description?.fallback ?? `Built surfaces for the ${key} app.`,
        license: manifest.license ?? 'AGPL-3.0-only',
        files: ['manifest.json', ...sides],
      },
      null,
      2,
    )}\n`,
  );
  cpSync(join(root, 'manifest.json'), join(staging, 'manifest.json'));
  for (const side of sides) cpSync(join(built, side), join(staging, side), { recursive: true });

  // X-RAY BEFORE UPLOADING ANYTHING. A published version is immutable, so a
  // defect found after the upload is on the registry forever.
  execFileSync('npm', ['pack', '--pack-destination', staging], { cwd: staging, stdio: 'pipe' });
  const packed = readdirSync(staging).find((f) => f.endsWith('.tgz'));
  if (packed === undefined) throw new Error('npm pack produced no tarball');
  const bytes = readFileSync(join(staging, packed));
  integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

  const listed = execFileSync('tar', ['-tzf', join(staging, packed)], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const stray = listed.filter(
    (p) => !/^package\/(manifest\.json|package\.json|staff\/|customer\/)/.test(p),
  );
  if (stray.length > 0) {
    throw new Error(`tarball carries files outside the surface set:\n  ${stray.join('\n  ')}`);
  }

  console.log(`${name}@${version}`);
  console.log(`  sides:     ${sides.join(', ')}`);
  console.log(`  entries:   ${listed.length}`);
  console.log(`  bytes:     ${bytes.length}`);
  console.log(`  integrity: ${integrity}`);

  if (dryRun) {
    console.log('\n--dry-run: nothing published.');
    process.exit(0);
  }

  // No NODE_AUTH_TOKEN: npm authenticates with the workflow's OIDC token and
  // generates provenance automatically on that path.
  execFileSync('npm', ['publish', join(staging, packed), '--access', 'public'], { stdio: 'inherit' });
} finally {
  rmSync(staging, { recursive: true, force: true });
}

const ledgerPath = join(root, 'RELEASES.json');
const ledger = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
  : { schemaVersion: 1, releases: [] };
ledger.releases = [
  ...ledger.releases.filter((r) => r.version !== version),
  { name, version, integrity, publishedAt: new Date().toISOString() },
].sort((a, b) => a.version.localeCompare(b.version));
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`\nledger updated: ${ledgerPath}`);
