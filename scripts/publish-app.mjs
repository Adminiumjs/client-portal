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
//   node scripts/publish-app.mjs --tag next  publish under a dist-tag other than
//                                            `latest` (only needed to retract)
//   node scripts/publish-app.mjs --record    publish NOTHING; confirm the registry
//                                            serves this build's exact bytes, then
//                                            write the ledger (recovery, see below)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const recordOnly = process.argv.includes('--record');
const root = resolve('.');

// `--tag <name>` passes npm's dist-tag through. Normal releases never need it:
// each version is higher than the last, so npm applies `latest` implicitly.
//
// It exists for the one case where that implicit step is REFUSED — publishing a
// version LOWER than one already on the registry. npm stops with "Cannot
// implicitly apply the latest tag because previously published version X is
// higher", which is a guard against silently moving `latest` backwards, and it
// wants the intent stated. That happens when a release is being retracted:
// the replacement has to go up before the old version can come down (see
// `app-release.sh bootstrap` and 47 §5), and the replacement is the lower one.
//
// Publish it under a throwaway tag, unpublish the old version, then repoint
// `latest`. `npm dist-tag rm latest` is disallowed, so `latest` is MOVED with
// `npm dist-tag add <pkg>@<version> latest`, never removed.
const tagAt = process.argv.indexOf('--tag');
const distTag = tagAt === -1 ? undefined : process.argv[tagAt + 1];
if (tagAt !== -1 && (distTag === undefined || distTag.startsWith('--'))) {
  throw new Error('--tag needs a value, e.g. `--tag next`');
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const { key, version, kind } = manifest;
if (kind !== 'app') throw new Error(`manifest.json declares kind "${String(kind)}" — this publishes apps`);
if (typeof key !== 'string' || typeof version !== 'string') throw new Error('manifest.json has no key/version');

const built = join(root, 'dist-surface', key);
const sides = ['staff', 'customer'].filter((side) => existsSync(join(built, side, 'index.html')));
if (sides.length === 0) {
  throw new Error(`no built surface under ${built} — run \`npm run build:surface\` first`);
}

// ─── The build must BE the committed source ──────────────────────────────────
//
// A published version is immutable, so the one thing this script must never do
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
// clean and the workflow builds after it. `--record` skips this — it proves
// the local build matches the registry byte for byte instead.
const NOT_SHIPPED = [
  ':!RELEASES.json', ':!.github', ':!.claude', ':!*.md', ':!scripts',
  ':!src/testing', ':!**/*.test.ts', ':!**/*.test.tsx', ':!dist-surface', ':!dist',
];
if (!recordOnly) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const dirty = git('status', '--porcelain', '--', '.', ...NOT_SHIPPED);
  if (dirty !== '') {
    throw new Error(
      `uncommitted changes can reach the bundle — commit them, rebuild, then publish:\n${dirty
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
        '  Run `npm run build:surface`, then publish.',
    );
  }
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
    // NOT `process.exit(0)`: exiting here would skip the `finally` below and
    // leak the staging directory on every dry run (it did, three times, before
    // 2026-09-12). Fall through and let the block unwind normally instead.
    console.log('\n--dry-run: nothing published.');
  } else if (recordOnly) {
    console.log('\n--record: publishing nothing — asking the registry what it serves.');
  } else {
    // A dead npm session reports the publish as `404 Not Found - PUT`, because
    // the registry answers 404 rather than 401 for a scope you cannot write to
    // so that it does not leak whether the package exists. That error names the
    // package and says "or you do not have permission", which reads as "the
    // name is wrong" and sends you looking in entirely the wrong place. Ask
    // first, and say the true thing.
    //
    // Skipped under Actions: there is no logged-in session there, npm mints
    // credentials from the OIDC token at publish time, and `whoami` does not
    // describe that.
    if (process.env.GITHUB_ACTIONS === undefined) {
      try {
        execFileSync('npm', ['whoami'], { stdio: 'pipe' });
      } catch {
        throw new Error(
          'not logged in to npm — run `npm login` first.\n' +
            '  A stale ~/.npmrc token fails this way too: it is present, so npm tries,\n' +
            '  and the publish comes back as a 404 on the package name rather than a 401.',
        );
      }
    }

    // No NODE_AUTH_TOKEN: npm authenticates with the workflow's OIDC token and
    // generates provenance automatically on that path.
    execFileSync(
      'npm',
      [
        'publish',
        join(staging, packed),
        '--access',
        'public',
        ...(distTag === undefined ? [] : ['--tag', distTag]),
      ],
      { stdio: 'inherit' },
    );
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

// The ledger records real publishes only.
if (dryRun) process.exit(0);

// ─── The registry is the only receipt ────────────────────────────────────────
//
// `npm publish` exiting 0 does NOT mean the version exists. With an account
// under npm's 2FA-token restriction the registry can accept the upload into a
// STAGED state pending approval and still exit 0 — which is how `app-clinic`'s
// ledger was written two minutes before 0.1.0 was installable, and how every
// retry after that failed three different ways against a version that already
// existed. So no ledger row is written until the registry itself serves this
// version with THIS build's integrity: that is the same cross-check the
// marketplace feed runs, performed before the row exists instead of after.
//
// Polls because the read path lags the write (135 s and 210 s measured on
// first publishes). Plain fetch rather than `npm view`, which would write a
// debug log per poll and rotate out the one log that explains a failure.
// `publishedAt` is the registry's own `time[version]`, not the local clock —
// the local clock is when the upload was ACCEPTED, which staging proved can be
// minutes before the version was real.
const WAIT_MS = 8 * 60 * 1000;
const served = await (async () => {
  const url = `https://registry.npmjs.org/${name.replace('/', '%2f')}`;
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    let doc;
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', 'cache-control': 'no-cache' } });
      if (res.ok) doc = await res.json();
    } catch {
      // a network blip is not an answer; keep asking until the deadline
    }
    const got = doc?.versions?.[version]?.dist?.integrity;
    if (got !== undefined) {
      if (got !== integrity) {
        throw new Error(
          `the registry serves ${name}@${version} as ${got},\n  but this build packs to ${integrity}.\n` +
            '  Refusing to write a ledger row for bytes that differ from what is published.',
        );
      }
      return { publishedAt: doc.time?.[version] ?? new Date().toISOString() };
    }
    if (Date.now() >= deadline) {
      throw new Error(
        recordOnly
          ? `the registry does not serve ${name}@${version} — nothing to record.`
          : `npm accepted the upload, but ${name}@${version} is not live after ${WAIT_MS / 60000} min.\n` +
              `  It is probably STAGED pending 2FA approval — approve it at https://www.npmjs.com/package/${name}\n` +
              '  (or propagation is unusually slow). Once `npm view` shows it, run:\n' +
              '    node scripts/publish-app.mjs --record\n' +
              '  Do NOT re-run a plain publish: the version number is taken either way.',
      );
    }
    console.log(`  waiting for the registry to serve ${version}…`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
})();
console.log(`\nregistry serves ${name}@${version} with this build's integrity (published ${served.publishedAt})`);

const ledgerPath = join(root, 'RELEASES.json');
const ledger = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, 'utf8'))
  : { schemaVersion: 1, releases: [] };
ledger.releases = [
  ...ledger.releases.filter((r) => r.version !== version),
  { name, version, integrity, publishedAt: served.publishedAt },
  // NUMERIC: a plain localeCompare is lexical and files 0.1.10 before 0.1.9.
].sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`ledger updated: ${ledgerPath}`);
