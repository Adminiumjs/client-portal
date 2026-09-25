/**
 * THE CLIENT PORTAL'S CONTRACT WITH ADMINIUM, ON EVERY ENGINE.
 *
 * This repo's own `manifest.json` and sample, installed on a BUILT Adminium
 * with the Invoices & Receipts add-on, on SQLite, Postgres and MySQL:
 *
 *   1. install — the add-on first, then the app, every rule kept;
 *   2. the sample added at 10:00 on Tuesday 28 July 2026 at the studio;
 *   3. every invoice's totals and balance = what the rows work out, and the
 *      Overview's figures = the ones the sample's own test asserts;
 *   4. a payment race: two payments at once, one through, one refused with
 *      the balance left;
 *   5. a void: an unpaid invoice voids and its reminders go at the next scan;
 *      one with money on it is refused;
 *   6. a client signs in by an emailed link and accepts the proposal still
 *      out: sealed with the SHA-256 of what was agreed;
 *   7. the sample removed, keeping what the studio and the client made of it.
 *
 * The demo's stand-in world plays the same scenario (`demo/world.test.ts`),
 * and the figures here are held to it: the same receipt number, the same
 * refusals, the SAME fingerprint — so the demo can never decide otherwise
 * than Adminium does without this failing.
 *
 * It runs where an Adminium checkout with its built server and dashboard is
 * (`ADMINIUM_REPO`) and the add-ons checkout beside it (`ADD_ONS_REPO`), and
 * says why it skipped when they are not; `ADMINIUM_REQUIRE_CONTRACT=1` makes
 * that a failure (the contract workflow sets it). Postgres and MySQL run with
 * `TEST_POSTGRES_URL` / `TEST_MYSQL_URL`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { normaliseAll } from "../data/rows.ts";
import { COLUMNS, resolveSample } from "../data/sampleRows.ts";
import { setServerZone } from "../data/venueTime.ts";
import type { Id, TableRef } from "../data/types.ts";
import { DEMO_START, DEMO_ZONE } from "../lib/clock.ts";
import { overview } from "../demo/figures.ts";
import { fingerprint, type HashOf } from "../demo/fingerprint.ts";
import { placesOf } from "../demo/engine.ts";
import { DEMO_RULES } from "../demo/rules.ts";
import { DEMO_BUNDLE, DEMO_CURRENCY, DEMO_SETTINGS, demoSample } from "../demo/sample.ts";
import { createWorld } from "../demo/world.ts";
import { addOnBundle, addOnVersions, appBundle, boot, Caller, ENGINES, missing, ok, packedAddOnVersion, solve, until, type Engine, type Server } from "./harness.ts";

type Row = Record<string, unknown> & { id: Id };

const why = missing();
if (why !== null && process.env["ADMINIUM_REQUIRE_CONTRACT"] === "1") throw new Error(`the contract must run here, and cannot: ${why}`);
const PORT_BASE = Number(process.env["CONTRACT_PORT_BASE"] ?? 4870);
const ADMIN = { email: process.env["E2E_ADMIN_EMAIL"] ?? "e2e@adminium.local", password: process.env["E2E_ADMIN_PASSWORD"] ?? "adminium-e2e-password" };
const CLEO = { email: "cleo@marigoldlane.example", name: "Cleo Nkemdi" };
const SPEC = (DEMO_RULES.stamps["proposals"]!.find((s) => s.column === "fingerprint")!.set as { hashOf: HashOf }).hashOf;

/** The same scenario on the demo's world: what Adminium must agree with. */
async function worldScenario() {
  const world = createWorld(demoSample("en-US"), () => DEMO_START, DEMO_ZONE, { name: "Nadia Cole" });
  const find = (ref: TableRef, number: string) => world.rows[ref].find((r) => r["number"] === number)!;
  const paid = await world.writes.insert("payments", { document_id: find("invoices", "INV-S2039").id, amount: "1000", method: "bank-transfer", paid_on: "2026-07-28" });
  const proposal = find("proposals", "QUO-S1142");
  const accepted = await world.portal(proposal["client_id"] as Id).accept(proposal.id, CLEO.name);
  return { receipt: paid.number, fingerprint: accepted.fingerprint };
}

/** Said in the name: the checkout packed as the release it will be, when the app already asks for that release. */
const REHEARSAL = why === null && packedAddOnVersion().rehearsed ? ` (the add-ons checkout, ${addOnVersions().checkout}, packed as ${packedAddOnVersion().version}: its release not yet stamped)` : "";

