/**
 * The studio's day, from the sample studio on its pinned Tuesday: what is
 * owed and how late, what is waiting on a client (only what the client can
 * act on — never an out-of-date proposal or an unshared deliverable), what
 * happened lately (built from stamps, newest first, a discarded draft left
 * out), and what falls due this week. Sums leave void invoices out.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { DISCARDED_DRAFT } from "../../state/actions.ts";
import { ensureRows, upsert, useDesk } from "../../state/desk.ts";
import { fakeStudio } from "../../testing/fakeStudio.ts";
import { sumDecimals } from "../../lib/money.ts";
import { aging, agingKeyOf, feed, kpis, openInvoices, waiting, week } from "./model.ts";

const today = "2026-07-28";
const zone = "America/New_York";
const rows = () => useDesk.getState().rows;

beforeEach(async () => {
  await fakeStudio();
});

describe("the three figures and aging", () => {
  it("adds up what is owed on sent invoices only, counts the late ones and the oldest", () => {
    const open = openInvoices(rows());
    expect(open.every((i) => i.status === "sent" && Number(i.balance) > 0)).toBe(true);
    const k = kpis(rows(), today, 1);
    expect(k.outstanding).toBe(sumDecimals(open.map((i) => i.balance)));
    expect(k.openCount).toBe(open.length);
    expect([k.overdueCount, k.oldestDays, k.active, k.paused, k.done]).toEqual([2, 47, 2, 1, 1]);
    // A void invoice with a balance owes nothing and is not counted.
    upsert("invoices", { ...rows().invoices[4]!, status: "void" });
    expect(kpis(rows(), today, 1).overdueCount).toBe(1);
    expect(openInvoices(rows()).map((i) => i.id)).not.toContain(4);
  });

  it("buckets the open balances by days past due, measured against today", () => {
    expect([0, -3, 1, 30, 31, 60, 61].map(agingKeyOf)).toEqual(["current", "current", "d30", "d30", "d60", "d60", "d61"]);
    const b = aging(rows(), today);
    expect(b.map((x) => [x.key, x.count])).toEqual([
      ["current", 2],
      ["d30", 1],
      ["d60", 1],
      ["d61", 0],
    ]);
    expect(b[3]!.amount).toBe("0.00");
    expect(sumDecimals(b.map((x) => x.amount))).toBe(kpis(rows(), today, null).outstanding);
  });
});

describe("waiting on a client", () => {
  it("lists what the client can act on, the longest waiting first", () => {
    expect(waiting(rows(), today, zone).map((w) => [w.kind, w.ref, w.days])).toEqual([
      ["invoice", "INV-2039", 47],
      ["invoice", "INV-2038", 12],
      ["proposal", "PRO-1142", 6],
      ["deliverable", "Notebook box, large", 4],
    ]);
  });

  it("leaves out a proposal past its day and a deliverable not shared", () => {
    upsert("proposals", { ...rows().proposals[3]!, valid_until: "2026-07-27" });
    upsert("deliverables", { ...rows().deliverables[1]!, status: "unshared" });
    expect(waiting(rows(), today, zone).map((w) => w.kind)).toEqual(["invoice", "invoice"]);
  });
});

describe("recent activity, from the stamps", () => {
  it("is newest first and opens what it is about", () => {
    const items = feed(rows(), zone, 50);
    const times = items.map((i) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(items[0]).toMatchObject({ kind: "enquiryIn", params: { business: "Bright Offers Ltd", number: "ENQ-004" }, go: { view: "enquiries" } });
    expect(items.find((i) => i.kind === "clientSaysPaid")).toMatchObject({ params: { number: "INV-2037", first: "Cleo" }, amount: { value: "500.00" } });
    expect(items.find((i) => i.kind === "proposalSigned")).toMatchObject({ params: { name: "Cleo Marchetti", number: "PRO-1141" }, go: { view: "proposal", id: 2 } });
    expect(items.find((i) => i.kind === "changesRequested")).toMatchObject({ params: { company: "Hearth & Co Bakery", title: "Window sketch A" } });
    expect(feed(rows(), zone)).toHaveLength(6);
  });

  it("names a voided invoice, but never a discarded draft the client never saw", async () => {
    // Home reads the invoices sent or voided lately, beyond the open work.
    await ensureRows("invoices", [1]);
    expect(feed(rows(), zone, 50).filter((i) => i.kind === "invoiceVoided").map((i) => i.params["number"])).toEqual(["INV-2035"]);
    upsert("invoices", { ...rows().invoices[7]!, status: "void", void_reason: DISCARDED_DRAFT, voided_at: "2026-07-28T09:00:00.000Z" });
    expect(feed(rows(), zone, 50).filter((i) => i.kind === "invoiceVoided").map((i) => i.params["number"])).toEqual(["INV-2035"]);
  });
});

describe("this week", () => {
  it("lists open milestones and open invoices due from today to six days on, soonest first", () => {
    expect(week(rows(), today).map((w) => [w.kind, w.title, w.due])).toEqual([
      ["milestone", "Window sketches", "2026-07-30"],
      ["milestone", "Artwork", "2026-07-31"],
      ["invoice", "INV-2040", "2026-08-03"],
    ]);
    upsert("milestones", { ...rows().milestones[4]!, state: "done" });
    expect(week(rows(), today).map((w) => w.title)).not.toContain("Window sketches");
    expect(week(rows(), "2026-09-01")).toEqual([]);
  });
});
