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
 *   7. the back office: purchases and suppliers numbered without gaps under
 *      parallel creates; the desk's own "Move onto an invoice" and "Pass on",
 *      pressed twice at once, put each entry and purchase on ONE line; one
 *      running clock per person, its hours counted by Adminium from its own
 *      start and stop stamps; an invoiced entry kept; a line taken off a
 *      draft frees it, a sent one's lines are locked; the hours and the cost
 *      a line bills stay as billed, and a voided invoice's lines let go of
 *      them, so the desk bills them again;
 *   8. an enquiry from the studio's site: behind the human check, only its
 *      own columns, landing as a new enquiry from the web, and the studio
 *      emailed about it; the per-address limit;
 *   9. the sample removed, keeping what the studio and the client made of it;
 *  10. a clock left running past sixteen hours (the server's clock moved on a
 *      night): its count refused, nothing stored, the typed hours stop it.
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

import { sessionDeskReads } from "../data/adminiumSource.ts";
import { normaliseAll } from "../data/rows.ts";
import { createSessionTransport } from "../data/sessionSource.ts";
import { sessionSink } from "../data/sink.ts";
import { realTables } from "../data/tableOfRef.ts";
import { setClockSource, setZone } from "../lib/clock.ts";
import { resetDesk, setDeskReads, setDeskWrites, upsert } from "../state/desk.ts";
import { takeOffDraft } from "../state/invoiceDrafts.ts";
import { discardDraft, voidInvoice } from "../state/actions.ts";
import { addPurchase, editPurchase, passOn } from "../state/officeActions.ts";
import { editTime, logTime, moveTimeOntoInvoice, removeTime, startClock, stopClock } from "../state/timeActions.ts";
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
import { addOnBundle, addOnVersions, appBundle, boot, Caller, ENGINES, missing, ok, packedAddOnVersion, PORTS_PER_ENGINE, solve, until, type Engine, type Server } from "./harness.ts";

type Row = Record<string, unknown> & { id: Id };