describe.skipIf(why !== null)(`the contract with a built Adminium${why === null ? REHEARSAL : ` — skipped: ${why}`}`, () => {
  let world: Awaited<ReturnType<typeof worldScenario>>;
  beforeAll(async () => {
    world = await worldScenario();
  });

  ENGINES.forEach(([engine, available], index) => {
    describe.skipIf(!available)(`on ${engine}`, () => {
      let server: Server;
      let staff: Caller;
      let connectionId = "";
      let real: Record<string, string> = {};
      let tableIds: Record<string, string> = {};

      beforeAll(async () => {
        server = await boot(engine as Engine, PORT_BASE + index * 10, DEMO_START);
        staff = new Caller(server.base, { origin: server.base });
        await staff.signIn(ADMIN.email, ADMIN.password);
        const connections = ok(await staff.get<{ connections: { id: string; name: string }[] }>("/api/v1/connections"));
        connectionId = connections.connections.find((c) => c.name === "northwind")!.id;
      }, 240_000);

      afterAll(async () => {
        await server?.stop();
      });

      const data = (ref: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tableIds[ref]!)}`;
      /**
       * Every row of one of the app's tables, a page at a time — read as the
       * portal reads them (`data/rows.ts`): each engine spells a decimal, a
       * yes/no and a date its own way, and the app holds one spelling.
       */
      const rows = async (ref: string): Promise<Row[]> => {
        const out: Row[] = [];
        for (let offset = 0; ; offset += 200) {
          const page = ok(await staff.get<{ data: Row[] }>(`${data(ref)}?limit=200&offset=${String(offset)}`)).data;
          out.push(...(normaliseAll(ref as TableRef, page) as unknown as Row[]));
          if (page.length < 200) return out;
        }
      };
      const all = async () => Object.fromEntries(await Promise.all(Object.keys(real).map(async (ref) => [ref, await rows(ref)] as const)));
      const byNumber = (list: Row[], number: string) => list.find((r) => r["number"] === number)!;

      it("installs the add-on first, then the app, keeping every rule", async () => {
        const addOn = addOnBundle();
        const stored = ok(await staff.post<{ key: string; version: string }>(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(addOn.integrity)}`, addOn.buffer));
        expect([stored.key, stored.version]).toEqual([addOn.key, addOn.version]);
        const app = appBundle();
        const staged = await staff.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(app.integrity)}`, app.buffer);
        expect([200, 201], JSON.stringify(staged.body).slice(0, 800)).toContain(staged.status);
        const body = { key: app.key, version: app.version, connectionId };
        const plan = ok(await staff.post<{ plan: { installable: boolean; checksum: string; addOns: { key: string; action: string }[] } }>("/api/v1/apps/plan", body)).plan;
        expect(plan.installable).toBe(true);
        expect(plan.addOns.map((a) => [a.key, a.action])).toEqual([["invoices", "install"]]);
        const installed = ok(
          await staff.post<{ rules: { skipped: unknown[] }; schema: { created: string[] }; publicAccess: { keys: Record<string, string> }; outbox: { defined: boolean } }>(
            "/api/v1/apps/install",
            { ...body, planChecksum: plan.checksum },
          ),
        );
        // The app's tables, by the manifest's names (read first: every later step works on them).
        const created = installed.schema.created;
        const prefix = created.find((name) => name.endsWith("deliverable_versions"))!.slice(0, -"deliverable_versions".length);
        real = Object.fromEntries(created.map((name) => [name.slice(prefix.length), name]));
        expect(Object.keys(real).sort()).toEqual(Object.keys(COLUMNS).sort());
        const schema = ok(await staff.get<{ model: { tables: { id: string; name: string }[] } }>(`/api/v1/connections/${connectionId}/schema`));
        tableIds = Object.fromEntries(Object.entries(real).map(([ref, name]) => [ref, schema.model.tables.find((t) => t.name === name)!.id]));
        // The studio's clock, currency and the add-on's settings, as the demo's studio set them.
        ok(await staff.patch(`/api/v1/connections/${connectionId}`, { timezone: DEMO_ZONE, currency: DEMO_CURRENCY }));
        const values = Object.fromEntries(Object.entries(DEMO_SETTINGS).map(([name, value]) => [name.slice("invoices.".length), value]));
        ok(await staff.put("/api/v1/add-ons/invoices/settings", { values }));
        // The server's own clock, which a driver reads a date at (as the staff side learns it).
        const surface = ok(await staff.get<{ serverTimezone: string | null }>("/apps/clients/staff/surface-config.json"));
        setServerZone(surface.serverTimezone);
        // Every rule the manifest asks for is kept, both browser keys are made, and the outbox is on.
        expect(JSON.stringify(installed.rules.skipped)).toBe("[]");
        expect(Object.keys(installed.publicAccess.keys).sort()).toEqual(["customer", "handover"]);
        expect(installed.outbox.defined).toBe(true);
      }, 180_000);

      it("adds the sample at 10:00 on 28 July: every invoice's totals as the rows work them out, the Overview's figures as the sample's own", async () => {
        ok(await staff.post("/api/v1/apps/clients/sample-data"));
        await until(async () => (ok(await staff.get<{ loaded: boolean }>("/api/v1/apps/clients/sample-data")).loaded ? true : undefined), "the sample to be added");
        const held = await all();
        const sample = resolveSample(DEMO_BUNDLE, { now: DEMO_START, zone: DEMO_ZONE, locale: "en-US", currency: DEMO_CURRENCY, settings: DEMO_SETTINGS });
        for (const expected of sample["invoices"]!) {
          const invoice = byNumber(held["invoices"]!, String(expected["number"]));
          for (const column of ["subtotal", "tax", "total", "paid", "balance"]) expect(Number(invoice[column]), `${String(expected["number"])} ${column}`).toBe(expected[column]);
        }
        const o = overview(held, DEMO_START, DEMO_ZONE);
        expect(o).toEqual(overview(sample, DEMO_START, DEMO_ZONE));
        expect(o.outstanding).toEqual({ amount: 6937.5, invoices: 4 });
        expect(o.overdue).toEqual({ amount: 3797.5, invoices: 2, oldestDays: 47 });
        expect(o.proposalsWaiting).toEqual({ amount: 4231.5, proposals: 1, holdsUntil: "2026-08-11" });
        expect(o.needs.chaseReady).toEqual([{ invoice: "INV-S2038", client: "Fold & Rule", daysLate: 12, rung: "invoice-rung-1" }]);
        expect(o.needs.chaseHeld).toBe(9);
      }, 240_000);

      it("lets one of two payments at once through, and refuses the other with the balance left", async () => {
        const invoice = byNumber(await rows("invoices"), "INV-S2039");
        const pay = () => staff.post<{ data: Row }>(data("payments"), { values: { document_id: invoice.id, amount: "1000", method: "bank-transfer", paid_on: "2026-07-28" } });
        const [a, b] = await Promise.all([pay(), pay()]);
        const through = [a!, b!].find((r) => r.status === 201)!;
        const refused = [a!, b!].find((r) => r.status !== 201)!;
        expect([a!.status, b!.status].sort()).toEqual([201, 409]);
        expect(through.body.data["number"]).toBe(world.receipt);
        expect([refused.code, refused.details["column"], Number(refused.details["balance"])]).toEqual(["BALANCE_EXCEEDED", "balance", 621]);
        expect(Number(byNumber(await rows("invoices"), "INV-S2039")["balance"])).toBe(621);
      }, 60_000);

      it("voids an unpaid invoice — its reminders go at the next scan — and refuses one with money on it", async () => {
        const invoices = await rows("invoices");
        const unpaid = byNumber(invoices, "INV-S2040");
        ok(await staff.patch(`${data("invoices")}/${String(unpaid.id)}`, { values: { status: "void", void_reason: "Raised twice" } }));
        const refused = await staff.patch(`${data("invoices")}/${String(byNumber(invoices, "INV-S2039").id)}`, { values: { status: "void" } });
        expect([refused.status, refused.code, refused.details["requires"]]).toEqual([409, "STATE_MOVE_REFUSED", "paid"]);
        await until(
          async () => {
            const rungs = (await rows("messages")).filter((m) => String(m["invoice_id"]) === String(unpaid.id) && String(m["kind"]).startsWith("invoice-rung-"));
            return rungs.length === 3 && rungs.every((m) => m["status"] === "skipped" && m["skip_reason"] === "void") ? true : undefined;
          },
          "the scan to skip the void invoice's reminders",
          150_000,
        );
      }, 180_000);

      it("lets a client sign in by an emailed link and accept the proposal still out, sealed with the fingerprint the demo seals", async () => {
        ok(await staff.put("/api/v1/public-api", { enabled: true }));
        ok(await staff.put("/api/v1/settings/email", { publicOrigin: server.base }));
        const config = ok(await new Caller(server.base).get<{ publishableKey: string }>("/apps/clients/customer/surface-config.json"));
        const guest = new Caller(server.base, { authorization: `Bearer ${config.publishableKey}`, origin: server.base });
        const proof = async () => {
          const challenge = ok(await guest.get<{ data: { id: string; salt: string; difficulty: number } }>("/api/v1/public/challenge?purpose=claim")).data;
          return { "x-adminium-proof": `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}` };
        };
        ok(await guest.post("/api/v1/public/claim/link", { email: CLEO.email, lang: "en-US" }, await proof()), 202);
        const mail = await until(async () => {
          const messages = (await (await fetch(`${server.sink}/messages`)).json()) as { to: string[]; text: string }[];
          return messages.find((m) => m.to.some((to) => to.includes(CLEO.email)) && m.text.includes("/c#"));
        }, "Cleo's sign-in link");
        const token = /\/c#([A-Za-z0-9_-]{43})/.exec(mail.text)![1]!;
        const session = ok(await guest.post<{ data: { session: string; level: string } }>("/api/v1/public/claim/link/verify", { token })).data;
        expect(session.level).toBe("verified");
        const as = { "x-adminium-public-session": session.session };
        // The accept door, found as the portal finds it: the proposals entry that writes a status and a signature.
        const refs = ok(await guest.get<{ data: { refs: Record<string, { actions: string[]; writable: string[] }> } }>("/api/v1/public/config", as)).data.refs;
        const accept = Object.entries(refs).find(([ref, r]) => ref.startsWith(real["proposals"]!) && r.writable.includes("status") && r.writable.includes("signed_name") && !r.writable.includes("decline_note"))![0];
        const proposal = byNumber(await rows("proposals"), "QUO-S1142");
        const accepted = ok(await guest.patch<{ data: Row }>(`/api/v1/public/records/${accept}/${String(proposal.id)}`, { values: { status: "accepted", signed_name: CLEO.name } }, as)).data;
        expect(accepted["fingerprint"]).toMatch(/^[0-9a-f]{64}$/);
        // Worked out again from what is stored, the canonical way — and the same as the demo's world seals.
        const held = await all();
        const stored = held["proposals"]!.find((p) => p.id === proposal.id)!;
        expect(stored).toMatchObject({ status: "accepted", signed_name: CLEO.name, signed_email: CLEO.email, accepted_how: "portal" });
        const again = fingerprint("proposals", stored, SPEC, {
          rows: (table) => held[table] ?? [],
          kind: (table, column) => DEMO_RULES.kinds[table]?.[column],
          places: (table, column, row) => placesOf(table, column, row, DEMO_CURRENCY),
        });
        expect([stored["fingerprint"], again]).toEqual([accepted["fingerprint"], accepted["fingerprint"]]);
        expect(accepted["fingerprint"]).toBe(world.fingerprint);
        // Once: a second acceptance finds nothing to accept.
        const twice = await guest.patch(`/api/v1/public/records/${accept}/${String(proposal.id)}`, { values: { status: "accepted", signed_name: "Someone Else" } }, as);
        expect(twice.status).toBe(404);
      }, 240_000);

      it("removes the sample, keeping what the studio and its client made of it", async () => {
        const plan = ok(await staff.post<{ total: number; kept: { table: string }[]; changed: unknown[] }>("/api/v1/apps/clients/sample-data/remove-plan"));
        expect(plan.total).toBeGreaterThan(0);
        const removed = ok(await staff.post<{ removed: number; kept: number }>("/api/v1/apps/clients/sample-data/remove", { keepChanged: true }));
        expect(removed.removed).toBeGreaterThan(0);
        const left = await all();
        const numbers = left["invoices"]!.map((i) => i["number"]);
        // The paid-into and the voided invoices are the studio's now; one nobody touched is gone.
        expect(numbers).toEqual(expect.arrayContaining(["INV-S2039", "INV-S2040"]));
        expect(numbers).not.toContain("INV-S2024");
        // The payment the studio recorded stays, and so does the proposal the client accepted.
        expect(left["payments"]!.map((p) => p["number"])).toContain(world.receipt);
        expect(left["proposals"]!.map((p) => p["number"])).toContain("QUO-S1142");
        expect(ok(await staff.get<{ loaded: boolean }>("/api/v1/apps/clients/sample-data")).loaded).toBe(false);
      }, 180_000);
    });
  });
});
