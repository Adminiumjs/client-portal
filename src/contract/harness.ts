/**
 * The contract's Adminium: the BUILT server of an Adminium checkout
 * (`ADMINIUM_REPO`), booted by its own e2e script on one engine, with the
 * Invoices & Receipts add-on packed from an add-ons checkout (`ADD_ONS_REPO`,
 * at the commit the demo's printed copies are pinned to), and this repo's own
 * `manifest.json` and sample packed as an operator would upload them.
 *
 * Everything is spoken over HTTP, as the dashboard and a client's page speak
 * it: nothing here reaches into the server's modules.
 *
 * Tests only; nothing that ships imports it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

export type Engine = "sqlite" | "postgres" | "mysql";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string) => readFileSync(path, "utf8");

// ── what the contract needs, and whether it is here ─────────────────────────

export const ADMINIUM_REPO = process.env["ADMINIUM_REPO"] ?? "";
export const ADD_ONS_REPO = process.env["ADD_ONS_REPO"] ?? join(REPO, "..", "add-ons");
const E2E_SERVER = join(ADMINIUM_REPO, "apps", "e2e", "scripts", "e2e-server.mjs");
const INVOICES = join(ADD_ONS_REPO, "packages", "invoices");

/** Why the contract cannot run here, or null when it can. */
export function missing(): string | null {
  if (ADMINIUM_REPO === "") return "ADMINIUM_REPO is not set";
  if (!existsSync(join(ADMINIUM_REPO, "apps", "server", "dist", "app.js"))) return `no built server in ${ADMINIUM_REPO} (pnpm turbo run build --filter=@adminium/e2e...)`;
  if (!existsSync(join(ADMINIUM_REPO, "apps", "dashboard", "dist", "index.html"))) return `no built dashboard in ${ADMINIUM_REPO}`;
  if (!existsSync(E2E_SERVER)) return `no e2e server script in ${ADMINIUM_REPO}`;
  if (!existsSync(join(INVOICES, "dist", "server.js"))) return `no built invoices add-on in ${ADD_ONS_REPO}`;
  return null;
}

/** `CONTRACT_ENGINES=postgres,mysql` runs only those (a machine with few free ports runs them one at a time). */
const ONLY = (process.env["CONTRACT_ENGINES"] ?? "").split(",").map((e) => e.trim()).filter((e) => e !== "");
const wanted = (engine: Engine) => ONLY.length === 0 || ONLY.includes(engine);

/** The engines this run can reach: SQLite always, the others with their URLs. */
export const ENGINES: [Engine, boolean][] = [
  ["sqlite", wanted("sqlite")],
  ["postgres", wanted("postgres") && (process.env["TEST_POSTGRES_URL"] ?? "") !== ""],
  ["mysql", wanted("mysql") && (process.env["TEST_MYSQL_URL"] ?? "") !== ""],
];

// ── the packages, as an operator uploads them ───────────────────────────────

const BLOCK = 512;

/** An npm-shaped tarball (`package/…` members), which is what the server's hardened unpacker reads. */
function tarball(files: Record<string, Buffer>): Buffer {
  const members: Buffer[] = [];
  const put = (block: Buffer, at: number, length: number, value: string) => Buffer.from(value, "latin1").subarray(0, length).copy(block, at);
  for (const [path, body] of Object.entries(files)) {
    const header = Buffer.alloc(BLOCK);
    put(header, 0, 100, `package/${path}`);
    put(header, 100, 8, "0000644\0");
    put(header, 124, 12, `${body.length.toString(8).padStart(11, "0")}\0`);
    put(header, 136, 12, "00000000000\0");
    put(header, 156, 1, "0");
    put(header, 257, 6, "ustar\0");
    put(header, 263, 2, "00");
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    put(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
    members.push(header, body, Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK));
  }
  members.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(members), { mtime: 0 } as never);
}

export interface Bundle {
  buffer: Buffer;
  integrity: string;
}

const bundle = (files: Record<string, Buffer>): Bundle => {
  const buffer = tarball(files);
  return { buffer, integrity: `sha512-${createHash("sha512").update(buffer).digest("base64")}` };
};

