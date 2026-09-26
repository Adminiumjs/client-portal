// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A studio's Adminium that outlives a restart, for the update contract's real
 * path: the released app installed under the Adminium a studio ran then, that
 * Adminium stopped, the next Adminium started on the same data, and only then
 * the app updated.
 *
 * The e2e boot script every other check uses (`apps/e2e/scripts/e2e-server.mjs`
 * of the checkout) makes everything afresh at each boot and deletes it on the
 * way out: a new data directory, a new secret, the source database dropped. So
 * nothing it served can be served again by another build. This script boots
 * the same way (the checkout's `openRuntime` and `composeServer`, `firstRun`
 * at every boot as `adminium start` runs it, the same SMTP sink), but keeps
 * what a studio keeps in `STUDIO_DIR`: the data directory, the secret the
 * stored credentials are sealed with, and the source database (SQLite: the
 * file the contract reads by the port; Postgres/MySQL: `E2E_DATABASE`).
 *
 * The first boot on an empty `STUDIO_DIR` makes the studio: the Northwind the
 * e2e script seeds, the first super admin, the SMTP relay pointed at the sink,
 * and the connection. Every later boot, of this or another checkout, opens
 * what is there, applies the migrations that checkout brings, and serves it.
 *
 *   STUDIO_ADMINIUM   the built Adminium checkout to run
 *   STUDIO_DIR        what the studio keeps between boots
 *   E2E_ENGINE, E2E_PORT, E2E_SMTP_PORT, E2E_SINK_PORT, E2E_DATABASE,
 *   TEST_POSTGRES_URL, TEST_MYSQL_URL   as the e2e script reads them
 *
 * Tests only; nothing that ships imports it.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHECKOUT = process.env.STUDIO_ADMINIUM ?? '';
const DIR = process.env.STUDIO_DIR ?? '';
const ENGINE = process.env.E2E_ENGINE ?? 'sqlite';
const PORT = Number(process.env.E2E_PORT ?? 4610);
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? PORT + 1);
const SINK_PORT = Number(process.env.E2E_SINK_PORT ?? PORT + 2);
const DATABASE = process.env.E2E_DATABASE ?? 'adminium_studio';
const HOST = '127.0.0.1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e@adminium.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'adminium-e2e-password';
const CONNECTION_NAME = 'northwind';

const log = (message) => console.log(`[studio-server] ${message}`);
const die = (message) => {
  console.error(`[studio-server] FATAL: ${message}`);
  process.exit(1);
};

if (CHECKOUT === '' || DIR === '') die('STUDIO_ADMINIUM and STUDIO_DIR are both needed');
const serverRoot = join(CHECKOUT, 'apps', 'server');
const dashboardDist = join(CHECKOUT, 'apps', 'dashboard', 'dist');
if (!existsSync(join(serverRoot, 'dist', 'app.js'))) die(`no built server in ${CHECKOUT}`);

// The checkout's own packages, as its e2e script resolves them.
const need = createRequire(join(CHECKOUT, 'apps', 'e2e', 'package.json'));
const load = (name) => import(pathToFileURL(need.resolve(name)).href);
const [{ loadCliEnv, openRuntime, composeServer }, { hashPassword }, { firstRun, createFirstSuperAdmin }, { default: BetterSqlite3 }, { SMTPServer }, { simpleParser }] =
  await Promise.all([
    load('@adminium/server'),
    import(pathToFileURL(join(serverRoot, 'dist', 'auth', 'passwords.js')).href),
    load('@adminium/meta'),
    load('better-sqlite3'),
    load('smtp-server'),
    load('mailparser'),
  ]);

const secretFile = join(DIR, 'secret');
const readyFile = join(DIR, 'ready');
const dataDir = join(DIR, 'data');
const fresh = !existsSync(secretFile);
if (!fresh && !existsSync(readyFile)) die(`${DIR} holds a studio whose first boot never finished`);
if (fresh) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
}
const fixture = (engineDir, file) => readFileSync(join(CHECKOUT, 'packages', engineDir, 'fixtures', file), 'utf8');

/** The source database: made (Northwind, as the e2e script seeds it) on the first boot only. Answers its DSN. */
async function sourceDb() {
  if (ENGINE === 'sqlite') {
    const file = join(tmpdir(), `adminium-e2e-source-sqlite-${String(PORT)}.db`);
    if (fresh) {
      writeFileSync(file, '');
      const db = new BetterSqlite3(file);
      try {
        db.exec(fixture('adapter-sqlite', 'northwind.sqlite.sql'));
      } finally {
        db.close();
      }
    }
    return `sqlite:${file}`;
  }
  if (ENGINE === 'postgres') {
    const base = process.env.TEST_POSTGRES_URL ?? '';
    if (base === '') die('E2E_ENGINE=postgres needs TEST_POSTGRES_URL');
    const { default: pg } = await load('pg');
    const url = new URL(base);
    url.pathname = `/${DATABASE}`;
    if (fresh) {
      const admin = new pg.Client({ connectionString: base });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${DATABASE}`);
      } finally {
        await admin.end();
      }
      const seeded = new pg.Client({ connectionString: url.toString() });
      await seeded.connect();
      try {
        await seeded.query(fixture('adapter-postgres', 'northwind.sql'));
      } finally {
        await seeded.end();
      }
    }
    return url.toString();
  }
  if (ENGINE === 'mysql') {
    const base = process.env.TEST_MYSQL_URL ?? '';
    if (base === '') die('E2E_ENGINE=mysql needs TEST_MYSQL_URL');
    const mysql = await load('mysql2/promise');
    const url = new URL(base);
    url.pathname = `/${DATABASE}`;
    if (fresh) {
      const admin = await mysql.createConnection({ uri: base, multipleStatements: true });
      try {
        await admin.query(`DROP DATABASE IF EXISTS \`${DATABASE}\``);
        await admin.query(`CREATE DATABASE \`${DATABASE}\``);
      } finally {
        await admin.end();
      }
      const seeded = await mysql.createConnection({ uri: url.toString(), multipleStatements: true });
      try {
        await seeded.query(fixture('adapter-mysql', 'northwind.mysql.sql'));
      } finally {
        await seeded.end();
      }
    }
    return url.toString();
  }
  return die(`unknown E2E_ENGINE "${ENGINE}"`);
}

