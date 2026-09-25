/**
 * THE MONEY SCREEN'S FIGURES OUT OF THE SAMPLE'S ROWS, at 10:00 on Tuesday
 * 28 July 2026 in New York — worked out by the screen's own functions over
 * the rows Adminium would store, so the browser pass and this agree on what
 * the page must say.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normaliseAll } from "../../data/rows.ts";
import { resolveSample, type SampleBundleRows } from "../../data/sampleRows.ts";
import type { Id, Invoice } from "../../data/types.ts";
import { aging, chart, drill, figures, type MoneyInputs } from "./model.ts";

const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("../../../seeds/clients.sample.json", import.meta.url)), "utf8")) as SampleBundleRows;

function sampleInputs(now = Date.parse("2026-07-28T14:00:00Z"), today = "2026-07-28"): MoneyInputs {
  const rows = resolveSample(bundle, { now, zone: "America/New_York", locale: "en-US", currency: "USD" });
  const invoices = normaliseAll("invoices", rows["invoices"]!);
  return {
    today,
    currency: "USD",
    invoices: Object.fromEntries(invoices.map((i) => [i.id, i])) as Record<Id, Invoice>,
    payments: normaliseAll("payments", rows["payments"]!),
    proposals: normaliseAll("proposals", rows["proposals"]!),
    costs: normaliseAll("running_costs", rows["running_costs"]!),
  };
}

describe("Money at 10:00 on Tuesday 28 July 2026", () => {
  const input = sampleInputs();
  const f = figures(input);

  it("collected $20,350.25 in six months, an average of $3,391.71 a month, against $2,850.00 of costs", () => {
    expect([f.sixMonths, f.average, f.costs]).toEqual(["20350.25", "3391.71", "2850.00"]);
  });

  it("collected $1,200.00 in July, when $6,510.00 was invoiced — a thin month, with invoices of it still open", () => {
    expect([f.collectedThisMonth, f.invoicedThisMonth, f.thin]).toEqual(["1200.00", "6510.00", true]);
    expect(f.openThisMonth).toBe(3);
  });

  it("has $6,937.50 open on four invoices, $3,797.50 of it overdue", () => {
    expect([f.open, f.openCount, f.overdue]).toEqual(["6937.50", 4, "3797.50"]);
  });

  it("has $4,231.50 out for signature on one proposal, which holds to 11 August", () => {
    expect([f.outForSignature, f.proposalsOut, f.holdsUntil]).toEqual(["4231.50", 1, "2026-08-11"]);
  });

  it("covers 2.4 months of costs if every open invoice cleared tomorrow", () => {
    expect(f.monthsCovered).toBe(2.4);
  });

  it("charts February to July, invoiced against collected", () => {
    expect(chart(input).map((b) => [b.month, b.invoiced, b.collected])).toEqual([
      ["2026-02", "5967.50", "6076.00"],
      ["2026-03", "3634.75", "3526.25"],
      ["2026-04", "5208.00", "3472.00"],
      ["2026-05", "2495.50", "3689.00"],
      ["2026-06", "2387.00", "2387.00"],
      ["2026-07", "6510.00", "1200.00"],
    ]);
  });

  it("itemises July: the three invoices issued and the one payment, in the order they happened", () => {
    const rows = drill("2026-07", input).map((r) => (r.kind === "invoice" ? ["invoice", r.invoice.number, r.amount] : ["payment", r.invoice?.number, r.amount]));
    expect(rows.filter((r) => r[0] === "invoice")).toHaveLength(3);
    expect(rows.filter((r) => r[0] === "payment")).toEqual([["payment", "INV-S2039", "1200"]]);
  });

  it("ages what is owed: $3,140 not yet due (2), $2,170 at 1–30 days (1), $1,627.50 at 31–60 (1), nothing older", () => {
    expect(aging(input).map((b) => [b.key, b.amount, b.count])).toEqual([
      ["current", "3140.00", 2],
      ["d30", "2170.00", 1],
      ["d60", "1627.50", 1],
      ["d61", "0.00", 0],
    ]);
  });
});

describe("added on another day, the screen keeps the sample's shape", () => {
  it("still owes the same, and still covers about 2.4 months", () => {
    const f = figures(sampleInputs(Date.parse("2026-10-03T12:00:00Z"), "2026-10-03"));
    expect([f.open, f.overdue, f.monthsCovered]).toEqual(["6937.50", "3797.50", 2.4]);
  });
});
