/**
 * THE APP'S ROLES, HELD BY REAL PEOPLE, ON EVERY ENGINE.
 *
 * This repo's manifest installed on a BUILT Adminium with Invoices & Receipts,
 * its sample added, and two people invited through Adminium's own API — each
 * holding ONLY one of the app's roles — who set their own password from the
 * invitation and sign in:
 *
 *   1. Studio takes a line out of a DRAFT proposal and a DRAFT invoice (the
 *      composer's "remove line"): 200, and the document's totals settle again;
 *   2. Studio is refused the line of a SENT invoice and of a sent or accepted
 *      proposal — the documents' states lock them, not the role;
 *   3. Studio still cannot void an invoice or a payment, delete an invoice, a
 *      client, an hour entry or a message, nor write the studio's set-up
 *      (settings, people, the rate card, the running costs);
 *   4. Studio manager can do what the manifest gives it: take a draft's line
 *      out, discard a draft (a numbered invoice is voided, never deleted — the
 *      add-on's rule, for everyone), void an invoice and a payment, delete a
 *      client and an hour entry, change the set-up — and still never deletes
 *      from the outbox.
 *
 * Nothing here signs in through a browser: the invitation's link token is
 * the one Adminium hands the inviting admin, and the password is made here.
 */
import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEMO_START, DEMO_ZONE } from "../lib/clock.ts";
import { DEMO_CURRENCY, DEMO_SETTINGS } from "../demo/sample.ts";
import type { Id } from "../data/types.ts";
import { addOnBundle, appBundle, boot, Caller, ENGINES, missing, ok, PORTS_PER_ENGINE, until, type Engine, type Reply, type Server } from "./harness.ts";

type Row = Record<string, unknown> & { id: Id };

const REQUIRED = ["1", "true"].includes(process.env["ADMINIUM_REQUIRE_CONTRACT"] ?? "");
const why = missing();
if (why !== null && REQUIRED) throw new Error(`the roles contract must run here, and cannot: ${why}`);
/** After the plain contract's and the update contract's engines (or `CONTRACT_ROLES_PORT_BASE`). */
const PORT_BASE = Number(process.env["CONTRACT_ROLES_PORT_BASE"] ?? Number(process.env["CONTRACT_PORT_BASE"] ?? 4870) + 6 * PORTS_PER_ENGINE);
const database = (engine: Engine) => `cp_roles_${engine}${process.env["CONTRACT_DB_SUFFIX"] ?? ""}`;
const ADMIN = { email: process.env["E2E_ADMIN_EMAIL"] ?? "e2e@adminium.local", password: process.env["E2E_ADMIN_PASSWORD"] ?? "adminium-e2e-password" };

/** A refusal: anything 4xx, never a quiet success. */
const refused = (reply: Reply) => [reply.status, reply.status >= 400 && reply.status < 500];

