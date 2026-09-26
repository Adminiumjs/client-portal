/**
 * THE CLIENT PORTAL'S ACCEPTANCE CHECKS, AGAINST A BUILT ADMINIUM, ON EVERY ENGINE.
 *
 * This repo's `manifest.json` installed with Invoices & Receipts on a BUILT
 * Adminium (no sample: every row here is made by the check that reads it), on
 * SQLite, Postgres and MySQL, and spoken to over HTTP only:
 *
 *   1. TOTALS — a thousand random proposals and invoices (stage invoices of
 *      accepted proposals among them), written through the data API with
 *      random lines, quantities, rates, discounts, tax rates and currencies of
 *      0, 2 and 3 minor units, sent and paid at random: every stored line
 *      amount, subtotal, tax, total, paid and balance equals a reference worked
 *      out here in whole minor units (BigInt, half away from zero), from the
 *      rules the manifest and the add-on's shapes state;
 *   2. NUMBERS — twenty invoices, twenty receipts and twenty proposals made at
 *      once, each: no number twice, none skipped, the whole series unbroken;
 *   3. LOCKED ONCE SENT — a sent invoice's lines refuse every change and every
 *      removal from Studio, Studio manager, a super admin, an API key and a
 *      client's page; a numbered invoice is never deleted, only voided;
 *   4. OVERPAYMENT — a payment above the balance is refused, also when two
 *      desks pay at once: what is accepted never adds up past the total;
 *   5. CLIENT SIGN-IN — only the emailed link (or its code) opens a session:
 *      the address lookup answers no one; the reply and its timing are the
 *      same for a client, a stranger, an address over its cap and one locked;
 *      the link works once, for twenty minutes, only when "Continue" posts it;
 *      it points at the configured address, never at a host a request named;
 *   6. ISOLATION — signed in as one client, every entry the manifest opens to
 *      a client is swept: nothing of another client's, no draft's lines, no
 *      unshared work, no voided draft or payment, no parent reached through a
 *      child that names another, no file of another connection; "not yours"
 *      answers exactly as "does not exist";
 *   7. HELD REMINDERS — an invoice's three reminders are held from its send,
 *      come due on their days, go only when approved, go with the words a
 *      person edited, are skipped when overtaken, paid or voided; the third's
 *      follow-up refused never sends it twice;
 *   8. ANOTHER CONNECTION — the app installed a second time on another
 *      connection: the client's key keeps to its own, so the same ids and the
 *      same address there reach nothing.
 *
 * Runs where the plain contract runs (`contract.test.ts`); its own servers
 * (`CONTRACT_ACCEPT_PORT_BASE`) and databases, so the files run side by side.
 * `ACCEPT_DOCUMENTS` sets how many random documents (1,000), `ACCEPT_SEED`
 * replays a run (the seed is printed).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { performance } from "node:perf_hooks";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEMO_START, DEMO_ZONE } from "../lib/clock.ts";
import { DEMO_SETTINGS } from "../demo/sample.ts";
import { addOnBundle, appBundle, boot, Caller, ENGINES, missing, ok, otherDatabase, PORTS_PER_ENGINE, solve, until, type Engine, type Reply, type Server } from "./harness.ts";

type Row = Record<string, unknown> & { id: number };

const REQUIRED = ["1", "true"].includes(process.env["ADMINIUM_REQUIRE_CONTRACT"] ?? "");
const why = missing();
if (why !== null && REQUIRED) throw new Error(`the acceptance contract must run here, and cannot: ${why}`);
/** After the plain, update and roles contracts' engines (or `CONTRACT_ACCEPT_PORT_BASE`). */
const PORT_BASE = Number(process.env["CONTRACT_ACCEPT_PORT_BASE"] ?? Number(process.env["CONTRACT_PORT_BASE"] ?? 4870) + 9 * PORTS_PER_ENGINE);
const database = (engine: Engine) => `cp_accept_${engine}${process.env["CONTRACT_DB_SUFFIX"] ?? ""}`;
const ADMIN = { email: process.env["E2E_ADMIN_EMAIL"] ?? "e2e@adminium.local", password: process.env["E2E_ADMIN_PASSWORD"] ?? "adminium-e2e-password" };
const DOCUMENTS = Number(process.env["ACCEPT_DOCUMENTS"] ?? 1000);
const SEED = Number(process.env["ACCEPT_SEED"] ?? randomBytes(4).readUInt32BE(0));
/**
 * The API keys the thousand documents are written through, each its own rate
 * budget (300 a minute), as many desks would be; and how many write at once.
 */
const DESKS = 40;
const WRITERS = 16;

/** The manifest this repo ships: the public entries the sweep walks. */
interface PublicEntry {
  table: string;
  methods: string[];
  select: string[];
  writable?: string[];
  key?: string;
  claim?: unknown;
  claimedBy?: unknown;
  visibleWith?: unknown;
}
const MANIFEST = JSON.parse(readFileSync(new URL("../../manifest.json", import.meta.url), "utf8")) as { publicAccess: PublicEntry[] };
/** The entries a signed-in client's page is served (the handover link's key is another door). */
const CLIENT_ENTRIES = MANIFEST.publicAccess.filter((e) => e.key === undefined);

// ── exact money ─────────────────────────────────────────────────────────────

/** Minor units of the currencies the documents are written in (ISO 4217). */
const PLACES: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0, CLP: 0, KWD: 3, BHD: 3 };
const TEN = (n: number) => 10n ** BigInt(n);

/** `a / b`, rounded half away from zero (`b > 0`): the rounding the manifest's formulas state. */
function roundDiv(a: bigint, b: bigint): bigint {
  const negative = a < 0n;
  const magnitude = negative ? -a : a;
  let q = magnitude / b;
  if ((magnitude % b) * 2n >= b) q += 1n;
  return negative ? -q : q;
}

/** Whole units at `places` as decimal text: `1234n, 2` → `12.34`. */
function decimal(units: bigint, places: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(places + 1, "0");
  const whole = places === 0 ? digits : digits.slice(0, -places);
  return `${negative ? "-" : ""}${whole}${places === 0 ? "" : `.${digits.slice(-places)}`}`;
}

/**
 * A stored value (Postgres and MySQL hand out text, SQLite a float) as whole
 * units at `places`. `clean` is false when it is not a whole number of units —
 * more than a float's last-digit noise (10⁻⁶ of a unit) away from one.
 */
function unitsOf(value: unknown, places: number): { units: bigint | null; clean: boolean } {
  if (value === null || value === undefined) return { units: null, clean: true };
  const text = typeof value === "number" ? value.toString() : String(value).trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (m === null) return { units: null, clean: false };
  let n = BigInt(`${m[2] === "" ? "0" : m[2]!}${m[3] ?? ""}`);
  let d = TEN((m[3] ?? "").length);
  const e = Number(m[4] ?? 0);
  if (e > 0) n *= TEN(e);
  else if (e < 0) d *= TEN(-e);
  if (m[1] === "-") n = -n;
  const scaled = n * TEN(places);
  const units = roundDiv(scaled, d);
  const residual = scaled - units * d;
  return { units, clean: (residual < 0n ? -residual : residual) * 1_000_000n <= d };
}

/** A seeded generator (mulberry32): the same seed, the same thousand documents. */
function generator(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const big = (lo: bigint, hi: bigint) => lo + BigInt(Math.floor(next() * Number(hi - lo + 1n)));
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
  return { next, int, big, pick, chance: (p: number) => next() < p };
}

interface LineSpec {
  /** Thousandths (the quantity's scale is 3). */
  qty: bigint;
  /** Minor units of the document's currency. */
  rate: bigint;
  kind: "amount" | "percent" | undefined;
  /** Thousandths: an amount off, or a percent off. */
  discount: bigint | null;
}
interface ClientSpec {
  id: number;
  /** Thousandths of a percent, or none. */
  tax: bigint | null;
}
interface DocSpec {
  kind: "invoice" | "proposal";
  client: ClientSpec;
  currency: string | null;
  /** Thousandths of a percent, when the writer names one. */
  tax: bigint | null;
  lines: LineSpec[];
  send: boolean;
  /** Stage invoices of the proposal once accepted: each a share (hundredths of a percent). */
  stages: bigint[];
  /** Each payment: a fraction of what is still owed when it is made (thousandths), and whether it is then voided. */
  payments: { part: bigint; voided: boolean }[];
}

/** One line's amount, as the lines' formula states it: `max(0, qty × rate − discount)` or `max(0, qty × rate × (1 − discount ÷ 100))`, rounded once. */
function lineAmount(line: LineSpec, places: number): bigint {
  const qr = line.qty * line.rate; // units of 10^-(3 + places)
  const d = line.discount ?? 0n;
  if (line.kind === "percent") {
    const exact = qr * (100_000n - d); // 10^-(8 + places)
    return exact <= 0n ? 0n : roundDiv(exact, 100_000_000n);
  }
  const exact = qr - d * TEN(places); // 10^-(3 + places)
  return exact <= 0n ? 0n : roundDiv(exact, 1000n);
}
/** A stage line: `round(rate × share ÷ 100)`, the rate being the proposal's subtotal. */
const stageAmount = (rate: bigint, share: bigint) => roundDiv(rate * share, 10_000n);
/** `round(subtotal × coalesce(tax rate, 0) ÷ 100)`. */
const taxOf = (subtotal: bigint, rate: bigint) => roundDiv(subtotal * rate, 100_000n);

// ── the timing rule ─────────────────────────────────────────────────────────

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
/** The spread of a sample around its median (its median absolute deviation): the noise a gap is judged against. */
const noiseOf = (values: readonly number[]) => {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
};