const why = missing();
if (why !== null && ["1", "true"].includes(process.env["ADMINIUM_REQUIRE_CONTRACT"] ?? "")) throw new Error(`the contract must run here, and cannot: ${why}`);
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
        server = await boot(engine as Engine, PORT_BASE + index * PORTS_PER_ENGINE, DEMO_START);
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
        const plan = ok(
          await staff.post<{ plan: { installable: boolean; checksum: string; addOns: { key: string; need: string; checked: boolean; action: string | null }[] } }>("/api/v1/apps/plan", body),
        ).plan;
        expect(plan.installable).toBe(true);
        // Invoices & Receipts is installed with it; Holiday calendars is offered for one feature, not ticked, and nothing waits on it.
        expect(plan.addOns.map((a) => [a.key, a.need, a.checked])).toEqual([
          ["invoices", "requires", true],
          ["holiday-calendars", "feature", false],
        ]);
        expect(plan.addOns.find((a) => a.key === "invoices")!.action).toBe("install");
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

      // ── the back office ─────────────────────────────────────────────────────

      it("numbers purchases EX- and suppliers SUP- without gaps when many are made at once", async () => {
        const made = await Promise.all(
          Array.from({ length: 8 }, (_, i) => staff.post<{ data: Row }>(data("expenses"), { values: { date: "2026-07-28", what: `Stamps ${String(i)}`, amount: "10", rebill: false } })),
        );
        expect(made.map((m) => m.status)).toEqual(Array(8).fill(201));
        expect(made.map((m) => String(m.body.data["number"])).sort()).toEqual(["EX-001", "EX-002", "EX-003", "EX-004", "EX-005", "EX-006", "EX-007", "EX-008"]);
        const suppliers = await Promise.all(Array.from({ length: 6 }, (_, i) => staff.post<{ data: Row }>(data("suppliers"), { values: { name: `Printer ${String(i)}` } })));
        expect(suppliers.map((m) => m.status)).toEqual(Array(6).fill(201));
        expect(suppliers.map((m) => String(m.body.data["number"])).sort()).toEqual(["SUP-01", "SUP-02", "SUP-03", "SUP-04", "SUP-05", "SUP-06"]);
        // A purchase is dated when it was made, never later; a cost is above zero.
        const future = await staff.post(data("expenses"), { values: { date: "2026-08-02", what: "Later", amount: "10" } });
        const free = await staff.post(data("expenses"), { values: { date: "2026-07-28", what: "Nothing", amount: "0" } });
        expect([future.status, free.status]).toEqual([422, 422]);
      }, 120_000);

      it("moves time onto an invoice ONCE, through the desk's own code pressed twice at once", async () => {
        // The desk, booted as main.tsx boots it, speaking to this server with the operator's session.
        const { csrfToken } = staff.session();
        const tables = realTables(real);
        const transport = createSessionTransport({
          tableOfRef: tables,
          connectionId,
          staff: { csrfToken, timezone: DEMO_ZONE, currency: DEMO_CURRENCY },
          fetchImpl: staff.fetchAs(),
        });
        resetDesk();
        setZone(DEMO_ZONE);
        setClockSource(() => DEMO_START);
        setDeskReads(sessionDeskReads(transport));
        setDeskWrites(sessionSink(transport, tables, { csrfToken: () => csrfToken, fetchImpl: staff.fetchAs() }));

        const project = byNumber(await rows("projects"), "PRJ-S02");
        const people = await rows("people");
        const [nadia, tomas] = [people.find((p) => p["name"] === "Nadia Cole")!.id, people.find((p) => p["name"] === "Tomas Wilde")!.id];
        const logged = await Promise.all([
          logTime({ project_id: project.id, person_id: nadia, hours: "2.5", note: "Sleeve layouts, contract run" }),
          logTime({ project_id: project.id, person_id: tomas, hours: "1.25", note: "Board check, contract run" }),
        ]);
        const ids = logged.map((o) => (o.ok ? o.value.id : Number.NaN));
        expect(ids.every(Number.isFinite), JSON.stringify(logged)).toBe(true);
        const move = { rate: "125.00", newTitle: () => "Time, contract run" };
        const [a, b] = await Promise.all([moveTimeOntoInvoice(ids, move), moveTimeOntoInvoice(ids, move)]);
        expect([a.ok, b.ok], JSON.stringify([a, b]).slice(0, 800)).toEqual([true, true]);
        const carried = (await rows("invoice_lines")).filter((l) => ids.includes(l["time_entry_id"] as Id));
        expect(carried.map((l) => l["time_entry_id"]).sort()).toEqual([...ids].sort());
        const drafts = new Set(carried.map((l) => l["document_id"]));
        expect(drafts.size).toBe(1);
        const draft = (await rows("invoices")).find((i) => i.id === [...drafts][0])!;
        // 3.75 hours at 125, taxed at the client's 8.5 %: Adminium's figures.
        expect([draft["status"], draft["title"], Number(draft["subtotal"]), Number(draft["total"])]).toEqual(["draft", "Time, contract run", 468.75, 508.59]);
        expect((await rows("invoices")).filter((i) => i["title"] === "Time, contract run")).toHaveLength(1);

        // Adminium's own guarantee, under the desk: a second line for the same hours is refused.
        const again = await staff.post(data("invoice_lines"), { values: { document_id: draft.id, description: "Again", qty: "1", rate: "1", time_entry_id: ids[0] } });
        expect([again.status, again.code]).toEqual([409, "UNIQUE_VIOLATION"]);
        // An invoiced entry stays: the line points at it.
        const removed = await removeTime(ids[0]!);
        expect(!removed.ok && removed.code).toBe("FK_VIOLATION");
        // Off the draft, the entry is free; moved again, it is on one line again.
        const line = carried.find((l) => l["time_entry_id"] === ids[0])!;
        expect((await takeOffDraft(line.id)).ok).toBe(true);
        const moved = await moveTimeOntoInvoice([ids[0]!], move);
        expect(moved.ok && moved.value.lines.map((l) => l.time_entry_id)).toEqual([ids[0]]);
        // Sent, the draft's lines are locked: nothing comes off it any more.
        ok(await staff.patch(`${data("invoices")}/${String(draft.id)}`, { values: { status: "sent" } }));
        const locked = await takeOffDraft(moved.ok ? moved.value.lines[0]!.id : 0);
        expect(!locked.ok && ["RECORD_LOCKED", "DELETE_REFUSED"].includes(locked.code)).toBe(true);
      }, 180_000);

      it("keeps one running clock per person, started and stopped by Adminium's stamps, its hours Adminium's", async () => {
        const project = byNumber(await rows("projects"), "PRJ-S01");
        const nadia = (await rows("people")).find((p) => p["name"] === "Nadia Cole")!.id;
        const [a, b] = await Promise.all([startClock({ project_id: project.id, person_id: nadia }), startClock({ project_id: project.id, person_id: nadia })]);
        const started = [a, b].filter((o) => o.ok);
        const refused = [a, b].filter((o) => !o.ok);
        expect([started.length, refused.length]).toEqual([1, 1]);
        expect(!refused[0]!.ok && refused[0]!.code).toBe("UNIQUE_VIOLATION");
        const clock = started[0]!.ok ? started[0]!.value : null;
        expect(clock?.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(clock?.hours).toBeNull();
        // An hour and 37 minutes pass on Adminium's clock (09:00 → 10:37, say); the desk's own clock
        // still says 10:00 — it is not asked. The stop sends no hours: Adminium stamps the stop and
        // counts them from its two stamps, to the quarter hour.
        await server.pass(97 * 60_000);
        const stopped = await stopClock(clock!.id, { note: "Contract clock" });
        expect(stopped.ok, JSON.stringify(stopped)).toBe(true);
        const row = stopped.ok ? stopped.value : null;
        expect([Number(row?.hours), row?.logged_hours, row?.running_for, row?.clock_stopped]).toEqual([1.5, null, null, true]);
        const ran = Date.parse(String(row?.stopped_at)) - Date.parse(String(row?.started_at));
        expect(ran).toBeGreaterThanOrEqual(97 * 60_000);
        expect(ran).toBeLessThan(97 * 60_000 + 30_000);
        // What the desk holds is what Adminium stored.
        const held = (await rows("time_entries")).find((e) => e.id === clock!.id)!;
        expect([Number(held["hours"]), held["stopped_at"], held["running_for"]]).toEqual([1.5, row?.stopped_at, null]);
        // A person's correction is their own figure; Adminium's hours follow it.
        const corrected = await editTime(clock!.id, { hours: "1.25" });
        expect(corrected.ok && [Number(corrected.value.hours), Number(corrected.value.logged_hours)]).toEqual([1.25, 1.25]);
        // Hours a writer sends for Adminium's own figure, or a stop moment of its own, are not kept.
        ok(await staff.patch(`${data("time_entries")}/${String(clock!.id)}`, { values: { hours: "12", stopped_at: "2026-07-28T23:00:00Z" } }));
        const kept = (await rows("time_entries")).find((e) => e.id === clock!.id)!;
        expect([Number(kept["hours"]), kept["stopped_at"]]).toEqual([1.25, row?.stopped_at]);
        // The stop is stamped once: stopped again an hour later, straight to Adminium, it keeps its moment.
        await server.pass(60 * 60_000);
        ok(await staff.patch(`${data("time_entries")}/${String(clock!.id)}`, { values: { running_for: null, clock_stopped: true, note: "Contract clock, again" } }));
        const once = (await rows("time_entries")).find((e) => e.id === clock!.id)!;
        expect([once["stopped_at"], Number(once["hours"])]).toEqual([row?.stopped_at, 1.25]);
        // A page that still drew it running reads it again before its Stop, and writes nothing.
        upsert("time_entries", clock!);
        const stale = await stopClock(clock!.id, { hours: "4", note: "Contract clock" });
        expect(!stale.ok && stale.code).toBe("CLOCK_NOT_RUNNING");
        expect(Number((await rows("time_entries")).find((e) => e.id === clock!.id)!["hours"])).toBe(1.25);
        expect((await startClock({ project_id: project.id, person_id: nadia })).ok).toBe(true);
      }, 120_000);

      it("passes a purchase on at cost ONCE, pressed twice at once", async () => {
        const project = byNumber(await rows("projects"), "PRJ-S01");
        const bought = await addPurchase({ what: "Proof prints, contract run", amount: "42.10", project_id: project.id, rebill: true, date: "2026-07-28" });
        expect(bought.ok, JSON.stringify(bought)).toBe(true);
        const id = bought.ok ? bought.value.id : 0;
        // The project's client, copied by Adminium.
        expect(bought.ok && bought.value.client_id).toBe(project["client_id"]);
        const title = { newTitle: () => "Purchases, contract run" };
        const [a, b] = await Promise.all([passOn([id], title), passOn([id], title)]);
        expect([a.ok, b.ok]).toEqual([true, true]);
        const carried = (await rows("invoice_lines")).filter((l) => l["expense_id"] === id);
        expect(carried.map((l) => [Number(l["qty"]), Number(l["rate"])])).toEqual([[1, 42.1]]);
      }, 120_000);

      it("keeps billed hours and costs as billed, and bills what a voided invoice let go of again, through the desk's own code", async () => {
        // The refusal names the lines' table as Adminium's schema knows it (`<schema>.<table>`).
        const byLines = (from: unknown) => String(from).endsWith(`.${real["invoice_lines"]!}`);
        const entries = (await rows("time_entries")).filter((e) => String(e["note"]).endsWith(", contract run"));
        const ids = entries.map((e) => e.id).sort((a, b) => a - b);
        expect(ids).toHaveLength(2);
        const sent = (await rows("invoices")).find((i) => i["title"] === "Time, contract run")!;
        expect(sent["status"]).toBe("sent");

        // Billed on a sent invoice: the hours, the day and the project stay, whichever door writes; the note is the studio's.
        const edited = await editTime(ids[0]!, { hours: "3" });
        expect(!edited.ok && [edited.code, byLines(edited.details["linkedFrom"])]).toEqual(["ALREADY_INVOICED", true]);
        for (const values of [{ logged_hours: "3" }, { date: "2026-07-20" }]) {
          const raw = await staff.patch(`${data("time_entries")}/${String(ids[0])}`, { values });
          expect([raw.status, raw.code, byLines(raw.details["linkedFrom"])]).toEqual([409, "RECORD_LOCKED", true]);
        }
        expect((await editTime(ids[0]!, { note: "Sleeve layouts, contract run" })).ok).toBe(true);

        // A purchase on a draft: its cost and "pass on" stay too.
        const purchase = (await rows("expenses")).find((e) => e["what"] === "Proof prints, contract run")!;
        const cost = await editPurchase(purchase.id, { amount: "50" });
        expect(!cost.ok && cost.code).toBe("ALREADY_INVOICED");
        const rebill = await staff.patch(`${data("expenses")}/${String(purchase.id)}`, { values: { rebill: false } });
        expect([rebill.status, rebill.code, byLines(rebill.details["linkedFrom"])]).toEqual([409, "RECORD_LOCKED", true]);

        // Voided: its lines take nothing but an emptied link, and the hours are free.
        expect((await voidInvoice(sent.id, "Raised in error")).ok).toBe(true);
        const voidedLines = (await rows("invoice_lines")).filter((l) => l["document_id"] === sent.id);
        const figures = await staff.patch(`${data("invoice_lines")}/${String(voidedLines[0]!.id)}`, { values: { qty: "1" } });
        const moved = await staff.patch(`${data("invoice_lines")}/${String(voidedLines[0]!.id)}`, { values: { time_entry_id: purchase.id } });
        expect([figures.status, figures.code, moved.status, moved.code]).toEqual([409, "RECORD_LOCKED", 409, "RECORD_LOCKED"]);

        // Moved again by the desk: each voided line lets go, and the hours go on a new draft — kept again there.
        const again = await moveTimeOntoInvoice(ids, { rate: "125.00", newTitle: () => "Time, billed again" });
        expect(again.ok, JSON.stringify(again).slice(0, 800)).toBe(true);
        const now = await rows("invoice_lines");
        expect(now.filter((l) => l["document_id"] === sent.id).map((l) => l["time_entry_id"])).toEqual([null, null]);
        const carriers = now.filter((l) => ids.includes(l["time_entry_id"] as Id));
        expect(carriers.map((l) => l["time_entry_id"]).sort()).toEqual(ids);
        expect(new Set(carriers.map((l) => l["document_id"])).size).toBe(1);
        const draft = (await rows("invoices")).find((i) => i.id === carriers[0]!["document_id"])!;
        expect([draft["status"], draft.id === sent.id]).toEqual(["draft", false]);
        const keptAgain = await editTime(ids[0]!, { hours: "3" });
        expect(!keptAgain.ok && keptAgain.code).toBe("ALREADY_INVOICED");

        // A draft discarded (voided) lets go of its purchase the same way: passed on again, it is on one line.
        const purchaseDraft = (await rows("invoice_lines")).find((l) => l["expense_id"] === purchase.id)!["document_id"] as Id;
        expect((await discardDraft(purchaseDraft)).ok).toBe(true);
        const passed = await passOn([purchase.id], { newTitle: () => "Purchases, billed again" });
        expect(passed.ok && passed.value.lines.map((l) => l.expense_id)).toEqual([purchase.id]);
        const holding = (await rows("invoice_lines")).filter((l) => l["expense_id"] === purchase.id);
        expect(holding.map((l) => l["document_id"] === purchaseDraft)).toEqual([false]);
      }, 120_000);

      it("takes an enquiry from the studio's site behind the human check, as a new one from the web, and tells the studio", async () => {
        ok(await staff.put("/api/v1/public-api", { enabled: true }));
        ok(await staff.put("/api/v1/settings/email", { publicOrigin: server.base }));
        // The sample studio's address is on a reserved domain, which Adminium never mails: the contract's studio has its own.
        const settings = (await rows("settings"))[0]!;
        const studio = "desk@studio-contract.net";
        ok(await staff.patch(`${data("settings")}/${String(settings.id)}`, { values: { notify_enquiry: true, reply_to: studio } }));
        const config = ok(await new Caller(server.base).get<{ publishableKey: string }>("/apps/clients/customer/surface-config.json"));
        const guest = new Caller(server.base, { authorization: `Bearer ${config.publishableKey}`, origin: server.base });
        const refs = ok(await guest.get<{ data: { refs: Record<string, { actions: string[]; writable: string[]; expose: string[] }> } }>("/api/v1/public/config")).data.refs;
        const [door, entry] = Object.entries(refs).find(([ref, r]) => ref.startsWith(real["enquiries"]!) && r.writable.includes("body"))!;
        expect([entry.actions, entry.expose]).toEqual([["create"], ["received_at"]]);
        const proof = async () => {
          const challenge = ok(await guest.get<{ data: { id: string; salt: string; difficulty: number } }>("/api/v1/public/challenge?purpose=write")).data;
          return { "x-adminium-proof": `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}` };
        };
        const form = { name: "Rosa Vento", email: "rosa.contract@ventoandsons.example", business: "Vento & Sons", body: "A sign, and a name people can find." };
        // No proof, no enquiry; nor one that tries to choose what the studio decides.
        const unproved = await guest.post(`/api/v1/public/records/${door}`, { values: form });
        expect(unproved.status).toBeGreaterThanOrEqual(400);
        const forged = await guest.post(`/api/v1/public/records/${door}`, { values: { ...form, status: "proposal" } }, await proof());
        expect([forged.status, forged.code]).toEqual([400, "PUBLIC_WRITE_REFUSED"]);
        const sent = await guest.post<{ data: Row }>(`/api/v1/public/records/${door}`, { values: form }, await proof());
        expect(sent.status).toBe(201);
        expect(Object.keys(sent.body.data)).toEqual(["received_at"]);
        const made = (await rows("enquiries")).find((e) => e["email"] === form.email)!;
        expect(made).toMatchObject({ status: "new", source: "web", fit: null, client_id: null, name: "Rosa Vento", number: "ENQ-001" });
        expect(made["received_at"]).not.toBeNull();
        // The studio's notice, to its reply-to address, behind its switch.
        const mail = await until(
          async () => {
            const messages = (await (await fetch(`${server.sink}/messages`)).json()) as { to: string[]; subject: string; text: string }[];
            return messages.find((m) => m.to.some((to) => to.includes(studio)) && m.subject.includes("Rosa Vento"));
          },
          "the studio's new-enquiry notice",
          150_000,
        );
        expect(mail.subject).toBe("A new enquiry from Rosa Vento");
        expect(mail.text).toContain(form.body);
        // A personal column (their address) is never read into an email: the studio answers from the desk.
        expect(mail.text).not.toContain(form.email);
        const notice = (await rows("messages")).find((m) => m["kind"] === "new-enquiry")!;
        expect(notice).toMatchObject({ enquiry_id: made.id, status: "sent", to: studio });
        // Three a day from one address; a fourth waits.
        for (let i = 0; i < 2; i += 1) expect((await guest.post(`/api/v1/public/records/${door}`, { values: form }, await proof())).status).toBe(201);
        const fourth = await guest.post(`/api/v1/public/records/${door}`, { values: form }, await proof());
        expect([fourth.status, fourth.code]).toEqual([409, "PUBLIC_LIMIT_REACHED"]);
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

      // Last, as it moves the server's clock on a night: nothing after it reads the time.
      it("stores no hours for a clock left running past sixteen: Adminium refuses its own count, and the typed hours stop it", async () => {
        const client = ok(await staff.post<{ data: Row }>(data("clients"), { values: { company: "Overnight Ltd", contact_name: "Ola Night", email: "ola@overnight.example" } }), 201).data;
        const project = ok(await staff.post<{ data: Row }>(data("projects"), { values: { client_id: client.id, name: "Night shift" } }), 201).data;
        const person = ok(await staff.post<{ data: Row }>(data("people"), { values: { name: "Ola Night", position: 9 } }), 201).data;
        const started = await startClock({ project_id: project.id, person_id: person.id, milestone_id: null, note: "Left running overnight" });
        expect(started.ok, JSON.stringify(started)).toBe(true);
        const clock = started.ok ? started.value : null;
        await server.pass(17 * 3_600_000);
        const refused = await stopClock(clock!.id);
        expect(!refused.ok && [refused.code, refused.field]).toEqual(["CLOCK_TOO_LONG", "hours"]);
        // Adminium's own answer, under the desk: the count is refused, naming the hours.
        const raw = await staff.patch(`${data("time_entries")}/${String(clock!.id)}`, { values: { running_for: null, clock_stopped: true } });
        expect([raw.status, raw.code, Object.keys((raw.details["fields"] ?? {}) as object)]).toEqual([422, "VALIDATION_FAILED", ["hours"]]);
        // Nothing of the stop was stored: the clock still runs, with no stop and no hours.
        const still = (await rows("time_entries")).find((e) => e.id === clock!.id)!;
        expect([still["running_for"], still["hours"], still["stopped_at"], still["clock_stopped"]]).toEqual([person.id, null, null, false]);
        // The person says how many it really was: those are the hours, and the stop is Adminium's moment.
        const typed = await stopClock(clock!.id, { hours: "7" });
        expect(typed.ok && [Number(typed.value.hours), Number(typed.value.logged_hours), typed.value.running_for]).toEqual([7, 7, null]);
        const ran = typed.ok ? Date.parse(String(typed.value.stopped_at)) - Date.parse(String(typed.value.started_at)) : 0;
        expect(ran).toBeGreaterThanOrEqual(17 * 3_600_000);
      }, 120_000);
    });
  });
});
