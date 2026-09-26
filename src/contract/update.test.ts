/**
 * THE CLIENT PORTAL'S UPDATE CONTRACT: THE RELEASED 0.2.0, UPDATED IN PLACE.
 *
 * On a BUILT Adminium with Invoices & Receipts, on SQLite, Postgres and MySQL:
 *
 *   1. install the RELEASED 0.2.0 — the published tarball's own bytes
 *      (`CONTRACT_FROM_TARBALL`), refused unless they hash to what
 *      RELEASES.json recorded — as an operator's Adminium was handed it;
 *   2. its own sample, added at 10:00 on Tuesday 28 July 2026 at the studio;
 *   3. a studio and its clients at work in 0.2.0, through 0.2.0's own doors:
 *      a payment and a void on sample invoices; a new client with a proposal
 *      sent and an invoice sent and part-paid; one client signing in by an
 *      emailed link to accept the proposal still out, another to leave a note
 *      on her work — and the outbox's messages about all of it, settled;
 *   4. every table of the app read straight from the database (each value as
 *      the engine spells it, each column as the engine declares it) and over
 *      HTTP: the snapshot;
 *   5. THIS build (0.2.1) uploaded; the update's plan is new tables and new
 *      columns only — nothing dropped, renamed or rewritten — and it applies;
 *   6. every row that was there is unchanged, byte for byte, and every column
 *      declaration too, but for what the plan said it adds; the new tables
 *      exist with the manifest's columns;
 *   7. the new record pages; the new tables granted to Studio and Studio
 *      manager exactly as the manifest says;
 *   8. the outbox's new kind `new-enquiry` tells the studio of a web enquiry;
 *   9. the money still settles: new payments on invoices made in 0.2.0 move
 *      their balances, and an overpayment is refused;
 *  10. THE SAMPLE ON UPDATE: an update adds no sample rows (the studio is
 *      live: the back office's sample — time, purchases, suppliers — never
 *      lands beside a studio's real books), the 0.2.0 sample stays exactly the
 *      one recorded, adding it again is refused and writes nothing; removing
 *      it afterwards keeps every row the studio and its clients made; and
 *      the new release's sample, added after that, never writes a row twice.
 *
 * And what an update must keep of the promises a fresh install makes: the
 * guest key reaches the new public enquiry door; the handover link's own key
 * still opens the links already sent; a link column the update adds keeps its
 * one-of-a-kind rule, and the time it bills keeps its hours until a void
 * invoice lets go of it; a text default is declared as it was; and a sample
 * row the update only widened is not counted as the studio's change.
 *
 * It runs where the plain contract runs (`contract.test.ts`), with the
 * published tarball of the release it updates; `ADMINIUM_REQUIRE_CONTRACT`
 * (`1` or `true`) makes a missing one a failure.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEMO_START, DEMO_ZONE } from "../lib/clock.ts";
import { DEMO_CURRENCY, DEMO_SETTINGS } from "../demo/sample.ts";
import { TABLES } from "../manifest/tables.ts";
import { ROLES } from "../manifest/roles.ts";
import { PAGE_REFS } from "../manifest/pages.ts";
import type { Id } from "../data/types.ts";
import {
  addOnBundle,
  appBundle,
  boot,
  Caller,
  ENGINES,
  missing,
  ok,
  PORTS_PER_ENGINE,
  rawTables,
  releasedBundle,
  releasedMissing,
  solve,
  until,
  type Engine,
  type RawTable,
  type Server,
} from "./harness.ts";

type Row = Record<string, unknown> & { id: Id };
type Refs = Record<string, { actions: string[]; writable: string[]; expose: string[] }>;

/** A value as `rawTables` spells it, back to its text (SQLite's `quote()` wraps text in single quotes). */
const unquote = (value: string | null | undefined): string => {
  const text = String(value ?? "");
  return /^'.*'$/s.test(text) ? text.slice(1, -1).replace(/''/g, "'") : text;
};

const REQUIRED = ["1", "true"].includes(process.env["ADMINIUM_REQUIRE_CONTRACT"] ?? "");
const why = missing() ?? releasedMissing();
if (why !== null && REQUIRED) throw new Error(`the update contract must run here, and cannot: ${why}`);
/** After the plain contract's three engines (or `CONTRACT_UPDATE_PORT_BASE`): its own servers and databases, so the files run side by side. */
const PORT_BASE = Number(process.env["CONTRACT_UPDATE_PORT_BASE"] ?? Number(process.env["CONTRACT_PORT_BASE"] ?? 4870) + 3 * PORTS_PER_ENGINE);
const database = (engine: Engine) => `cp_update_${engine}${process.env["CONTRACT_DB_SUFFIX"] ?? ""}`;
const ADMIN = { email: process.env["E2E_ADMIN_EMAIL"] ?? "e2e@adminium.local", password: process.env["E2E_ADMIN_PASSWORD"] ?? "adminium-e2e-password" };
const CLEO = { email: "cleo@marigoldlane.example", name: "Cleo Nkemdi" };
const AMARA = { email: "amara@hearthandloaf.example" };

/** What 0.2.1 adds to 0.2.0's tables, from the manifest: the update's plan must be exactly this. */
const NEW_TABLES = ["events", "expenses", "running_costs", "suppliers", "time_entries"];
const NEW_COLUMNS: Record<string, string[]> = { invoice_lines: ["expense_id", "time_entry_id"] };
const NEW_ENUM_VALUES: Record<string, Record<string, string[]>> = { messages: { kind: ["new-enquiry"] } };
const NEW_PAGES = ["clients-expenses", "clients-running-costs", "clients-studio-dates", "clients-suppliers", "clients-time"];

const released = why === null ? releasedBundle() : null;
const FROM = released?.version ?? "0.2.0";
const TO = why === null ? appBundle().version : "0.2.1";