/**
 * The version the app asks of the add-on (`addOns.requires[].range` `>=x.y.z`), and the
 * version the checkout carries.
 */
export function addOnVersions(): { floor: string | null; checkout: string } {
  const app = JSON.parse(read(join(REPO, "manifest.json"))) as { addOns?: { requires?: { key: string; range: string }[] } };
  const range = app.addOns?.requires?.find((r) => r.key === "invoices")?.range ?? "";
  const floor = /^>=\s*(\d+\.\d+\.\d+)$/.exec(range.trim())?.[1] ?? null;
  const checkout = (JSON.parse(read(join(INVOICES, "manifest.json"))) as { version: string }).version;
  return { floor, checkout };
}

const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i += 1) if (x![i] !== y![i]) return x![i]! > y![i]!;
  return false;
};

/**
 * The version the add-on is packed as. The checkout is the next release of the
 * add-on BEFORE its release bumps the number (the add-ons repo stamps it when
 * it releases), so when the app already asks for that next number, the
 * checkout is packed as it — a rehearsal of the release, said in the test's
 * name — rather than failing on a number nobody has stamped yet.
 */
export function packedAddOnVersion(): { version: string; rehearsed: boolean } {
  const { floor, checkout } = addOnVersions();
  if (floor !== null && newer(floor, checkout)) return { version: floor, rehearsed: true };
  return { version: checkout, rehearsed: false };
}

