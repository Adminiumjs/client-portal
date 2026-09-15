// SPDX-License-Identifier: AGPL-3.0-only
//
// publish-app.mjs — put this app's built surfaces in the downloads bucket and
// record what was released (48-self-hosted-downloads.md D5/D6; 47-app-installation.md §5, 4c).
//
// VENDORED. The canonical copy is `workplan/tools/app-release/publish-app.mjs`
// in the Adminium monorepo; `app-release.sh sync` copies it into every app repo
// beside `r2.mjs`. Edit them there, never here.
//
// ─── Why the package is staged rather than packed from the repo root ─────────
//
// This repo's root is its SOURCE — src/, db/, node_modules, the demo seed. What
// Adminium installs is `manifest.json` plus the built `dist-surface/<key>/<side>`
// directories, which the install path expects to find at `staff/` and
// `customer/` once the archive's `package/` prefix is stripped. Staging produces
// exactly that and nothing else, so the released file cannot drift from what the
// server unpacks, and no `files` field here has to stay in step with a layout it
// does not own.
//
// ─── The ledger is the point of the second half ──────────────────────────────
//
// `RELEASES.json` records `{name, version, integrity, publishedAt}` for every
// release. The marketplace catalog carries that integrity to every server, and a
// server keeps a download only if its bytes hash to it (48 D3) — so a row may
// exist only for bytes the public address really serves. It is committed and
// tagged, readable at a pinned SHA, rather than left as a build artifact.
//
// Usage:
//   node scripts/publish-app.mjs --dry-run   pack + X-ray; uploads nothing, needs no credentials
//   node scripts/publish-app.mjs             upload, read back, then write RELEASES.json
//
// Both read the newest published @adminiumjs/adminium from the npm registry
// first, and refuse a manifest whose compatibility.minAdminiumVersion is newer.
//
// A real run needs R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and
// R2_SECRET_ACCESS_KEY; release.yml maps them from the Adminiumjs organization.
//
// RE-RUNNING IS THE RECOVERY. The bucket never replaces a file. A rerun that
// packs the same bytes finds them already there and finishes the read-back and
// the ledger; a rerun that packs DIFFERENT bytes stops, because that version
// number is burned — release the next patch. There is no retraction either: a
// released file stays in the bucket for good, and the next patch supersedes it.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { assertMinimumReleased, newestAdminium, objectKeyFor, publishObject, r2ConfigFromEnv } from './r2.mjs';

const known = new Set(['--dry-run']);
const unknown = process.argv.slice(2).filter((arg) => !known.has(arg));
if (unknown.length > 0) {
  // `--tag` and `--record` belonged to the npm pipeline. Refuse them by name
  // rather than ignore them: an ignored flag reads as one that took effect.
  throw new Error(`unknown argument(s): ${unknown.join(' ')} — the only flag is --dry-run`);
}
const dryRun = process.argv.includes('--dry-run');
const root = resolve('.');

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const { key, version, kind } = manifest;
if (kind !== 'app') throw new Error(`manifest.json declares kind "${String(kind)}" — this releases apps`);
if (typeof key !== 'string' || typeof version !== 'string') throw new Error('manifest.json has no key/version');
// Before any packing: a missing credential should cost nothing, and a bad key or
// version must not get as far as a bucket path.
const objectKey = objectKeyFor({ kind: 'app', key, version });
const config = dryRun ? undefined : r2ConfigFromEnv(process.env);
if (config?.test) console.log(`TEST ENDPOINTS — bucket ${config.endpoint}, read-back ${config.publicBase}`);
// A minimum no published Adminium meets would sit in the released file forever
// (48 A17). Checked in a dry run too, so a rehearsal says what the release would.
const newest = await newestAdminium();
const minimum = assertMinimumReleased(manifest, newest);
console.log(`${key}@${version} needs Adminium ${minimum}; the newest published is ${newest}`);

const built = join(root, 'dist-surface', key);
const sides = ['staff', 'customer'].filter((side) => existsSync(join(built, side, 'index.html')));
if (sides.length === 0) {
  throw new Error(`no built surface under ${built} — run \`npm run build:surface\` first`);
}

