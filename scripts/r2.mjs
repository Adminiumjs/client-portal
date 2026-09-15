// SPDX-License-Identifier: AGPL-3.0-only
//
// r2.mjs — write one released file into the downloads bucket, then prove the
// public address serves exactly those bytes (48-self-hosted-downloads.md D1, D2,
// D4, D6).
//
// VENDORED. The canonical copy is `workplan/tools/app-release/r2.mjs` in the
// Adminium monorepo. `app-release.sh sync` copies it, byte for byte, into every
// app repo and into Adminiumjs/add-ons. Edit it there, never here.
//
// ─── What a release may conclude, and from what ─────────────────────────────
//
// A ledger row says "this version's file is served with this fingerprint". An
// upload answering 200 does not establish that; the public address does (D6).
// So `publishObject` returns only after https://downloads.adminium.dev has
// served bytes whose sha512 equals the build's, and callers write their ledger
// row after it returns, never before.
//
//   HEAD ── 404 ──▶ PUT, If-None-Match: * ── 200 ──────────────────▶ read back
//     │                        └── 412 (written meanwhile) ──┐
//     └── 200 ──▶ GET: same sha512 ─────────────────────────┴──────▶ read back
//                      different sha512 ──▶ STOP
//
// DIFFERENT BYTES ARE FINAL. The bucket lock (D2) keeps whatever is there, so
// that version number is burned and the release needs the next patch. SAME
// BYTES ARE THE RECOVERY: a release that uploaded and then failed its read-back
// is re-dispatched with the same version and completes here, because `npm pack`
// output is reproducible from the same sources.
//
// ─── Zero dependencies, and a signer that checks itself on load ─────────────
//
// The Adminium server's `apps/server/src/files/drivers/sigv4.ts` is the same
// algorithm, asserted against AWS's published vectors by its test suite. A
// vendored copy cannot import that file and lands in repos with no such test, so
// this one re-derives AWS's `get-vanilla` signature when it is loaded and throws
// — before anything is signed — if its answer differs.

import { createHash, createHmac } from 'node:crypto';

/** The only public host a release is read back from (D4). */
export const DOWNLOAD_HOST = 'downloads.adminium.dev';
/** An edge can serve a miss cached from before the upload (48 §4); poll past it. */
export const READ_BACK_WAIT_MS = 5 * 60 * 1000;
const READ_BACK_POLL_MS = 10_000;
/** The server's MAX_TARBALL_BYTES: nothing larger is installable, so nothing larger ships. */
const MAX_BYTES = 32 * 1024 * 1024;
const USER_AGENT = 'Adminium-release/48';

/** The server catalog's grammars (`apps/server/src/add-ons/catalog.ts`). */
const KEY_RE = /^[a-z][a-z0-9-]{1,79}$/;
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)*$/;

/**
 * `stage` says which leg refused: signer, config, key, compat (the minimum Adminium a
 * manifest claims), bucket (the S3 API) or live (the public read-back).
 */
export class R2Error extends Error {
  name = 'R2Error';
  constructor(message, stage) {
    super(message);
    this.stage = stage;
  }
}

export const sriOf = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

/**
 * D1's layout, and D4's own check: a URL built from the key must carry exactly
 * this path (a version's pre-release tail may hold `.` or `+`).
 */
export function objectKeyFor({ kind, key, version }) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new R2Error(`not a key: ${JSON.stringify(key)}`, 'key');
  if (typeof version !== 'string' || !VERSION_RE.test(version)) throw new R2Error(`not an exact version: ${JSON.stringify(version)}`, 'key');
  const folder = { 'add-on': 'add-ons', app: 'apps' }[kind];
  if (folder === undefined) throw new R2Error(`unknown kind ${JSON.stringify(kind)}`, 'key');
  const objectKey = `${folder}/${key}/${key}-${version}.tgz`;
  const { pathname } = new URL(`https://${DOWNLOAD_HOST}/${objectKey}`);
  if (pathname !== `/${objectKey}`) throw new R2Error(`${objectKey}: a URL built from it carries ${pathname} instead`, 'key');
  return objectKey;
}