let app = null;
let runtime = null;
let smtp = null;
let sinkHttp = null;

try {
  const dsn = await sourceDb();
  const env = loadCliEnv(
    { ADMINIUM_SECRET: readFileSync(secretFile, 'utf8').trim(), ADMINIUM_PUBLIC_API_ORIGINS: 'self' },
    { port: PORT, host: HOST, dataDir },
  );
  runtime = await openRuntime(env, { blockLoopback: false }); // every contract database is on loopback
  // What `adminium start` runs at every boot: this checkout's migrations, its built-in roles.
  const { appliedMigrations } = await firstRun(runtime.metaStore.meta);
  if (appliedMigrations.length > 0) log(`applied ${String(appliedMigrations.length)} meta migration(s)`);
  if (fresh) await createFirstSuperAdmin(runtime.metaStore.meta, { email: ADMIN_EMAIL, name: 'Studio Admin', passwordHash: await hashPassword(ADMIN_PASSWORD) });

  // The SMTP sink, as the e2e script runs it; what it holds starts empty at each boot.
  const messages = [];
  smtp = new SMTPServer({
    authOptional: true,
    disabledCommands: ['AUTH', 'STARTTLS'],
    disableReverseLookup: true,
    logger: false,
    onData(stream, session, callback) {
      simpleParser(stream).then(
        (parsed) => {
          const list = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
          messages.push({
            receivedAt: Date.now(),
            subject: parsed.subject ?? '',
            from: parsed.from?.text ?? '',
            to: list(parsed.to).flatMap((entry) => entry.value.map((address) => address.address ?? '')),
            html: typeof parsed.html === 'string' ? parsed.html : '',
            text: parsed.text ?? '',
          });
          callback();
        },
        (error) => callback(error instanceof Error ? error : new Error(String(error))),
      );
    },
  });
  await new Promise((resolve, reject) => {
    smtp.once('error', reject);
    smtp.listen(SMTP_PORT, HOST, () => resolve());
  });
  sinkHttp = createHttpServer((req, res) => {
    if (req.url === '/messages' && req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(messages));
      return;
    }
    if (req.url === '/messages' && req.method === 'DELETE') {
      messages.length = 0;
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve) => sinkHttp.listen(SINK_PORT, HOST, resolve));

  const composed = await composeServer({
    env,
    metaStore: runtime.metaStore,
    manager: runtime.manager,
    runService: runtime.runService,
    applyService: runtime.applyService,
    allowed: runtime.allowed,
    collectStats: runtime.collectStats,
    staticRoot: dashboardDist,
    logger: false,
    telemetry: false,
  });
  app = composed.app;
  await app.ready();

  if (fresh) {
    const inject = async (method, url, cookie, payload) => {
      const res = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }), ...(cookie === undefined ? {} : { headers: { cookie } }) });
      let json = null;
      try {
        json = res.json();
      } catch {
        // not JSON
      }
      return { status: res.statusCode, json, headers: res.headers };
    };
    const expect = (label, res, ...codes) => {
      if (!codes.includes(res.status)) throw new Error(`${label} → ${String(res.status)} ${JSON.stringify(res.json)}`);
    };
    const login = await inject('POST', '/api/v1/auth/login', undefined, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect('login', login, 200);
    const set = login.headers['set-cookie'];
    const cookie = (Array.isArray(set) ? set[0] : set).split(';')[0];
    expect('email settings', await inject('PUT', '/api/v1/settings/email', cookie, { smtp: { host: HOST, port: SMTP_PORT, user: '', from: `Studio <${ADMIN_EMAIL}>`, secure: false } }), 200);
    const created = await inject('POST', '/api/v1/connections', cookie, { name: CONNECTION_NAME, engine: ENGINE, dsn });
    expect('create connection', created, 201);
    const introspect = await inject('POST', `/api/v1/connections/${created.json.id}/introspect`, cookie);
    expect('introspect', introspect, 200, 202);
    for (let i = 0; i < 240; i += 1) {
      if ((await inject('GET', `/api/v1/connections/${created.json.id}`, cookie)).json?.snapshot != null) break;
      if (i === 239) throw new Error('introspection produced no snapshot in 120 s');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    writeFileSync(readyFile, '');
  }

  await app.listen({ port: PORT, host: HOST });
  log(`READY on http://${HOST}:${String(PORT)} (${fresh ? 'a new studio' : 'the studio kept'} in ${DIR})`);
} catch (error) {
  console.error(`[studio-server] boot failed: ${error?.stack ?? error}`);
  if (app !== null) await app.close().catch(() => {});
  if (runtime !== null) await runtime.close().catch(() => {});
  sinkHttp?.close();
  smtp?.close();
  process.exit(1);
}

// Stopped as a server is stopped: nothing the studio keeps is removed.
const shutdown = () => {
  const finish = () => {
    sinkHttp?.close();
    smtp?.close();
    process.exit(0);
  };
  app
    .close()
    .then(() => runtime.close())
    .then(finish, finish);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