// ─── The build must BE the committed source ──────────────────────────────────
//
// A released version is immutable, so the one thing this script must never do
// is pack a build that is not the code in git. It did: `app-clinic@0.1.0` went
// out from a dist-surface built on Aug 28 while 54 shipped files (+9,580 lines)
// had been committed since, because nothing here compared the two — the build
// merely had to EXIST. Two refusals close that:
//
//   DIRTY — uncommitted changes to anything that can reach the bundle mean the
//           build may contain code no commit holds.
//   STALE — a build older than the newest commit touching those paths is, by
//           construction, not that commit.
//
// The path filter is an EXCLUSION list on purpose. Leaving out a path that
// does not ship only costs a needless rebuild; leaving out one that DOES ship
// is the clinic bug again. So everything counts except what provably cannot
// reach the bundle. Under Actions both pass on their own: the checkout is
// clean and the workflow builds after it.
const NOT_SHIPPED = [
  ':!RELEASES.json', ':!.github', ':!.claude', ':!*.md', ':!scripts',
  ':!src/testing', ':!**/*.test.ts', ':!**/*.test.tsx', ':!dist-surface', ':!dist',
];
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const dirty = git('status', '--porcelain', '--', '.', ...NOT_SHIPPED);
if (dirty !== '') {
  throw new Error(
    `uncommitted changes can reach the bundle — commit them, rebuild, then release:\n${dirty
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n')}`,
  );
}
const lastCommit = Number(git('log', '-1', '--format=%ct', '--', '.', ...NOT_SHIPPED) || '0');
const oldestSide = Math.min(...sides.map((side) => statSync(join(built, side, 'index.html')).mtimeMs / 1000));
if (oldestSide < lastCommit) {
  const hours = Math.round((lastCommit - oldestSide) / 3600);
  throw new Error(
    `the build is STALE: dist-surface predates the last shipped-path commit by ~${hours}h.\n` +
      '  Run `npm run build:surface`, then release.',
  );
}

// The name is npm-shaped because `npm pack` needs one and the files copied from
// npm carry it (48 D8). Nothing resolves it on a registry any more; the ledger
// and the tarball's own package.json keep it so every row reads the same way.
const name = `@adminiumjs/app-${key}`;

// `repository` records where the file was built from. Under Actions,
// GITHUB_REPOSITORY is that repo; locally it is read from `origin`.
const repoSlug = (() => {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const origin = git('remote', 'get-url', 'origin');
  const m = origin.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (m === null) throw new Error(`origin is not a GitHub repository (${origin})`);
  return m[1];
})();
const staging = mkdtempSync(join(tmpdir(), `app-release-${key}-`));
let released;
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
        repository: { type: 'git', url: `git+https://github.com/${repoSlug}.git` },
        files: ['manifest.json', ...sides],
      },
      null,
      2,
    )}\n`,
  );
  cpSync(join(root, 'manifest.json'), join(staging, 'manifest.json'));
  for (const side of sides) cpSync(join(built, side), join(staging, side), { recursive: true });

  // X-RAY BEFORE UPLOADING ANYTHING. A released version is immutable, so a
  // defect found after the upload is in the bucket forever. `npm pack` is only
  // the local packer (48 D5): `archive.ts` reads exactly its tar shape, and
  // macOS `tar` output was already refused there.
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
  console.log(`  object:    ${objectKey}`);

  if (dryRun) {
    // NOT `process.exit(0)`: exiting here would skip the `finally` below and
    // leak the staging directory on every dry run (it did, three times, before
    // 2026-09-12). Fall through and let the block unwind normally instead.
    console.log('\n--dry-run: nothing uploaded.');
  } else {
    released = await publishObject({
      config,
      kind: 'app',
      key,
      version,
      bytes,
      log: (line) => console.log(`  ${line}`),
    });
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

// The ledger records real releases only.
if (dryRun) process.exit(0);

// `publishedAt` is the public host's own Last-Modified for the object, not the
// local clock: on a rerun that found the file already there, it is still the
// moment the file was first written.
const lastModified = released.lastModified === null ? Number.NaN : Date.parse(released.lastModified);
const publishedAt = Number.isNaN(lastModified) ? new Date().toISOString() : new Date(lastModified).toISOString();
console.log(`\n${released.url} serves this build (written ${publishedAt})`);

const ledgerPath = join(root, 'RELEASES.json');
const ledger = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
  : { schemaVersion: 1, releases: [] };
ledger.releases = [
  ...ledger.releases.filter((r) => r.version !== version),
  { name, version, integrity, publishedAt },
  // NUMERIC: a plain localeCompare is lexical and files 0.1.10 before 0.1.9.
].sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`ledger updated: ${ledgerPath}`);