// ─── SigV4 ───────────────────────────────────────────────────────────────────

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value, 'utf8').digest();

/** RFC 3986 unreserved only: `encodeURIComponent` leaves `!'()*` alone and escapes `~`. */
function uriEncode(value, encodeSlash = true) {
  let out = '';
  for (const char of value) {
    if (/[A-Za-z0-9\-._~]/.test(char) || (char === '/' && !encodeSlash)) out += char;
    else for (const byte of Buffer.from(char, 'utf8')) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

function canonicalize({ method, url, headers, payloadSha256, region, service, amzDate }, secretAccessKey) {
  const parsed = new URL(url);
  const lowered = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const query = [...parsed.searchParams]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const signedHeaders = lowered.map(([k]) => k).join(';');
  const canonicalRequest = [
    method,
    // S3 encodes the path exactly once, keeping `/`.
    uriEncode(decodeURIComponent(parsed.pathname), false),
    query,
    lowered.map(([k, v]) => `${k}:${v}\n`).join(''),
    signedHeaders,
    payloadSha256,
  ].join('\n');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), 'aws4_request');
  return { signedHeaders, scope, signature: createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex') };
}

// AWS's `get-vanilla` vector: the documented example credentials, GET / on
// example.amazonaws.com at 20150830T123600Z, us-east-1, service `service`.
if (
  canonicalize(
    {
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
      payloadSha256: EMPTY_SHA256,
      region: 'us-east-1',
      service: 'service',
      amzDate: '20150830T123600Z',
    },
    'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  ).signature !== '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
) {
  throw new R2Error('r2.mjs: the SigV4 signer no longer reproduces AWS get-vanilla; refusing to sign anything', 'signer');
}

/** The complete header set to send: every header is under the signature except `host`, which fetch derives from the URL. */
function sign({ method, url, headers, payloadSha256 }, { accessKeyId, secretAccessKey }) {
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const all = { ...headers, host: new URL(url).host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadSha256 };
  // R2 signs with region `auto`.
  const { signedHeaders, scope, signature } = canonicalize(
    { method, url, headers: all, payloadSha256, region: 'auto', service: 's3', amzDate },
    secretAccessKey,
  );
  // undici refuses a `host` override; the value it sends is the one signed.
  const { host: _host, ...sendable } = all;
  return {
    ...sendable,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Test stand-ins are honoured ONLY on loopback. A variable that could point the
 * read-back at a real host could have a fake host "confirm" bytes the real one
 * never served, and a ledger row would follow.
 */
function loopbackOverride(name, value) {
  if (value === undefined || value === '') return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new R2Error(`${name} is not a URL`, 'config');
  }
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new R2Error(`${name} may point only at a loopback test server, not ${value}`, 'config');
  }
  return value.replace(/\/+$/, '');
}

/** Where read-backs go. Needs no credentials. */
export function publicBaseFromEnv(env = process.env) {
  return loopbackOverride('ADMINIUM_DOWNLOADS_TEST_PUBLIC_BASE', env.ADMINIUM_DOWNLOADS_TEST_PUBLIC_BASE) ?? `https://${DOWNLOAD_HOST}`;
}

/**
 * The bucket, from the environment. Refuses before any network call, and never
 * echoes a value — only the names of what is missing.
 */
export function r2ConfigFromEnv(env = process.env) {
  const names = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new R2Error(
      `the downloads bucket needs ${missing.join(', ')}. In a release workflow they come from the ` +
        "Adminiumjs organization's variables (R2_ACCOUNT_ID, R2_BUCKET) and secrets (R2_ACCESS_KEY_ID, " +
        'R2_SECRET_ACCESS_KEY), and this repository must be granted access to them.',
      'config',
    );
  }
  if (!/^[0-9a-f]{32}$/.test(env.R2_ACCOUNT_ID)) throw new R2Error('R2_ACCOUNT_ID is not a 32-character Cloudflare account id', 'config');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(env.R2_BUCKET)) throw new R2Error('R2_BUCKET is not an R2 bucket name', 'config');
  const jurisdiction = env.R2_JURISDICTION ?? '';
  if (!['', 'eu', 'fedramp'].includes(jurisdiction)) throw new R2Error('R2_JURISDICTION must be eu or fedramp when it is set', 'config');
  const real = `https://${env.R2_ACCOUNT_ID}${jurisdiction === '' ? '' : `.${jurisdiction}`}.r2.cloudflarestorage.com`;
  const endpoint = loopbackOverride('ADMINIUM_DOWNLOADS_TEST_S3_ENDPOINT', env.ADMINIUM_DOWNLOADS_TEST_S3_ENDPOINT) ?? real;
  const publicBase = publicBaseFromEnv(env);
  return {
    endpoint,
    bucket: env.R2_BUCKET,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    publicBase,
    test: endpoint !== real || publicBase !== `https://${DOWNLOAD_HOST}`,
  };
}

