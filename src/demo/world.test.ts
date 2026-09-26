/**
 * THE DEMO'S WORLD DECIDES WHAT ADMINIUM DECIDES.
 *
 * The same scenario the three-engine contract runs against Adminium — the
 * sample added at 10:00 on Tuesday 28 July 2026, every invoice's totals and
 * balance, a payment race, a void, a proposal accepted by a signed-in client
 * with its fingerprint, the sample put back — run on the demo's stand-in
 * world, and held to the figures the sample's own test asserts at that
 * moment (`data/sample-figures.test.ts`), then carried a week on by the
 * card's clock.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { PortError } from "../data/ports.ts";
import { resolveSample } from "../data/sampleRows.ts";
import { SinkError } from "../data/sink.ts";
import type { Id, TableRef } from "../data/types.ts";
import { DEMO_START, DEMO_ZONE } from "../lib/clock.ts";
import { canonical, fingerprintDocument, type HashOf } from "./fingerprint.ts";
import { overview } from "./figures.ts";
import { DEMO_RULES } from "./rules.ts";
import { DEMO_BUNDLE, demoSample } from "./sample.ts";
import { createWorld, type DemoWorld } from "./world.ts";

const NADIA = { name: "Nadia Cole" };
const fresh = (locale = "en-US"): DemoWorld => createWorld(demoSample(locale), () => DEMO_START, DEMO_ZONE, NADIA);
const figures = (world: DemoWorld) => overview(world.rows, world.now(), DEMO_ZONE);
const byNumber = (world: DemoWorld, ref: TableRef, number: string) => world.rows[ref].find((r) => r["number"] === number)!;
const refusal = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    if (error instanceof SinkError) return { code: error.code, status: error.status, details: error.details };
    if (error instanceof PortError) return { code: error.code, status: error.status, details: error.params };
    throw error;
  }
  throw new Error("expected a refusal");
};
const rungs = (world: DemoWorld, invoice: Id) =>
  world.rows.messages
    .filter((m) => String(m["invoice_id"]) === String(invoice) && String(m["kind"]).startsWith("invoice-rung-"))
    .sort((a, b) => String(a["kind"]).localeCompare(String(b["kind"])))
    .map((m) => [m["kind"], m["status"], m["skip_reason"]]);

describe("the sample added at 10:00 on Tuesday 28 July 2026", () => {
  const world = fresh();
  const o = figures(world);

  it("draws the Overview the sample's own test asserts, figure for figure", () => {
    const sample = resolveSample(DEMO_BUNDLE, { now: DEMO_START, zone: DEMO_ZONE, locale: "en-US", currency: "USD" });
    expect(o).toEqual(overview(sample, DEMO_START, DEMO_ZONE));
    expect(o.today).toBe("2026-07-28");
    expect(o.outstanding).toEqual({ amount: 6937.5, invoices: 4 });
    expect(o.overdue).toEqual({ amount: 3797.5, invoices: 2, oldestDays: 47 });
    expect(o.collectedThisMonth).toEqual({ amount: 1200, payments: 1, methods: ["bank-transfer"] });
    expect(o.proposalsWaiting).toEqual({ amount: 4231.5, proposals: 1, holdsUntil: "2026-08-11" });
    expect(o.projects).toEqual({ active: 2, paused: 1, doneThisMonth: 1 });
    expect(o.aging).toEqual({
      notYetDue: { amount: 3140, invoices: 2 },
      days1to30: { amount: 2170, invoices: 1 },
      days31to60: { amount: 1627.5, invoices: 1 },
      over60: { amount: 0, invoices: 0 },
    });
    expect(o.needs.chaseReady).toEqual([{ invoice: "INV-S2038", client: "Fold & Rule", daysLate: 12, rung: "invoice-rung-1" }]);
    expect(o.needs.chaseHeld).toBe(9);
    expect(o.needs.clientSaysPaid).toEqual([{ invoice: "INV-S2039", client: "Hearth & Loaf", balance: 1621 }]);
    expect(o.chart.map((m) => m.invoiced)).toEqual([5967.5, 3634.75, 5208, 2495.5, 2387, 6510]);
    expect(o.chart.map((m) => m.collected)).toEqual([6076, 3526.25, 3472, 3689, 2387, 1200]);
    expect(o.nextWake).toEqual(["INV-S2038", "invoice-rung-2", "2026-07-30"]);
  });

  it("keeps every invoice's totals and balance as the rows work them out, as decimal text at the currency's places", () => {
    const sample = resolveSample(DEMO_BUNDLE, { now: DEMO_START, zone: DEMO_ZONE, locale: "en-US", currency: "USD" });
    for (const invoice of world.rows.invoices) {
      const same = sample["invoices"]!.find((i) => i["id"] === invoice.id)!;
      for (const column of ["subtotal", "tax", "total", "paid", "balance"]) {
        expect(invoice[column], `${String(invoice["number"])} ${column}`).toMatch(/^-?\d+\.\d{2}$/);
        expect(Number(invoice[column]), `${String(invoice["number"])} ${column}`).toBe(same[column]);
      }
    }
    expect(byNumber(world, "invoices", "INV-S2039")).toMatchObject({ total: "2821.00", paid: "1200.00", balance: "1621.00" });
  });

  it("works a stage line from the proposal's subtotal, and taxes it once, on the invoice", () => {
    const stage = byNumber(world, "invoices", "INV-S2038");
    const proposal = world.rows.proposals.find((p) => p.id === stage["from_quote_id"])!;
    const line = world.rows.invoice_lines.find((l) => l["document_id"] === stage.id)!;
    expect(line["rate"]).toBe(proposal["subtotal"]);
    expect(Number(line["amount"])).toBeCloseTo((Number(proposal["subtotal"]) * Number(stage["share_pct"])) / 100, 2);
    expect(Number(stage["total"])).toBeCloseTo(Number(line["amount"]) * 1.085, 2);
  });
});

describe("a payment race, a void, and what a sent invoice keeps", () => {
  it("lets the first of two payments through and refuses the second with the balance left, rolling it back", async () => {
    const world = fresh();
    const invoice = byNumber(world, "invoices", "INV-S2039");
    const first = await world.writes.insert("payments", { document_id: invoice.id, amount: "1000", method: "bank-transfer", paid_on: "2026-07-28" });
    expect(first).toMatchObject({ number: "REC-0019", number_seq: 19, amount: "1000.00", recorded_by: "Nadia Cole", client_id: invoice["client_id"] });
    expect(await refusal(() => world.writes.insert("payments", { document_id: invoice.id, amount: "1000", method: "card", paid_on: "2026-07-28" }))).toEqual({
      code: "BALANCE_EXCEEDED",
      status: 409,
      details: { column: "balance", balance: 621 },
    });
    expect(world.rows.payments.filter((p) => p["document_id"] === invoice.id)).toHaveLength(2);
    // The recorded payment cleared what the client said they sent, and its receipt went out.
    expect(byNumber(world, "invoices", "INV-S2039")).toMatchObject({ paid: "2200.00", balance: "621.00", client_paid: null, client_paid_at: null });
    expect(world.rows.messages.find((m) => m["kind"] === "payment-receipt" && m["payment_id"] === first.id)).toMatchObject({ status: "sent", to: "amara@hearthandloaf.example" });
    // The next receipt takes the next number: none was burnt by the refusal.
    expect(await world.writes.insert("payments", { document_id: invoice.id, amount: "621", method: "card", paid_on: "2026-07-28" })).toMatchObject({ number: "REC-0020" });
    // Paid: its waiting reminders are no longer needed.
    expect(rungs(world, invoice.id)).toEqual([
      ["invoice-rung-1", "skipped", "paid"],
      ["invoice-rung-2", "skipped", "paid"],
      ["invoice-rung-3", "skipped", "paid"],
    ]);
  });

  it("voids an unpaid invoice (stamped, its reminders skipped) and refuses one with money on it", async () => {
    const world = fresh();
    const unpaid = byNumber(world, "invoices", "INV-S2040");
    expect(await world.writes.update("invoices", unpaid.id, { status: "void", void_reason: "Raised twice" })).toMatchObject({ status: "void", voided_by: "Nadia Cole", voided_at: new Date(DEMO_START).toISOString() });
    expect(rungs(world, unpaid.id).map(([, status, reason]) => [status, reason])).toEqual([
      ["skipped", "void"],
      ["skipped", "void"],
      ["skipped", "void"],
    ]);
    const paid = byNumber(world, "invoices", "INV-S2039");
    expect(await refusal(() => world.writes.update("invoices", paid.id, { status: "void" }))).toEqual({
      code: "STATE_MOVE_REFUSED",
      status: 409,
      details: { column: "status", from: "sent", to: "void", requires: "paid" },
    });
  });

  it("locks a sent invoice and its lines, takes no payment on a draft, and deletes no numbered invoice", async () => {
    const world = fresh();
    const sent = byNumber(world, "invoices", "INV-S2038");
    expect(await refusal(() => world.writes.update("invoices", sent.id, { title: "Another title" }))).toMatchObject({ code: "RECORD_LOCKED", details: { column: "title", state: "sent" } });
    expect(await refusal(() => world.writes.insert("invoice_lines", { document_id: sent.id, description: "Extra", qty: "1", rate: "10" }))).toMatchObject({
      code: "RECORD_LOCKED",
      details: { table: "invoice_lines", parent: "invoices", state: "sent" },
    });
    // What a sent invoice still takes: its due day and its ladder — and a form sending its state back as it was stamps nothing again.
    const was = { ...sent };
    expect(await world.writes.update("invoices", sent.id, { status: "sent", ladder: "gentle" })).toMatchObject({ ladder: "gentle", issued_on: was["issued_on"], due_on: was["due_on"], sent_at: was["sent_at"] });
    const draft = await world.writes.insert("invoices", { client_id: 4, title: "Extra formats" });
    expect(draft).toMatchObject({ number: "INV-2042", status: "draft", currency: "USD", tax_rate: "8.500", terms: "net14", ladder: "standard" });
    expect(await refusal(() => world.writes.insert("payments", { document_id: draft.id, amount: "10", method: "card", paid_on: "2026-07-28" }))).toMatchObject({
      code: "RECORD_LOCKED",
      details: { parent: "invoices", state: "draft", parentIn: ["sent"] },
    });
    expect(await refusal(() => world.writes.remove("invoices", draft.id))).toMatchObject({ code: "DELETE_REFUSED", details: { numbered: true } });
    // Sent with nothing on it: the move names what it requires.
    expect(await refusal(() => world.writes.update("invoices", draft.id, { status: "sent" }))).toMatchObject({
      code: "STATE_MOVE_REFUSED",
      details: { from: "draft", to: "sent", requires: "invoice_lines", min: 1 },
    });
    await world.writes.insert("invoice_lines", { document_id: draft.id, description: "Formats", qty: "2", rate: "90" });
    expect(await world.writes.update("invoices", draft.id, { status: "sent" })).toMatchObject({ status: "sent", issued_on: "2026-07-28", due_on: "2026-08-11", subtotal: "180.00", tax: "15.30", total: "195.30" });
    // Sent: three reminders, held for a person, dated by the ladder at 09:00 on the studio's clock.
    expect(world.rows.messages.filter((m) => m["invoice_id"] === draft.id).map((m) => [m["kind"], m["status"], m["due"]])).toEqual([
      ["invoice-sent", "sent", null],
      ["invoice-rung-1", "held", "2026-08-14T13:00:00.000Z"],
      ["invoice-rung-2", "held", "2026-08-25T13:00:00.000Z"],
      ["invoice-rung-3", "held", "2026-09-10T13:00:00.000Z"],
    ]);
    // A new row starts where its states start.
    expect(await refusal(() => world.writes.insert("invoices", { client_id: 4, title: "Backdated", status: "sent" }))).toMatchObject({ code: "STATE_MOVE_REFUSED", details: { from: null, to: "sent" } });
  });
});

describe("a proposal accepted by a signed-in client, with its fingerprint", () => {
  const spec = (DEMO_RULES.stamps["proposals"]!.find((s) => s.column === "fingerprint")!.set as { hashOf: HashOf }).hashOf;

  it("is stamped from the client's own session and sealed with the SHA-256 of what was agreed", async () => {
    const world = fresh();
    const proposal = byNumber(world, "proposals", "QUO-S1142");
    const cleo = world.portal(proposal["client_id"] as Id);
    const accepted = await cleo.accept(proposal.id, " Cleo Nkemdi ");
    expect(accepted).toMatchObject({ status: "accepted", signed_name: "Cleo Nkemdi", signed_email: "cleo@marigoldlane.example", accepted_how: "portal", signed_at: new Date(DEMO_START).toISOString(), decided_at: new Date(DEMO_START).toISOString() });
    const ctx = {
      rows: (table: string) => world.rows[table as TableRef],
      kind: (table: string, column: string) => DEMO_RULES.kinds[table]?.[column],
      places: (table: string, column: string) => (DEMO_RULES.decimals[table]?.[column] === "currency" ? 2 : (DEMO_RULES.decimals[table]?.[column] as number | undefined)),
    };
    const document = fingerprintDocument("proposals", world.rows.proposals.find((p) => p.id === proposal.id)!, spec, ctx) as {
      columns: Record<string, unknown>;
      children: Record<string, unknown>[][];
      linked: ({ columns: Record<string, unknown>; children: Record<string, unknown>[][] } | null)[];
    };
    // The canonical form: decimals as text at their places, whole numbers as digits, rows by position.
    expect(document.columns).toMatchObject({ number: "QUO-S1142", total: "4231.50", tax_rate: "8.500", signed_name: "Cleo Nkemdi", valid_until: "2026-08-11" });
    expect(document.children[0]!.map((line) => line["position"])).toEqual([...document.children[0]!.map((line) => line["position"])].sort((a, b) => Number(a) - Number(b)));
    // The sample's terms carry no version number (a studio's own first terms are version 1): the seal reads it as it is.
    expect(document.linked[0]!.columns).toEqual({ version: null });
    expect(document.linked[0]!.children[0]!.length).toBeGreaterThan(0);
    expect(accepted.fingerprint).toBe(createHash("sha256").update(canonical(document), "utf8").digest("hex"));
    expect(accepted.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Accepted: what was agreed is locked, and the studio is told.
    const line = world.rows.proposal_lines.find((l) => l["document_id"] === proposal.id)!;
    expect(await refusal(() => world.writes.update("proposal_lines", line.id, { qty: "9" }))).toMatchObject({ code: "RECORD_LOCKED" });
    expect(world.rows.messages.find((m) => m["kind"] === "accepted-and-signed" && m["proposal_id"] === proposal.id)).toMatchObject({ status: "sent", to: "hello@outline.example" });
  });

  it("changes when what was agreed changes, and never for the same rows", async () => {
    const one = fresh();
    const two = fresh();
    const three = fresh();
    const id = byNumber(one, "proposals", "QUO-S1142").id;
    const client = byNumber(one, "proposals", "QUO-S1142")["client_id"] as Id;
    // The studio moves the offer's day on before the client signs: a column the seal reads.
    await three.writes.update("proposals", id, { valid_until: "2026-08-12" });
    const [a, b, c] = await Promise.all([one, two, three].map((w) => w.portal(client).accept(id, "Cleo Nkemdi")));
    expect(a!.fingerprint).toBe(b!.fingerprint);
    expect(c!.fingerprint).not.toBe(a!.fingerprint);
  });

  it("refuses a proposal that is out of date, and one already decided", async () => {
    const world = fresh();
    const proposal = byNumber(world, "proposals", "QUO-S1142");
    const cleo = world.portal(proposal["client_id"] as Id);
    await cleo.decline(proposal.id, null);
    expect(await refusal(() => cleo.accept(proposal.id, "Cleo Nkemdi"))).toMatchObject({ code: "PUBLIC_WRITE_REFUSED" });
    const later = fresh();
    later.advance(21);
    expect(await refusal(() => later.portal(proposal["client_id"] as Id).accept(proposal.id, "Cleo Nkemdi"))).toMatchObject({ code: "PUBLIC_WRITE_REFUSED" });
    // Another client's proposal is not there at all.
    expect(await refusal(() => world.portal(1).accept(proposal.id, "Amara Okafor"))).toMatchObject({ code: "PUBLIC_REF_NOT_FOUND" });
  });
});

describe("the card's clock: a week on", () => {
  it("wakes the second reminder, which overtakes the first, and makes a third invoice late", () => {
    const world = fresh();
    world.advance(7);
    const o = figures(world);
    expect(o.today).toBe("2026-08-04");
    const late = byNumber(world, "invoices", "INV-S2038");
    expect(rungs(world, late.id)).toEqual([
      ["invoice-rung-1", "skipped", "overtaken"],
      ["invoice-rung-2", "held", null],
      ["invoice-rung-3", "held", null],
    ]);
    expect(o.needs.chaseReady).toEqual([{ invoice: "INV-S2038", client: "Fold & Rule", daysLate: 19, rung: "invoice-rung-2" }]);
    expect(o.needs.chaseHeld).toBe(8);
    expect(o.overdue).toEqual({ amount: 5316.5, invoices: 3, oldestDays: 54 });
    expect(o.outstanding).toEqual({ amount: 6937.5, invoices: 4 });
    // The proposal still holds until 11 August: a week alone never makes it out of date.
    expect(o.proposalsWaiting).toMatchObject({ proposals: 1, holdsUntil: "2026-08-11" });
    expect(o.nextWake).toEqual(["INV-S2040", "invoice-rung-1", "2026-08-06"]);
  });

  it("sends an approved reminder at once; the third pauses the project once it is sent", async () => {
    const world = fresh();
    world.advance(7);
    const late = byNumber(world, "invoices", "INV-S2038");
    const second = world.rows.messages.find((m) => m["invoice_id"] === late.id && m["kind"] === "invoice-rung-2")!;
    expect(await world.writes.update("messages", second.id, { status: "queued" })).toMatchObject({ approved_by: "Nadia Cole" });
    expect(world.rows.messages.find((m) => m.id === second.id)).toMatchObject({ status: "sent", sent_at: new Date(world.now()).toISOString() });
    // A person may not say why, nor mark one sent.
    const third = world.rows.messages.find((m) => m["invoice_id"] === late.id && m["kind"] === "invoice-rung-3")!;
    expect(await refusal(() => world.writes.update("messages", third.id, { status: "skipped", skip_reason: "by-hand" }))).toMatchObject({ code: "STATE_MOVE_REFUSED", details: { column: "skip_reason" } });
    expect(await refusal(() => world.writes.update("messages", third.id, { status: "sent" }))).toMatchObject({ code: "STATE_MOVE_REFUSED", details: { column: "status", from: "held", to: "sent" } });
    world.advance(14);
    const project = world.rows.projects.find((p) => p.id === late["project_id"])!;
    expect(project["status"]).toBe("active");
    await world.writes.update("messages", third.id, { status: "queued" });
    expect(world.rows.messages.find((m) => m.id === third.id)).toMatchObject({ status: "sent", effect_error: null });
    expect(world.rows.projects.find((p) => p.id === late["project_id"])).toMatchObject({ status: "paused" });
  });

  it("puts everything back: the day, the sample, the series", async () => {
    const world = fresh();
    await world.writes.insert("invoices", { client_id: 4, title: "Extra formats" });
    world.advance(21);
    world.reset();
    expect(figures(world)).toEqual(figures(fresh()));
    expect(await world.writes.insert("invoices", { client_id: 4, title: "Extra formats" })).toMatchObject({ number: "INV-2042" });
  });
});

describe("the sample in the visitor's language", () => {
  it("reads the sample's words again in another language, leaving what the studio wrote since", async () => {
    const world = fresh();
    const invoice = byNumber(world, "invoices", "INV-S2041");
    await world.writes.update("invoices", invoice.id, { title: "Episode artwork, as agreed" });
    world.relabel("de-DE");
    expect(byNumber(world, "invoices", "INV-S2040")["title"]).toBe(byNumber(fresh("de-DE"), "invoices", "INV-S2040")["title"]);
    expect(byNumber(world, "invoices", "INV-S2040")["title"]).not.toBe(byNumber(fresh(), "invoices", "INV-S2040")["title"]);
    expect(byNumber(world, "invoices", "INV-S2041")["title"]).toBe("Episode artwork, as agreed");
    expect(figures(world).outstanding).toEqual({ amount: 6937.5, invoices: 4 });
  });
});

describe("a date, as Adminium hands one out on every engine", () => {
  it("keeps the day a write names and hands it back as `YYYY-MM-DD`, whatever time was written with it", async () => {
    const world = fresh();
    const draft = world.rows.invoices.find((i) => i["status"] === "draft")!;
    await world.writes.update("invoices", draft.id, { due_on: "2026-09-14T00:00:00.000Z" });
    expect(world.rows.invoices.find((i) => i.id === draft.id)!["due_on"]).toBe("2026-09-14");
    await world.writes.update("invoices", draft.id, { due_on: new Date(Date.UTC(2026, 8, 21)) });
    expect(world.rows.invoices.find((i) => i.id === draft.id)!["due_on"]).toBe("2026-09-21");
    // Every date the sample brought in is a day already.
    for (const ref of ["invoices", "payments", "milestones", "projects", "time_entries", "expenses", "events", "proposals"] as TableRef[]) {
      for (const row of world.rows[ref]) {
        for (const [column, value] of Object.entries(row)) {
          if (/_on$|^date$|^to_date$|_until$/.test(column) && value !== null) expect([ref, column, value]).toEqual([ref, column, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]);
        }
      }
    }
  });
});