describe.skipIf(why !== null)(`the update of a live ${FROM} install to ${TO}${why === null ? "" : ` — skipped: ${why}`}`, () => {
  ENGINES.forEach(([engine, available], index) => {
    describe.skipIf(!available)(`on ${engine}`, () => {
      const port = PORT_BASE + index * PORTS_PER_ENGINE;
      let server: Server;
      let staff: Caller;
      let connectionId = "";
      let prefix = "";
      let real: Record<string, string> = {};
      let tableIds: Record<string, string> = {};
      /** What the studio and its clients made or changed in 0.2.0. */
      const made = { receipt: "", client: 0 as Id, project: 0 as Id, proposal: 0 as Id, invoice: 0 as Id, invoiceNumber: "", note: 0 as Id };
      let before: Record<string, RawTable> = {};
      let beforeHttp: Record<string, Row[]> = {};
      let sampleBefore: { loaded: boolean; total: number; tables: { ref: string; count: number }[] } = { loaded: false, total: 0, tables: [] };
      let changedBefore: { ref: string; label: string | null; columns: string[] }[] = [];
      let handoverKey = "";

      beforeAll(async () => {
        server = await boot(engine as Engine, port, DEMO_START, { database: database(engine as Engine) });
        staff = new Caller(server.base, { origin: server.base });
        await staff.signIn(ADMIN.email, ADMIN.password);
        const connections = ok(await staff.get<{ connections: { id: string; name: string }[] }>("/api/v1/connections"));
        connectionId = connections.connections.find((c) => c.name === "northwind")!.id;
      }, 240_000);

      afterAll(async () => {
        await server?.stop();
      });

      const learnTables = async () => {
        const schema = ok(await staff.get<{ model: { tables: { id: string; name: string }[] } }>(`/api/v1/connections/${connectionId}/schema`));
        tableIds = Object.fromEntries(Object.entries(real).map(([ref, name]) => [ref, schema.model.tables.find((t) => t.name === name)!.id]));
      };
      const data = (ref: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tableIds[ref]!)}`;
      /** Every row of one of the app's tables, as Adminium hands it out (unnormalised: what is compared). */
      const rows = async (ref: string): Promise<Row[]> => {
        const out: Row[] = [];
        for (let offset = 0; ; offset += 200) {
          const page = ok(await staff.get<{ data: Row[] }>(`${data(ref)}?limit=200&offset=${String(offset)}`)).data;
          out.push(...page);
          if (page.length < 200) return out.sort((a, b) => Number(a.id) - Number(b.id));
        }
      };
      const all = async () => Object.fromEntries(await Promise.all(Object.keys(real).map(async (ref) => [ref, await rows(ref)] as const)));
      const byNumber = (list: Row[], number: string) => list.find((r) => r["number"] === number)!;
      const raw = () => rawTables(engine as Engine, port, database(engine as Engine), prefix);
      const sample = async () => ok(await staff.get<{ loaded: boolean; total: number; tables: { ref: string; count: number }[] }>("/api/v1/apps/clients/sample-data"));
      const surfaceConfig = async () => ok(await new Caller(server.base).get<{ publishableKey: string; publicKeys?: Record<string, string> }>("/apps/clients/customer/surface-config.json"));
      const guestOf = async () => new Caller(server.base, { authorization: `Bearer ${(await surfaceConfig()).publishableKey}`, origin: server.base });
      const proof = async (guest: Caller, purpose: "claim" | "write") => {
        const challenge = ok(await guest.get<{ data: { id: string; salt: string; difficulty: number } }>(`/api/v1/public/challenge?purpose=${purpose}`)).data;
        return { "x-adminium-proof": `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}` };
      };
      /** A client signs in by the link Adminium emails them; their session's header. */
      const signInClient = async (guest: Caller, email: string) => {
        ok(await guest.post("/api/v1/public/claim/link", { email, lang: "en-US" }, await proof(guest, "claim")), 202);
        const mail = await until(async () => {
          const messages = (await (await fetch(`${server.sink}/messages`)).json()) as { to: string[]; text: string }[];
          return messages.find((m) => m.to.some((to) => to.includes(email)) && m.text.includes("/c#"));
        }, `${email}'s sign-in link`);
        const token = /\/c#([A-Za-z0-9_-]{43})/.exec(mail.text)![1]!;
        const session = ok(await guest.post<{ data: { session: string } }>("/api/v1/public/claim/link/verify", { token })).data;
        return { "x-adminium-public-session": session.session };
      };
      const refsOf = async (guest: Caller, as: Record<string, string> = {}) => ok(await guest.get<{ data: { refs: Refs } }>("/api/v1/public/config", as)).data.refs;

      // ── 0.2.0, released, at work ────────────────────────────────────────────

      it(`installs the RELEASED ${FROM} — the published tarball, byte for byte — with Invoices & Receipts`, async () => {
        const addOn = addOnBundle();
        ok(await staff.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(addOn.integrity)}`, addOn.buffer));
        const app = released!;
        const staged = await staff.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(app.integrity)}`, app.buffer);
        expect([200, 201], JSON.stringify(staged.body).slice(0, 800)).toContain(staged.status);
        const body = { key: app.key, version: app.version, connectionId };
        const plan = ok(await staff.post<{ plan: { installable: boolean; checksum: string } }>("/api/v1/apps/plan", body)).plan;
        expect(plan.installable).toBe(true);
        const installed = ok(
          await staff.post<{ schema: { created: string[] }; rules: { skipped: unknown[] }; outbox: { defined: boolean }; publicAccess: { keys: Record<string, string> } }>("/api/v1/apps/install", {
            ...body,
            planChecksum: plan.checksum,
          }),
        );
        const created = installed.schema.created;
        prefix = created.find((name) => name.endsWith("deliverable_versions"))!.slice(0, -"deliverable_versions".length);
        real = Object.fromEntries(created.map((name) => [name.slice(prefix.length), name]));
        const declared = (app.manifest["requiredSchema"] as { tables: { ref: string }[] }).tables.map((t) => t.ref);
        expect(Object.keys(real).sort()).toEqual([...declared].sort());
        expect(declared.filter((t) => NEW_TABLES.includes(t))).toEqual([]);
        await learnTables();
        ok(await staff.patch(`/api/v1/connections/${connectionId}`, { timezone: DEMO_ZONE, currency: DEMO_CURRENCY }));
        const values = Object.fromEntries(Object.entries(DEMO_SETTINGS).map(([name, value]) => [name.slice("invoices.".length), value]));
        ok(await staff.put("/api/v1/add-ons/invoices/settings", { values }));
        expect(JSON.stringify(installed.rules.skipped)).toBe("[]");
        expect(installed.outbox.defined).toBe(true);
        expect(Object.keys(installed.publicAccess.keys).sort()).toEqual(["customer", "handover"]);
        const apps = ok(await staff.get<{ apps: { key: string; version: string }[] }>("/api/v1/apps"));
        expect(apps.apps.find((a) => a.key === "clients")?.version).toBe(FROM);
      }, 180_000);

      it(`adds ${FROM}'s own sample at 10:00 on 28 July`, async () => {
        ok(await staff.post("/api/v1/apps/clients/sample-data"));
        await until(async () => ((await sample()).loaded ? true : undefined), "the sample to be added");
        sampleBefore = await sample();
        const bundle = JSON.parse(released!.files["seeds/clients.sample.json"]!.toString("utf8")) as { tables: { ref: string; rows: unknown[] }[] };
        expect(sampleBefore.tables.map((t) => t.ref).sort()).toEqual(bundle.tables.map((t) => t.ref).sort());
        expect(sampleBefore.tables.some((t) => NEW_TABLES.includes(t.ref))).toBe(false);
        expect(sampleBefore.total).toBe(bundle.tables.reduce((sum, t) => sum + t.rows.length, 0));
      }, 240_000);

      it(`lets the studio and its clients work in ${FROM}, through its own doors`, async () => {
        // A payment on a sample invoice, and a void of another.
        const invoices = await rows("invoices");
        const paid = ok(await staff.post<{ data: Row }>(data("payments"), { values: { document_id: byNumber(invoices, "INV-S2039").id, amount: "1000", method: "bank-transfer", paid_on: "2026-07-28" } }), 201).data;
        made.receipt = String(paid["number"]);
        ok(await staff.patch(`${data("invoices")}/${String(byNumber(invoices, "INV-S2040").id)}`, { values: { status: "void", void_reason: "Raised twice" } }));

        // A new client, their project, a proposal sent, and an invoice sent and part-paid.
        const client = ok(await staff.post<{ data: Row }>(data("clients"), { values: { company: "Harbour Lights", contact_name: "Hal Rigby", email: "hal@harbourlights.example", tax_rate: "8.5" } }), 201).data;
        const project = ok(await staff.post<{ data: Row }>(data("projects"), { values: { client_id: client.id, name: "Harbour signage" } }), 201).data;
        const proposal = ok(await staff.post<{ data: Row }>(data("proposals"), { values: { client_id: client.id, title: "Harbour signage", valid_until: "2026-08-28" } }), 201).data;
        ok(await staff.post(data("proposal_lines"), { values: { document_id: proposal.id, position: 1, description: "Sign family", qty: "1", rate: "1800" } }), 201);
        ok(await staff.patch(`${data("proposals")}/${String(proposal.id)}`, { values: { status: "sent" } }));
        const invoice = ok(await staff.post<{ data: Row }>(data("invoices"), { values: { client_id: client.id, project_id: project.id, title: "Harbour signage, deposit" } }), 201).data;
        ok(await staff.post(data("invoice_lines"), { values: { document_id: invoice.id, position: 1, description: "Deposit", qty: "1", rate: "900" } }), 201);
        const sent = ok(await staff.patch<{ data: Row }>(`${data("invoices")}/${String(invoice.id)}`, { values: { status: "sent" } })).data;
        ok(await staff.post(data("payments"), { values: { document_id: invoice.id, amount: "300", method: "bank-transfer", paid_on: "2026-07-28" } }), 201);
        Object.assign(made, { client: client.id, project: project.id, proposal: proposal.id, invoice: invoice.id, invoiceNumber: String(sent["number"]) });
        const held = (await rows("invoices")).find((i) => i.id === invoice.id)!;
        expect([Number(held["total"]), Number(held["paid"]), Number(held["balance"])]).toEqual([976.5, 300, 676.5]);

        // Cleo signs in by an emailed link and accepts the proposal still out to her.
        ok(await staff.put("/api/v1/public-api", { enabled: true }));
        ok(await staff.put("/api/v1/settings/email", { publicOrigin: server.base }));
        const guest = await guestOf();
        const cleo = await signInClient(guest, CLEO.email);
        const refs = await refsOf(guest, cleo);
        const accept = Object.entries(refs).find(([ref, r]) => ref.startsWith(real["proposals"]!) && r.writable.includes("status") && r.writable.includes("signed_name") && !r.writable.includes("decline_note"))![0];
        const quote = byNumber(await rows("proposals"), "QUO-S1142");
        const accepted = ok(await guest.patch<{ data: Row }>(`/api/v1/public/records/${accept}/${String(quote.id)}`, { values: { status: "accepted", signed_name: CLEO.name } }, cleo)).data;
        expect(accepted["fingerprint"]).toMatch(/^[0-9a-f]{64}$/);

        // Amara signs in and leaves a note on the work waiting for her.
        const amara = await signInClient(guest, AMARA.email);
        const seen = Object.entries(refs).find(([ref, r]) => ref.startsWith(real["deliverables"]!) && r.actions.includes("read"))![0];
        const hers = ok(await guest.get<{ data: Row[] }>(`/api/v1/public/records/${seen}`, amara)).data;
        expect(hers.length).toBeGreaterThan(0);
        const noteDoor = Object.entries(refs).find(([ref, r]) => ref.startsWith(real["deliverable_notes"]!) && r.actions.includes("create"))![0];
        ok(await guest.post(`/api/v1/public/records/${noteDoor}`, { values: { deliverable_id: hers[0]!.id, body: "Could the mark sit a touch higher?" } }, amara), 201);
        made.note = (await rows("deliverable_notes")).find((n) => n["body"] === "Could the mark sit a touch higher?")!.id;

        // The handover link's own key opens the handover side.
        handoverKey = (await surfaceConfig()).publicKeys?.["handover"] ?? "";
        expect(handoverKey).not.toBe("");
        expect((await new Caller(server.base, { authorization: `Bearer ${handoverKey}`, origin: server.base }).get("/api/v1/public/config")).status).toBe(200);

        // The outbox wrote about it all; every message settles, and the void's reminders are skipped at the next scan.
        const voided = byNumber(await rows("invoices"), "INV-S2040");
        await until(
          async () => {
            const messages = await rows("messages");
            const rungs = messages.filter((m) => String(m["invoice_id"]) === String(voided.id) && String(m["kind"]).startsWith("invoice-rung-"));
            const moving = messages.filter((m) => ["queued", "sending"].includes(String(m["status"])));
            return rungs.length === 3 && rungs.every((m) => m["status"] === "skipped") && moving.length === 0 ? true : undefined;
          },
          "the outbox to settle and the void invoice's reminders to be skipped",
          180_000,
        );
        // Among them, the ones about what the studio made here: its proposal sent, its invoice sent and the payment's receipt.
        const about = (await rows("messages")).filter((m) => m["proposal_id"] === made.proposal || m["invoice_id"] === made.invoice).map((m) => String(m["kind"]));
        expect(about).toEqual(expect.arrayContaining(["proposal-sent", "invoice-sent", "payment-receipt"]));
      }, 300_000);

      it("reads every table of the app, straight from the database and over HTTP, once nothing is moving", async () => {
        // Still: two reads a few seconds apart agree (no job is still at a row).
        await until(
          async () => {
            const a = await raw();
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            const b = await raw();
            return JSON.stringify(a) === JSON.stringify(b) ? (before = b) : undefined;
          },
          "the database to be still",
          120_000,
        );
        beforeHttp = await all();
        expect(Object.keys(before).sort()).toEqual([...Object.values(real), `${prefix}sample_data`].sort());
        // The sample rows the studio and its clients changed: what a removal would keep, before any update.
        changedBefore = ok(await staff.post<{ changed: { ref: string; label: string | null; columns: string[] }[] }>("/api/v1/apps/clients/sample-data/remove-plan")).changed;
        expect(changedBefore.filter((c) => c.ref === "invoice_lines")).toEqual([]);
        expect(changedBefore.length).toBeGreaterThan(0);
      }, 180_000);

      // ── the update ──────────────────────────────────────────────────────────

      let plan: {
        installable: boolean;
        checksum: string;
        problems: unknown[];
        tables: { ref: string; table: string; class: string; action: string; edits: { kind: string; column: string; values?: string[] }[]; blocked: unknown[]; renameExistingTo?: string }[];
        addOns?: { key: string; action: string | null }[];
      };

      it(`plans the update to ${TO}: new tables and new columns, nothing dropped, renamed or rewritten`, async () => {
        const app = appBundle();
        const staged = await staff.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(app.integrity)}`, app.buffer);
        expect([200, 201], JSON.stringify(staged.body).slice(0, 800)).toContain(staged.status);
        plan = ok(await staff.post<{ plan: typeof plan }>("/api/v1/apps/plan", { key: app.key, version: app.version, connectionId })).plan;
        // The plan, shown as the operator's check step lists it.
        console.info(
          `[update plan, ${engine}] ` +
            JSON.stringify({
              installable: plan.installable,
              problems: plan.problems,
              changed: plan.tables.filter((t) => t.action !== "reuse" || t.edits.length > 0 || t.blocked.length > 0).map((t) => ({ ref: t.ref, table: t.table, class: t.class, action: t.action, edits: t.edits, blocked: t.blocked })),
              reusedUntouched: plan.tables.filter((t) => t.action === "reuse" && t.edits.length === 0 && t.blocked.length === 0).map((t) => t.ref),
              addOns: plan.addOns?.map((a) => ({ key: a.key, action: a.action })),
            }),
        );
        expect([plan.installable, plan.problems]).toEqual([true, []]);
        const byRef = Object.fromEntries(plan.tables.map((t) => [t.ref, t]));
        expect(Object.keys(byRef).sort()).toEqual(TABLES.map((t) => t.ref).sort());
        for (const ref of NEW_TABLES) expect([ref, byRef[ref]!.action, byRef[ref]!.table, byRef[ref]!.class]).toEqual([ref, "create", `${prefix}${ref}`, "new"]);
        for (const [ref, table] of Object.entries(real)) {
          const planned = byRef[ref]!;
          // The app's own table, kept where it is, under its name.
          expect([ref, planned.action, planned.class, planned.table, planned.renameExistingTo, planned.blocked]).toEqual([ref, "reuse", "own-leftover", table, undefined, []]);
          // Only additions: a column added, an enum given a value; never a column changed in type or width.
          const adds = planned.edits.filter((e) => e.kind === "add-column").map((e) => e.column).sort();
          expect([ref, adds]).toEqual([ref, NEW_COLUMNS[ref] ?? []]);
          const values = Object.fromEntries(planned.edits.filter((e) => e.kind === "enum-values").map((e) => [e.column, e.values]));
          expect([ref, values]).toEqual([ref, NEW_ENUM_VALUES[ref] ?? {}]);
          expect([ref, planned.edits.filter((e) => !["add-column", "enum-values"].includes(e.kind))]).toEqual([ref, []]);
        }
        // Invoices & Receipts is already there, at a version the new release takes: nothing to do.
        expect(plan.addOns?.find((a) => a.key === "invoices")?.action ?? null).toBeNull();
      }, 120_000);

      let updated: { app: Record<string, unknown> & { version: string; schema?: { created: string[]; reused: string[] }; rules?: { skipped: unknown[] } }; from: string; to: string; pruned: string[] };

      it(`updates in place to ${TO}, as planned`, async () => {
        updated = ok(await staff.post<typeof updated>("/api/v1/apps/clients/update", { planChecksum: plan.checksum }));
        const reply = updated.app;
        console.info(
          `[update reply, ${engine}] ` +
            JSON.stringify({ from: updated.from, to: updated.to, pruned: updated.pruned, schema: reply.schema, rulesSkipped: reply.rules?.skipped, publicAccess: reply["publicAccess"], pages: reply["pages"] }),
        );
        expect([updated.from, updated.to, reply.version]).toEqual([FROM, TO, TO]);
        expect(updated.pruned).toEqual([FROM]);
        expect([...(reply.schema?.created ?? [])].sort()).toEqual(NEW_TABLES.map((t) => `${prefix}${t}`));
        expect([...(reply.schema?.reused ?? [])].sort()).toEqual(Object.values(real).sort());
        expect(JSON.stringify(reply.rules?.skipped ?? [])).toBe("[]");
        const apps = ok(await staff.get<{ apps: { key: string; version: string }[] }>("/api/v1/apps"));
        expect(apps.apps.find((a) => a.key === "clients")?.version).toBe(TO);
        for (const ref of NEW_TABLES) real[ref] = `${prefix}${ref}`;
        await learnTables();
      }, 180_000);

      /** Each column whose declaration the update changed, `table.column: before → after`. */
      let redeclared: string[] = [];
      /** The indexes, foreign keys and checks each table lost and gained. */
      const constraintsMoved: Record<string, { gone: string[]; came: string[] }> = {};

      it("keeps every row that was there, byte for byte, and every column as it was — but for what the plan adds", async () => {
        const after = await raw();
        const added: Record<string, string[]> = {};
        redeclared = [];
        for (const [name, was] of Object.entries(before)) {
          const now = after[name];
          expect(now, `${name} is still there`).toBeDefined();
          expect([name, now!.key]).toEqual([name, was.key]);
          added[name] = Object.keys(now!.columns).filter((c) => !(c in was.columns)).sort();
          for (const [column, declared] of Object.entries(was.columns)) {
            expect(now!.columns[column], `${name}.${column} is still there`).toBeDefined();
            if (now!.columns[column] !== declared) redeclared.push(`${name}.${column}: ${declared} → ${now!.columns[column]!}`);
          }
          // Every row: the same key, the same values as the engine spells them, in the same order.
          expect([name, now!.rows.length]).toEqual([name, was.rows.length]);
          const kept = now!.rows.map((row) => Object.fromEntries(Object.keys(was.columns).map((c) => [c, row[c]])));
          expect(kept, `the rows of ${name}`).toEqual(was.rows);
          // A column the update adds holds nothing on a row that was there.
          for (const column of added[name]!) expect([name, column, now!.rows.filter((row) => row[column] !== null).length]).toEqual([name, column, 0]);
        }
        console.info(`[redeclared, ${engine}] ${JSON.stringify(redeclared)}`);
        // Indexes, foreign keys and checks: every one there is still there, but an enum's check, which takes the new value.
        for (const [name, was] of Object.entries(before)) {
          const now = after[name]!.constraints;
          const gone = was.constraints.filter((c) => !now.includes(c));
          const came = now.filter((c) => !was.constraints.includes(c));
          if (gone.length + came.length > 0) console.info(`[constraints, ${engine}, ${name}] gone ${JSON.stringify(gone)} came ${JSON.stringify(came)}`);
          constraintsMoved[name] = { gone, came };
          // Nothing goes but a check the rebuild spells again (SQLite writes its keywords in capitals), or an
          // enum's check, replaced by one naming every old value, in order, and then the new one.
          const valuesOf = (c: string) => [...c.matchAll(/'([a-z0-9-]+)\\?'/g)].map((m) => m[1]!);
          for (const c of gone) {
            const same = came.some((d) => d.toLowerCase() === c.toLowerCase());
            const widened = came.some((d) => JSON.stringify(valuesOf(d)) === JSON.stringify([...valuesOf(c), ...(NEW_ENUM_VALUES["messages"]!["kind"] ?? [])]));
            expect([name, c, same || (name === `${prefix}messages` && widened)]).toEqual([name, c, true]);
          }
          expect([name, came.length - gone.length]).toEqual([name, name === `${prefix}invoice_lines` ? came.length : 0]);
        }
        // Only the columns the plan said.
        expect(Object.fromEntries(Object.entries(added).filter(([, list]) => list.length > 0))).toEqual(Object.fromEntries(Object.entries(NEW_COLUMNS).map(([ref, list]) => [`${prefix}${ref}`, list])));
        // A declaration changes only where the plan gives an enum a value (and SQLite's pinned default, below).
        const enumColumns = Object.entries(NEW_ENUM_VALUES).flatMap(([ref, columns]) => Object.keys(columns).map((column) => `${prefix}${ref}.${column}`));
        const sqliteDefault = `${prefix}messages.status`;
        for (const line of redeclared) {
          const column = line.slice(0, line.indexOf(":"));
          if (engine === "sqlite" && column === sqliteDefault) continue;
          expect(enumColumns, line).toContain(column);
        }
        // And over HTTP: every row Adminium hands out is the one it handed out before.
        const nowHttp = await all();
        for (const [ref, list] of Object.entries(beforeHttp)) {
          const extra = NEW_COLUMNS[ref] ?? [];
          const trimmed = nowHttp[ref]!.map((row) => Object.fromEntries(Object.entries(row).filter(([column]) => !extra.includes(column))));
          expect(trimmed, `${ref} over HTTP`).toEqual(list);
        }
        // The new tables, with the manifest's columns, and nothing in them.
        for (const ref of NEW_TABLES) {
          const table = after[`${prefix}${ref}`];
          expect(table, `${prefix}${ref} exists`).toBeDefined();
          expect([ref, Object.keys(table!.columns).sort()]).toEqual([ref, TABLES.find((t) => t.ref === ref)!.columns.map((c) => c.ref).sort()]);
          expect([ref, table!.rows.length]).toEqual([ref, 0]);
        }
      }, 120_000);

      it("keeps the text defaults of a table the update rebuilds", async () => {
        /*
         * `messages.kind` gains `new-enquiry`, which SQLite can only take by
         * rebuilding the table. The rebuild declares `status DEFAULT 'queued'`
         * as it was, never quoted a second time: a row inserted past Adminium
         * without a status would otherwise read `'queued'`, quotes and all.
         * Nothing is redeclared, on any engine.
         */
        expect(redeclared).toEqual([]);
      });

      it("adds the new record pages, and grants the new tables to Studio and Studio manager exactly as the manifest says", async () => {
        const pages = ok(await staff.get<{ data: { slug: string }[] }>("/api/v1/pages")).data;
        const slugs = new Set(pages.map((p) => p.slug));
        for (const page of PAGE_REFS) expect([page, slugs.has(page)]).toEqual([page, true]);
        const had = (released!.manifest["pages"] as { ref: string }[]).map((p) => p.ref);
        expect(PAGE_REFS.filter((page) => !had.includes(page)).sort()).toEqual(NEW_PAGES);
        expect((updated.app["pages"] as { created: string[] }).created.sort()).toEqual(NEW_PAGES);
        const roles = ok(await staff.get<{ roles: { id: string; slug: string }[] }>("/api/v1/roles")).roles;
        for (const role of ROLES) {
          const held = roles.find((r) => r.slug === `clients-${role.key}`)!;
          expect(held, role.key).toBeDefined();
          const grants = ok(await staff.get<{ grants: string[] }>(`/api/v1/roles/${held.id}/permissions`)).grants;
          // Every table the manifest names, old and new: the role holds exactly the actions it grants there.
          for (const table of TABLES.map((t) => t.ref)) {
            const want = role.permissions.filter((p) => p.startsWith(`table:@${table}:`)).map((p) => p.split(":")[2]!).sort();
            const have = grants.filter((g) => g.startsWith(`table:${connectionId}:`) && g.slice(0, g.lastIndexOf(":")).endsWith(`:${tableIds[table]!}`)).map((g) => g.split(":").pop()!).sort();
            expect([role.key, table, have]).toEqual([role.key, table, want]);
          }
          for (const page of NEW_PAGES) {
            const want = role.permissions.filter((p) => p.startsWith(`page:@${page}:`)).length;
            expect([role.key, page, want > 0]).toEqual([role.key, page, true]);
          }
        }
      }, 120_000);

      it("tells the studio of a web enquiry through the outbox's new kind, `new-enquiry`", async () => {
        const settings = (await rows("settings"))[0]!;
        const studio = "desk@studio-update.net";
        ok(await staff.patch(`${data("settings")}/${String(settings.id)}`, { values: { notify_enquiry: true, reply_to: studio } }));
        // The new length rule on `enquiries.body` holds.
        const long = await staff.post(data("enquiries"), { values: { name: "Too Long", email: "long@ventoandsons.example", body: "x".repeat(4001), source: "web" } });
        expect([long.status, Object.keys((long.details["fields"] ?? {}) as object)]).toEqual([422, ["body"]]);
        const enquiry = ok(await staff.post<{ data: Row }>(data("enquiries"), { values: { name: "Rosa Vento", email: "rosa.update@ventoandsons.example", business: "Vento & Sons", body: "A sign, and a name people can find.", source: "web" } }), 201).data;
        const notice = await until(async () => (await rows("messages")).find((m) => m["kind"] === "new-enquiry" && ["sent", "failed", "skipped"].includes(String(m["status"]))), "the new-enquiry notice", 150_000);
        expect(notice).toMatchObject({ enquiry_id: enquiry.id, to: studio, status: "sent" });
        const mail = await until(async () => {
          const messages = (await (await fetch(`${server.sink}/messages`)).json()) as { to: string[]; subject: string }[];
          return messages.find((m) => m.to.some((to) => to.includes(studio)));
        }, "the studio's notice");
        expect(mail.subject).toBe("A new enquiry from Rosa Vento");
      }, 240_000);

      it("gives the app's live guest key the new public enquiry door, which takes an enquiry behind the human check", async () => {
        /*
         * The update saves the new endpoint and grants it to the guest key the
         * install made at 0.2.0 (an update allows public access unless the
         * operator says not to). So the studio's enquiry form answers on an
         * updated install as on a fresh one (`contract.test.ts`): the door is
         * in the guest config, refused without the human check, and takes an
         * enquiry with it.
         */
        expect((updated.app["publicAccess"] as { endpoints: string[] }).endpoints).toContain(real["enquiries"]);
        expect((updated.app["publicAccess"] as { granted?: Record<string, string[]> }).granted).toEqual({ customer: [real["enquiries"]] });
        const guest = await guestOf();
        const refs = await refsOf(guest);
        const [door, entry] = Object.entries(refs).find(([ref, r]) => ref.startsWith(real["enquiries"]!) && r.writable.includes("body"))!;
        expect([entry.actions, entry.expose]).toEqual([["create"], ["received_at"]]);
        const form = { name: "Rosa Vento", email: "rosa.door@ventoandsons.example", business: "Vento & Sons", body: "A sign, and a name people can find." };
        const unproved = await guest.post(`/api/v1/public/records/${door}`, { values: form });
        expect(unproved.status).toBeGreaterThanOrEqual(400);
        const sent = await guest.post(`/api/v1/public/records/${door}`, { values: form }, await proof(guest, "write"));
        expect(sent.status).toBe(201);
        expect((await rows("enquiries")).some((e) => e["email"] === form.email)).toBe(true);
      }, 120_000);

      it("keeps the handover link's own key: every handover link the studio sent before the update still opens", async () => {
        /*
         * `publicKeys: { handover: {} }` is a key a shared link opens by its
         * token, with no staff binding. The new version still declares it, so
         * the update keeps it as it is: the same key, live, opening the
         * handover side.
         */
        expect((await surfaceConfig()).publicKeys?.["handover"]).toBe(handoverKey);
        const handover = new Caller(server.base, { authorization: `Bearer ${handoverKey}`, origin: server.base });
        expect((await handover.get("/api/v1/public/config")).status).toBe(200);
      }, 60_000);

      it(`settles money on the invoices made in ${FROM}, and refuses an overpayment`, async () => {
        const pay = (id: Id, amount: string) => staff.post<{ data: Row }>(data("payments"), { values: { document_id: id, amount, method: "bank-transfer", paid_on: "2026-07-28" } });
        ok(await pay(made.invoice, "176.50"), 201);
        const harbour = (await rows("invoices")).find((i) => i.id === made.invoice)!;
        expect([Number(harbour["paid"]), Number(harbour["balance"])]).toEqual([476.5, 500]);
        ok(await pay(byNumber(await rows("invoices"), "INV-S2039").id, "621"), 201);
        const settled = byNumber(await rows("invoices"), "INV-S2039");
        expect([Number(settled["paid"]), Number(settled["balance"])]).toEqual([Number(settled["total"]), 0]);
        const over = await pay(made.invoice, "600");
        expect([over.status, over.code, Number(over.details["balance"])]).toEqual([409, "BALANCE_EXCEEDED", 500]);
        // Hours logged against the project made in 0.2.0: Adminium's formula counts them.
        const nadia = (await rows("people")).find((p) => p["name"] === "Nadia Cole")!.id;
        const entry = ok(await staff.post<{ data: Row }>(data("time_entries"), { values: { project_id: made.project, person_id: nadia, date: "2026-07-28", logged_hours: "2" } }), 201).data;
        expect([Number(entry["hours"]), entry["client_id"]]).toEqual([2, made.client]);
      }, 120_000);

      it("keeps a link column's one-of-a-kind rule when the update adds it: the same hours never go on two lines", async () => {
        /*
         * `invoice_lines.time_entry_id` / `expense_id` are `unique: true` (one
         * line per entry, per purchase — what stops the same hours being billed
         * twice). The update adds them with the rule, as a fresh install makes
         * them (`contract.test.ts`): the second line is refused, 409
         * UNIQUE_VIOLATION.
         */
        const entry = (await rows("time_entries")).find((e) => e["project_id"] === made.project)!;
        const draft = ok(await staff.post<{ data: Row }>(data("invoices"), { values: { client_id: made.client, title: "Time, after the update" } }), 201).data;
        ok(await staff.post(data("invoice_lines"), { values: { document_id: draft.id, description: "Signage time", qty: "2", rate: "125", time_entry_id: entry.id } }), 201);
        const again = await staff.post(data("invoice_lines"), { values: { document_id: draft.id, description: "Again", qty: "1", rate: "1", time_entry_id: entry.id } });
        expect([again.status, again.code]).toEqual([409, "UNIQUE_VIOLATION"]);
        // The schema says so: each link column came with its foreign key and its one-of-a-kind rule.
        const came = constraintsMoved[`${prefix}invoice_lines`]!.came;
        console.info(`[invoice_lines constraints came, ${engine}] ${JSON.stringify(came)}`);
        expect(came.filter((c) => /time_entry_id|expense_id/.test(c) && /unique/i.test(c)).length).toBeGreaterThanOrEqual(2);
        expect(came.filter((c) => /time_entry_id|expense_id/.test(c) && /fk|FOREIGN KEY/i.test(c))).toHaveLength(2);
        expect((await rows("invoice_lines")).filter((l) => l["time_entry_id"] === entry.id)).toHaveLength(1);
      }, 60_000);

      it("keeps the hours a line bills on the updated install, and lets a void invoice's line let go of them to be billed again", async () => {
        /*
         * The invoice's states come with the update: while a line of an
         * invoice that is not void carries an entry, its hours, day and
         * project stay as billed, whichever door writes; once the invoice is
         * void its line may empty the link (and nothing else), and the hours
         * go on another invoice, kept again there.
         */
        const entry = (await rows("time_entries")).find((e) => e["project_id"] === made.project)!;
        const line = (await rows("invoice_lines")).find((l) => l["time_entry_id"] === entry.id)!;
        const kept = await staff.patch(`${data("time_entries")}/${String(entry.id)}`, { values: { logged_hours: "5" } });
        // The refusal names the lines' table as Adminium's schema knows it (`<schema>.<table>`).
        expect([kept.status, kept.code, String(kept.details["linkedFrom"]).endsWith(`.${prefix}invoice_lines`)]).toEqual([409, "RECORD_LOCKED", true]);
        ok(await staff.patch(`${data("invoices")}/${String(line["document_id"])}`, { values: { status: "void", void_reason: "Raised in error" } }));
        const figures = await staff.patch(`${data("invoice_lines")}/${String(line.id)}`, { values: { qty: "1" } });
        expect([figures.status, figures.code]).toEqual([409, "RECORD_LOCKED"]);
        ok(await staff.patch(`${data("invoice_lines")}/${String(line.id)}`, { values: { time_entry_id: null } }));
        const draft = ok(await staff.post<{ data: Row }>(data("invoices"), { values: { client_id: made.client, title: "Time, billed again" } }), 201).data;
        ok(await staff.post(data("invoice_lines"), { values: { document_id: draft.id, description: "Signage time", qty: "2", rate: "125", time_entry_id: entry.id } }), 201);
        const keptAgain = await staff.patch(`${data("time_entries")}/${String(entry.id)}`, { values: { logged_hours: "5" } });
        expect([keptAgain.status, keptAgain.code]).toEqual([409, "RECORD_LOCKED"]);
      }, 60_000);

      // ── the sample, after the update ────────────────────────────────────────

      it(`leaves the sample as ${FROM} added it: the update adds no sample rows, and adding it again is refused and writes nothing`, async () => {
        const now = await sample();
        expect(now).toEqual(sampleBefore);
        const job = ok(await staff.post<{ jobId: string }>("/api/v1/apps/clients/sample-data")).jobId;
        const done = await until(
          async () => {
            const view = ok(await staff.get<{ data: { status: string; lastError: string | null } }>(`/api/v1/jobs/${job}`)).data;
            return ["succeeded", "failed", "cancelled"].includes(view.status) ? view : undefined;
          },
          "the second add to finish",
          60_000,
        );
        expect([done.status, done.lastError]).toEqual(["failed", expect.stringContaining("already has its sample data")]);
        expect(await sample()).toEqual(sampleBefore);
        // The back office holds only what the studio made after the update: one hour entry, one line pair.
        const counts = Object.fromEntries(Object.entries(await raw()).map(([name, t]) => [name.slice(prefix.length), t.rows.length]));
        expect([counts["suppliers"], counts["expenses"], counts["running_costs"], counts["events"], counts["time_entries"]]).toEqual([0, 0, 0, 0, 1]);
      }, 120_000);

      it("counts a sample row the update only widened as unchanged: what a removal keeps is the studio's own edits", async () => {
        /*
         * A sample row's hashes (`<prefix>sample_data.row_hash/col_hashes`) are
         * of the columns it had when added. A column the update added, still
         * empty, is not a change: were it one, every sample invoice line would
         * read "changed", and a removal that keeps changed rows (the default)
         * would keep them, and every invoice, project and client they point at.
         */
        const plan = ok(await staff.post<{ changed: { ref: string; label: string | null; columns: string[] }[] }>("/api/v1/apps/clients/sample-data/remove-plan"));
        expect(plan.changed.filter((c) => c.ref === "invoice_lines")).toEqual([]);
        const key = (c: { ref: string; label: string | null; columns: string[] }) => `${c.ref}|${String(c.label)}|${[...c.columns].sort().join(",")}`;
        // The studio's own edits since the snapshot: the settings the new-enquiry test switched on.
        expect(plan.changed.map(key).sort()).toEqual([...changedBefore.map(key), "settings|studio|notify_enquiry,reply_to"].sort());
      }, 60_000);

      it("removes the sample afterwards, keeping every row the studio and its clients made", async () => {
        const removed = ok(await staff.post<{ removed: number; kept: number; byTable: Record<string, number> }>("/api/v1/apps/clients/sample-data/remove", { keepChanged: true }));
        console.info(`[sample removed, ${engine}] ${JSON.stringify(removed)}`);
        expect(removed.removed).toBeGreaterThan(0);
        const left = await all();
        const numbers = left["invoices"]!.map((i) => String(i["number"]));
        // The paid-into and the voided invoices are the studio's now, and its own invoice stays.
        expect(numbers).toEqual(expect.arrayContaining(["INV-S2039", "INV-S2040", made.invoiceNumber]));
        expect(left["payments"]!.map((p) => String(p["number"]))).toContain(made.receipt);
        expect(left["proposals"]!.map((p) => String(p["number"]))).toContain("QUO-S1142");
        expect(left["proposals"]!.map((p) => p.id)).toContain(made.proposal);
        expect(left["clients"]!.map((c) => c.id)).toContain(made.client);
        expect(left["deliverable_notes"]!.map((n) => n.id)).toContain(made.note);
        expect(left["enquiries"]!.map((e) => e["email"])).toContain("rosa.update@ventoandsons.example");
        expect((await sample()).loaded).toBe(false);
        // Every row that was not the sample's — the studio's and its clients' own — is still there.
        const ledger = before[`${prefix}sample_data`]!.rows.map((row) => ({ table: unquote(row["table_ref"]), pk: JSON.parse(unquote(row["pk"])) as Record<string, unknown> }));
        const after = await raw();
        let own = 0;
        for (const [ref, name] of Object.entries(real)) {
          const was = before[name];
          if (was === undefined) continue;
          const keyOf = (row: Record<string, string | null>) => was.key.map((k) => unquote(row[k])).join("|");
          const sampled = new Set(ledger.filter((l) => l.table === ref).map((l) => was.key.map((k) => String(l.pk[k])).join("|")));
          const still = new Set(after[name]!.rows.map(keyOf));
          for (const row of was.rows.filter((r) => !sampled.has(keyOf(r)))) {
            own += 1;
            expect([name, keyOf(row), still.has(keyOf(row))]).toEqual([name, keyOf(row), true]);
          }
        }
        expect(own).toBeGreaterThan(10);
      }, 180_000);

      it(`never writes the ${TO} sample twice: added again after the removal, it is refused whole or lands without a copy`, async () => {
        /*
         * The removal kept the studio's sample clients (their invoices were
         * paid into or voided). Adminium refuses an add that would repeat a
         * one-of-a-kind value such a row holds (a client's email), in ONE
         * transaction: nothing of the add is written. An Adminium that takes
         * kept rows back instead may let it through; either way no row is ever
         * there twice.
         */
        const counts = async () => Object.fromEntries(Object.entries(await raw()).map(([name, t]) => [name, t.rows.length]));
        const was = await counts();
        const job = ok(await staff.post<{ jobId: string }>("/api/v1/apps/clients/sample-data")).jobId;
        const done = await until(
          async () => {
            const view = ok(await staff.get<{ data: { status: string; lastError: string | null } }>(`/api/v1/jobs/${job}`)).data;
            return ["succeeded", "failed", "cancelled"].includes(view.status) ? view : undefined;
          },
          "the add to finish",
          120_000,
        );
        console.info(`[sample again, ${engine}] ${done.status}: ${String(done.lastError)}`);
        if (done.status === "failed") {
          expect(done.lastError).toMatch(/clashes with a record already there/);
          const now = await counts();
          expect(Object.fromEntries(Object.entries(now).filter(([name]) => name !== `${prefix}sample_data`))).toEqual(Object.fromEntries(Object.entries(was).filter(([name]) => name !== `${prefix}sample_data`)));
          expect((await sample()).loaded).toBe(false);
        } else {
          expect(done.status).toBe("succeeded");
        }
        const left = await all();
        const twice = (ref: string, key: (r: Row) => unknown) => {
          const seen = left[ref]!.map((r) => String(key(r)));
          return seen.filter((value, i) => seen.indexOf(value) !== i);
        };
        expect(twice("clients", (r) => r["email"])).toEqual([]);
        expect(twice("invoices", (r) => r["number"])).toEqual([]);
        expect(twice("proposals", (r) => r["number"])).toEqual([]);
        expect(twice("payments", (r) => r["number"])).toEqual([]);
        expect(twice("people", (r) => r["name"])).toEqual([]);
      }, 180_000);
    });
  });
});
