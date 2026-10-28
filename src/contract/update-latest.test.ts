/**
 * THE CLIENT PORTAL'S UPDATE FROM THE RELEASE BEFORE THIS ONE: THE RELEASED
 * 0.2.5, UPDATED IN PLACE.
 *
 * `update.test.ts` proves the longest way a studio comes (0.2.0, the first
 * release an install can be updated from). This proves the way most come:
 * from the release just before this one, on SQLite, Postgres and MySQL:
 *
 *   1. install the RELEASED 0.2.5 — the published tarball's own bytes
 *      (`CONTRACT_LATEST_TARBALL`), refused unless they hash to what
 *      RELEASES.json recorded — on the Adminium it asks for
 *      (`CONTRACT_LATEST_ADMINIUM`, 0.3.28), with Invoices & Receipts, and
 *      its own sample;
 *   2. a client at work in 0.2.5: an enquiry the desk took from them and made
 *      a proposal of, the proposal signed on the clients' side, their work
 *      approved there and a note left on it, an invoice sent to them;
 *   3. ADMINIUM UPGRADED IN PLACE to the one this build needs (`ADMINIUM_REPO`)
 *      on the same data directory, secret and database: nothing in the app's
 *      tables moved by it;
 *   4. ENGINE FIRST: the client's address put on the do-not-email list, and
 *      the invoice the desk sends them still reaches them (an app that says
 *      no class sends service mail);
 *   5. THIS build uploaded: the plan is no new table, no new column and no new
 *      enum value — nothing dropped, renamed or rewritten — and it applies;
 *   6. every row that was there is unchanged, byte for byte, and every column
 *      and constraint as it was;
 *   7. THE APP NEXT: an invoice and a payment's receipt still reach the client
 *      on the do-not-email list (every kind is service mail);
 *   8. THE CLIENT ERASED by their address: their own row and the copies of
 *      them on the enquiry, the approved work and the note are blanked, and so
 *      is the address their mail went to; the proposal they signed, their
 *      invoices and payments stay as the law keeps them, said so under "What
 *      stays" with the reason.
 *
 * It runs where the plain contract runs, with the published tarball of the
 * release before this one and a built checkout of the Adminium that release
 * asks for; `ADMINIUM_REQUIRE_CONTRACT` (`1` or `true`) makes a missing one a
 * failure.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEMO_START, DEMO_ZONE } from "../lib/clock.ts";
import { DEMO_CURRENCY, DEMO_SETTINGS } from "../demo/sample.ts";
import { TABLES } from "../manifest/tables.ts";
import type { Id } from "../data/types.ts";
import {
  addOnBundle,
  appBundle,
  boot,
  Caller,
  ENGINES,
  FROM_NODE_OPTIONS,
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
  type ReleasedFrom,
  type Server,
} from "./harness.ts";

type Row = Record<string, unknown> & { id: Id };
type Refs = Record<string, { actions: string[]; writable: string[]; expose: string[] }>;

const LATEST: ReleasedFrom = {
  tarball: process.env["CONTRACT_LATEST_TARBALL"] ?? "",
  adminium: process.env["CONTRACT_LATEST_ADMINIUM"] ?? "",
  names: { tarball: "CONTRACT_LATEST_TARBALL", adminium: "CONTRACT_LATEST_ADMINIUM" },
};

const REQUIRED = ["1", "true"].includes(process.env["ADMINIUM_REQUIRE_CONTRACT"] ?? "");
const why = missing() ?? releasedMissing(LATEST);
if (why !== null && REQUIRED) throw new Error(`the update contract from the latest release must run here, and cannot: ${why}`);
/** After the plain, update, roles and acceptance contracts' engines (or `CONTRACT_LATEST_PORT_BASE`). */
const PORT_BASE = Number(process.env["CONTRACT_LATEST_PORT_BASE"] ?? Number(process.env["CONTRACT_PORT_BASE"] ?? 4870) + 12 * PORTS_PER_ENGINE);
const database = (engine: Engine) => `cp_latest_${engine}${process.env["CONTRACT_DB_SUFFIX"] ?? ""}`;
const ADMIN = { email: process.env["E2E_ADMIN_EMAIL"] ?? "e2e@adminium.local", password: process.env["E2E_ADMIN_PASSWORD"] ?? "adminium-e2e-password" };

