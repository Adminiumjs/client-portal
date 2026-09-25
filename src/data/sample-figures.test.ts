/**
 * THE OVERVIEW'S FIGURES COME OUT OF THE SAMPLE'S ROWS.
 *
 * The Client Portal Overview draws its figures from the rows alone — nothing
 * on it is typed in. So the sample is built to reproduce the design's
 * figures when it is added at the design's moment, Tuesday 28 July 2026
 * (10:00 in the studio's zone): the money owed and how late it is, what came
 * in this month, the proposal still out, the projects, what needs a partner,
 * six months of invoiced and collected, what is waiting on a client, this
 * week, the work in progress — and Chasing's list, rung by rung. The one
 * figure the design could not reach is corrected here: July invoiced $6,510,
 * the sum of the three invoices issued in July.
 *
 * The functions below work each figure out the way the Overview's cards do:
 * "owing" is a sent invoice with a balance, "overdue" one due before the
 * studio's today, a month is a calendar month on the studio's clock, the
 * week runs Monday to Sunday. Added on another day, the sample keeps its
 * shape: every month of the chart still holds an invoice and a payment, and
 * the two late invoices are still about 12 and 47 days late.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveSample, type ResolvedRow, type ResolvedSample, type SampleBundleRows } from "./sampleRows.ts";

const ZONE = "America/New_York";
const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("../../seeds/clients.sample.json", import.meta.url)), "utf8")) as SampleBundleRows;

// ── the Overview's arithmetic ───────────────────────────────────────────────

const DAY = 86_400_000;
const money = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: ResolvedRow[], column: string) => money(rows.reduce((total, row) => total + Number(row[column]), 0));
/** A date (`YYYY-MM-DD`) or an instant, as the day it falls on in the studio's zone. */
const studioDay = (value: unknown) => (String(value).length === 10 ? String(value) : new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date(String(value))));
const daysFrom = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const monthOf = (day: string) => day.slice(0, 7);
/** The calendar month `back` months before the one `day` is in, as `YYYY-MM`. */
const monthsBack = (day: string, back: number) => {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1 - back, 1));
  return first.toISOString().slice(0, 7);
};