describe.skipIf(why !== null)(`the Client Portal's acceptance checks against a built Adminium${why === null ? "" : ` — skipped: ${why}`}`, () => {
  ENGINES.forEach(([engine, available], index) => {
    describe.skipIf(!available)(`on ${engine}`, () => {
      const port = PORT_BASE + index * PORTS_PER_ENGINE;
      let server: Server;
      let admin: Caller;
      let studio: Caller;
      let manager: Caller;
      /** Super-admin API keys: the desks the heavy writing goes through. */
      let desks: Caller[] = [];
      let connectionId = "";
      let real: Record<string, string> = {};
      let tableIds: Record<string, string> = {};
      let publishable = "";
      let mailDomain = "";
      /** The server's own zone: Postgres and MySQL hand a day out as the instant of its midnight there (as the desk reads it). */
      let serverZone = "UTC";
      /** The day an instant falls on in `zone`. */
      const dayIn = (instant: string, zone: string): string => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
        return `${parts["year"]!}-${parts["month"]!}-${parts["day"]!}`;
      };
      const dayOf = (value: unknown): string => {
        const text = String(value);
        return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : dayIn(text, serverZone);
      };

      const data = (ref: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tableIds[ref]!)}`;
      const reader = () => desks[0] ?? admin;
      /** Every row of a table, a page at a time; `where` narrows them on the server (a filter tree), so a poll stays cheap. */
      const rows = async (ref: string, as: Caller = reader(), where?: Record<string, unknown>): Promise<Row[]> => {
        const out: Row[] = [];
        const narrowed = where === undefined ? "" : `&where=${encodeURIComponent(JSON.stringify(where))}`;
        for (let offset = 0; ; offset += 200) {
          const page = ok(await as.get<{ data: Row[] }>(`${data(ref)}?limit=200&offset=${String(offset)}${narrowed}`)).data;
          out.push(...page);
          if (page.length < 200) return out;
        }
      };
      const one = async (ref: string, id: number, as: Caller = reader()) => ok(await as.get<{ data: Row }>(`${data(ref)}/${String(id)}`)).data;
      const make = async (ref: string, values: Record<string, unknown>, as: Caller = admin): Promise<Row> => ok(await as.post<{ data: Row }>(data(ref), { values }), 201).data;
      const change = async (ref: string, id: number, values: Record<string, unknown>, as: Caller = admin): Promise<Row> =>
        ok(await as.patch<{ data: Row }>(`${data(ref)}/${String(id)}`, { values })).data;
      const remove = (as: Caller, ref: string, id: number) => as.send("DELETE", `${data(ref)}/${String(id)}?confirm=true`);
      const isRefused = (reply: Reply) => reply.status >= 400 && reply.status < 500;
      let clientSeq = 0;
      /** A client of the studio's, on an address of the run's own. */
      const newClient = async (values: Record<string, unknown> = {}, as: Caller = admin): Promise<Row> => {
        clientSeq += 1;
        const n = String(clientSeq).padStart(4, "0");
        return make("clients", { company: `Client ${n}`, contact_name: `Casey ${n}`, email: `c${n}@${mailDomain}`, ...values }, as);
      };
      /** A document with its lines, as the composer writes it, sent when asked. */
      const document = async (ref: "invoices" | "proposals", values: Record<string, unknown>, lines: Record<string, unknown>[], send: boolean, as: Caller = admin) => {
        const made = await make(ref, values, as);
        const lineRef = ref === "invoices" ? "invoice_lines" : "proposal_lines";
        const madeLines: Row[] = [];
        for (const [i, line] of lines.entries()) madeLines.push(await make(lineRef, { document_id: made.id, position: i + 1, description: `Line ${String(i + 1)}`, ...line }, as));
        const doc = send ? await change(ref, made.id, { status: "sent" }, as) : made;
        return { doc, lines: madeLines };
      };

      // ── the emails a person receives ──────────────────────────────────────

      interface Mail {
        to: string[];
        subject: string;
        text: string;
        receivedAt: number;
      }
      const mails = async (): Promise<Mail[]> => (await (await fetch(`${server.sink}/messages`)).json()) as Mail[];
      const mailsTo = async (email: string) => (await mails()).filter((m) => m.to.some((to) => to.toLowerCase() === email.toLowerCase()));
      const LINK = /(\S+?)\/c#([A-Za-z0-9_-]{43})/;
      const CODE = /Code:\s*(\d{6})/;
      /** The next email to `email` after `seen` of them. */
      const nextMail = async (email: string, seen: number, label = `an email to ${email}`) => until(async () => (await mailsTo(email))[seen], label, 240_000);

      // ── a client's page ───────────────────────────────────────────────────

      interface Answer {
        status: number;
        text: string;
        body: { data?: unknown; error?: { code?: string; details?: Record<string, unknown>; params?: Record<string, unknown> } } | null;
        ms: number;
        headers: Headers;
      }
      /**
       * One request as a client's page makes it. The public API's own per-minute
       * limits are the limits', not the check's: a refusal of that kind moves the
       * server's clock past its window and the request is made again.
       */
      const pub = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> => {
        for (let attempt = 0; ; attempt += 1) {
          const started = performance.now();
          const res = await fetch(`${server.base}${path}`, {
            method,
            headers: { authorization: `Bearer ${publishable}`, origin: server.base, ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const text = await res.text();
          const ms = performance.now() - started;
          if (res.status === 429 && attempt < 5) {
            await server.pass(61_000);
            continue;
          }
          let parsed: Answer["body"] = null;
          try {
            parsed = text === "" ? null : (JSON.parse(text) as Answer["body"]);
          } catch {
            // not JSON
          }
          return { status: res.status, text, body: parsed, ms, headers: res.headers };
        }
      };
      const proof = async (purpose: "claim" | "write") => {
        const challenge = (await pub("GET", `/api/v1/public/challenge?purpose=${purpose}`)).body!.data as { id: string; salt: string; difficulty: number };
        return { "x-adminium-proof": `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}` };
      };
      const askLink = async (email: string, headers: Record<string, string> = {}) => pub("POST", "/api/v1/public/claim/link", { email, lang: "en-US" }, { ...(await proof("claim")), ...headers });
      /** A client signs in by the link Adminium emails them: their session's header. */
      const signIn = async (email: string): Promise<Record<string, string>> => {
        const seen = (await mailsTo(email)).length;
        expect((await askLink(email)).status).toBe(202);
        // The link, not whichever email reaches them first: a client with a sent invoice is sent that too.
        const mail = await until(async () => (await mailsTo(email)).slice(seen).find((m) => LINK.test(m.text)), `${email}'s sign-in link`, 240_000);
        const token = LINK.exec(mail.text)![2]!;
        const verified = await pub("POST", "/api/v1/public/claim/link/verify", { token });
        expect(verified.status, verified.text).toBe(200);
        return { "x-adminium-public-session": (verified.body!.data as { session: string }).session };
      };
      type Refs = Record<string, { actions: string[]; writable: string[]; expose: string[] }>;
      const refsOf = async (as: Record<string, string>) => (await pub("GET", "/api/v1/public/config", undefined, as)).body!.data as { refs: Refs };
      /** The ref a manifest entry is served under: its table's, with the same doors and the same writable columns. */
      const refFor = (refs: Refs, entry: PublicEntry): string => {
        const actions = entry.methods.map((m) => ({ GET: "read", POST: "create", PATCH: "update" })[m] ?? m);
        const table = real[entry.table]!;
        // A ref is its table's name, or that name with a suffix (`_verified`, `_verified_2`, `_claimed`) — never another table's.
        const ofTable = (ref: string) => (ref === table || ref.startsWith(`${table}_`)) && !Object.values(real).some((other) => other.length > table.length && other.startsWith(table) && (ref === other || ref.startsWith(`${other}_`)));
        // A read-only entry is told apart by its doors alone (Adminium lists its columns as `writable` all the same).
        const writable = entry.writable === undefined ? null : [...entry.writable].sort().join(",");
        const found = Object.entries(refs).filter(
          ([ref, r]) => ofTable(ref) && actions.every((a) => r.actions.includes(a as never)) && (writable === null ? r.actions.every((a) => actions.includes(a)) : [...r.writable].sort().join(",") === writable),
        );
        if (found.length !== 1) {
          const near = Object.entries(refs).filter(([ref]) => ofTable(ref)).map(([ref, r]) => ({ ref, actions: r.actions, writable: r.writable }));
          throw new Error(`no single ref serves ${entry.table} ${entry.methods.join("/")} [${(entry.writable ?? []).join(",")}]: ${JSON.stringify(near)}`);
        }
        return found[0]![0];
      };

      beforeAll(async () => {
        server = await boot(engine as Engine, port, DEMO_START, { database: database(engine as Engine) });
        admin = new Caller(server.base, { origin: server.base });
        await admin.signIn(ADMIN.email, ADMIN.password);
        const connections = ok(await admin.get<{ connections: { id: string; name: string }[] }>("/api/v1/connections"));
        connectionId = connections.connections.find((c) => c.name === "northwind")!.id;
        // Not a reserved domain (Adminium's outbox never writes to `.example`): the sink takes every address.
        mailDomain = `accept-${engine}-${randomBytes(3).toString("hex")}.net`;

        // The add-on, then the app — no sample: each check makes the rows it reads.
        const addOn = addOnBundle();
        ok(await admin.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(addOn.integrity)}`, addOn.buffer));
        const app = appBundle();
        const staged = await admin.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(app.integrity)}`, app.buffer);
        expect([200, 201]).toContain(staged.status);
        const body = { key: app.key, version: app.version, connectionId };
        const plan = ok(await admin.post<{ plan: { checksum: string; installable: boolean } }>("/api/v1/apps/plan", body)).plan;
        expect(plan.installable).toBe(true);
        const installed = ok(await admin.post<{ schema: { created: string[] }; rules: { skipped: unknown[] } }>("/api/v1/apps/install", { ...body, planChecksum: plan.checksum }));
        expect(JSON.stringify(installed.rules.skipped)).toBe("[]");
        const created = installed.schema.created;
        const prefix = created.find((name) => name.endsWith("deliverable_versions"))!.slice(0, -"deliverable_versions".length);
        real = Object.fromEntries(created.map((name) => [name.slice(prefix.length), name]));
        const schema = ok(await admin.get<{ model: { tables: { id: string; name: string }[] } }>(`/api/v1/connections/${connectionId}/schema`));
        tableIds = Object.fromEntries(Object.entries(real).map(([ref, name]) => [ref, schema.model.tables.find((t) => t.name === name)!.id]));

        // The studio's clock and currency, and the add-on's settings as the demo's studio set them.
        ok(await admin.patch(`/api/v1/connections/${connectionId}`, { timezone: DEMO_ZONE, currency: "USD" }));
        const values = Object.fromEntries(Object.entries(DEMO_SETTINGS).map(([name, value]) => [name.slice("invoices.".length), value]));
        ok(await admin.put("/api/v1/add-ons/invoices/settings", { values }));
        await make("settings", { name: "Acceptance Studio", reply_to: `desk@${mailDomain}`, phone: "+1 555 0100" });
        // The clients' side, on the address the studio configured.
        ok(await admin.put("/api/v1/public-api", { enabled: true }));
        ok(await admin.put("/api/v1/settings/email", { publicOrigin: server.base }));
        publishable = ok(await new Caller(server.base).get<{ publishableKey: string }>("/apps/clients/customer/surface-config.json")).publishableKey;
        serverZone = ok(await admin.get<{ serverTimezone: string | null }>("/apps/clients/staff/surface-config.json")).serverTimezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

        // The desks: API keys acting as a super admin, each with its own budget.
        const roles = ok(await admin.get<{ roles: { id: string; slug: string }[] }>("/api/v1/roles")).roles;
        const superAdmin = roles.find((r) => r.slug === "super-admin")!;
        desks = [];
        for (let i = 0; i < DESKS; i += 1) {
          const key = ok(await admin.post<{ key: string }>("/api/v1/api-keys", { name: `Desk ${String(i + 1)}`, roleId: superAdmin.id }), 201).key;
          desks.push(new Caller(server.base, { authorization: `Bearer ${key}` }));
        }

        // Two people of the studio, each holding one of the app's roles, signed in by their own password.
        const person = async (email: string, slug: string) => {
          const role = roles.find((r) => r.slug === slug)!;
          const invited = ok(await admin.post<{ invite: { token: string } }>("/api/v1/users", { email, name: slug, roleIds: [role.id] }), 201);
          const password = `${randomBytes(18).toString("base64url")}Aa1!`;
          ok(await new Caller(server.base, { origin: server.base }).post("/api/v1/auth/password/reset", { token: invited.invite.token, newPassword: password }));
          const caller = new Caller(server.base, { origin: server.base });
          await caller.signIn(email, password);
          return caller;
        };
        studio = await person(`studio@${mailDomain}`, "clients-studio");
        manager = await person(`manager@${mailDomain}`, "clients-studio-manager");
      }, 300_000);

      afterAll(async () => {
        await server?.stop();
      });

      // ── 2. numbers ─────────────────────────────────────────────────────────

      it("numbers twenty invoices, twenty receipts and twenty proposals made at once each: no number twice, none skipped, the series unbroken", async () => {
        const client = await newClient({ tax_rate: "0" });
        // Twenty invoices out, each to take one of the twenty payments.
        const owing: Row[] = [];
        for (let i = 0; i < 20; i += 1) owing.push((await document("invoices", { client_id: client.id, title: `Owing ${String(i)}` }, [{ qty: "1", rate: "100" }], true)).doc);
        const callers = [admin, manager, studio, ...desks];
        const at = (i: number) => callers[i % callers.length]!;
        const series = async (ref: string, prefix: string, start: number, make20: (i: number) => Promise<Reply<{ data: Row }>>) => {
          const before = await rows(ref);
          const [first] = [Math.max(start - 1, ...before.map((r) => Number(r["number_seq"])))];
          const made = await Promise.all(Array.from({ length: 20 }, (_, i) => make20(i)));
          expect(made.map((m) => m.status), JSON.stringify(made.find((m) => m.status !== 201)?.body ?? null).slice(0, 400)).toEqual(Array(20).fill(201));
          const numbers = made.map((m) => Number(m.body.data["number_seq"])).sort((a, b) => a - b);
          expect(numbers, `${ref}: twenty at once`).toEqual(Array.from({ length: 20 }, (_, i) => first! + 1 + i));
          for (const m of made) expect(m.body.data["number"]).toBe(`${prefix}${String(m.body.data["number_seq"]).padStart(4, "0")}`);
          // The whole series, from its first number: every one once, none missing.
          const all = (await rows(ref)).map((r) => Number(r["number_seq"])).sort((a, b) => a - b);
          expect(all, `${ref}: the whole series`).toEqual(Array.from({ length: all.length }, (_, i) => start + i));
          expect(new Set((await rows(ref)).map((r) => r["number"])).size).toBe(all.length);
        };
        await series("invoices", "INV-", Number(DEMO_SETTINGS["invoices.number_start_invoice"]), (i) => at(i).post(data("invoices"), { values: { client_id: client.id, title: `At once ${String(i)}` } }));
        await series("payments", "REC-", Number(DEMO_SETTINGS["invoices.number_start_receipt"]), (i) =>
          at(i).post(data("payments"), { values: { document_id: owing[i]!.id, amount: "10", method: "cash", paid_on: "2026-07-28" } }),
        );
        await series("proposals", "QUO-", Number(DEMO_SETTINGS["invoices.number_start_quote"]), (i) => at(i).post(data("proposals"), { values: { client_id: client.id, title: `At once ${String(i)}` } }));
      }, 300_000);

      // ── 3. locked once sent ───────────────────────────────────────────────

      it("keeps a sent invoice's lines as they were for everyone — Studio, Studio manager, a super admin, an API key, the client's page — and voids a numbered invoice, never deletes it", async () => {
        const client = await newClient({ tax_rate: "10" });
        const { doc: sent, lines } = await document("invoices", { client_id: client.id, title: "Locked" }, [{ qty: "2", rate: "150" }, { qty: "1", rate: "75.50" }], true);
        const { doc: draft } = await document("invoices", { client_id: client.id, title: "A numbered draft" }, [{ qty: "1", rate: "20" }], false);
        expect(sent["status"]).toBe("sent");
        expect(draft["number"]).toMatch(/^INV-\d{4}$/);
        const linesBefore = JSON.stringify((await rows("invoice_lines")).filter((l) => l["document_id"] === sent.id).sort((a, b) => a.id - b.id));
        const invoiceBefore = await one("invoices", sent.id);
        const people: [string, Caller][] = [
          ["Studio", studio],
          ["Studio manager", manager],
          ["a super admin", admin],
          ["an API key", desks[1]!],
        ];
        const line = lines[0]!;
        for (const [who, as] of people) {
          const attempts: [string, Reply][] = [
            ["change a line's quantity", await as.patch(`${data("invoice_lines")}/${String(line.id)}`, { values: { qty: "5" } })],
            ["change a line's rate", await as.patch(`${data("invoice_lines")}/${String(line.id)}`, { values: { rate: "1" } })],
            ["change a line's wording", await as.patch(`${data("invoice_lines")}/${String(line.id)}`, { values: { description: "Something else" } })],
            ["remove a line", await remove(as, "invoice_lines", line.id)],
            ["add a line", await as.post(data("invoice_lines"), { values: { document_id: sent.id, position: 3, description: "Slipped in", qty: "1", rate: "999" } })],
            ["change every line at once", await as.post(`${data("invoice_lines")}/bulk`, { action: "update", ids: lines.map((l) => l.id), values: { qty: "9" } })],
            ["remove every line at once", await as.post(`${data("invoice_lines")}/bulk`, { action: "delete", ids: lines.map((l) => l.id) })],
            ["delete the sent invoice", await remove(as, "invoices", sent.id)],
            ["delete the numbered draft", await remove(as, "invoices", draft.id)],
          ];
          for (const [what, reply] of attempts) expect([who, what, reply.status, isRefused(reply)], JSON.stringify(reply.body).slice(0, 300)).toEqual([who, what, reply.status, true]);
          // Only a draft's own lines may be taken out, never a sent one's: the refusal is the state's, not the role's.
          const deleteDraft = attempts.find(([what]) => what === "delete the numbered draft")![1];
          if (who !== "Studio") expect([who, deleteDraft.status, deleteDraft.code]).toEqual([who, 409, "DELETE_REFUSED"]);
        }
        // The client's page has no door to a line at all: reading its own is all it may do.
        const session = await signIn(String(client["email"]));
        const refs = (await refsOf(session)).refs;
        const lineRef = refFor(refs, CLIENT_ENTRIES.find((e) => e.table === "invoice_lines")!);
        expect(refs[lineRef]!.actions).toEqual(["read"]);
        const theirs = await pub("GET", `/api/v1/public/records/${lineRef}`, undefined, session);
        expect((theirs.body!.data as Row[]).map((l) => Number(l.id)).sort()).toEqual(lines.map((l) => Number(l.id)).sort());
        for (const [what, answer] of [
          ["change a line", await pub("PATCH", `/api/v1/public/records/${lineRef}/${String(line.id)}`, { values: { qty: "5" } }, session)],
          ["add a line", await pub("POST", `/api/v1/public/records/${lineRef}`, { values: { document_id: sent.id, qty: "1", rate: "999" } }, { ...session, ...(await proof("write")) })],
          ["remove a line", await pub("DELETE", `/api/v1/public/records/${lineRef}/${String(line.id)}`, undefined, session)],
        ] as const)
          expect([what, answer.status >= 400 && answer.status < 500], answer.text.slice(0, 300)).toEqual([what, true]);
        // Every line as it was, and the invoice's figures with them.
        expect(JSON.stringify((await rows("invoice_lines")).filter((l) => l["document_id"] === sent.id).sort((a, b) => a.id - b.id))).toBe(linesBefore);
        const invoiceAfter = await one("invoices", sent.id);
        for (const column of ["subtotal", "tax", "total", "balance", "number"]) expect([column, invoiceAfter[column]]).toEqual([column, invoiceBefore[column]]);
        // Both numbered invoices are still there; each is voided instead, by the people who may.
        expect((await rows("invoices")).filter((i) => i.id === sent.id || i.id === draft.id)).toHaveLength(2);
        expect(isRefused(await studio.patch(`${data("invoices")}/${String(draft.id)}`, { values: { status: "void", void_reason: "Not Studio's to void" } }))).toBe(true);
        expect((await change("invoices", draft.id, { status: "void", void_reason: "Discarded" }, manager))["status"]).toBe("void");
        expect((await change("invoices", sent.id, { status: "void", void_reason: "Raised in error" }, admin))["status"]).toBe("void");
        // Void, it is kept — and still never deleted.
        const gone = await remove(admin, "invoices", sent.id);
        expect([gone.status, gone.code]).toEqual([409, "DELETE_REFUSED"]);
        expect((await one("invoices", sent.id))["number"]).toBe(sent["number"]);
      }, 300_000);

      // ── 4. overpayment ────────────────────────────────────────────────────

      it("refuses a payment above the balance, also when two desks pay at once: what is accepted never adds up past the total", async () => {
        const client = await newClient({ tax_rate: "0" });
        const { doc: invoice } = await document("invoices", { client_id: client.id, title: "Paid at two desks" }, [{ qty: "4", rate: "250" }], true);
        expect(Number(invoice["total"])).toBe(1000);
        const pay = (as: Caller, amount: string) => as.post<{ data: Row }>(data("payments"), { values: { document_id: invoice.id, amount, method: "bank-transfer", paid_on: "2026-07-28" } });
        const payments = async () => (await rows("payments")).filter((p) => p["document_id"] === invoice.id && !(p["voided"] === true || p["voided"] === 1));
        // One cent over, alone: refused, nothing stored.
        const over = await pay(admin, "1000.01");
        expect([over.status, over.code, over.details["column"], Number(over.details["balance"])]).toEqual([409, "BALANCE_EXCEEDED", "balance", 1000]);
        expect(await payments()).toEqual([]);
        // Ten payments of 150 at once from two desks (the manager's and a super admin's): six fit.
        const desksAtOnce = [manager, admin];
        const burst = await Promise.all(Array.from({ length: 10 }, (_, i) => pay(desksAtOnce[i % 2]!, "150")));
        const accepted = burst.filter((r) => r.status === 201);
        const refused = burst.filter((r) => r.status !== 201);
        expect([accepted.length, refused.length]).toEqual([6, 4]);
        for (const r of refused) expect([r.status, r.code]).toEqual([409, "BALANCE_EXCEEDED"]);
        let held = await one("invoices", invoice.id);
        expect([Number(held["paid"]), Number(held["balance"])]).toEqual([900, 100]);
        // The last hundred, twice at once from the two desks: one goes through.
        const last = await Promise.all([pay(manager, "100"), pay(admin, "100")]);
        expect(last.map((r) => r.status).sort()).toEqual([201, 409]);
        // Nothing more fits, not even a cent.
        const cent = await pay(desks[2]!, "0.01");
        expect([cent.status, cent.code]).toEqual([409, "BALANCE_EXCEEDED"]);
        held = await one("invoices", invoice.id);
        const sum = (await payments()).reduce((total, p) => total + Number(p["amount"]), 0);
        expect([Number(held["paid"]), Number(held["balance"]), sum]).toEqual([1000, 0, 1000]);
        // And a larger burst, across every desk, on a fresh invoice: the sum of what is accepted never passes the total.
        const { doc: second } = await document("invoices", { client_id: client.id, title: "Paid at every desk" }, [{ qty: "1", rate: "999.99" }], true);
        const everyone = [admin, manager, studio, ...desks];
        const rush = await Promise.all(Array.from({ length: 24 }, (_, i) => everyone[i % everyone.length]!.post<{ data: Row }>(data("payments"), { values: { document_id: second.id, amount: "77.77", method: "card", paid_on: "2026-07-28" } })));
        const through = rush.filter((r) => r.status === 201).length;
        expect(rush.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.code === "BALANCE_EXCEEDED")).toBe(true);
        expect(through).toBe(Math.floor(999.99 / 77.77));
        const stored = await one("invoices", second.id);
        expect(unitsOf(stored["paid"], 2).units).toBe(7777n * BigInt(through));
        expect(unitsOf(stored["balance"], 2).units).toBe(99_999n - 7777n * BigInt(through));
      }, 180_000);

      // ── 5. client sign-in ─────────────────────────────────────────────────

      it("opens a client's session only by the emailed link or its code, answering every address alike", async () => {
        const real1 = await newClient({ contact_name: "Robin Real" });
        const email = String(real1["email"]);
        // The address lookup opens nothing, for a client or a stranger, and says the same to both.
        const lookup = async (address: string) => pub("POST", "/api/v1/public/claim", { match: { email: address } }, await proof("claim"));
        const [asClient, asStranger] = [await lookup(email), await lookup(`x${email}`)];
        expect([asClient.status, asClient.body?.error?.code]).toEqual([403, "PUBLIC_CLAIM_UNAVAILABLE"]);
        expect(asClient.text).toBe(asStranger.text);
        expect(asClient.text).not.toMatch(/session/i);

        // The link: to the configured address, the token in the fragment only.
        const seen = (await mailsTo(email)).length;
        const asked = await askLink(email);
        expect([asked.status, asked.body]).toEqual([202, { data: { sentTo: `${email[0]!}•••@${mailDomain[0]!}•••.net` } }]);
        const mail = await nextMail(email, seen);
        const [, base, token] = LINK.exec(mail.text)!;
        expect(base).toBe(`${server.base}/apps/clients/customer`);
        const code = CODE.exec(mail.text)?.[1];
        expect(code).toMatch(/^\d{6}$/);
        // A mail scanner opening the link (a GET, with or without the token in the address) spends nothing and signs no one in.
        for (const url of [`${base!}/c#${token!}`, `${base!}/c?token=${token!}`, `${base!}/c/${token!}`]) {
          const res = await fetch(url, { redirect: "manual" });
          await res.text();
          expect(res.headers.get("set-cookie") ?? "", url).not.toMatch(/public|session/i);
        }
        // The Continue page's greeting spends nothing either (what it says is its own check, below).
        const peek = await pub("POST", "/api/v1/public/claim/link/peek", { token });
        expect([peek.status, typeof (peek.body?.data as { firstName?: unknown } | undefined)?.firstName]).toEqual([200, "string"]);
        // "Continue": the one session — then never again.
        const first = await pub("POST", "/api/v1/public/claim/link/verify", { token });
        expect([first.status, (first.body?.data as { level: string }).level]).toEqual([200, "verified"]);
        const session = { "x-adminium-public-session": (first.body!.data as { session: string }).session };
        expect((await pub("GET", "/api/v1/public/config", undefined, session)).status).toBe(200);
        const again = await pub("POST", "/api/v1/public/claim/link/verify", { token });
        expect([again.status, again.body?.error?.code]).toEqual([410, "LINK_EXPIRED"]);
        // Its code, from the same email, is one sign-in too: the link's own, spent with it.
        const spentCode = await pub("POST", "/api/v1/public/claim/link/verify", { email, code });
        expect(spentCode.status).not.toBe(200);

        // Twenty minutes: a link is good for 19 of them, and not at 20 and a few seconds.
        const inTime = await newClient({ contact_name: "Ina Time" });
        const late = await newClient({ contact_name: "Lee Late" });
        const tokenFor = async (address: string) => {
          const before = (await mailsTo(address)).length;
          expect((await askLink(address)).status).toBe(202);
          const got = await nextMail(address, before);
          return { token: LINK.exec(got.text)![2]!, code: CODE.exec(got.text)![1]! };
        };
        const early = await tokenFor(String(inTime["email"]));
        const lateLink = await tokenFor(String(late["email"]));
        await server.pass(19 * 60_000);
        expect((await pub("POST", "/api/v1/public/claim/link/verify", { token: early.token })).status).toBe(200);
        await server.pass(90_000);
        const expired = await pub("POST", "/api/v1/public/claim/link/verify", { token: lateLink.token });
        expect([expired.status, expired.body?.error?.code]).toEqual([410, "LINK_EXPIRED"]);
        // The code on another device: once, within the same twenty minutes.
        const byCode = await newClient({ contact_name: "Cody Code" });
        const codeLink = await tokenFor(String(byCode["email"]));
        const withCode = await pub("POST", "/api/v1/public/claim/link/verify", { email: byCode["email"], code: codeLink.code });
        expect([withCode.status, (withCode.body?.data as { level: string } | undefined)?.level]).toEqual([200, "verified"]);
        expect((await pub("POST", "/api/v1/public/claim/link/verify", { email: byCode["email"], code: codeLink.code })).status).not.toBe(200);
        expect((await pub("POST", "/api/v1/public/claim/link/verify", { token: codeLink.token })).status).toBe(410);

        // A request naming another host — its Host, Origin and forwarding headers — still gets a link to the configured address.
        const forged = await newClient({ contact_name: "Fay Forged" });
        const forgedEmail = String(forged["email"]);
        const before = (await mailsTo(forgedEmail)).length;
        const raw = (headers: Record<string, string>, body: string) =>
          new Promise<number>((resolve, reject) => {
            const req = httpRequest(`${server.base}/api/v1/public/claim/link`, { method: "POST", headers: { ...headers, "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } }, (res) => {
              res.resume();
              res.on("end", () => resolve(res.statusCode ?? 0));
            });
            req.on("error", reject);
            req.end(body);
          });
        const evil = "evil.example";
        const statuses: number[] = [];
        // (a) everything forged alike, so the page looks like its own origin to the server;
        statuses.push(
          await raw(
            { host: `${evil}:8443`, origin: `https://${evil}:8443`, "x-forwarded-host": evil, "x-forwarded-proto": "https", forwarded: `host=${evil};proto=https`, authorization: `Bearer ${publishable}`, ...(await proof("claim")) },
            JSON.stringify({ email: forgedEmail, lang: "en-US" }),
          ),
        );
        // (b) the page's own Host and Origin, the forwarding headers forged.
        statuses.push(
          await raw(
            { host: new URL(server.base).host, origin: server.base, "x-forwarded-host": evil, "x-forwarded-proto": "https", forwarded: `host=${evil};proto=https`, authorization: `Bearer ${publishable}`, ...(await proof("claim")) },
            JSON.stringify({ email: forgedEmail, lang: "en-US" }),
          ),
        );
        expect(statuses[1]).toBe(202);
        await nextMail(forgedEmail, before);
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const forgedMails = (await mailsTo(forgedEmail)).slice(before);
        expect(forgedMails.length).toBe(statuses.filter((s) => s === 202).length);
        for (const m of forgedMails) {
          expect(m.text).not.toContain(evil);
          expect(LINK.exec(m.text)![1]).toBe(`${server.base}/apps/clients/customer`);
        }
        console.info(`[sign-in, ${engine}] a forged request was answered ${String(statuses[0])} (all forged) and ${String(statuses[1])} (forwarding forged); every link it sent points at ${server.base}`);

        // The code path locks alike for a client and a stranger: the same answers, try by try.
        const locked = await newClient({ contact_name: "Lou Locked" });
        const lockedEmail = String(locked["email"]);
        const stranger = `${lockedEmail[0]!}zz${lockedEmail.slice(1)}`;
        expect((await askLink(stranger)).status).toBe(202);
        const lockedLink = await tokenFor(lockedEmail);
        // The stranger's decoy link is made by the same background step as the client's real one: let it run.
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const wrong = String((Number(lockedLink.code) + 1) % 1_000_000).padStart(6, "0");
        const trail = { client: [] as string[], stranger: [] as string[] };
        for (let i = 0; i < 12; i += 1) {
          for (const [who, address] of [["client", lockedEmail], ["stranger", stranger]] as const) {
            const answer = await pub("POST", "/api/v1/public/claim/link/verify", { email: address, code: wrong });
            trail[who].push(`${String(answer.status)} ${answer.body?.error?.code ?? ""} ${JSON.stringify(answer.body?.error?.details ?? answer.body?.error?.params ?? {})}`);
          }
        }
        expect(trail.client).toEqual(trail.stranger);
        expect(trail.client.at(-1)).toMatch(/^403 PUBLIC_CLAIM_LOCKED/);
        // Locked on the code, the link still works: the lock is the code's only.
        expect((await pub("POST", "/api/v1/public/claim/link/verify", { token: lockedLink.token })).status).toBe(200);

        // THE SAME REPLY, IN THE SAME TIME, for a client, a stranger, a client over the per-address cap, and one locked.
        const SAMPLES = 25;
        const capped = await newClient({ contact_name: "Cap Over" });
        const cappedEmail = String(capped["email"]);
        for (let i = 0; i < 11; i += 1) expect((await askLink(cappedEmail)).status).toBe(202);
        const clientsToAsk: string[] = [];
        for (let i = 0; i < SAMPLES; i += 1) clientsToAsk.push(String((await newClient({ contact_name: `Tia Timing ${String(i)}` }))["email"]));
        // Strangers whose masked address reads exactly as a client's: the same first letter, the same domain.
        const strangers = clientsToAsk.map((address) => `${address[0]!}q${address.slice(1)}`);
        const times: Record<"client" | "stranger" | "capped" | "locked", number[]> = { client: [], stranger: [], capped: [], locked: [] };
        const replies = new Map<string, Set<string>>();
        let sinceMove = 0;
        const shuffle = generator(SEED + 99);
        for (let i = 0; i < SAMPLES; i += 1) {
          const round: ["client" | "stranger" | "capped" | "locked", string][] = [
            ["client", clientsToAsk[i]!],
            ["stranger", strangers[i]!],
            ["capped", cappedEmail],
            ["locked", lockedEmail],
          ];
          round.sort(() => shuffle.next() - 0.5);
          for (const [kind, address] of round) {
            // The link door takes five a minute from one page: the clock moves past its window between rounds, never inside a measurement.
            if (sinceMove === 5) {
              await server.pass(61_000);
              sinceMove = 0;
            }
            const headers = await proof("claim");
            const answer = await pub("POST", "/api/v1/public/claim/link", { email: address, lang: "en-US" }, headers);
            sinceMove += 1;
            expect([kind, answer.status]).toEqual([kind, 202]);
            times[kind].push(answer.ms);
            const shape = answer.text.replace(address[0]!, "?");
            replies.set(kind, (replies.get(kind) ?? new Set()).add(shape));
          }
        }
        // One reply, byte for byte, whoever typed what (the address masked alike: its first letter, its domain's).
        expect(new Set([...replies.values()].flatMap((s) => [...s])).size).toBe(1);
        const report = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, { median: Number(median(v).toFixed(2)), noise: Number(noiseOf(v).toFixed(2)) }]));
        console.info(`[sign-in timing, ${engine}] ${String(SAMPLES)} tries each, milliseconds: ${JSON.stringify(report)}`);
        for (const kind of ["stranger", "capped", "locked"] as const) {
          const gap = Math.abs(median(times.client) - median(times[kind]));
          // As alike as noise allows: within three times the larger spread, a fifth of the larger median, and never under 2 ms.
          const allowed = Math.max(2, 3 * Math.max(noiseOf(times.client), noiseOf(times[kind])), 0.2 * Math.max(median(times.client), median(times[kind])));
          expect(gap, `client ${median(times.client).toFixed(2)} ms vs ${kind} ${median(times[kind]).toFixed(2)} ms (allowed ${allowed.toFixed(2)} ms)`).toBeLessThanOrEqual(allowed);
        }
        // Behind the same reply, every client was really sent their link (the emails go out one after another, after the replies) ...
        await until(async () => {
          const got = await mails();
          return clientsToAsk.every((address) => got.some((m) => m.to.includes(address))) ? true : undefined;
        }, "every client's link to arrive", 400_000);
        // ... and over its cap, a client is sent no more links than the cap: the extra asks were answered, and nothing went.
        expect((await mailsTo(cappedEmail)).length).toBeLessThanOrEqual(10);
        // A stranger is never written to.
        for (const address of strangers) expect(await mailsTo(address)).toEqual([]);
      }, 600_000);

      it("DEFECT: the link's Continue page greets the client by their first name, and by nothing else", async () => {
        // Adminium greets with the first word of the sign-in entry's first `select` column, a rule no guide states,
        // rather than the person's name the manifest already declares (the outbox's recipient name, `contact_name`).
        // The `clients` entry lists `id` first, as every entry does, so the page is handed "".
        const client = await newClient({ contact_name: "Dana Greeted" });
        const email = String(client["email"]);
        const seen = (await mailsTo(email)).length;
        expect((await askLink(email)).status).toBe(202);
        const token = LINK.exec((await nextMail(email, seen)).text)![2]!;
        const peek = await pub("POST", "/api/v1/public/claim/link/peek", { token });
        expect([peek.status, peek.body?.data]).toEqual([200, { firstName: "Dana" }]);
      }, 120_000);

      it("DEFECT: a client's page can tell the day an invoice falls due", async () => {
        // On Postgres and MySQL a `date` comes out of the APIs as the instant of the server's local midnight
        // (`2026-08-13T22:00:00.000Z` for the 14th on a server in Berlin). The staff side reads it on the
        // `serverTimezone` its config carries; nothing a client's page is served names that zone, so the page
        // can only guess — and on UTC, a day early on every server east of it.
        const client = await newClient({ contact_name: "Dee Dated" });
        const { doc } = await document("invoices", { client_id: client.id, title: "Dated", terms: "net7" }, [{ qty: "1", rate: "50" }], true);
        const due = "2026-08-14";
        expect(dayOf((await change("invoices", doc.id, { due_on: due }))["due_on"])).toBe(due);
        const session = await signIn(String(client["email"]));
        const invoicesRef = refFor((await refsOf(session)).refs, CLIENT_ENTRIES.find((e) => e.table === "invoices" && e.methods.includes("GET"))!);
        const value = String(((await pub("GET", `/api/v1/public/records/${invoicesRef}/${String(doc.id)}`, undefined, session)).body!.data as Row)["due_on"]);
        // Everything the page is told: its surface's config and the public config.
        const surface = ok(await new Caller(server.base).get<{ serverTimezone?: string }>("/apps/clients/customer/surface-config.json"));
        const config = (await pub("GET", "/api/v1/public/config", undefined, session)).body!.data as { serverTimezone?: string };
        const zone = surface.serverTimezone ?? config.serverTimezone ?? null;
        const onPage = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : zone === null ? `${value}, with no zone to read it in` : dayIn(value, zone);
        expect(onPage).toBe(due);
      }, 120_000);

      // ── 6. isolation ──────────────────────────────────────────────────────

      it("shows a signed-in client only their own rows through every entry, and answers 'not yours' exactly as 'does not exist'", async () => {
        // Two clients, each with the whole of a studio's work.
        const world = async (name: string) => {
          const client = await newClient({ contact_name: `${name} Person`, company: `${name} Ltd` });
          const terms = await make("terms_versions", { note: `${name}'s terms` });
          await make("terms_clauses", { version_id: terms.id, position: 1, title: `${name} clause`, body: "Payment in 14 days." });
          ok(await admin.patch(`${data("terms_versions")}/${String(terms.id)}`, { values: { status: "in_force" } }));
          const draftTerms = await make("terms_versions", { note: `${name}'s draft terms` });
          await make("terms_clauses", { version_id: draftTerms.id, position: 1, title: `${name} draft clause`, body: "Not agreed yet." });
          const sentProposal = await document("proposals", { client_id: client.id, title: `${name} sent`, terms_version_id: terms.id, valid_until: "2026-12-31" }, [{ qty: "1", rate: "500" }], true);
          const draftProposal = await document("proposals", { client_id: client.id, title: `${name} draft`, terms_version_id: draftTerms.id }, [{ qty: "1", rate: "400" }], false);
          const project = await make("projects", { client_id: client.id, name: `${name} project` });
          const milestone = await make("milestones", { project_id: project.id, title: `${name} milestone` });
          const shared = await make("deliverables", { project_id: project.id, milestone_id: milestone.id, title: `${name} shared work` });
          const sharedVersion = await make("deliverable_versions", { deliverable_id: shared.id, note: "v1" });
          await change("deliverables", shared.id, { status: "pending" });
          const note = await make("deliverable_notes", { deliverable_id: shared.id, version_id: sharedVersion.id, body: `${name}: a studio note` });
          const unshared = await make("deliverables", { project_id: project.id, title: `${name} unshared work` });
          const unsharedVersion = await make("deliverable_versions", { deliverable_id: unshared.id, note: "not yet" });
          const unsharedNote = await make("deliverable_notes", { deliverable_id: unshared.id, body: `${name}: private` });
          const brief = await make("briefs", { project_id: project.id });
          const answer = await make("brief_answers", { brief_id: brief.id, question_key: "goals", answer: `${name}'s goals` });
          const sentInvoice = await document("invoices", { client_id: client.id, project_id: project.id, title: `${name} sent invoice` }, [{ qty: "2", rate: "300" }], true);
          const payment = await make("payments", { document_id: sentInvoice.doc.id, amount: "100", method: "card", paid_on: "2026-07-28" });
          const voidedPayment = await make("payments", { document_id: sentInvoice.doc.id, amount: "50", method: "card", paid_on: "2026-07-28" });
          await change("payments", voidedPayment.id, { voided: true, void_reason: "Bounced" });
          const draftInvoice = await document("invoices", { client_id: client.id, title: `${name} draft invoice` }, [{ qty: "1", rate: "250" }], false);
          const voidedDraft = await document("invoices", { client_id: client.id, title: `${name} voided draft` }, [{ qty: "1", rate: "90" }], false);
          await change("invoices", voidedDraft.doc.id, { status: "void", void_reason: "Discarded draft" });
          return {
            client,
            // What this client may read, table by table.
            visible: {
              clients: [client.id],
              proposals: [sentProposal.doc.id],
              proposal_lines: sentProposal.lines.map((l) => l.id),
              terms_versions: [terms.id],
              terms_clauses: [] as number[],
              projects: [project.id],
              milestones: [milestone.id],
              deliverables: [shared.id],
              deliverable_versions: [sharedVersion.id],
              deliverable_notes: [note.id],
              briefs: [brief.id],
              brief_answers: [answer.id],
              invoices: [sentInvoice.doc.id],
              invoice_lines: sentInvoice.lines.map((l) => l.id),
              payments: [payment.id],
            } as Record<string, number[]>,
            // What it never reads, though it is theirs: drafts, their lines, unshared work, the voided.
            hidden: {
              proposals: [draftProposal.doc.id],
              proposal_lines: draftProposal.lines.map((l) => l.id),
              terms_versions: [draftTerms.id],
              deliverables: [unshared.id],
              deliverable_versions: [unsharedVersion.id],
              deliverable_notes: [unsharedNote.id],
              invoices: [draftInvoice.doc.id, voidedDraft.doc.id],
              invoice_lines: [...draftInvoice.lines, ...voidedDraft.lines].map((l) => l.id),
              payments: [voidedPayment.id],
            } as Record<string, number[]>,
            rows: { terms, draftTerms, sentProposal: sentProposal.doc, draftProposal: draftProposal.doc, project, shared, sharedVersion, unshared, unsharedVersion, brief, answer, sentInvoice: sentInvoice.doc, draftInvoice: draftInvoice.doc, payment },
          };
        };
        const a = await world("Ada");
        const b = await world("Bea");
        for (const w of [a, b]) {
          const clauses = (await rows("terms_clauses")).filter((c) => c["version_id"] === w.rows.terms.id || c["version_id"] === w.rows.draftTerms.id);
          w.visible["terms_clauses"] = clauses.filter((c) => c["version_id"] === w.rows.terms.id).map((c) => c.id);
          w.hidden["terms_clauses"] = clauses.filter((c) => c["version_id"] === w.rows.draftTerms.id).map((c) => c.id);
        }
        // A child row carrying A's client id under B's parent is still B's: the desk's column is no key.
        const misfiled = await make("milestones", { project_id: b.rows.project.id, title: "Bea's, marked Ada's" });
        const relabelled = await admin.patch(`${data("milestones")}/${String(misfiled.id)}`, { values: { client_id: a.client.id } });
        const relabelledTo = (await one("milestones", misfiled.id))["client_id"];
        console.info(`[isolation, ${engine}] a staff write of a child's client id answered ${String(relabelled.status)}; stored ${JSON.stringify(relabelledTo)}`);
        if (relabelled.status === 200) expect(relabelledTo).toBe(a.client.id);
        b.visible["milestones"]!.push(misfiled.id);

        const session = await signIn(String(a.client["email"]));
        const { refs } = await refsOf(session);
        const unknownId = 987_654_321;
        const record = (ref: string, id: number) => pub("GET", `/api/v1/public/records/${ref}/${String(id)}`, undefined, session);
        const listAll = async (ref: string) => {
          const out: Row[] = [];
          for (let offset = 0; ; offset += 200) {
            const page = await pub("GET", `/api/v1/public/records/${ref}?limit=200&offset=${String(offset)}`, undefined, session);
            expect(page.status, `${ref}: ${page.text.slice(0, 200)}`).toBe(200);
            const list = page.body!.data as Row[];
            out.push(...list);
            if (list.length < 200) return out;
          }
        };
        const swept: string[] = [];
        // Every read entry: the list holds A's visible rows and nothing else; any other row answers as a missing one.
        for (const entry of CLIENT_ENTRIES.filter((e) => e.methods.includes("GET"))) {
          const ref = refFor(refs, entry);
          const list = await listAll(ref);
          const own = a.visible[entry.table];
          if (own === undefined) {
            // The studio's own public rows (its name, its people, its brief questions): no client's row among them.
            expect(Object.keys(list[0] ?? {}).every((c) => entry.select.includes(c)), entry.table).toBe(true);
            swept.push(`${entry.table} (the studio's)`);
            continue;
          }
          const ids = list.map((r) => Number(r["id"] ?? NaN)).sort((x, y) => x - y);
          expect([entry.table, ids]).toEqual([entry.table, own.map(Number).sort((x, y) => x - y)]);
          for (const row of list) expect([entry.table, Object.keys(row).filter((c) => !entry.select.includes(c))]).toEqual([entry.table, []]);
          const missing = await record(ref, unknownId);
          expect([entry.table, missing.status]).toEqual([entry.table, 404]);
          const notYours = [...(b.visible[entry.table] ?? []), ...(b.hidden[entry.table] ?? []), ...(a.hidden[entry.table] ?? [])];
          for (const id of notYours) {
            const answer = await record(ref, id);
            expect([entry.table, id, answer.status, answer.text]).toEqual([entry.table, id, 404, missing.text]);
          }
          if (own.length > 0) expect((await record(ref, own[0]!)).status).toBe(200);
          swept.push(`${entry.table} (${String(own.length)} own, ${String(notYours.length)} not)`);
        }
        // Every write entry, aimed at a row that is not A's: the same answer as a row that does not exist.
        const patchAnswer = async (ref: string, id: number, values: Record<string, unknown>) => pub("PATCH", `/api/v1/public/records/${ref}/${String(id)}`, { values }, session);
        const writes: [PublicEntry, number[], Record<string, unknown>][] = [];
        for (const entry of CLIENT_ENTRIES.filter((e) => e.methods.includes("PATCH"))) {
          const w = entry.writable ?? [];
          const values: Record<string, unknown> =
            entry.table === "proposals"
              ? w.includes("decline_note")
                ? { status: "declined", decline_note: "No" }
                : w.includes("new_price_asked")
                  ? { new_price_asked: true }
                  : w.includes("status")
                    ? { status: "accepted", signed_name: "Ada Person" }
                    : { signed_name: "Ada Person" }
              : entry.table === "deliverables"
                ? { status: "approved" }
                : entry.table === "briefs"
                  ? { status: "sent" }
                  : entry.table === "invoices"
                    ? { client_paid: true, client_paid_on: "2026-07-28" }
                    : { answer: "Not mine" };
          const targets: Record<string, number[]> = {
            proposals: [b.rows.sentProposal.id, a.rows.draftProposal.id, b.rows.draftProposal.id],
            deliverables: [b.rows.shared.id, a.rows.unshared.id],
            briefs: [b.rows.brief.id],
            invoices: [b.rows.sentInvoice.id, a.rows.draftInvoice.id],
            brief_answers: [b.rows.answer.id],
          };
          writes.push([entry, targets[entry.table] ?? [], values]);
        }
        for (const [entry, targets, values] of writes) {
          const ref = refFor(refs, entry);
          const missing = await patchAnswer(ref, unknownId, values);
          expect([entry.table, missing.status]).toEqual([entry.table, 404]);
          for (const id of targets) {
            const answer = await patchAnswer(ref, id, values);
            expect([entry.table, entry.writable, id, answer.status, answer.text]).toEqual([entry.table, entry.writable, id, 404, missing.text]);
          }
          swept.push(`${entry.table} PATCH [${(entry.writable ?? []).join(",")}] (${String(targets.length)} not A's)`);
        }
        // Nothing of B's moved.
        expect((await one("proposals", b.rows.sentProposal.id))["status"]).toBe("sent");
        expect((await one("deliverables", b.rows.shared.id))["status"]).toBe("pending");
        expect((await one("briefs", b.rows.brief.id))["status"]).toBe("open");
        expect((await one("invoices", b.rows.sentInvoice.id))["client_paid"] ?? null).toBeNull();
        expect((await one("brief_answers", b.rows.answer.id))["answer"]).toBe("Bea's goals");

        // The creates: a note under B's work, or under A's naming B's version (or A's own unshared one); an answer in B's brief; a client id of B's.
        const noteEntry = CLIENT_ENTRIES.find((e) => e.table === "deliverable_notes")!;
        const answerEntry = CLIENT_ENTRIES.find((e) => e.table === "brief_answers")!;
        const noteRef = refFor(refs, noteEntry);
        const answerRef = refFor(refs, answerEntry);
        const post = async (ref: string, values: Record<string, unknown>) => pub("POST", `/api/v1/public/records/${ref}`, { values }, { ...session, ...(await proof("write")) });
        const notesBefore = (await rows("deliverable_notes")).length;
        const answersBefore = (await rows("brief_answers")).length;
        const refusedCreates: [string, Answer][] = [
          ["a note on B's work", await post(noteRef, { deliverable_id: b.rows.shared.id, body: "Mine now?" })],
          ["a note on A's work naming B's version", await post(noteRef, { deliverable_id: a.rows.shared.id, version_id: b.rows.sharedVersion.id, body: "Across" })],
          ["a note on A's work naming A's unshared version", await post(noteRef, { deliverable_id: a.rows.shared.id, version_id: a.rows.unsharedVersion.id, body: "Across" })],
          ["a note on A's unshared work", await post(noteRef, { deliverable_id: a.rows.unshared.id, body: "Early" })],
          ["an answer in B's brief", await post(answerRef, { brief_id: b.rows.brief.id, question_key: "goals", answer: "Mine now?" })],
        ];
        for (const [what, answer] of refusedCreates) expect([what, answer.status >= 400 && answer.status < 500], answer.text.slice(0, 300)).toEqual([what, true]);
        expect((await rows("deliverable_notes")).length).toBe(notesBefore);
        expect((await rows("brief_answers")).length).toBe(answersBefore);
        // A client id of B's, supplied: refused, or never B's.
        for (const [ref, values, table] of [
          [noteRef, { deliverable_id: a.rows.shared.id, body: "With B's id", client_id: b.client.id }, "deliverable_notes"],
          [answerRef, { brief_id: a.rows.brief.id, question_key: "budget", answer: "With B's id", client_id: b.client.id }, "brief_answers"],
        ] as const) {
          const answer = await post(ref, values);
          if (answer.status === 201) {
            const stored = (await rows(table)).find((r) => r.id === Number((answer.body!.data as Row)["id"]) || r["body"] === "With B's id" || r["answer"] === "With B's id")!;
            expect([table, stored["client_id"]]).toEqual([table, a.client.id]);
          } else expect([table, answer.status >= 400 && answer.status < 500]).toEqual([table, true]);
          swept.push(`${table} POST with B's client id → ${String(answer.status)}`);
        }
        // Patching an invoice's "I've sent it" with B's client id: refused, or the invoice stays A's.
        const paidEntry = CLIENT_ENTRIES.find((e) => e.table === "invoices" && e.methods.includes("PATCH"))!;
        const withClient = await patchAnswer(refFor(refs, paidEntry), a.rows.sentInvoice.id, { client_paid: true, client_paid_on: "2026-07-28", client_id: b.client.id });
        expect([withClient.status >= 400 && withClient.status < 500, withClient.status === 200]).toContain(true);
        expect((await one("invoices", a.rows.sentInvoice.id))["client_id"]).toBe(a.client.id);
        // A good note, for contrast: stored as A's, from the client.
        const good = await post(noteRef, { deliverable_id: a.rows.shared.id, version_id: a.rows.sharedVersion.id, body: "Looks right" });
        expect(good.status, good.text).toBe(201);
        const goodRow = (await rows("deliverable_notes")).find((n) => n["body"] === "Looks right")!;
        expect([goodRow["client_id"], goodRow["side"]]).toEqual([a.client.id, "client"]);

        // Files: a version's file reaches only its own client, only while shared, and only of this connection.
        const upload = async (connection: string, tableId: string | undefined, name: string) => {
          const query = new URLSearchParams({ filename: name, connectionId: connection, ...(tableId === undefined ? {} : { table: tableId, column: "file" }) });
          const reply = await admin.post<{ data: { id: string }; ref?: string }>(`/api/v1/files?${query.toString()}`, Buffer.from(`%PDF-1.4 ${name}`));
          expect(reply.status, JSON.stringify(reply.body).slice(0, 300)).toBe(201);
          return reply.body.ref ?? reply.body.data.id;
        };
        const versionsTable = tableIds["deliverable_versions"]!;
        await change("deliverable_versions", a.rows.sharedVersion.id, { file: await upload(connectionId, versionsTable, "ada.pdf") });
        await change("deliverable_versions", b.rows.sharedVersion.id, { file: await upload(connectionId, versionsTable, "bea.pdf") });
        await change("deliverable_versions", a.rows.unsharedVersion.id, { file: await upload(connectionId, versionsTable, "ada-unshared.pdf") });
        const versionsRef = refFor(refs, CLIENT_ENTRIES.find((e) => e.table === "deliverable_versions")!);
        const file = (id: number) => pub("GET", `/api/v1/public/files/${versionsRef}/${String(id)}/file`, undefined, session);
        const mine = await file(a.rows.sharedVersion.id);
        expect(mine.status, mine.text.slice(0, 200)).toBe(200);
        expect(mine.text).toContain("ada.pdf");
        const noFile = await file(unknownId);
        expect(noFile.status).toBe(404);
        for (const id of [b.rows.sharedVersion.id, a.rows.unsharedVersion.id]) expect([id, (await file(id)).status, (await file(id)).text]).toEqual([id, 404, noFile.text]);

        // Documents: A draws A's own; B's invoice, proposal, receipt and statement draw nothing.
        const render = (kind: string, ref: string, id: number) => pub("POST", "/api/v1/public/documents/render", { kind, ref, id }, session);
        const invoicesRef = refFor(refs, CLIENT_ENTRIES.find((e) => e.table === "invoices" && e.methods.includes("GET"))!);
        const proposalsRef = refFor(refs, CLIENT_ENTRIES.find((e) => e.table === "proposals" && e.methods.includes("GET"))!);
        const paymentsRef = refFor(refs, CLIENT_ENTRIES.find((e) => e.table === "payments")!);
        const clientsRef = refFor(refs, CLIENT_ENTRIES.find((e) => e.table === "clients")!);
        const ownDoc = await render("invoice", invoicesRef, a.rows.sentInvoice.id);
        console.info(`[isolation, ${engine}] A's own invoice drawn: ${String(ownDoc.status)} ${ownDoc.status >= 400 ? ownDoc.text.slice(0, 300) : ""}`);
        expect([200, 201]).toContain(ownDoc.status);
        // Each kind draws for A's own row, so a refusal below is the row's, never the kind's.
        for (const [kind, ref, id] of [
          ["quote", proposalsRef, a.rows.sentProposal.id],
          ["receipt", paymentsRef, a.rows.payment.id],
          ["statement", clientsRef, a.client.id],
        ] as const) {
          const own = await render(kind, ref, id);
          expect([kind, [200, 201].includes(own.status)], own.text.slice(0, 300)).toEqual([kind, true]);
        }
        const noDoc = await render("invoice", invoicesRef, unknownId);
        expect(noDoc.status).toBe(404);
        for (const [what, kind, ref, id] of [
          ["B's invoice", "invoice", invoicesRef, b.rows.sentInvoice.id],
          ["A's draft invoice", "invoice", invoicesRef, a.rows.draftInvoice.id],
          ["B's proposal", "quote", proposalsRef, b.rows.sentProposal.id],
          ["B's receipt", "receipt", paymentsRef, b.rows.payment.id],
          ["B's statement", "statement", clientsRef, b.client.id],
        ] as const) {
          const answer = await render(kind, ref, id);
          expect([what, answer.status, answer.text]).toEqual([what, 404, noDoc.text]);
        }
        // B draws B's invoice; A cannot open it by its id, nor list it.
        const bSession = await signIn(String(b.client["email"]));
        const bDoc = await pub("POST", "/api/v1/public/documents/render", { kind: "invoice", ref: invoicesRef, id: b.rows.sentInvoice.id }, bSession);
        expect([200, 201]).toContain(bDoc.status);
        const bDocId = (bDoc.body!.data as { id: string }).id;
        const noDocById = await pub("GET", `/api/v1/public/documents/${randomUUID()}`, undefined, session);
        expect([(await pub("GET", `/api/v1/public/documents/${bDocId}`, undefined, session)).text, (await pub("GET", `/api/v1/public/documents/${bDocId}/content`, undefined, session)).status]).toEqual([noDocById.text, 404]);
        const listed = (await pub("GET", "/api/v1/public/documents", undefined, session)).body!.data as { id: string }[];
        expect(listed.map((d) => d.id)).not.toContain(bDocId);
        expect(listed.map((d) => d.id)).toContain((ownDoc.body!.data as { id: string }).id);

        // Another connection: its file, named in A's own shared version, is not served; its row ids reach nothing.
        const other = `cp_accept_other_${engine}${process.env["CONTRACT_DB_SUFFIX"] ?? ""}`;
        const twin = real["invoices"]!;
        const dsn = await otherDatabase(engine as Engine, port, other, [
          `CREATE TABLE ${twin} (id INTEGER PRIMARY KEY, client_id INTEGER, status VARCHAR(10), title VARCHAR(200), issued_on DATE, total DECIMAL(19,4))`,
          `INSERT INTO ${twin} (id, client_id, status, title, issued_on, total) VALUES (${String(unknownId)}, ${String(a.client.id)}, 'sent', 'On the other connection', '2026-07-28', 10), (${String(a.rows.sentInvoice.id)}, ${String(a.client.id)}, 'sent', 'A twin on the other connection', '2026-07-28', 10)`,
        ]);
        const second = ok(await admin.post<{ id: string }>("/api/v1/connections", { name: `second-${engine}`, engine, dsn }), 201);
        const plan = await admin.post<{ plan?: { installable: boolean; problems: unknown[] } }>("/api/v1/apps/plan", { key: appBundle().key, version: appBundle().version, connectionId: second.id });
        // The twin table stands where a second install would go (the plan says so); a second install is its own check, last.
        console.info(`[isolation, ${engine}] the app planned onto a second connection: ${String(plan.status)} installable ${String(plan.body.plan?.installable)}, ${JSON.stringify(plan.body.plan?.problems ?? plan.body).slice(0, 600)}`);
        // Named in A's own shared version (if Adminium lets the desk name it at all), another connection's file is not served.
        const elsewhere = await admin.patch(`${data("deliverable_versions")}/${String(a.rows.sharedVersion.id)}`, { values: { file: await upload(second.id, undefined, "elsewhere.pdf") } });
        console.info(`[isolation, ${engine}] naming another connection's file in a version answered ${String(elsewhere.status)}`);
        if (elsewhere.status === 200) expect([(await file(a.rows.sharedVersion.id)).status, (await file(a.rows.sharedVersion.id)).text]).toEqual([404, noFile.text]);
        else expect(isRefused(elsewhere)).toBe(true);
        expect((await record(invoicesRef, unknownId)).text).toBe((await record(invoicesRef, unknownId + 1)).text);
        expect((await record(invoicesRef, unknownId)).status).toBe(404);
        const ownTwin = await record(invoicesRef, a.rows.sentInvoice.id);
        expect((ownTwin.body!.data as Row)["title"]).toBe("Ada sent invoice");
        swept.push("files and documents of B, A's unshared work, another connection's file and rows");
        console.info(`[isolation, ${engine}] swept: ${swept.join("; ")}`);
        // Every entry the manifest opens to a client was walked.
        const walked = new Set([...CLIENT_ENTRIES.filter((e) => e.methods.includes("GET")), ...writes.map(([e]) => e), noteEntry, answerEntry]);
        expect(CLIENT_ENTRIES.filter((e) => !walked.has(e) && !(e.methods.length === 1 && e.methods[0] === "POST" && e.table === "enquiries"))).toEqual([]);
      }, 600_000);

      // ── 7. held reminders ─────────────────────────────────────────────────

      // After the checks that read the clock as it starts: it moves the server's clock on by weeks.
      it("holds an invoice's three reminders from its send, sends one only when approved, in the edited words, skips the overtaken, paid and void, and never sends one twice", async () => {
        const desk = desks[3]!;
        const zone = DEMO_ZONE;
        const localOf = (iso: unknown) => {
          const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(String(iso))).map((p) => [p.type, p.value]));
          return `${parts["year"]!}-${parts["month"]!}-${parts["day"]!} ${parts["hour"]!}:${parts["minute"]!}`;
        };
        const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
        const FIRM = (DEMO_SETTINGS["invoices.ladders"] as Record<string, number[]>)["firm"]!;
        const messages = async (invoice: number) =>
          (await rows("messages", desk, { column: "invoice_id", op: "eq", value: invoice })).filter((m) => m["invoice_id"] === invoice && String(m["kind"]).startsWith("invoice-rung-")).sort((x, y) => String(x["kind"]).localeCompare(String(y["kind"])));
        const rung = async (invoice: number, n: number) => (await messages(invoice)).find((m) => m["kind"] === `invoice-rung-${String(n)}`)!;
        /** An invoice sent now, on the firm ladder, due on receipt — to a client of its own, whose inbox is its alone. */
        const invoiceFor = async (label: string, projectStatus?: "active" | "done") => {
          const client = await newClient({ contact_name: `${label} Reminded` });
          const project = await make("projects", { client_id: client.id, name: `${label} project` });
          if (projectStatus === "done") await change("projects", project.id, { status: "done" });
          const { doc } = await document("invoices", { client_id: client.id, project_id: project.id, title: `${label} invoice`, terms: "on-receipt", ladder: "firm" }, [{ qty: "1", rate: "400" }], true);
          return { client, project, invoice: doc, email: String(client["email"]) };
        };
        const H = await invoiceFor("Held");
        const P = await invoiceFor("Paid");
        const V = await invoiceFor("Void");
        const E = await invoiceFor("Edited");
        const A = await invoiceFor("Early");
        const S = await invoiceFor("Refused", "done");
        const O = await invoiceFor("Paused", "active");

        // From the send: three reminders, held, each due at 09:00 at the studio on its day of the ladder after the due date.
        for (const x of [H, P, V, E, A, S, O]) {
          const list = await until(async () => {
            const found = await messages(x.invoice.id);
            return found.length === 3 ? found : undefined;
          }, "three reminders");
          expect(list.map((m) => [m["kind"], m["status"]])).toEqual([1, 2, 3].map((n) => [`invoice-rung-${String(n)}`, "held"]));
          const dueOn = dayOf(x.invoice["due_on"]);
          expect(list.map((m) => localOf(m["due"]))).toEqual(FIRM.map((days) => `${addDays(dueOn, days)} 09:00`));
          expect(list.every((m) => m["sent_at"] === null && m["approved_by"] === null)).toBe(true);
        }

        // Paid in full, and voided: their reminders go at the next scan, for that reason.
        ok(await desk.post(data("payments"), { values: { document_id: P.invoice.id, amount: String(P.invoice["total"]), method: "cash", paid_on: "2026-07-28" } }), 201);
        await change("invoices", V.invoice.id, { status: "void", void_reason: "Raised twice" }, desk);
        // The words a person edits on a held reminder: it stays held.
        const edited = { subject: `A word about ${String(E.invoice["number"])}, rewritten ${randomBytes(3).toString("hex")}`, body: "We rewrote this reminder by hand.\n\nIt should arrive in these words." };
        const e1 = await rung(E.invoice.id, 1);
        expect((await change("messages", e1.id, { subject_override: edited.subject, body_override: edited.body }, desk))["status"]).toBe("held");
        // Approved before its day: the desk's "send it early" — it goes at once, its due moved to that moment, never before it.
        const a2 = await rung(A.invoice.id, 2);
        const early = await change("messages", a2.id, { status: "queued" }, desk);
        expect(Date.parse(String(early["due"]))).toBeLessThan(Date.parse(String(a2["due"])));
        // The third reminder, sent early too: its follow-up pauses the project — or, on a finished project, is refused.
        const tag = randomBytes(3).toString("hex");
        for (const x of [S, O]) {
          const third = await rung(x.invoice.id, 3);
          await change("messages", third.id, { status: "queued", subject_override: `Third reminder ${tag} ${String(x.invoice["number"])}` }, desk);
        }
        const sentOnce = async (x: typeof S) => (await mailsTo(x.email)).filter((m) => m.subject === `Third reminder ${tag} ${String(x.invoice["number"])}`);
        await until(async () => ((await sentOnce(S)).length === 1 && (await sentOnce(O)).length === 1 ? true : undefined), "the two third reminders to go", 300_000);
        await until(async () => {
          const [s3, o3] = [await rung(S.invoice.id, 3), await rung(O.invoice.id, 3)];
          return s3["effect_error"] !== null && o3["effect_at"] !== null ? true : undefined;
        }, "the two follow-ups to be settled", 300_000);
        const [s3, o3] = [await rung(S.invoice.id, 3), await rung(O.invoice.id, 3)];
        expect([s3["status"], s3["effect_at"], typeof s3["effect_error"]]).toEqual(["sent", null, "string"]);
        expect([o3["status"], o3["effect_error"]]).toEqual(["sent", null]);
        expect([(await one("projects", S.project.id))["status"], (await one("projects", O.project.id))["status"]]).toEqual(["done", "paused"]);
        await until(async () => ((await rung(A.invoice.id, 2))["status"] === "sent" ? true : undefined), "the early reminder to go", 300_000);
        const a2sent = await rung(A.invoice.id, 2);
        expect(Date.parse(String(a2sent["sent_at"]))).toBeGreaterThanOrEqual(Date.parse(String(a2sent["due"])));
        expect(a2sent["approved_by"]).toBe("Desk 4");

        // The next scan: paid and void skipped for their reasons; the early one's first reminder overtaken; nothing else moved.
        await until(
          async () => {
            const [p, v, a1] = [await messages(P.invoice.id), await messages(V.invoice.id), await rung(A.invoice.id, 1)];
            return p.every((m) => m["status"] === "skipped") && v.every((m) => m["status"] === "skipped") && a1["status"] === "skipped" ? true : undefined;
          },
          "a scan to skip the paid, the void and the overtaken",
          150_000,
        );
        expect((await messages(P.invoice.id)).map((m) => m["skip_reason"])).toEqual(["paid", "paid", "paid"]);
        expect((await messages(V.invoice.id)).map((m) => m["skip_reason"])).toEqual(["void", "void", "void"]);
        expect((await rung(A.invoice.id, 1))["skip_reason"]).toBe("overtaken");
        expect((await rung(A.invoice.id, 3))["status"]).toBe("held");
        expect((await messages(H.invoice.id)).map((m) => m["status"])).toEqual(["held", "held", "held"]);

        // A day on, past the first reminder's 09:00: it is ready (held, due) — and still not sent, however many scans pass.
        const serverClock = async () => {
          const note = await make("client_notes", { client_id: H.client.id, body: "What time is it?" }, desk);
          return Date.parse(String(note["at"]));
        };
        const firstDue = Date.parse(String((await rung(H.invoice.id, 1))["due"]));
        await server.pass(firstDue + 3_600_000 - (await serverClock()));
        // A payment in full on another invoice now: once its reminders are skipped, a scan has run past the first reminder's day.
        const P2 = await invoiceFor("Paid later");
        ok(await desk.post(data("payments"), { values: { document_id: P2.invoice.id, amount: String(P2.invoice["total"]), method: "cash", paid_on: "2026-07-28" } }), 201);
        await until(async () => ((await messages(P2.invoice.id)).every((m) => m["status"] === "skipped") ? true : undefined), "a scan after the first reminder's day", 150_000);
        const h1 = await rung(H.invoice.id, 1);
        expect([h1["status"], Date.parse(String(h1["due"])) <= (await serverClock())]).toEqual(["held", true]);
        // Every email H's client has had is one of a message the desk sent them — none a reminder.
        const toH = (await rows("messages", desk)).filter((m) => m["client_id"] === H.client.id && m["status"] === "sent");
        expect(toH.map((m) => String(m["kind"])).filter((k) => k.startsWith("invoice-rung-"))).toEqual([]);
        expect((await mailsTo(H.email)).length).toBe(toH.length);
        expect((await rung(E.invoice.id, 1))["status"]).toBe("held");

        // Approved now, the edited reminder goes in the edited words.
        const approved = await change("messages", e1.id, { status: "queued" }, desk);
        expect(approved["approved_by"]).toBe("Desk 4");
        const editedMail = await until(async () => (await mailsTo(E.email)).find((m) => m.subject === edited.subject), "the edited reminder", 300_000);
        expect(editedMail.text).toContain("We rewrote this reminder by hand.");
        expect(editedMail.text).toContain("It should arrive in these words.");
        const e1sent = await rung(E.invoice.id, 1);
        expect(Date.parse(String(e1sent["sent_at"]))).toBeGreaterThanOrEqual(Date.parse(String(e1sent["due"])));

        // A week on, past the second reminder's day: the first, never approved, is overtaken; the second is ready, held.
        const secondDue = Date.parse(String((await rung(H.invoice.id, 2))["due"]));
        await server.pass(secondDue + 3_600_000 - (await serverClock()));
        await until(async () => ((await rung(H.invoice.id, 1))["status"] === "skipped" ? true : undefined), "the first reminder to be overtaken", 150_000);
        expect((await rung(H.invoice.id, 1))["skip_reason"]).toBe("overtaken");
        expect((await rung(H.invoice.id, 2))["status"]).toBe("held");
        expect((await rung(H.invoice.id, 3))["status"]).toBe("held");

        // Several scans later, each third reminder went once — the one whose follow-up was refused too — and nothing unapproved went.
        await new Promise((resolve) => setTimeout(resolve, 130_000));
        expect([(await sentOnce(S)).length, (await sentOnce(O)).length]).toEqual([1, 1]);
        expect((await rung(S.invoice.id, 3))["effect_at"]).toBeNull();
        for (const x of [H, P, V, P2]) for (const m of await messages(x.invoice.id)) expect([x.email, m["kind"], m["sent_at"]]).toEqual([x.email, m["kind"], null]);
      }, 900_000);

      it("sends the invoice, its receipt and each reminder in the app's own words, every day in them named", async () => {
        // Adminium fills a date column as `{{x}}`, `{{x.day_month}}` and `{{x.days_since}}`; `{{x.date}}` is a time's
        // alone. An email that asks a date for `.date` is marked failed at send ("nothing fills" it), and its client is
        // sent nothing — as the invoice, its receipt and the first reminder once were.
        const desk = desks[4]!;
        const client = await newClient({ contact_name: "Una Unedited" }, desk);
        const email = String(client["email"]);
        const project = await make("projects", { client_id: client.id, name: "Unedited project" }, desk);
        const { doc: invoice } = await document("invoices", { client_id: client.id, project_id: project.id, title: "Unedited invoice", terms: "on-receipt", ladder: "firm" }, [{ qty: "1", rate: "120" }], true, desk);
        ok(await desk.post(data("payments"), { values: { document_id: invoice.id, amount: "20", method: "cash", paid_on: "2026-07-28" } }), 201);
        const ofInvoice = async () => (await rows("messages", desk, { column: "invoice_id", op: "eq", value: invoice.id })).filter((m) => m["invoice_id"] === invoice.id).sort((x, y) => String(x["kind"]).localeCompare(String(y["kind"])));
        const rungs = await until(async () => {
          const found = (await ofInvoice()).filter((m) => String(m["kind"]).startsWith("invoice-rung-"));
          return found.length === 3 ? found : undefined;
        }, "three reminders");
        // Each reminder approved as it stands, no words changed — one after another, so no later one overtakes an earlier.
        for (const m of rungs) {
          await change("messages", m.id, { status: "queued" }, desk);
          await until(async () => (["sent", "failed"].includes(String((await ofInvoice()).find((r) => r.id === m.id)!["status"])) ? true : undefined), `${String(m["kind"])} to go`);
        }
        const settled = await until(async () => {
          const list = await ofInvoice();
          const done = list.filter((m) => ["invoice-sent", "payment-receipt", "invoice-rung-1", "invoice-rung-2", "invoice-rung-3"].includes(String(m["kind"])) && ["sent", "failed", "skipped"].includes(String(m["status"])));
          return done.length === 5 ? done : undefined;
        }, "the invoice's emails to settle", 180_000);
        const outcome = settled.map((m) => `${String(m["kind"])}: ${String(m["status"])}${m["error"] === null ? "" : ` (${String(m["error"]).slice(0, 120)})`}`);
        console.info(`[emails in their own words, ${engine}] ${outcome.join("; ")}`);
        expect(settled.map((m) => [m["kind"], m["status"], m["error"]])).toEqual(
          ["invoice-rung-1", "invoice-rung-2", "invoice-rung-3", "invoice-sent", "payment-receipt"].map((kind) => [kind, "sent", null]),
        );
        const inbox = await mailsTo(email);
        expect(inbox.some((m) => m.subject === `${String(invoice["number"])} — in case it slipped`)).toBe(true);
      }, 300_000);

      // ── 1. totals ──────────────────────────────────────────────────────────

      // After every check that waits on the app's emails: the thousand documents queue a thousand of them, and
      // Adminium's outbox sends fifty a minute in the order they were made, so anything queued later waits behind them.
      it(`works out every line, subtotal, tax, total, paid and balance of ${String(DOCUMENTS)} random documents exactly as the reference does (seed ${String(SEED)})`, async () => {
        const g = generator(SEED + index);
        const TAX_RATES = [0n, 5_000n, 7_125n, 8_500n, 12_345n, 20_000n, 21_000n, 99n];
        const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CLP", "KWD", "BHD"];
        // Clients with and without a tax rate of their own.
        const clients: ClientSpec[] = [];
        for (let i = 0; i < 12; i += 1) {
          const tax = i % 3 === 0 ? null : g.pick(TAX_RATES);
          // On a reserved domain: Adminium's outbox skips each of their thousand emails when it reaches it, and writes to no one.
          const row = await newClient({ email: `totals-${String(i)}@${engine}-totals.example`, ...(tax === null ? {} : { tax_rate: decimal(tax, 3) }) });
          clients.push({ id: row.id, tax });
        }
        const randomLine = (places: number): LineSpec => {
          const qty = g.chance(0.4) ? BigInt(g.int(1, 20)) * 1000n : g.big(1n, 60_000n);
          const rate = g.chance(0.1) ? 0n : g.big(1n, 5_000n * TEN(places));
          const roll = g.next();
          if (roll < 0.35) return { qty, rate, kind: undefined, discount: null };
          if (roll < 0.65) return { qty, rate, kind: "percent", discount: g.chance(0.1) ? g.big(100_000n, 120_000n) : g.big(0n, 99_999n) };
          // An amount off, in thousandths — now and then more than the line is worth.
          const worth = (qty * rate) / TEN(places);
          return { qty, rate, kind: g.chance(0.5) ? "amount" : undefined, discount: g.chance(0.1) ? worth + g.big(1n, 5_000n) : g.big(0n, worth > 0n ? worth : 1n) };
        };
        const specs: DocSpec[] = [];
        let planned = 0;
        while (planned < DOCUMENTS) {
          const kind = g.chance(0.55) ? "invoice" : "proposal";
          const currency = g.chance(0.45) ? null : g.pick(CURRENCIES);
          const places = PLACES[currency ?? "USD"]!;
          const stages = kind === "proposal" && g.chance(0.08) && planned + 3 <= DOCUMENTS ? g.pick([[5_000n, 5_000n], [4_000n, 3_000n, 3_000n], [3_333n]]) : [];
          // A proposal to be accepted asks for something (Adminium sends none at nothing): its lines carry no discount,
          // a rate and at least one whole unit, so each is worth a minor unit or more.
          const lines = Array.from({ length: g.int(1, 8) }, () => {
            if (stages.length === 0) return randomLine(places);
            const line = { ...randomLine(places), kind: undefined, discount: null, rate: g.big(1n, 5_000n * TEN(places)) };
            return { ...line, qty: line.qty < 1000n ? 1000n : line.qty };
          });
          specs.push({
            kind,
            client: g.pick(clients),
            currency,
            tax: g.chance(0.3) ? g.pick(TAX_RATES) : null,
            lines,
            send: stages.length > 0 || g.chance(0.55),
            stages,
            payments: kind === "invoice" ? Array.from({ length: g.int(0, 3) }, () => ({ part: g.big(1n, 1000n), voided: g.chance(0.15) })) : [],
          });
          planned += 1 + stages.length;
        }

        /** What Adminium must store for each document it was handed, keyed by the document's id. */
        interface Expected {
          ref: "invoices" | "proposals";
          currency: string;
          tax: bigint;
          lines: { id: number; amount: bigint; rate?: bigint; share?: bigint }[];
          subtotal: bigint;
          taxAmount: bigint;
          total: bigint;
          paid: bigint;
          status: string;
        }
        const expected = new Map<string, Expected>();
        const problems: string[] = [];
        const counts = { documents: 0, lines: 0, payments: 0, voided: 0, sent: 0, stages: 0, requests: 0 };
        // Each write goes through the next desk in turn, so no desk's budget runs out.
        let turn = 0;
        const call = async <T,>(_writer: number, method: "post" | "patch", path: string, values: Record<string, unknown>): Promise<Reply<T>> => {
          counts.requests += 1;
          const as = desks[turn++ % desks.length]!;
          return method === "post" ? as.post<T>(path, { values }) : as.patch<T>(path, { values });
        };
        const write = async (as: number, spec: DocSpec) => {
          const ref = spec.kind === "invoice" ? "invoices" : "proposals";
          const lineRef = spec.kind === "invoice" ? "invoice_lines" : "proposal_lines";
          const currency = spec.currency ?? "USD";
          const places = PLACES[currency]!;
          const tax = spec.tax ?? (spec.kind === "invoice" ? (spec.client.tax ?? 8_500n) : 8_500n);
          const values: Record<string, unknown> = { client_id: spec.client.id, title: `Random ${spec.kind}`, client_key: randomUUID() };
          if (spec.currency !== null) values["currency"] = spec.currency;
          if (spec.tax !== null) values["tax_rate"] = decimal(spec.tax, 3);
          const doc = await call<{ data: Row }>(as, "post", data(ref), values);
          if (doc.status !== 201) return problems.push(`${ref} refused: ${doc.status} ${JSON.stringify(doc.body).slice(0, 300)}`);
          counts.documents += 1;
          const id = doc.body.data.id;
          const exp: Expected = { ref, currency, tax, lines: [], subtotal: 0n, taxAmount: 0n, total: 0n, paid: 0n, status: "draft" };
          expected.set(`${ref}:${String(id)}`, exp);
          for (const [i, line] of spec.lines.entries()) {
            const lv: Record<string, unknown> = { document_id: id, position: i + 1, description: `Line ${String(i + 1)}`, qty: decimal(line.qty, 3), rate: decimal(line.rate, places) };
            if (line.kind !== undefined) lv["discount_kind"] = line.kind;
            if (line.discount !== null) lv["discount"] = decimal(line.discount, 3);
            const made = await call<{ data: Row }>(as, "post", data(lineRef), lv);
            if (made.status !== 201) {
              problems.push(`${lineRef} refused: ${made.status} ${JSON.stringify(made.body).slice(0, 300)}`);
              continue;
            }
            counts.lines += 1;
            exp.lines.push({ id: made.body.data.id, amount: lineAmount(line, places) });
          }
          exp.subtotal = exp.lines.reduce((sum, l) => sum + l.amount, 0n);
          exp.taxAmount = taxOf(exp.subtotal, tax);
          exp.total = exp.subtotal + exp.taxAmount;
          // A document goes out only with something to ask for: Adminium refuses a sent one at nothing.
          if (spec.send && exp.total > 0n) {
            const sent = await call(as, "patch", `${data(ref)}/${String(id)}`, { status: "sent" });
            if (sent.status !== 200) problems.push(`${ref} ${String(id)} not sent: ${sent.status} ${JSON.stringify(sent.body).slice(0, 300)}`);
            else {
              exp.status = "sent";
              counts.sent += 1;
            }
          }
          if (spec.kind === "invoice" && exp.status === "sent") {
            for (const payment of spec.payments) {
              const owed = exp.total - exp.paid;
              const amount = (owed * payment.part) / 1000n;
              if (amount < 1n) continue;
              const made = await call<{ data: Row }>(as, "post", data("payments"), { document_id: id, amount: decimal(amount, places), method: "bank-transfer", paid_on: "2026-07-28" });
              if (made.status !== 201) {
                problems.push(`payment of ${decimal(amount, places)} on ${String(id)} refused: ${made.status} ${JSON.stringify(made.body).slice(0, 300)}`);
                continue;
              }
              counts.payments += 1;
              if (payment.voided) {
                const voided = await call(as, "patch", `${data("payments")}/${String(made.body.data.id)}`, { voided: true, void_reason: "Bounced" });
                if (voided.status !== 200) problems.push(`payment ${String(made.body.data.id)} not voided: ${voided.status}`);
                else counts.voided += 1;
                if (voided.status === 200) continue;
              }
              exp.paid += amount;
            }
          }
          // A proposal meant to be staged that stayed a draft leaves its stage invoices unmade: said, never a count that falls short unexplained.
          if (spec.stages.length > 0 && exp.status !== "sent") problems.push(`proposal ${String(id)} worth ${decimal(exp.total, places)} was not sent, so its ${String(spec.stages.length)} stage invoice(s) were never made`);
          // The proposal accepted, and its stage invoices: each line the proposal's subtotal at the stage's share.
          if (spec.kind === "proposal" && spec.stages.length > 0 && exp.status === "sent") {
            const accepted = await call(as, "patch", `${data("proposals")}/${String(id)}`, { status: "accepted" });
            if (accepted.status !== 200) return problems.push(`proposal ${String(id)} not accepted: ${accepted.status} ${JSON.stringify(accepted.body).slice(0, 300)}`);
            exp.status = "accepted";
            for (const share of spec.stages) {
              const stageValues: Record<string, unknown> = { client_id: spec.client.id, proposal_id: id, from_quote_id: id, share_pct: decimal(share, 2), stage: `Stage at ${decimal(share, 2)} %`, title: "Stage" };
              if (spec.currency !== null) stageValues["currency"] = spec.currency;
              const stage = await call<{ data: Row }>(as, "post", data("invoices"), stageValues);
              if (stage.status !== 201) {
                problems.push(`stage invoice refused: ${stage.status} ${JSON.stringify(stage.body).slice(0, 300)}`);
                continue;
              }
              counts.documents += 1;
              counts.stages += 1;
              const line = await call<{ data: Row }>(as, "post", data("invoice_lines"), { document_id: stage.body.data.id, position: 1, description: "Stage", quote_id: id });
              const stageTax = spec.client.tax ?? 8_500n;
              const amount = stageAmount(exp.subtotal, share);
              const sx: Expected = { ref: "invoices", currency, tax: stageTax, lines: [], subtotal: amount, taxAmount: taxOf(amount, stageTax), total: 0n, paid: 0n, status: "draft" };
              sx.total = sx.subtotal + sx.taxAmount;
              if (line.status !== 201) problems.push(`stage line refused: ${line.status} ${JSON.stringify(line.body).slice(0, 300)}`);
              else sx.lines.push({ id: line.body.data.id, amount, rate: exp.subtotal, share });
              expected.set(`invoices:${String(stage.body.data.id)}`, sx);
            }
          }
          return 0;
        };

        const started = performance.now();
        const queue = [...specs];
        await Promise.all(
          Array.from({ length: WRITERS }, async (_, writer) => {
            for (let spec = queue.shift(); spec !== undefined; spec = queue.shift()) await write(writer, spec);
          }),
        );
        const wrote = performance.now() - started;

        // Everything read back, a page at a time, and held to the reference.
        const held = Object.fromEntries(await Promise.all(["invoices", "proposals", "invoice_lines", "proposal_lines"].map(async (ref) => [ref, await rows(ref)] as const)));
        const byId = (ref: string) => new Map(held[ref]!.map((r) => [r.id, r]));
        const docs = { invoices: byId("invoices"), proposals: byId("proposals") };
        const lines = { invoices: byId("invoice_lines"), proposals: byId("proposal_lines") };
        const same = (label: string, value: unknown, places: number, want: bigint) => {
          const got = unitsOf(value, places);
          if (!got.clean || got.units !== want) problems.push(`${label}: stored ${JSON.stringify(value)}, the reference ${decimal(want, places)}`);
        };
        let checked = 0;
        for (const [key, exp] of expected) {
          const id = Number(key.split(":")[1]);
          const row = docs[exp.ref].get(id);
          if (row === undefined) {
            problems.push(`${key} is gone`);
            continue;
          }
          const places = PLACES[exp.currency]!;
          const label = `${key} (${String(row["number"])}, ${exp.currency})`;
          if (row["currency"] !== exp.currency) problems.push(`${label}: currency ${String(row["currency"])}`);
          if (row["status"] !== exp.status) problems.push(`${label}: status ${String(row["status"])}, meant ${exp.status}`);
          same(`${label} tax rate`, row["tax_rate"], 3, exp.tax);
          for (const line of exp.lines) {
            const stored = lines[exp.ref].get(line.id);
            if (stored === undefined) {
              problems.push(`${label} line ${String(line.id)} is gone`);
              continue;
            }
            same(`${label} line ${String(line.id)} amount`, stored["amount"], places, line.amount);
            if (line.rate !== undefined) same(`${label} stage line rate`, stored["rate"], places, line.rate);
            if (line.share !== undefined) same(`${label} stage line share`, stored["share_pct"], 2, line.share);
            checked += 1;
          }
          same(`${label} subtotal`, row["subtotal"], places, exp.subtotal);
          same(`${label} tax`, row["tax"], places, exp.taxAmount);
          same(`${label} total`, row["total"], places, exp.total);
          if (exp.ref === "invoices") {
            same(`${label} paid`, row["paid"] ?? 0, places, exp.paid);
            same(`${label} balance`, row["balance"], places, exp.total - exp.paid);
          }
        }
        console.info(
          `[totals, ${engine}] seed ${String(SEED + index)}: ${String(counts.documents)} documents (${String(counts.stages)} stage invoices, ${String(counts.sent)} sent), ${String(counts.lines)} lines, ${String(counts.payments)} payments (${String(counts.voided)} voided), ${String(counts.requests)} writes by ${String(WRITERS)} writers at once through ${String(DESKS)} desks in ${(wrote / 1000).toFixed(1)} s; ${String(expected.size)} documents and ${String(checked)} lines held to the reference`,
        );
        expect(problems.slice(0, 25), `seed ${String(SEED + index)}: ${String(problems.length)} disagreements`).toEqual([]);
        expect(counts.documents).toBeGreaterThanOrEqual(DOCUMENTS);
      }, 1_800_000);

      // ── the same rows on another connection ───────────────────────────────

      /** A clean database beside the studio's, as a connection of this Adminium: where the app is planned and installed a second time. */
      let third = "";
      const thirdConnection = async (as: Caller) => {
        if (third !== "") return third;
        const name = `cp_accept_third_${engine}${process.env["CONTRACT_DB_SUFFIX"] ?? ""}`;
        const dsn = await otherDatabase(engine as Engine, port, name, ["CREATE TABLE unrelated (id INTEGER PRIMARY KEY)"]);
        third = ok(await as.post<{ id: string }>("/api/v1/connections", { name: `third-${engine}`, engine, dsn }), 201).id;
        return third;
      };

      // After the reminders: a second install of the app moves what the outbox and the desk run against.
      it("DEFECT: an app already installed is offered, and installed, onto a second connection — it should be refused, not split in two", async () => {
        const as = desks[5]!;
        const plan = await as.post<{ plan?: { installable: boolean; problems: { code: string }[] } }>("/api/v1/apps/plan", { key: appBundle().key, version: appBundle().version, connectionId: await thirdConnection(as) });
        console.info(`[second install, ${engine}] planned onto a second connection: ${String(plan.status)} installable ${String(plan.body.plan?.installable)} ${JSON.stringify(plan.body.plan?.problems ?? plan.body).slice(0, 300)}`);
        // One install per app: the plan says it is installed already (or the request is refused outright).
        expect(plan.status !== 200 || plan.body.plan?.installable === false, "the app is installed on the studio's connection already").toBe(true);
      }, 120_000);

      it("keeps a client's session on its own connection: with the app installed on a second one, the same ids and the same address there reach nothing", async () => {
        const as = desks[5]!;
        const home = await newClient({ contact_name: "Hana Home" }, as);
        const homeEmail = String(home["email"]);
        const { doc: homeInvoice } = await document("invoices", { client_id: home.id, title: "Home invoice" }, [{ qty: "1", rate: "10" }], true, as);
        const conn = await thirdConnection(as);
        const plan = await as.post<{ plan?: { installable: boolean; checksum: string } }>("/api/v1/apps/plan", { key: appBundle().key, version: appBundle().version, connectionId: conn });
        if (plan.status !== 200 || plan.body.plan?.installable !== true) {
          // Refused, as it should be: the key then serves the one connection there is, and there is nothing else to reach.
          console.info(`[second install, ${engine}] refused: ${String(plan.status)}`);
          return;
        }
        const installed = await as.post<{ schema: { created: string[] } }>("/api/v1/apps/install", { key: appBundle().key, version: appBundle().version, connectionId: conn, planChecksum: plan.body.plan.checksum });
        expect(installed.status, JSON.stringify(installed.body).slice(0, 300)).toBe(200);
        const schema = ok(await as.get<{ model: { tables: { id: string; name: string }[] } }>(`/api/v1/connections/${conn}/schema`));
        const there = (ref: string) => `/api/v1/data/${conn}/${encodeURIComponent(schema.model.tables.find((t) => t.name === real[ref])!.id)}`;
        // On the second connection: the same person's address, and rows whose ids are the first connection's ids — some of them hers.
        const twin = ok(await as.post<{ data: Row }>(there("clients"), { values: { company: "Twin Ltd", contact_name: "Hana Twin", email: homeEmail } }), 201).data;
        const twinRows: Row[] = [];
        for (let i = 0; i < 3; i += 1) {
          const inv = ok(await as.post<{ data: Row }>(there("invoices"), { values: { client_id: twin.id, title: `On the second connection ${String(i)}` } }), 201).data;
          ok(await as.post(there("invoice_lines"), { values: { document_id: inv.id, position: 1, description: "Elsewhere", qty: "1", rate: "999" } }), 201);
          twinRows.push(ok(await as.patch<{ data: Row }>(`${there("invoices")}/${String(inv.id)}`, { values: { status: "sent" } })).data);
        }
        console.info(`[second install, ${engine}] the second connection's invoice ids ${JSON.stringify(twinRows.map((r) => r.id))}; the home invoice is ${String(homeInvoice.id)}; the apps list says ${JSON.stringify((await as.get<{ apps: { connectionId: string }[] }>("/api/v1/apps")).body.apps.map((x) => x.connectionId === conn ? "the second connection" : x.connectionId === connectionId ? "the first" : x.connectionId))}`);
        // Signed in by her link, she reaches her invoice on the first connection, and nothing of the second.
        const session = await signIn(homeEmail);
        const { refs } = await refsOf(session);
        const invoicesRef = refFor(refs, CLIENT_ENTRIES.find((e) => e.table === "invoices" && e.methods.includes("GET"))!);
        const list = (await pub("GET", `/api/v1/public/records/${invoicesRef}`, undefined, session)).body!.data as Row[];
        expect(list.map((r) => [Number(r.id), r["title"]])).toEqual([[Number(homeInvoice.id), "Home invoice"]]);
        const missing = await pub("GET", `/api/v1/public/records/${invoicesRef}/987654321`, undefined, session);
        for (const row of twinRows) {
          const answer = await pub("GET", `/api/v1/public/records/${invoicesRef}/${String(row.id)}`, undefined, session);
          if (Number(row.id) === Number(homeInvoice.id)) expect((answer.body!.data as Row)["title"]).toBe("Home invoice");
          else expect([row.id, answer.status, answer.text]).toEqual([row.id, 404, missing.text]);
        }
      }, 300_000);
    });
  });
});