const released = why === null ? releasedBundle(LATEST) : null;
const FROM = released?.version ?? "0.2.5";
const TO = why === null ? appBundle().version : "0.2.6";

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
      let before: Record<string, RawTable> = {};
      let beforeHttp: Record<string, Row[]> = {};

      /** A client of the studio, on an address the outbox writes to (it skips the sample's reserved `.example`). */
      const INES = { company: "Calloway Ceramics", contact_name: "Ines Calloway", email: `ines.${engine}@studio-latest.net` };
      /** What she and the studio made in 0.2.5. */
      const made = { client: 0 as Id, enquiry: 0 as Id, loose: 0 as Id, proposal: 0 as Id, project: 0 as Id, deliverable: 0 as Id, note: 0 as Id, invoices: [] as Id[] };

      const studio = mkdtempSync(join(tmpdir(), `cp-latest-${engine}-`));
      const ran = { from: "", to: "" };

      const signIn = async () => {
        staff = new Caller(server.base, { origin: server.base });
        await staff.signIn(ADMIN.email, ADMIN.password);
        const connections = ok(await staff.get<{ connections: { id: string; name: string }[] }>("/api/v1/connections"));
        connectionId = connections.connections.find((c) => c.name === "northwind")!.id;
        return ok(await staff.get<{ version: string }>("/api/v1/healthz")).version;
      };

      beforeAll(async () => {
        server = await boot(engine as Engine, port, DEMO_START, { database: database(engine as Engine), adminium: LATEST.adminium, keep: studio, nodeOptions: FROM_NODE_OPTIONS });
        ran.from = await signIn();
      }, 240_000);

      afterAll(async () => {
        await server?.stop();
        rmSync(studio, { recursive: true, force: true });
      });

      const learnTables = async () => {
        const schema = ok(await staff.get<{ model: { tables: { id: string; name: string }[] } }>(`/api/v1/connections/${connectionId}/schema`));
        tableIds = Object.fromEntries(Object.entries(real).map(([ref, name]) => [ref, schema.model.tables.find((t) => t.name === name)!.id]));
      };
      const data = (ref: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tableIds[ref]!)}`;
      const rows = async (ref: string): Promise<Row[]> => {
        const out: Row[] = [];
        for (let offset = 0; ; offset += 200) {
          const page = ok(await staff.get<{ data: Row[] }>(`${data(ref)}?limit=200&offset=${String(offset)}`)).data;
          out.push(...page);
          if (page.length < 200) return out.sort((a, b) => Number(a.id) - Number(b.id));
        }
      };
      const row = async (ref: string, id: Id) => (await rows(ref)).find((r) => r.id === id)!;
      const all = async () => Object.fromEntries(await Promise.all(Object.keys(real).map(async (ref) => [ref, await rows(ref)] as const)));
      const raw = () => rawTables(engine as Engine, port, database(engine as Engine), prefix);
      const sample = async () => ok(await staff.get<{ loaded: boolean; total: number }>("/api/v1/apps/clients/sample-data"));
      const guestOf = async () => {
        const config = ok(await new Caller(server.base).get<{ publishableKey: string }>("/apps/clients/customer/surface-config.json"));
        return new Caller(server.base, { authorization: `Bearer ${config.publishableKey}`, origin: server.base });
      };
      const proof = async (guest: Caller) => {
        const challenge = ok(await guest.get<{ data: { id: string; salt: string; difficulty: number } }>("/api/v1/public/challenge?purpose=claim")).data;
        return { "x-adminium-proof": `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}` };
      };
      const sink = async () => (await (await fetch(`${server.sink}/messages`)).json()) as { to: string[]; subject: string; text: string }[];
      /** The message of a kind about one row, once it has settled; and the mail, when it was sent. */
      const settled = async (kind: string, link: string, id: Id) => {
        const message = await until(
          async () => (await rows("messages")).find((m) => m["kind"] === kind && m[link] === id && ["sent", "failed", "skipped"].includes(String(m["status"]))),
          `the ${kind} email about ${link} ${String(id)}`,
          180_000,
        );
        return { status: message["status"], to: message["to"], error: message["error"] };
      };
      /** The desk sends Ines an invoice; the `invoice-sent` email as it settles, and the mail in the sink. */
      const invoiceInes = async (title: string) => {
        const invoice = ok(await staff.post<{ data: Row }>(data("invoices"), { values: { client_id: made.client, project_id: made.project, title, terms: "net14" } }), 201).data;
        ok(await staff.post(data("invoice_lines"), { values: { document_id: invoice.id, position: 1, description: "Glaze trials", qty: "1", rate: "320" } }), 201);
        const sent = ok(await staff.patch<{ data: Row }>(`${data("invoices")}/${String(invoice.id)}`, { values: { status: "sent" } })).data;
        made.invoices.push(invoice.id);
        const message = await settled("invoice-sent", "invoice_id", invoice.id);
        const number = String(sent["number"]);
        const mail = message.status === "sent" ? await until(async () => (await sink()).find((m) => m.to.includes(INES.email) && m.subject.includes(number)), `${number} in the sink`) : undefined;
        return { id: invoice.id, number, message, mail };
      };

      // ── 0.2.5, released, at work ────────────────────────────────────────────

      it(`installs the RELEASED ${FROM} — the published tarball, byte for byte — with Invoices & Receipts, and its sample`, async () => {
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
        // 0.2.5 has every table this build has: the update adds none.
        expect(Object.keys(real).sort()).toEqual(TABLES.map((t) => t.ref).sort());
        await learnTables();
        ok(await staff.patch(`/api/v1/connections/${connectionId}`, { timezone: DEMO_ZONE, currency: DEMO_CURRENCY }));
        const values = Object.fromEntries(Object.entries(DEMO_SETTINGS).map(([name, value]) => [name.slice("invoices.".length), value]));
        ok(await staff.put("/api/v1/add-ons/invoices/settings", { values }));
        expect(JSON.stringify(installed.rules.skipped)).toBe("[]");
        expect(installed.outbox.defined).toBe(true);
        const apps = ok(await staff.get<{ apps: { key: string; version: string }[] }>("/api/v1/apps"));
        expect(apps.apps.find((a) => a.key === "clients")?.version).toBe(FROM);
        ok(await staff.post("/api/v1/apps/clients/sample-data"));
        await until(async () => ((await sample()).loaded ? true : undefined), "the sample to be added");
      }, 300_000);

      it(`lets a client and the studio work in ${FROM}: an enquiry made a proposal, signed, work approved and noted on the clients' side, an invoice sent`, async () => {
        ok(await staff.put("/api/v1/public-api", { enabled: true }));
        ok(await staff.put("/api/v1/settings/email", { publicOrigin: server.base }));
        // The desk takes an enquiry from a call; the Composer makes a client and a proposal of it, and links the enquiry to both.
        const enquiry = ok(await staff.post<{ data: Row }>(data("enquiries"), { values: { name: INES.contact_name, email: INES.email, business: INES.company, body: "A run of mugs for the café.", source: "call" } }), 201).data;
        const client = ok(await staff.post<{ data: Row }>(data("clients"), { values: { ...INES, language: "en-US", phone: "0161 496 0731", address: "4 Kiln Row, Stoke", tax_number: "GB 123 4567 89" } }), 201).data;
        const proposal = ok(await staff.post<{ data: Row }>(data("proposals"), { values: { client_id: client.id, title: "Café mugs", valid_until: "2026-08-28" } }), 201).data;
        ok(await staff.post(data("proposal_lines"), { values: { document_id: proposal.id, position: 1, description: "Mug design", qty: "1", rate: "900" } }), 201);
        ok(await staff.patch(`${data("enquiries")}/${String(enquiry.id)}`, { values: { client_id: client.id, proposal_id: proposal.id, status: "proposal" } }));
        ok(await staff.patch(`${data("proposals")}/${String(proposal.id)}`, { values: { status: "sent" } }));
        const project = ok(await staff.post<{ data: Row }>(data("projects"), { values: { client_id: client.id, name: "Café mugs", proposal_id: proposal.id } }), 201).data;
        const deliverable = ok(await staff.post<{ data: Row }>(data("deliverables"), { values: { project_id: project.id, title: "Mug artwork" } }), 201).data;
        ok(await staff.patch(`${data("deliverables")}/${String(deliverable.id)}`, { values: { status: "pending" } }));
        // Weeks later she writes again from her address, and the desk answers it without linking it to her.
        const loose = ok(await staff.post<{ data: Row }>(data("enquiries"), { values: { name: INES.contact_name, email: INES.email, body: "And a teapot?", source: "call" } }), 201).data;
        Object.assign(made, { client: client.id, enquiry: enquiry.id, loose: loose.id, proposal: proposal.id, project: project.id, deliverable: deliverable.id });
        expect(await settled("proposal-sent", "proposal_id", proposal.id)).toMatchObject({ status: "sent", to: INES.email });

        // Ines signs in by her emailed link, signs the proposal, approves the work and leaves a note on it.
        const guest = await guestOf();
        ok(await guest.post("/api/v1/public/claim/link", { email: INES.email, lang: "en-US" }, await proof(guest)), 202);
        const link = await until(async () => (await sink()).find((m) => m.to.includes(INES.email) && m.text.includes("/c#")), "Ines's sign-in link");
        const token = /\/c#([A-Za-z0-9_-]{43})/.exec(link.text)![1]!;
        const ines = { "x-adminium-public-session": ok(await guest.post<{ data: { session: string } }>("/api/v1/public/claim/link/verify", { token })).data.session };
        const refs = ok(await guest.get<{ data: { refs: Refs } }>("/api/v1/public/config", ines)).data.refs;
        const door = (table: string, test: (r: Refs[string]) => boolean) => Object.entries(refs).find(([ref, r]) => ref.startsWith(real[table]!) && test(r))![0];
        const sign = door("proposals", (r) => r.writable.includes("status") && r.writable.includes("signed_name") && !r.writable.includes("decline_note"));
        ok(await guest.patch(`/api/v1/public/records/${sign}/${String(proposal.id)}`, { values: { status: "accepted", signed_name: INES.contact_name } }, ines));
        const review = door("deliverables", (r) => r.writable.includes("status"));
        ok(await guest.patch(`/api/v1/public/records/${review}/${String(deliverable.id)}`, { values: { status: "approved", review_note: "Lovely." } }, ines));
        const notes = door("deliverable_notes", (r) => r.actions.includes("create"));
        ok(await guest.post(`/api/v1/public/records/${notes}`, { values: { deliverable_id: deliverable.id, body: "Could the handle be a little rounder?" } }, ines), 201);
        made.note = (await rows("deliverable_notes")).find((n) => n["body"] === "Could the handle be a little rounder?")!.id;

        // The server's stamps put her name and address on what she did: the copies the manifest now declares.
        const signed = await row("proposals", proposal.id);
        expect([signed["status"], signed["signed_name"], signed["signed_email"]]).toEqual(["accepted", INES.contact_name, INES.email]);
        expect((await row("deliverables", deliverable.id))["approved_by"]).toBe(INES.contact_name);
        expect((await row("deliverable_notes", made.note))["author"]).toBe(INES.contact_name);

        const first = await invoiceInes("Café mugs, deposit");
        expect([first.message.status, first.message.to]).toEqual(["sent", INES.email]);
      }, 400_000);

      it("upgrades Adminium in place to the one this build needs, on the same data, the app still at its release", async () => {
        // Still: two reads a few seconds apart agree (no job is still at a row).
        const rawUnder = await until(
          async () => {
            const a = await raw();
            await new Promise((resolve) => setTimeout(resolve, 3_000));
            const b = await raw();
            return JSON.stringify(a) === JSON.stringify(b) ? b : undefined;
          },
          "the database to be still",
          120_000,
        );
        const at = server.now();
        await server.stop();
        server = await boot(engine as Engine, port, at, { database: database(engine as Engine), keep: studio });
        ran.to = await signIn();
        console.info(`[upgrade, ${engine}] Adminium ${ran.from} → ${ran.to}`);
        expect(ran.to).not.toBe(ran.from);
        const apps = ok(await staff.get<{ apps: { key: string; version: string; connectionId: string }[] }>("/api/v1/apps"));
        expect(apps.apps.filter((a) => a.key === "clients").map((a) => [a.version, a.connectionId])).toEqual([[FROM, connectionId]]);
        expect(await raw()).toEqual(rawUnder);
      }, 300_000);

      it(`still sends ${FROM}'s invoice to a client on the do-not-email list: an app that says no class sends service mail`, async () => {
        const added = ok(await staff.post<{ data: { added: number } }>("/api/v1/consent/stop-list", { addresses: [INES.email] })).data;
        expect(added.added).toBe(1);
        const sent = await invoiceInes("Café mugs, second stage, engine first");
        expect([sent.message.status, sent.message.to, sent.mail !== undefined]).toEqual(["sent", INES.email, true]);
      }, 300_000);

      it("reads every table of the app, straight from the database and over HTTP, once nothing is moving", async () => {
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
      }, 180_000);

      // ── the update ──────────────────────────────────────────────────────────

      let plan: {
        installable: boolean;
        checksum: string;
        problems: unknown[];
        tables: { ref: string; table: string; class: string; action: string; edits: unknown[]; blocked: unknown[]; renameExistingTo?: string }[];
        addOns?: { key: string; action: string | null }[];
      };

      it(`plans the update to ${TO}: no new table, column or value, nothing dropped, renamed or rewritten`, async () => {
        const app = appBundle();
        const staged = await staff.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(app.integrity)}`, app.buffer);
        expect([200, 201], JSON.stringify(staged.body).slice(0, 800)).toContain(staged.status);
        plan = ok(await staff.post<{ plan: typeof plan }>("/api/v1/apps/plan", { key: app.key, version: app.version, connectionId })).plan;
        console.info(`[update plan, ${engine}] ${JSON.stringify({ installable: plan.installable, problems: plan.problems, changed: plan.tables.filter((t) => t.edits.length > 0 || t.blocked.length > 0 || t.action !== "reuse") })}`);
        expect([plan.installable, plan.problems]).toEqual([true, []]);
        expect(plan.tables.map((t) => t.ref).sort()).toEqual(TABLES.map((t) => t.ref).sort());
        for (const planned of plan.tables) {
          expect([planned.ref, planned.action, planned.class, planned.table, planned.renameExistingTo, planned.edits, planned.blocked]).toEqual([
            planned.ref,
            "reuse",
            "own-leftover",
            real[planned.ref],
            undefined,
            [],
            [],
          ]);
        }
        expect(plan.addOns?.find((a) => a.key === "invoices")?.action ?? null).toBeNull();
      }, 120_000);

      it(`updates in place to ${TO}, as planned`, async () => {
        const updated = ok(
          await staff.post<{ app: { version: string; schema?: { created: string[]; reused: string[] }; rules?: { skipped: unknown[] } }; from: string; to: string; pruned: string[] }>("/api/v1/apps/clients/update", {
            planChecksum: plan.checksum,
          }),
        );
        expect([updated.from, updated.to, updated.app.version]).toEqual([FROM, TO, TO]);
        expect(updated.app.schema?.created ?? []).toEqual([]);
        expect([...(updated.app.schema?.reused ?? [])].sort()).toEqual(Object.values(real).sort());
        expect(JSON.stringify(updated.app.rules?.skipped ?? [])).toBe("[]");
        const apps = ok(await staff.get<{ apps: { key: string; version: string }[] }>("/api/v1/apps"));
        expect(apps.apps.find((a) => a.key === "clients")?.version).toBe(TO);
      }, 180_000);

      it("keeps every row that was there, byte for byte, and every column and constraint as it was", async () => {
        const after = await raw();
        expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
        for (const [name, was] of Object.entries(before)) {
          const now = after[name]!;
          expect([name, now.key, now.columns, now.constraints]).toEqual([name, was.key, was.columns, was.constraints]);
          expect(now.rows, `the rows of ${name}`).toEqual(was.rows);
        }
        const nowHttp = await all();
        for (const [ref, list] of Object.entries(beforeHttp)) expect(nowHttp[ref], `${ref} over HTTP`).toEqual(list);
      }, 120_000);

      // ── the app next ────────────────────────────────────────────────────────

      it(`still sends the invoice and the payment's receipt to the client on the do-not-email list, now that ${TO} says every email is service mail`, async () => {
        const sent = await invoiceInes("Café mugs, final stage");
        expect([sent.message.status, sent.message.to, sent.mail !== undefined]).toEqual(["sent", INES.email, true]);
        const payment = ok(await staff.post<{ data: Row }>(data("payments"), { values: { document_id: sent.id, amount: "100", method: "bank-transfer", paid_on: "2026-07-28" } }), 201).data;
        expect(await settled("payment-receipt", "payment_id", payment.id)).toMatchObject({ status: "sent", to: INES.email });
        await until(async () => (await sink()).find((m) => m.to.includes(INES.email) && m.text.includes(String(payment["number"]))), "the receipt in the sink");
      }, 300_000);

      // ── the client erased ───────────────────────────────────────────────────

      it("erases the client by their address: their row and their copies go, the proposal they signed and their money stay as the law keeps them", async () => {
        const named = (table?: string) => Object.entries(tableIds).find(([ref, id]) => id === table || real[ref] === table)?.[0] ?? table;
        type Item = { kind: string; table?: string; count: number | null; reason?: string };
        const preview = ok(await staff.post<{ data: { found: boolean; goes: Item[]; stays: Item[] } }>("/api/v1/privacy/erase/preview", { address: INES.email })).data;
        console.info(`[erase preview, ${engine}] ${JSON.stringify({ goes: preview.goes.map((g) => [g.kind, named(g.table), g.count]), stays: preview.stays.map((g) => [g.kind, named(g.table), g.reason, g.count]) })}`);
        expect(preview.found).toBe(true);
        expect(preview.goes.filter((g) => g.kind === "people").map((g) => [named(g.table), g.count])).toEqual([["clients", 1]]);
        expect(preview.goes.filter((g) => g.kind === "copy").map((g) => [named(g.table), g.count]).sort()).toEqual([
          ["deliverable_notes", 1],
          ["deliverables", 1],
          ["enquiries", 2],
        ]);
        const kept = preview.stays.filter((g) => g.kind === "app-rows").map((g) => [named(g.table), g.reason]);
        expect(kept).toEqual(expect.arrayContaining([["proposals", "contract"], ["invoices", "tax"], ["payments", "tax"]]));

        const was = { proposal: await row("proposals", made.proposal), invoices: await Promise.all(made.invoices.map((id) => row("invoices", id))) };
        ok(await staff.post("/api/v1/privacy/erase", { address: INES.email, confirm: INES.email }));

        // Her own row: neither her name nor her address is there any more.
        const client = await row("clients", made.client);
        expect([client["contact_name"] === INES.contact_name, client["email"] === INES.email]).toEqual([false, false]);
        // Her copies on the enquiry, the approved work and the note.
        const enquiry = await row("enquiries", made.enquiry);
        // A second enquiry from her address the desk never linked to her: her address on it goes too.
        const loose = await row("enquiries", made.loose);
        expect(loose["email"]).not.toBe(INES.email);
        expect([enquiry["name"] === INES.contact_name, enquiry["email"] === INES.email]).toEqual([false, false]);
        expect((await row("deliverables", made.deliverable))["approved_by"]).not.toBe(INES.contact_name);
        const note = await row("deliverable_notes", made.note);
        expect(note["author"]).not.toBe(INES.contact_name);
        // The proposal she signed and her invoices, as they were: the law keeps them.
        expect(await row("proposals", made.proposal)).toEqual(was.proposal);
        expect(await Promise.all(made.invoices.map((id) => row("invoices", id)))).toEqual(was.invoices);
        // Her mail's address is gone from the outbox; each message's record of being sent stays.
        const mail = (await rows("messages")).filter((m) => m["client_id"] === made.client);
        expect(mail.length).toBeGreaterThan(0);
        expect(mail.filter((m) => m["to"] === INES.email)).toEqual([]);
        console.info(
          `[survives an erasure, ${engine}] ${JSON.stringify({ client: { company: client["company"], phone: client["phone"], address: client["address"], tax_number: client["tax_number"], language: client["language"] }, enquiry: { business: enquiry["business"], body: enquiry["body"] }, unlinkedEnquiry: { name: loose["name"], body: loose["body"] }, note: { body: note["body"] }, proposal: { signed_name: was.proposal["signed_name"], signed_email: was.proposal["signed_email"] } })}`,
        );
      }, 300_000);
    });
  });
});