/** The add-on, packed as its release packs it: `files[]`, the name rewritten, no dev-only fields. */
export function addOnBundle(): Bundle & { key: string; version: string } {
  const pkg = JSON.parse(read(join(INVOICES, "package.json"))) as Record<string, unknown> & { name: string; version: string; files: string[] };
  const files: Record<string, Buffer> = {};
  const add = (path: string) => {
    const absolute = join(INVOICES, path);
    if (!existsSync(absolute)) return;
    if (statSync(absolute).isDirectory()) {
      for (const name of readdirSync(absolute)) add(join(path, name));
      return;
    }
    files[relative(INVOICES, absolute).split("\\").join("/")] = readFileSync(absolute);
  };
  for (const entry of pkg.files) add(entry);
  const { version } = packedAddOnVersion();
  const { devDependencies: _dev, scripts: _scripts, ...shipped } = pkg;
  files["package.json"] = Buffer.from(JSON.stringify({ ...shipped, name: pkg.name.replace(/^@adminium\//, "@adminiumjs/"), version }));
  const manifest = JSON.parse(read(join(INVOICES, "manifest.json"))) as { key: string; version: string };
  files["manifest.json"] = Buffer.from(JSON.stringify({ ...manifest, version }));
  return { ...bundle(files), key: manifest.key, version };
}

/** Every file under a directory, by its path below it. */
function filesUnder(root: string, into: string, files: Record<string, Buffer>): void {
  for (const name of readdirSync(root)) {
    const absolute = join(root, name);
    if (statSync(absolute).isDirectory()) filesUnder(absolute, `${into}${name}/`, files);
    else files[`${into}${name}`] = readFileSync(absolute);
  }
}

/**
 * This repo's app: its manifest, its sample, and a page for each side — a
 * placeholder page, or with `built: true` the surfaces `npm run build:surface`
 * made (`dist-surface/<key>/<side>`), as a release packs them: what a
 * browser test opens.
 */
export function appBundle(options: { built?: boolean } = {}): Bundle & { key: string; version: string } {
  const manifest = JSON.parse(read(join(REPO, "manifest.json"))) as { key: string; version: string; sampleData?: { file: string } };
  const files: Record<string, Buffer> = {
    "package.json": Buffer.from(JSON.stringify({ name: `@adminiumjs/app-${manifest.key}`, version: manifest.version })),
    "manifest.json": readFileSync(join(REPO, "manifest.json")),
  };
  for (const side of ["staff", "customer"]) {
    const built = join(REPO, "dist-surface", manifest.key, side);
    if (options.built !== true) files[`${side}/index.html`] = Buffer.from(`<!doctype html><html><body data-app="${manifest.key}-${side}"></body></html>`);
    else if (!existsSync(join(built, "index.html"))) throw new Error(`no built ${side} surface in ${built} — run \`npm run build:surface\` first`);
    else filesUnder(built, `${side}/`, files);
  }
  if (manifest.sampleData !== undefined) files[manifest.sampleData.file] = readFileSync(join(REPO, manifest.sampleData.file));
  return { ...bundle(files), key: manifest.key, version: manifest.version };
}

// ── the server ──────────────────────────────────────────────────────────────

export interface Server {
  base: string;
  sink: string;
  /** The server's clock now (epoch ms): where a server started again on the same data picks it up. */
  now(): number;
  /** What the server has said so far (its log), for a failure to show. */
  log(): string;
  /** Move the server's clock on by `ms` at once (a night passing over a running clock); resolves once it has moved. */
  pass(ms: number): Promise<void>;
  stop(): Promise<void>;
}

/**
 * The ports one engine's server takes: the server at `port`, its SMTP sink
 * and the sink's mailbox on the next two. The script's scripted LLM, which
 * nothing here calls, takes whatever port is free.
 */
export const PORTS_PER_ENGINE = 3;

export interface BootOptions {
  /** The Postgres/MySQL database the run owns (dropped and made again at boot, but by a kept studio's first boot only). */
  database?: string;
  /** The built Adminium checkout to run (default `ADMINIUM_REPO`). */
  adminium?: string;
  /**
   * A studio kept between boots (`studio-server.mjs`): its data directory,
   * secret and source database, made on the first boot in this directory and
   * served again by every later one — of this checkout or another.
   */
  keep?: string;
  /** The server's NODE_OPTIONS in place of this process's own (the clock's preload is always added). */
  nodeOptions?: string;
}

/**
 * Boot the built Adminium on one engine, its clock starting at `now`; resolves once it serves.
 */
export async function boot(engine: Engine, port: number, now: number, options: BootOptions = {}): Promise<Server> {
  const clockFile = join(tmpdir(), `cp-contract-clock-${String(port)}`);
  writeFileSync(clockFile, "");
  const checkout = options.adminium ?? ADMINIUM_REPO;
  const inherited = options.nodeOptions ?? process.env["NODE_OPTIONS"] ?? "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.keep === undefined ? {} : { STUDIO_ADMINIUM: checkout, STUDIO_DIR: options.keep }),
    E2E_ENGINE: engine,
    E2E_PORT: String(port),
    E2E_SMTP_PORT: String(port + 1),
    E2E_SINK_PORT: String(port + 2),
    E2E_FAKE_LLM_PORT: "0",
    // Its own database, so a contract never meets another run's rows (`CONTRACT_DB_SUFFIX` keeps two checkouts' runs apart).
    E2E_DATABASE: options.database ?? `cp_contract_${engine}${process.env["CONTRACT_DB_SUFFIX"] ?? ""}`,
    CONTRACT_NOW: String(now),
    CONTRACT_CLOCK_FILE: clockFile,
    NODE_OPTIONS: `${inherited} --import=${pathToFileURL(fileURLToPath(new URL("./clock.mjs", import.meta.url))).href}`.trim(),
  };
  const script = options.keep === undefined ? join(checkout, "apps", "e2e", "scripts", "e2e-server.mjs") : fileURLToPath(new URL("./studio-server.mjs", import.meta.url));
  const started = Date.now();
  let passed = 0;
  const child: ChildProcess = spawn(process.execPath, [script], { cwd: join(checkout, "apps", "e2e"), env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => (log += chunk.toString()));
  const base = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the ${engine} server exited:\n${log.slice(-4000)}`);
    try {
      const res = await fetch(`${base}/api/v1/healthz`);
      if (res.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`the ${engine} server never answered:\n${log.slice(-4000)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {
    base,
    sink: `http://127.0.0.1:${String(port + 2)}`,
    now: () => now + (Date.now() - started) + passed,
    log: () => log,
    async pass(ms: number) {
      passed += ms;
      writeFileSync(clockFile, String(ms));
      child.kill("SIGUSR2");
      const by = Date.now() + 10_000;
      while (readFileSync(clockFile, "utf8") !== "") {
        if (Date.now() > by) throw new Error("the server's clock did not move");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000);
      }),
  };
}

// ── speaking to it ──────────────────────────────────────────────────────────

export interface Reply<T = unknown> {
  status: number;
  body: T;
  code: string | undefined;
  details: Record<string, unknown>;
}

/** A caller: the operator (a session cookie) or a client's page (a browser key, a public session). */
export class Caller {
  private cookie = "";
  /** The session cookie(s) this caller holds, `name=value; …` — for a browser to carry the same session. */
  get cookies(): string {
    return this.cookie;
  }
  private csrf = "";
  readonly base: string;
  private readonly headers: Record<string, string>;
  constructor(base: string, headers: Record<string, string> = {}) {
    this.base = base;
    this.headers = headers;
  }

  async send<T = unknown>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Reply<T>> {
    for (let attempt = 0; ; attempt += 1) {
      const res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          ...this.headers,
          ...(this.cookie === "" ? {} : { cookie: this.cookie }),
          // Node's fetch says `sec-fetch-mode`, so the server asks what a browser page is asked: the session's token.
          ...(this.csrf === "" || method === "GET" ? {} : { "x-adminium-csrf": this.csrf }),
          ...(body === undefined ? {} : Buffer.isBuffer(body) ? { "content-type": "application/octet-stream" } : { "content-type": "application/json" }),
          ...extra,
        },
        ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body) }),
      });
      const set = res.headers.getSetCookie?.() ?? [];
      if (set.length > 0) this.cookie = set.map((c) => c.split(";")[0]).join("; ");
      // A burst the rate limit refused is the limit's, not the contract's: wait it out.
      if (res.status === 429 && attempt < 6) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        continue;
      }
      const text = await res.text();
      let parsed: unknown = text;
      try {
        parsed = text === "" ? null : JSON.parse(text);
      } catch {
        // not JSON
      }
      const error = (parsed as { error?: { code?: string; details?: Record<string, unknown> } } | null)?.error;
      return { status: res.status, body: parsed as T, code: error?.code, details: error?.details ?? {} };
    }
  }

  /** Sign in as the operator, and take the session's write token as the dashboard does. */
  async signIn(email: string, password: string): Promise<void> {
    ok(await this.post("/api/v1/auth/login", { email, password }));
    this.csrf = ok(await this.get<{ data: { csrfToken: string } }>("/api/v1/bootstrap")).data.csrfToken;
  }

  /** The session this caller holds, for a desk that speaks to the same server through its own transport. */
  session(): { cookie: string; csrfToken: string } {
    return { cookie: this.cookie, csrfToken: this.csrf };
  }

  /**
   * A `fetch` that goes to this server with this caller's session: what the
   * desk's own transport and sink are handed, so the desk's code runs
   * unchanged against the contract's Adminium.
   */
  fetchAs(): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (this.cookie !== "") headers.set("cookie", this.cookie);
      headers.set("origin", this.base);
      return fetch(new URL(String(input), this.base), { ...init, headers });
    }) as typeof fetch;
  }

  get = <T = unknown>(path: string, extra?: Record<string, string>) => this.send<T>("GET", path, undefined, extra);
  post = <T = unknown>(path: string, body?: unknown, extra?: Record<string, string>) => this.send<T>("POST", path, body ?? {}, extra);
  patch = <T = unknown>(path: string, body: unknown, extra?: Record<string, string>) => this.send<T>("PATCH", path, body, extra);
  put = <T = unknown>(path: string, body: unknown, extra?: Record<string, string>) => this.send<T>("PUT", path, body, extra);
}