describe.skipIf(why !== null)(`the app's roles, held by real people${why === null ? "" : ` — skipped: ${why}`}`, () => {
  ENGINES.forEach(([engine, available], index) => {
    describe.skipIf(!available)(`on ${engine}`, () => {
      const port = PORT_BASE + index * PORTS_PER_ENGINE;
      let server: Server;
      let admin: Caller;
      let studio: Caller;
      let manager: Caller;
      let connectionId = "";
      let tableIds: Record<string, string> = {};

      beforeAll(async () => {
        server = await boot(engine as Engine, port, DEMO_START, { database: database(engine as Engine) });
        admin = new Caller(server.base, { origin: server.base });
        await admin.signIn(ADMIN.email, ADMIN.password);
        const connections = ok(await admin.get<{ connections: { id: string; name: string }[] }>("/api/v1/connections"));
        connectionId = connections.connections.find((c) => c.name === "northwind")!.id;
      }, 240_000);

      afterAll(async () => {
        await server?.stop();
      });

      const data = (ref: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tableIds[ref]!)}`;
      const rows = async (ref: string, as: Caller = admin): Promise<Row[]> => {
        const out: Row[] = [];
        for (let offset = 0; ; offset += 200) {
          const page = ok(await as.get<{ data: Row[] }>(`${data(ref)}?limit=200&offset=${String(offset)}`)).data;
          out.push(...page);
          if (page.length < 200) return out;
        }
      };
      const one = async (ref: string, id: Id) => (await rows(ref)).find((r) => r.id === id)!;
      const byNumber = async (ref: string, number: string) => (await rows(ref)).find((r) => r["number"] === number)!;
      const remove = (as: Caller, ref: string, id: Id) => as.send("DELETE", `${data(ref)}/${String(id)}?confirm=true`);

      /** Invite a person holding exactly one role; they set a password from the invitation and sign in. */
      const person = async (email: string, roleSlug: string): Promise<Caller> => {
        const roles = ok(await admin.get<{ roles: { id: string; slug: string }[] }>("/api/v1/roles")).roles;
        const role = roles.find((r) => r.slug === roleSlug)!;
        expect(role, roleSlug).toBeDefined();
        const invited = ok(await admin.post<{ user: { id: string; status: string }; invite: { token: string } }>("/api/v1/users", { email, name: roleSlug, roleIds: [role.id] }), 201);
        expect(invited.user.status).toBe("invited");
        const password = `${randomBytes(18).toString("base64url")}Aa1!`;
        ok(await new Caller(server.base, { origin: server.base }).post("/api/v1/auth/password/reset", { token: invited.invite.token, newPassword: password }));
        const caller = new Caller(server.base, { origin: server.base });
        await caller.signIn(email, password);
        return caller;
      };

      it("installs the app with its add-on and its sample, and invites a Studio and a Studio manager", async () => {
        const addOn = addOnBundle();
        ok(await admin.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(addOn.integrity)}`, addOn.buffer));
        const app = appBundle();
        const staged = await admin.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(app.integrity)}`, app.buffer);
        expect([200, 201]).toContain(staged.status);
        const body = { key: app.key, version: app.version, connectionId };
        const plan = ok(await admin.post<{ plan: { checksum: string } }>("/api/v1/apps/plan", body)).plan;
        const installed = ok(await admin.post<{ schema: { created: string[] } }>("/api/v1/apps/install", { ...body, planChecksum: plan.checksum }));
        const created = installed.schema.created;
        const prefix = created.find((name) => name.endsWith("deliverable_versions"))!.slice(0, -"deliverable_versions".length);
        const schema = ok(await admin.get<{ model: { tables: { id: string; name: string }[] } }>(`/api/v1/connections/${connectionId}/schema`));
        tableIds = Object.fromEntries(created.map((name) => [name.slice(prefix.length), schema.model.tables.find((t) => t.name === name)!.id]));
        ok(await admin.patch(`/api/v1/connections/${connectionId}`, { timezone: DEMO_ZONE, currency: DEMO_CURRENCY }));
        const values = Object.fromEntries(Object.entries(DEMO_SETTINGS).map(([name, value]) => [name.slice("invoices.".length), value]));
        ok(await admin.put("/api/v1/add-ons/invoices/settings", { values }));
        ok(await admin.post("/api/v1/apps/clients/sample-data"));
        await until(async () => (ok(await admin.get<{ loaded: boolean }>("/api/v1/apps/clients/sample-data")).loaded ? true : undefined), "the sample to be added");
        studio = await person("studio.person@studio-roles.net", "clients-studio");
        manager = await person("manager.person@studio-roles.net", "clients-studio-manager");
        // Each reads the desk's tables, with only the role it was given.
        expect((await rows("invoices", studio)).length).toBeGreaterThan(0);
        expect((await rows("invoices", manager)).length).toBeGreaterThan(0);
      }, 300_000);

      it("lets Studio take a line out of a DRAFT proposal and a DRAFT invoice, and the totals settle again", async () => {
        const client = (await rows("clients", studio)).find((c) => c["company"] === "Hearth & Loaf")!;
        // A proposal, drafted by Studio with two lines; one taken out.
        const proposal = ok(await studio.post<{ data: Row }>(data("proposals"), { values: { client_id: client.id, title: "Shop signage, a draft" } }), 201).data;
        const keep = ok(await studio.post<{ data: Row }>(data("proposal_lines"), { values: { document_id: proposal.id, position: 1, description: "Fascia", qty: "1", rate: "1200" } }), 201).data;
        const drop = ok(await studio.post<{ data: Row }>(data("proposal_lines"), { values: { document_id: proposal.id, position: 2, description: "Blade sign", qty: "1", rate: "400" } }), 201).data;
        expect(Number((await one("proposals", proposal.id))["subtotal"])).toBe(1600);
        const gone = await remove(studio, "proposal_lines", drop.id);
        expect(gone.status, JSON.stringify(gone.body).slice(0, 400)).toBe(200);
        expect((await rows("proposal_lines")).filter((l) => l["document_id"] === proposal.id).map((l) => l.id)).toEqual([keep.id]);
        expect(Number((await one("proposals", proposal.id))["subtotal"])).toBe(1200);
        // An invoice, the same.
        const invoice = ok(await studio.post<{ data: Row }>(data("invoices"), { values: { client_id: client.id, title: "Shop signage, deposit" } }), 201).data;
        ok(await studio.post(data("invoice_lines"), { values: { document_id: invoice.id, position: 1, description: "Deposit", qty: "1", rate: "600" } }), 201);
        const extra = ok(await studio.post<{ data: Row }>(data("invoice_lines"), { values: { document_id: invoice.id, position: 2, description: "Survey", qty: "1", rate: "150" } }), 201).data;
        const before = await one("invoices", invoice.id);
        expect([Number(before["subtotal"]), Number(before["balance"])]).toEqual([750, Number(before["total"])]);
        const taken = await remove(studio, "invoice_lines", extra.id);
        expect(taken.status, JSON.stringify(taken.body).slice(0, 400)).toBe(200);
        const after = await one("invoices", invoice.id);
        expect([Number(after["subtotal"]), Number(after["total"]), Number(after["balance"])]).toEqual([600, Number(after["total"]), Number(after["total"])]);
        expect(Number(after["total"])).toBeLessThan(Number(before["total"]));
      }, 120_000);

      it("refuses Studio the line of a SENT invoice and of a sent or accepted proposal: the states lock them", async () => {
        const sentInvoice = await byNumber("invoices", "INV-S2039");
        expect(sentInvoice["status"]).toBe("sent");
        const line = (await rows("invoice_lines")).find((l) => l["document_id"] === sentInvoice.id)!;
        const a = await remove(studio, "invoice_lines", line.id);
        expect([...refused(a), a.code]).toEqual([a.status, true, expect.stringMatching(/RECORD_LOCKED|DELETE_REFUSED|STATE/)]);
        for (const number of ["QUO-S1142", "QUO-S1141"]) {
          const proposal = await byNumber("proposals", number);
          expect(["sent", "accepted"]).toContain(proposal["status"]);
          const pl = (await rows("proposal_lines")).find((l) => l["document_id"] === proposal.id)!;
          const b = await remove(studio, "proposal_lines", pl.id);
          expect([number, ...refused(b), b.code]).toEqual([number, b.status, true, expect.stringMatching(/RECORD_LOCKED|DELETE_REFUSED|STATE/)]);
        }
        // Still there, all of them.
        expect((await rows("invoice_lines")).some((l) => l.id === line.id)).toBe(true);
      }, 120_000);

      it("keeps Studio from voiding, deleting, and changing the studio's set-up", async () => {
        const unpaid = await byNumber("invoices", "INV-S2040");
        const voiding = await studio.patch(`${data("invoices")}/${String(unpaid.id)}`, { values: { status: "void", void_reason: "Not mine to void" } });
        expect(refused(voiding)).toEqual([voiding.status, true]);
        expect((await one("invoices", unpaid.id))["status"]).toBe("sent");
        const payment = (await rows("payments")).find((p) => p["voided"] !== true && p["voided"] !== 1)!;
        const voidPay = await studio.patch(`${data("payments")}/${String(payment.id)}`, { values: { voided: true, void_reason: "Not mine to void" } });
        expect(refused(voidPay)).toEqual([voidPay.status, true]);
        const draft = (await rows("invoices")).find((i) => i["status"] === "draft")!;
        const client = (await rows("clients"))[0]!;
        const message = (await rows("messages"))[0]!;
        const nadia = (await rows("people")).find((p) => p["name"] === "Nadia Cole")!;
        const project = (await rows("projects"))[0]!;
        const entry = ok(await studio.post<{ data: Row }>(data("time_entries"), { values: { project_id: project.id, person_id: nadia.id, date: "2026-07-28", logged_hours: "1" } }), 201).data;
        for (const [ref, id] of [["invoices", draft.id], ["clients", client.id], ["time_entries", entry.id], ["messages", message.id]] as const) {
          const reply = await remove(studio, ref, id);
          expect([ref, reply.status]).toEqual([ref, 403]);
        }
        const settings = (await rows("settings"))[0]!;
        const writes: [string, Reply][] = [
          ["settings", await studio.patch(`${data("settings")}/${String(settings.id)}`, { values: { name: "Not the studio's name" } })],
          ["people", await studio.post(data("people"), { values: { name: "A new hand", position: 9 } })],
          ["people", await studio.patch(`${data("people")}/${String(nadia.id)}`, { values: { role_label: "Owner" } })],
          ["rates", await studio.post(data("rates"), { values: { label: "Rush day", amount: "900" } })],
          ["running_costs", await studio.post(data("running_costs"), { values: { label: "Studio rent", monthly_amount: "1400" } })],
        ];
        for (const [ref, reply] of writes) expect([ref, reply.status]).toEqual([ref, 403]);
      }, 120_000);

      it("lets the Studio manager do what the manifest gives it, and still never delete from the outbox", async () => {
        // A draft line out, a draft discarded.
        const client = (await rows("clients", manager)).find((c) => c["company"] === "Hearth & Loaf")!;
        const draft = ok(await manager.post<{ data: Row }>(data("invoices"), { values: { client_id: client.id, title: "A draft to discard" } }), 201).data;
        const line = ok(await manager.post<{ data: Row }>(data("invoice_lines"), { values: { document_id: draft.id, position: 1, description: "Something", qty: "1", rate: "100" } }), 201).data;
        expect((await remove(manager, "invoice_lines", line.id)).status).toBe(200);
        // A numbered invoice is never deleted, by anyone (Invoices & Receipts: "Void it instead") — the manager discards it so.
        const deleted = await remove(manager, "invoices", draft.id);
        expect([deleted.status, deleted.code]).toEqual([409, "DELETE_REFUSED"]);
        ok(await manager.patch(`${data("invoices")}/${String(draft.id)}`, { values: { status: "void", void_reason: "Discarded" } }));
        expect((await one("invoices", draft.id))["status"]).toBe("void");
        // A void of an unpaid invoice, and of a payment: the invoice owes it again.
        const unpaid = await byNumber("invoices", "INV-S2040");
        ok(await manager.patch(`${data("invoices")}/${String(unpaid.id)}`, { values: { status: "void", void_reason: "Raised twice" } }));
        expect((await one("invoices", unpaid.id))["status"]).toBe("void");
        const invoice = await byNumber("invoices", "INV-S2039");
        const paid = ok(await manager.post<{ data: Row }>(data("payments"), { values: { document_id: invoice.id, amount: "100", method: "bank-transfer", paid_on: "2026-07-28" } }), 201).data;
        const owed = Number((await one("invoices", invoice.id))["balance"]);
        ok(await manager.patch(`${data("payments")}/${String(paid.id)}`, { values: { voided: true, void_reason: "Bounced" } }));
        expect(Number((await one("invoices", invoice.id))["balance"])).toBe(owed + 100);
        // Its own client and hour entry, deleted.
        const own = ok(await manager.post<{ data: Row }>(data("clients"), { values: { company: "Short Lived", contact_name: "Sol Brief", email: "sol@shortlived.example" } }), 201).data;
        expect((await remove(manager, "clients", own.id)).status).toBe(200);
        const nadia = (await rows("people")).find((p) => p["name"] === "Nadia Cole")!;
        const project = (await rows("projects"))[0]!;
        const entry = ok(await manager.post<{ data: Row }>(data("time_entries"), { values: { project_id: project.id, person_id: nadia.id, date: "2026-07-28", logged_hours: "1" } }), 201).data;
        expect((await remove(manager, "time_entries", entry.id)).status).toBe(200);
        // The set-up is the manager's.
        const settings = (await rows("settings"))[0]!;
        ok(await manager.patch(`${data("settings")}/${String(settings.id)}`, { values: { phone: "+1 555 0100" } }));
        ok(await manager.post(data("people"), { values: { name: "A new hand", position: 9 } }), 201);
        ok(await manager.post(data("rates"), { values: { label: "Rush day", amount: "900" } }), 201);
        ok(await manager.post(data("running_costs"), { values: { label: "Studio rent", monthly_amount: "1400" } }), 201);
        // The outbox is the studio's record of what was sent: nobody deletes from it.
        const message = (await rows("messages"))[0]!;
        expect((await remove(manager, "messages", message.id)).status).toBe(403);
      }, 120_000);
    });
  });
});