function overview(rows: ResolvedSample, now: number) {
  const today = studioDay(new Date(now).toISOString());
  const company = (id: unknown) => String(rows["clients"]!.find((c) => c["id"] === id)!["company"]);
  const invoices = rows["invoices"]!;
  const owing = invoices.filter((i) => i["status"] === "sent" && Number(i["balance"]) > 0);
  const late = (i: ResolvedRow) => daysFrom(String(i["due_on"]), today);
  const overdue = owing.filter((i) => late(i) > 0);
  const band = (from: number, to: number) => owing.filter((i) => late(i) >= from && late(i) <= to);
  const payments = rows["payments"]!.filter((p) => p["voided"] !== true);
  const thisMonth = payments.filter((p) => monthOf(String(p["paid_on"])) === monthOf(today));
  const waiting = rows["proposals"]!.filter((p) => p["status"] === "sent" && String(p["valid_until"]) >= today);
  const projects = rows["projects"]!;
  const rungs = rows["messages"]!.filter((m) => String(m["kind"]).startsWith("invoice-rung-"));
  const held = rungs.filter((m) => m["status"] === "held");
  const ready = held.filter((m) => Date.parse(String(m["due"])) <= now);
  const months = [5, 4, 3, 2, 1, 0].map((back) => monthsBack(today, back));
  const sent = invoices.filter((i) => i["status"] === "sent");
  // Monday to Sunday, on the studio's calendar.
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = shiftDay(today, -weekday);
  const sunday = shiftDay(monday, 6);
  const inWeek = (day: unknown) => String(day) >= monday && String(day) <= sunday;
  const milestones = rows["milestones"]!;
  return {
    today,
    outstanding: { amount: sum(owing, "balance"), invoices: owing.length },
    overdue: { amount: sum(overdue, "balance"), invoices: overdue.length, oldestDays: Math.max(...overdue.map(late)) },
    collectedThisMonth: { amount: sum(thisMonth, "amount"), payments: thisMonth.length, methods: [...new Set(thisMonth.map((p) => p["method"]))] },
    proposalsWaiting: { amount: sum(waiting, "total"), proposals: waiting.length, holdsUntil: waiting.map((p) => String(p["valid_until"])).sort()[0] },
    projects: {
      active: projects.filter((p) => p["status"] === "active").length,
      paused: projects.filter((p) => p["status"] === "paused").length,
      doneThisMonth: projects.filter((p) => p["status"] === "done" && monthOf(String(p["done_on"])) === monthOf(today)).length,
    },
    aging: {
      notYetDue: { amount: sum(band(-Infinity, 0), "balance"), invoices: band(-Infinity, 0).length },
      days1to30: { amount: sum(band(1, 30), "balance"), invoices: band(1, 30).length },
      days31to60: { amount: sum(band(31, 60), "balance"), invoices: band(31, 60).length },
      over60: { amount: sum(band(61, 3650), "balance"), invoices: band(61, 3650).length },
    },
    needs: {
      chaseReady: ready.map((m) => {
        const invoice = invoices.find((i) => i["id"] === m["invoice_id"])!;
        return { invoice: invoice["number"], client: company(invoice["client_id"]), daysLate: late(invoice), rung: m["kind"] };
      }),
      chaseHeld: held.length,
      clientSaysPaid: owing.filter((i) => i["client_paid_at"] !== null).map((i) => ({ invoice: i["number"], client: company(i["client_id"]), balance: i["balance"] })),
      changesAsked: rows["deliverables"]!.filter((d) => d["status"] === "changes").map((d) => ({ title: d["title"], client: company(d["client_id"]) })),
      newEnquiries: rows["enquiries"]!.filter((e) => e["status"] === "new").length,
    },
    chart: months.map((month) => ({
      month,
      invoiced: sum(sent.filter((i) => monthOf(String(i["issued_on"])) === month), "total"),
      invoices: sent.filter((i) => monthOf(String(i["issued_on"])) === month).length,
      collected: sum(payments.filter((p) => monthOf(String(p["paid_on"])) === month), "amount"),
      payments: payments.filter((p) => monthOf(String(p["paid_on"])) === month).length,
    })),
    waitingOnClient: {
      proposals: waiting.map((p) => [p["number"], company(p["client_id"]), p["valid_until"]]),
      files: rows["deliverables"]!
        .filter((d) => d["status"] === "pending")
        .sort((a, b) => String(a["shared_at"]).localeCompare(String(b["shared_at"])))
        .map((d) => [d["title"], company(d["client_id"]), studioDay(d["shared_at"])]),
      overdue: [...overdue].sort((a, b) => String(a["due_on"]).localeCompare(String(b["due_on"]))).map((i) => [i["number"], company(i["client_id"]), i["due_on"], i["balance"]]),
    },
    thisWeek: {
      monday,
      sunday,
      milestones: milestones
        .filter((m) => m["state"] !== "done" && inWeek(m["due_on"]))
        .sort((a, b) => String(a["due_on"]).localeCompare(String(b["due_on"])))
        .map((m) => [m["title"], company(m["client_id"]), m["due_on"]]),
      invoicesDue: owing.filter((i) => inWeek(i["due_on"])).map((i) => i["number"]),
      nextInvoiceDue: owing
        .filter((i) => String(i["due_on"]) > sunday)
        .sort((a, b) => String(a["due_on"]).localeCompare(String(b["due_on"])))
        .map((i) => [i["number"], company(i["client_id"]), i["due_on"]])[0],
    },
    workInProgress: projects
      .filter((p) => p["status"] === "active" || p["status"] === "paused")
      .map((p) => {
        const own = milestones.filter((m) => m["project_id"] === p["id"]);
        const next = own.filter((m) => m["state"] !== "done").sort((a, b) => String(a["due_on"]).localeCompare(String(b["due_on"])))[0];
        return {
          project: p["name"],
          client: company(p["client_id"]),
          status: p["status"],
          done: `${String(own.filter((m) => m["state"] === "done").length)} of ${String(own.length)}`,
          next: p["status"] === "active" ? [next?.["title"], next?.["due_on"]] : null,
          note: p["pause_note"],
        };
      }),
    chasing: [...owing]
      .sort((a, b) => late(b) - late(a))
      .map((i) => {
        const own = rungs.filter((m) => m["invoice_id"] === i["id"]).sort((a, b) => String(a["kind"]).localeCompare(String(b["kind"])));
        const waitingRung = own.find((m) => m["status"] === "held" && Date.parse(String(m["due"])) <= now);
        const nextRung = own.find((m) => m["status"] === "held" && Date.parse(String(m["due"])) > now);
        return {
          invoice: i["number"],
          client: company(i["client_id"]),
          daysLate: late(i),
          balance: i["balance"],
          rungs: own.map((m) => m["status"]),
          ready: waitingRung?.["kind"] ?? null,
          next: nextRung === undefined ? null : [nextRung["kind"], studioDay(nextRung["due"])],
        };
      }),
    nextWake: held
      .filter((m) => Date.parse(String(m["due"])) > now)
      .sort((a, b) => String(a["due"]).localeCompare(String(b["due"])))
      .map((m) => [invoices.find((i) => i["id"] === m["invoice_id"])!["number"], m["kind"], studioDay(m["due"])])[0],
  };
}