/** Expect a status, and hand back the body. */
export function ok<T>(reply: Reply<T>, status = 200): T {
  if (reply.status !== status) throw new Error(`expected ${String(status)}, got ${String(reply.status)}: ${JSON.stringify(reply.body).slice(0, 1500)}`);
  return reply.body;
}

/** The nonce a human check asks for: sha256(salt + nonce) starting with that many zero bits. */
export function solve(salt: string, difficulty: number): string {
  for (let n = 0; ; n += 1) {
    const nonce = n.toString(36);
    const digest = createHash("sha256").update(`${salt}${nonce}`).digest();
    let bits = 0;
    for (const byte of digest) {
      if (byte === 0) {
        bits += 8;
        continue;
      }
      bits += Math.clz32(byte) - 24;
      break;
    }
    if (bits >= difficulty) return nonce;
  }
}

export const until = async <T>(read: () => Promise<T | undefined>, label: string, ms = 120_000): Promise<T> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await read();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`waited ${String(ms / 1000)} s for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ADDED FOR THE UPDATE CONTRACT (`update.test.ts`) — additive only: nothing
// above this line reads anything below it.
// ════════════════════════════════════════════════════════════════════════════

/** One release as RELEASES.json records it: the integrity the published tarball must hash to. */
export function recordedRelease(version: string): { name: string; version: string; integrity: string } | null {
  const releases = JSON.parse(read(join(REPO, "RELEASES.json"))) as { releases: { name: string; version: string; integrity: string }[] };
  return releases.releases.find((r) => r.version === version) ?? null;
}

/** The members of an npm tarball, by their path below `package/`. */
export function untar(buffer: Buffer): Record<string, Buffer> {
  const raw = gunzipSync(buffer);
  const files: Record<string, Buffer> = {};
  for (let at = 0; at + BLOCK <= raw.length; ) {
    const header = raw.subarray(at, at + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const text = (from: number, length: number) => header.subarray(from, from + length).toString("latin1").replace(/\0.*$/s, "");
    const prefix = text(345, 155);
    const name = prefix === "" ? text(0, 100) : `${prefix}/${text(0, 100)}`;
    const size = parseInt(text(124, 12).trim() || "0", 8);
    const type = text(156, 1);
    if (type === "0" || type === "") files[name.replace(/^package\//, "")] = Buffer.from(raw.subarray(at + BLOCK, at + BLOCK + size));
    at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

/**
 * THE RELEASED APP, as its operator's Adminium was handed it: the published
 * tarball's own bytes (`CONTRACT_FROM_TARBALL`, e.g. `npm pack
 * @adminiumjs/app-clients@0.2.0`), refused unless it hashes to the integrity
 * RELEASES.json recorded for its version — so the update is proved from what
 * was really shipped, never from a rebuild of its tag.
 */
export const FROM_TARBALL = process.env["CONTRACT_FROM_TARBALL"] ?? "";

/**
 * THE ADMINIUM THE RELEASE WAS INSTALLED UNDER: a built checkout of the
 * Adminium a studio ran the released app on (`CONTRACT_FROM_ADMINIUM`, for
 * 0.2.0 Adminium 0.3.3). A newer Adminium may refuse the released version
 * outright (0.3.4 refuses 0.2.0's email words), so the update is proved on
 * the path a studio takes: installed there, that Adminium upgraded in place
 * to `ADMINIUM_REPO` on the same data, and only then the app updated. Its
 * server is started with `CONTRACT_FROM_NODE_OPTIONS`, never this process's
 * own NODE_OPTIONS, which are the new Adminium's.
 */
export const FROM_ADMINIUM = process.env["CONTRACT_FROM_ADMINIUM"] ?? "";
export const FROM_NODE_OPTIONS = process.env["CONTRACT_FROM_NODE_OPTIONS"] ?? "";

/** Why the released tarball, or the Adminium it was installed under, cannot be used here, or null when they can. */
export function releasedMissing(): string | null {
  if (FROM_TARBALL === "") return "CONTRACT_FROM_TARBALL is not set (the published tarball of the release this one updates)";
  if (!existsSync(FROM_TARBALL)) return `no tarball at ${FROM_TARBALL}`;
  if (FROM_ADMINIUM === "") return "CONTRACT_FROM_ADMINIUM is not set (a built checkout of the Adminium the released version was installed under)";
  if (!existsSync(join(FROM_ADMINIUM, "apps", "server", "dist", "app.js"))) return `no built server in ${FROM_ADMINIUM}`;
  if (!existsSync(join(FROM_ADMINIUM, "apps", "dashboard", "dist", "index.html"))) return `no built dashboard in ${FROM_ADMINIUM}`;
  return null;
}

export function releasedBundle(): Bundle & { key: string; version: string; files: Record<string, Buffer>; manifest: Record<string, unknown> } {
  const buffer = readFileSync(FROM_TARBALL);
  const integrity = `sha512-${createHash("sha512").update(buffer).digest("base64")}`;
  const files = untar(buffer);
  const pkg = JSON.parse(files["package.json"]!.toString("utf8")) as { version: string };
  const recorded = recordedRelease(pkg.version);
  if (recorded === null) throw new Error(`RELEASES.json records no ${pkg.version}`);
  if (recorded.integrity !== integrity) throw new Error(`${FROM_TARBALL} is not the published ${pkg.version}: ${integrity} ≠ ${recorded.integrity}`);
  const manifest = JSON.parse(files["manifest.json"]!.toString("utf8")) as Record<string, unknown> & { key: string; version: string };
  return { buffer, integrity, key: manifest.key, version: manifest.version, files, manifest };
}

/** One table read straight from the studio's database: its columns as the engine declares them, and every row as exact text. */
export interface RawTable {
  /** name → the engine's own declaration (type, nullability, default). */
  columns: Record<string, string>;
  /** Every row, in key order, each value as the engine spells it (`quote()` on SQLite, `::text` on Postgres, `CAST(… AS CHAR)` on MySQL). */
  rows: Record<string, string | null>[];
  key: string[];
  /**
   * The table's indexes, foreign keys and checks, each described by what it
   * holds rather than its name (a rebuild may rename one), sorted.
   */
  constraints: string[];
}

/** Asked for when used, so listing the tests needs no Adminium checkout. */
const driver = (name: string): unknown => createRequire(join(ADMINIUM_REPO, "apps", "e2e", "package.json"))(name);

/**
 * Every table whose name starts with `prefix`, read past HTTP from the
 * engine's source database (the drivers are the Adminium checkout's own; this
 * repo adds none) — what "byte for byte" is measured on.
 */
export async function rawTables(engine: Engine, port: number, database: string, prefix: string): Promise<Record<string, RawTable>> {
  const out: Record<string, RawTable> = {};
  const plain = (name: string) => {
    if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`not a plain name: ${name}`);
    return name;
  };
  if (engine === "sqlite") {
    type Db = { prepare(sql: string): { all(...args: unknown[]): Record<string, unknown>[] }; close(): void };
    const Database = driver("better-sqlite3") as new (file: string, options: { readonly: boolean }) => Db;
    const db = new Database(join(tmpdir(), `adminium-e2e-source-sqlite-${String(port)}.db`), { readonly: true });
    try {
      const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => String(r["name"])).filter((n) => n.startsWith(prefix));
      for (const name of names) {
        const info = db.prepare(`PRAGMA table_info(${plain(name)})`).all() as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[];
        const columns = Object.fromEntries(info.map((c) => [c.name, `${c.type}${c.notnull ? " NOT NULL" : ""}${c.dflt_value === null ? "" : ` DEFAULT ${c.dflt_value}`}${c.pk ? ` PK${String(c.pk)}` : ""}`]));
        const key = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
        const select = info.map((c) => `quote("${plain(c.name)}") AS "${c.name}"`).join(", ");
        const order = (key.length > 0 ? key : ["rowid"]).map((c) => `"${c}"`).join(", ");
        const rows = db.prepare(`SELECT ${select} FROM "${name}" ORDER BY ${order}`).all() as Record<string, string | null>[];
        const constraints: string[] = [];
        for (const index of db.prepare(`PRAGMA index_list("${name}")`).all() as { name: string; unique: number; origin: string; partial: number }[]) {
          const on = (db.prepare(`PRAGMA index_info("${plain(index.name)}")`).all() as { name: string }[]).map((c) => c.name).join(",");
          constraints.push(`index ${index.unique ? "unique " : ""}${index.origin}${index.partial ? " partial" : ""} (${on})`);
        }
        for (const fk of db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as { from: string; table: string; to: string; on_update: string; on_delete: string }[]) {
          constraints.push(`fk (${fk.from}) → ${fk.table}(${fk.to}) on update ${fk.on_update} on delete ${fk.on_delete}`);
        }
        const create = String(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").all(name)[0]?.["sql"] ?? "");
        for (const check of create.match(/CHECK\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/gi) ?? []) constraints.push(check.replace(/\s+/g, " "));
        out[name] = { columns, rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === "NULL" ? null : String(v)]))), key, constraints: constraints.sort() };
      }
    } finally {
      db.close();
    }
    return out;
  }
  if (engine === "postgres") {
    type Client = { connect(): Promise<void>; query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<void> };
    const pg = driver("pg") as { Client: new (options: { connectionString: string }) => Client };
    const url = new URL(process.env["TEST_POSTGRES_URL"] ?? "");
    url.pathname = `/${database}`;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
      const cols = (
        await client.query(
          `SELECT table_name, column_name, data_type, udt_name, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
             FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`,
        )
      ).rows.filter((r) => String(r["table_name"]).startsWith(prefix));
      const keys = (
        await client.query(
          `SELECT c.relname AS table_name, a.attname AS column_name, array_position(i.indkey, a.attnum) AS pos
             FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
            WHERE i.indisprimary AND c.relnamespace = current_schema()::regnamespace`,
        )
      ).rows;
      for (const name of [...new Set(cols.map((c) => String(c["table_name"])))]) {
        const mine = cols.filter((c) => c["table_name"] === name);
        const columns = Object.fromEntries(
          mine.map((c) => [
            String(c["column_name"]),
            `${String(c["data_type"])}/${String(c["udt_name"])}(${String(c["character_maximum_length"] ?? "")},${String(c["numeric_precision"] ?? "")},${String(c["numeric_scale"] ?? "")})${c["is_nullable"] === "NO" ? " NOT NULL" : ""}${c["column_default"] === null ? "" : ` DEFAULT ${String(c["column_default"])}`}`,
          ]),
        );
        const key = keys.filter((k) => k["table_name"] === name).sort((a, b) => Number(a["pos"]) - Number(b["pos"])).map((k) => String(k["column_name"]));
        const select = mine.map((c) => `"${plain(String(c["column_name"]))}"::text AS "${String(c["column_name"])}"`).join(", ");
        const order = (key.length > 0 ? key : mine.map((c) => String(c["column_name"]))).map((c) => `"${c}"`).join(", ");
        const rows = (await client.query(`SELECT ${select} FROM "${plain(name)}" ORDER BY ${order}`)).rows as Record<string, string | null>[];
        const defs = (
          await client.query(
            `SELECT pg_get_constraintdef(o.oid) AS def FROM pg_constraint o JOIN pg_class c ON c.oid = o.conrelid
              WHERE c.relname = $1 AND c.relnamespace = current_schema()::regnamespace
             UNION ALL
             SELECT regexp_replace(indexdef, '^CREATE (UNIQUE )?INDEX \\S+ ON ', 'CREATE \\1INDEX ON ') FROM pg_indexes WHERE tablename = $1 AND schemaname = current_schema()`,
            [name],
          )
        ).rows.map((r) => String(r["def"]));
        out[name] = { columns, rows, key, constraints: defs.sort() };
      }
    } finally {
      await client.end();
    }
    return out;
  }
  type Connection = { query(sql: string, args?: unknown[]): Promise<[Record<string, unknown>[]]>; end(): Promise<void> };
  const mysql = driver("mysql2/promise") as { createConnection(uri: string): Promise<Connection> };
  const url = new URL(process.env["TEST_MYSQL_URL"] ?? "");
  url.pathname = `/${database}`;
  const connection = await mysql.createConnection(url.toString());
  try {
    const [cols] = await connection.query(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt, COLUMN_KEY AS k, EXTRA AS extra
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [database],
    );
    const mine = cols.filter((r) => String(r["t"]).startsWith(prefix));
    for (const name of [...new Set(mine.map((c) => String(c["t"])))]) {
      const list = mine.filter((c) => c["t"] === name);
      const columns = Object.fromEntries(
        list.map((c) => [String(c["c"]), `${String(c["type"])}${c["nullable"] === "NO" ? " NOT NULL" : ""}${c["dflt"] === null ? "" : ` DEFAULT ${String(c["dflt"])}`}${String(c["extra"]) === "" ? "" : ` ${String(c["extra"])}`}`]),
      );
      const [keyRows] = await connection.query(
        "SELECT COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION",
        [database, name],
      );
      const key = keyRows.map((k) => String(k["c"]));
      const select = list.map((c) => `CAST(\`${plain(String(c["c"]))}\` AS CHAR) AS \`${String(c["c"])}\``).join(", ");
      const order = (key.length > 0 ? key : list.map((c) => String(c["c"]))).map((c) => `\`${c}\``).join(", ");
      const [rows] = await connection.query(`SELECT ${select} FROM \`${plain(name)}\` ORDER BY ${order}`);
      const [indexes] = await connection.query(
        "SELECT INDEX_NAME AS i, NON_UNIQUE AS nu, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? GROUP BY INDEX_NAME, NON_UNIQUE",
        [database, name],
      );
      const [fks] = await connection.query(
        `SELECT k.COLUMN_NAME AS c, k.REFERENCED_TABLE_NAME AS t, k.REFERENCED_COLUMN_NAME AS rc, r.UPDATE_RULE AS u, r.DELETE_RULE AS d
           FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
          WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL`,
        [database, name],
      );
      const [checks] = await connection.query(
        `SELECT cc.CHECK_CLAUSE AS c FROM information_schema.TABLE_CONSTRAINTS tc JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
          WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'CHECK'`,
        [database, name],
      );
      const constraints = [
        ...indexes.map((x) => `index ${Number(x["nu"]) === 0 ? "unique " : ""}${String(x["i"]) === "PRIMARY" ? "primary " : ""}(${String(x["cols"])})`),
        ...fks.map((x) => `fk (${String(x["c"])}) → ${String(x["t"])}(${String(x["rc"])}) on update ${String(x["u"])} on delete ${String(x["d"])}`),
        ...checks.map((x) => `CHECK ${String(x["c"])}`),
      ];
      out[name] = { columns, rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? null : String(v)]))), key, constraints: constraints.sort() };
    }
  } finally {
    await connection.end();
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// ADDED FOR THE ACCEPTANCE CONTRACT (`acceptance.test.ts`) — additive only:
// nothing above this line reads anything below it.
// ════════════════════════════════════════════════════════════════════════════

/**
 * A second database beside the studio's, made fresh on the same engine and
 * filled by `statements` (the engine's own SQL), for a second connection to
 * point at. Answers the DSN a connection is made with.
 */
export async function otherDatabase(engine: Engine, port: number, name: string, statements: string[]): Promise<string> {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`not a plain name: ${name}`);
  if (engine === "sqlite") {
    type Db = { exec(sql: string): void; close(): void };
    const Database = driver("better-sqlite3") as new (file: string) => Db;
    const file = join(tmpdir(), `${name}-${String(port)}.db`);
    writeFileSync(file, "");
    const db = new Database(file);
    try {
      for (const statement of statements) db.exec(statement);
    } finally {
      db.close();
    }
    return `sqlite:${file}`;
  }
  if (engine === "postgres") {
    type Client = { connect(): Promise<void>; query(sql: string): Promise<unknown>; end(): Promise<void> };
    const pg = driver("pg") as { Client: new (options: { connectionString: string }) => Client };
    const base = process.env["TEST_POSTGRES_URL"] ?? "";
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${name}`);
    } finally {
      await admin.end();
    }
    const url = new URL(base);
    url.pathname = `/${name}`;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
      for (const statement of statements) await client.query(statement);
    } finally {
      await client.end();
    }
    return url.toString();
  }
  type Connection = { query(sql: string): Promise<unknown>; end(): Promise<void> };
  const mysql = driver("mysql2/promise") as { createConnection(uri: string): Promise<Connection> };
  const base = process.env["TEST_MYSQL_URL"] ?? "";
  const admin = await mysql.createConnection(base);
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await admin.query(`CREATE DATABASE \`${name}\``);
  } finally {
    await admin.end();
  }
  const url = new URL(base);
  url.pathname = `/${name}`;
  const connection = await mysql.createConnection(url.toString());
  try {
    for (const statement of statements) await connection.query(statement);
  } finally {
    await connection.end();
  }
  return url.toString();
}