// ─── Transport ───────────────────────────────────────────────────────────────

const describe = (err) => (err instanceof Error ? (err.cause?.message ?? err.message) : String(err));

/**
 * GET under the size cap, redirects refused. The status and headers come back
 * even without a body, so a caller can tell a 404 from a challenge page.
 */
export async function download(url, { headers = {}, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      redirect: 'error',
      headers: { 'user-agent': USER_AGENT, ...headers },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new R2Error(`GET ${url} failed: ${describe(err)}`, 'live');
  }
  if (!res.ok || res.body === null) {
    await res.body?.cancel();
    return { status: res.status, headers: res.headers, bytes: null };
  }
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of res.body) {
      total += chunk.byteLength;
      if (total > MAX_BYTES) throw new R2Error(`GET ${url} exceeded ${String(MAX_BYTES)} bytes`, 'live');
      chunks.push(chunk);
    }
  } catch (err) {
    if (err instanceof R2Error) throw err;
    // A connection dropped mid-body is a failed request, not a short file.
    throw new R2Error(`reading ${url} failed: ${describe(err)}`, 'live');
  }
  return { status: res.status, headers: res.headers, bytes: Buffer.concat(chunks) };
}

/** Signed S3 calls against the bucket. */
export function createR2(config, { fetchImpl = fetch } = {}) {
  async function send(method, objectKey, { body, headers = {} } = {}) {
    const url = `${config.endpoint}/${config.bucket}/${uriEncode(objectKey, false)}`;
    const signed = sign({ method, url, headers, payloadSha256: body === undefined ? EMPTY_SHA256 : sha256Hex(body) }, config.credentials);
    try {
      return await fetchImpl(url, { method, headers: signed, body, redirect: 'error', signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      throw new R2Error(`${method} ${objectKey} failed: ${describe(err)}`, 'bucket');
    }
  }
  return {
    head: (objectKey) => send('HEAD', objectKey),
    get: (objectKey) => send('GET', objectKey),
    /** Refuse rather than replace (D6); the lock refuses too, this makes it explicit. */
    putIfAbsent: (objectKey, bytes) =>
      send('PUT', objectKey, {
        body: bytes,
        headers: {
          'content-type': 'application/octet-stream',
          // Immutable by construction (D2), so any cache may keep it for good.
          // Permanent: under the lock, metadata can never be edited later.
          'cache-control': 'public, max-age=31536000, immutable',
          'content-disposition': `attachment; filename="${objectKey.split('/').pop()}"`,
          'if-none-match': '*',
        },
      }),
  };
}

/**
 * Hash what the public address serves. 404s, 429s, 5xx and network failures are
 * retried until `waitMs` runs out; a wrong hash or any other status fails at once.
 */
export async function readBack({ url, integrity, waitMs = READ_BACK_WAIT_MS, pollMs = READ_BACK_POLL_MS, fetchImpl = fetch, onWait }) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    let got;
    let transient;
    try {
      got = await download(url, { headers: { accept: 'application/octet-stream' }, fetchImpl });
    } catch (err) {
      if (!(err instanceof R2Error) || /exceeded/.test(err.message)) throw err;
      transient = err.message;
    }
    if (got?.bytes != null) {
      const sri = sriOf(got.bytes);
      if (sri !== integrity) {
        // A bot challenge arrives as a 200 with an HTML body (48 §4), so name the type.
        throw new R2Error(
          `${url} served ${String(got.bytes.length)} bytes of ${String(got.headers.get('content-type'))} ` +
            `hashing to ${sri}, not ${integrity}`,
          'live',
        );
      }
      return { bytes: got.bytes, lastModified: got.headers.get('last-modified'), cache: got.headers.get('cf-cache-status') };
    }
    if (got !== undefined && !(got.status === 404 || got.status === 429 || got.status >= 500)) {
      throw new R2Error(`${url} answered HTTP ${String(got.status)}`, 'live');
    }
    const why = transient ?? `HTTP ${String(got.status)}`;
    if (Date.now() + pollMs > deadline) throw new R2Error(`${url} is still not served (${why})`, 'live');
    onWait?.(why);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * The whole D6 leg for one file: into the bucket if absent, the same bytes if
 * present, and served publicly — in that order, or a thrown R2Error.
 */
export async function publishObject({ config, kind, key, version, bytes, waitMs, pollMs, fetchImpl = fetch, log = () => {} }) {
  const objectKey = objectKeyFor({ kind, key, version });
  const integrity = sriOf(bytes);
  const r2 = createR2(config, { fetchImpl });

  const sameBytes = async () => {
    const res = await r2.get(objectKey);
    if (res.status !== 200) {
      throw new R2Error(`${objectKey} exists, but GET answered HTTP ${String(res.status)}: ${(await res.text()).slice(0, 300)}`, 'bucket');
    }
    const held = Buffer.from(await res.arrayBuffer());
    const sri = sriOf(held);
    if (sri !== integrity) {
      throw new R2Error(
        `${objectKey} ALREADY EXISTS holding different bytes (${sri}), and the bucket lock keeps them. ` +
          `Version ${version} is burned: release the next patch instead.`,
        'bucket',
      );
    }
    return 'present';
  };

  let status;
  const head = await r2.head(objectKey);
  if (head.status === 200) {
    status = await sameBytes();
  } else if (head.status === 404) {
    const put = await r2.putIfAbsent(objectKey, bytes);
    if (put.status === 200) {
      await put.body?.cancel();
      status = 'uploaded';
    } else {
      const text = await put.text();
      if (put.status !== 412) throw new R2Error(`PUT ${objectKey} answered HTTP ${String(put.status)}: ${text.slice(0, 300)}`, 'bucket');
      status = await sameBytes();
    }
  } else {
    throw new R2Error(`HEAD ${objectKey} answered HTTP ${String(head.status)}`, 'bucket');
  }
  log(`${status === 'uploaded' ? 'uploaded' : 'already in the bucket with the same bytes'}: ${objectKey}`);

  const url = `${config.publicBase}/${objectKey}`;
  const served = await readBack({
    url,
    integrity,
    waitMs,
    pollMs,
    fetchImpl,
    onWait: (why) => log(`waiting for ${url} (${why})`),
  });
  log(`served with this build's sha512: ${url}`);
  return { objectKey, url, integrity, status, lastModified: served.lastModified, cache: served.cache };
}

// ─── The minimum Adminium a release may claim (48 A17) ──────────────────────
//
// Every file released before 2026-09-16 claims `compatibility.minAdminiumVersion:
// "1.0.0"`, while the newest Adminium was 0.2.8. Nothing enforced the field, so
// installs worked, but a claim inside a released file is permanent: the day a
// server enforces it, every such file becomes uninstallable. So a release now
// refuses a minimum above the newest PUBLISHED Adminium, before anything is
// packed and in a dry run too. The manifest schema already keeps the value a
// semver; this keeps it one that some server can meet.
//
// The newest release is read from npm, where Adminium's own packages stay (48:
// engine packages are out of scope). One read per run.

export const ADMINIUM_PACKAGE = '@adminiumjs/adminium';
const REGISTRY = 'https://registry.npmjs.org';
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Where the newest published Adminium is read from. */
export function registryFromEnv(env = process.env) {
  return loopbackOverride('ADMINIUM_RELEASE_TEST_REGISTRY', env.ADMINIUM_RELEASE_TEST_REGISTRY) ?? REGISTRY;
}

/** Semver precedence: numbers first, a pre-release below its release, build metadata ignored. */
export function compareVersions(a, b) {
  const pa = SEMVER_RE.exec(a);
  const pb = SEMVER_RE.exec(b);
  if (pa === null || pb === null) {
    throw new R2Error(`not comparable versions: ${JSON.stringify(a)}, ${JSON.stringify(b)}`, 'compat');
  }
  for (let i = 1; i <= 3; i += 1) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return Math.sign(d);
  }
  if (pa[4] === undefined || pb[4] === undefined) return pa[4] === pb[4] ? 0 : pa[4] === undefined ? 1 : -1;
  const [xa, xb] = [pa[4].split('.'), pb[4].split('.')];
  for (let i = 0; i < Math.max(xa.length, xb.length); i += 1) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const [na, nb] = [/^\d+$/.test(xa[i]), /^\d+$/.test(xb[i])];
    if (na && nb && Number(xa[i]) !== Number(xb[i])) return Math.sign(Number(xa[i]) - Number(xb[i]));
    if (na !== nb) return na ? -1 : 1;
    if (!na && xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

/** The newest published Adminium, from the registry's `latest` tag. */
export async function newestAdminium({ registry = registryFromEnv(), fetchImpl = fetch } = {}) {
  const url = `${registry}/${ADMINIUM_PACKAGE.replace('/', '%2f')}`;
  let res;
  try {
    res = await fetchImpl(url, {
      redirect: 'error',
      headers: { 'user-agent': USER_AGENT, accept: 'application/vnd.npm.install-v1+json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new R2Error(`cannot read the newest ${ADMINIUM_PACKAGE} from ${registry}: ${describe(err)}`, 'compat');
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new R2Error(`${url} answered HTTP ${String(res.status)}`, 'compat');
  }
  const latest = (await res.json().catch(() => null))?.['dist-tags']?.latest;
  if (typeof latest !== 'string' || !SEMVER_RE.test(latest)) throw new R2Error(`${url} names no latest version`, 'compat');
  return latest;
}

/** Refuse a manifest whose minimum no published Adminium meets. Returns the minimum. */
export function assertMinimumReleased(manifest, newest) {
  const label = `${String(manifest?.key)}@${String(manifest?.version)}`;
  const minimum = manifest?.compatibility?.minAdminiumVersion;
  if (typeof minimum !== 'string' || !SEMVER_RE.test(minimum)) {
    throw new R2Error(`${label}: manifest.json has no compatibility.minAdminiumVersion that is a version`, 'compat');
  }
  if (compareVersions(minimum, newest) > 0) {
    throw new R2Error(
      `${label} claims it needs Adminium ${minimum}, but the newest published release is ${newest}. ` +
        'No server can meet that claim, and a released file keeps it forever. Set ' +
        'compatibility.minAdminiumVersion to the first release that can install it.',
      'compat',
    );
  }
  return minimum;
}