// ── at the design's moment ──────────────────────────────────────────────────

describe("the Overview at 10:00 on Tuesday 28 July 2026", () => {
  const now = Date.parse("2026-07-28T14:00:00Z");
  const o = overview(resolveSample(bundle, { now, zone: ZONE, locale: "en-US", currency: "USD" }), now);

  it("is drawn on the design’s day", () => {
    expect(o.today).toBe("2026-07-28");
  });

  it("owes $6,937.50 on four invoices, $3,797.50 of it overdue on two, the oldest 47 days", () => {
    expect(o.outstanding).toEqual({ amount: 6937.5, invoices: 4 });
    expect(o.overdue).toEqual({ amount: 3797.5, invoices: 2, oldestDays: 47 });
  });

  it("collected $1,200.00 in July, one payment by bank transfer", () => {
    expect(o.collectedThisMonth).toEqual({ amount: 1200, payments: 1, methods: ["bank-transfer"] });
  });

  it("has $4,231.50 waiting on one proposal, which holds until 11 August", () => {
    expect(o.proposalsWaiting).toEqual({ amount: 4231.5, proposals: 1, holdsUntil: "2026-08-11" });
  });

  it("has two projects active, one paused and one done this month", () => {
    expect(o.projects).toEqual({ active: 2, paused: 1, doneThisMonth: 1 });
  });

  it("ages the money owed: $3,140 not yet due (2), $2,170 at 1–30 days (1), $1,627.50 at 31–60 (1), nothing older", () => {
    expect(o.aging).toEqual({
      notYetDue: { amount: 3140, invoices: 2 },
      days1to30: { amount: 2170, invoices: 1 },
      days31to60: { amount: 1627.5, invoices: 1 },
      over60: { amount: 0, invoices: 0 },
    });
  });

  it("needs a partner for: one chase reminder, one client who says they paid, one change asked, three new enquiries", () => {
    expect(o.needs.chaseReady).toEqual([{ invoice: "INV-S2038", client: "Fold & Rule", daysLate: 12, rung: "invoice-rung-1" }]);
    // Every rung not yet sent is held for approval; only the one whose day has come is ready.
    expect(o.needs.chaseHeld).toBe(9);
    expect(o.needs.clientSaysPaid).toEqual([{ invoice: "INV-S2039", client: "Hearth & Loaf", balance: 1621 }]);
    expect(o.needs.changesAsked).toEqual([{ title: "Logo, third round", client: "Hearth & Loaf" }]);
    expect(o.needs.newEnquiries).toBe(3);
  });

  it("charts six calendar months, February to July, July invoiced $6,510", () => {
    expect(o.chart).toEqual([
      { month: "2026-02", invoiced: 5967.5, invoices: 4, collected: 6076, payments: 4 },
      { month: "2026-03", invoiced: 3634.75, invoices: 3, collected: 3526.25, payments: 3 },
      { month: "2026-04", invoiced: 5208, invoices: 2, collected: 3472, payments: 2 },
      { month: "2026-05", invoiced: 2495.5, invoices: 2, collected: 3689, payments: 3 },
      { month: "2026-06", invoiced: 2387, invoices: 1, collected: 2387, payments: 2 },
      { month: "2026-07", invoiced: 6510, invoices: 3, collected: 1200, payments: 1 },
    ]);
    // The legend's totals are the sums of the bars.
    expect(money(o.chart.reduce((t, m) => t + m.invoiced, 0))).toBe(26202.75);
    expect(money(o.chart.reduce((t, m) => t + m.collected, 0))).toBe(20350.25);
  });

  it("waits on clients for the shopfront proposal, three files and the two late invoices", () => {
    expect(o.waitingOnClient.proposals).toEqual([["QUO-S1142", "Marigold Lane", "2026-08-11"]]);
    expect(o.waitingOnClient.files).toEqual([
      ["Label marks, second round", "Northlight Records", "2026-07-06"],
      ["Wordmark for dark surfaces", "Hearth & Loaf", "2026-07-25"],
      ["Sleeve dieline", "Fold & Rule", "2026-07-27"],
    ]);
    expect(o.waitingOnClient.overdue).toEqual([
      ["INV-S2037", "Northlight Records", "2026-06-11", 1627.5],
      ["INV-S2038", "Fold & Rule", "2026-07-16", 2170],
    ]);
  });

  it("falls due this week: two milestones, no invoice — the next is INV-S2040 on Monday 3 August", () => {
    expect([o.thisWeek.monday, o.thisWeek.sunday]).toEqual(["2026-07-27", "2026-08-02"]);
    expect(o.thisWeek.milestones).toEqual([
      ["Wordmark refinement", "Hearth & Loaf", "2026-07-29"],
      ["Box & sleeve layouts", "Fold & Rule", "2026-07-31"],
    ]);
    expect(o.thisWeek.invoicesDue).toEqual([]);
    expect(o.thisWeek.nextInvoiceDue).toEqual(["INV-S2040", "Marigold Lane", "2026-08-03"]);
    expect(new Date("2026-08-03T12:00:00Z").getUTCDay()).toBe(1);
  });

  it("has the work in progress: 2 of 5, 2 of 4, and the paused one waiting on its invoice", () => {
    expect(o.workInProgress).toEqual([
      { project: "Bakehouse rebrand", client: "Hearth & Loaf", status: "active", done: "2 of 5", next: ["Wordmark refinement", "2026-07-29"], note: null },
      { project: "Packaging & stationery system", client: "Fold & Rule", status: "active", done: "2 of 4", next: ["Box & sleeve layouts", "2026-07-31"], note: null },
      { project: "Vinyl sleeve system", client: "Northlight Records", status: "paused", done: "2 of 4", next: null, note: "Paused until INV-S2037 clears." },
    ]);
  });

  it("lists Chasing most days late first, rung by rung", () => {
    expect(o.chasing).toEqual([
      // All three rungs sent; the third paused the project. Nothing left to escalate.
      { invoice: "INV-S2037", client: "Northlight Records", daysLate: 47, balance: 1627.5, rungs: ["sent", "sent", "sent"], ready: null, next: null },
      // Rung 1 is ready and waiting on a partner; rung 2 wakes on 30 July.
      { invoice: "INV-S2038", client: "Fold & Rule", daysLate: 12, balance: 2170, rungs: ["held", "held", "held"], ready: "invoice-rung-1", next: ["invoice-rung-2", "2026-07-30"] },
      { invoice: "INV-S2040", client: "Marigold Lane", daysLate: -6, balance: 1519, rungs: ["held", "held", "held"], ready: null, next: ["invoice-rung-1", "2026-08-06"] },
      { invoice: "INV-S2039", client: "Hearth & Loaf", daysLate: -10, balance: 1621, rungs: ["held", "held", "held"], ready: null, next: ["invoice-rung-1", "2026-08-10"] },
    ]);
    expect(o.nextWake).toEqual(["INV-S2038", "invoice-rung-2", "2026-07-30"]);
  });
});

// ── added on other days ─────────────────────────────────────────────────────

describe.each([
  ["on Saturday 3 October 2026", Date.parse("2026-10-03T12:00:00Z")],
  ["on 1 September 2026, before dawn", Date.parse("2026-09-01T08:30:00Z")],
  ["on 1 March 2027", Date.parse("2027-03-01T15:00:00Z")],
  ["on 31 December 2026, late", Date.parse("2027-01-01T04:00:00Z")],
])("the Overview keeps its shape when the sample is added %s", (_, now) => {
  const o = overview(resolveSample(bundle, { now, zone: ZONE, locale: "en-US", currency: "USD" }), now);

  it("holds an invoice and a payment in every month of the chart", () => {
    for (const month of o.chart) {
      expect(month.invoices, month.month).toBeGreaterThanOrEqual(1);
      expect(month.payments, month.month).toBeGreaterThanOrEqual(1);
    }
  });

  it("still has the two late invoices, about 12 and 47 days late, and the rest not yet due", () => {
    expect(o.waitingOnClient.overdue.map(([number]) => number)).toEqual(["INV-S2037", "INV-S2038"]);
    expect(o.chasing.map((c) => [c.invoice, c.daysLate > 0 ? c.daysLate : "not yet due"])).toEqual([
      ["INV-S2037", 47],
      ["INV-S2038", 12],
      ["INV-S2040", "not yet due"],
      ["INV-S2039", "not yet due"],
    ]);
    expect(o.overdue).toEqual({ amount: 3797.5, invoices: 2, oldestDays: 47 });
    expect(o.outstanding).toEqual({ amount: 6937.5, invoices: 4 });
    expect(o.needs.chaseReady.map((r) => [r.invoice, r.rung])).toEqual([["INV-S2038", "invoice-rung-1"]]);
  });

  it("keeps a payment in this month, the proposal in date, and the three new enquiries", () => {
    expect(o.collectedThisMonth).toMatchObject({ amount: 1200, payments: 1 });
    expect(o.proposalsWaiting).toMatchObject({ amount: 4231.5, proposals: 1 });
    expect(o.projects).toEqual({ active: 2, paused: 1, doneThisMonth: 1 });
    expect(o.needs.newEnquiries).toBe(3);
  });
});
