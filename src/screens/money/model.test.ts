/**
 * What the Money screen works out, on small hand-made rows: which invoices
 * and payments a month adds, what the figures leave out (voids, drafts, a
 * payment on a void invoice, another currency), and the edges (no costs, an
 * empty month).
 */
import { describe, expect, it } from "vitest";

import type { Id, Invoice, Payment, Proposal, RunningCost } from "../../data/types.ts";
import { aging, agingKeyOf, barHeights, chart, drill, figures, sixMonths, type MoneyInputs } from "./model.ts";

let seq = 0;
function invoice(over: Partial<Invoice>): Invoice {
  seq += 1;
  return {
    id: seq, number_seq: seq, number: `INV-${String(seq)}`, status: "sent", issued_on: "2026-07-02", terms: "net14", due_on: "2026-07-16", currency: "USD", tax_name: null, tax_rate: null,
    subtotal: "100.00", tax: "0.00", total: "100.00", paid: "0.00", balance: "100.00", ladder: null, sent_at: null, void_reason: null, voided_at: null, voided_by: null, from_quote_id: null,
    share_pct: null, client_id: 1, project_id: null, proposal_id: null, stage: null, title: "Work", client_paid_note: null, client_paid_amount: null, client_paid_on: null, client_paid: null,
    client_paid_at: null, client_key: null, ...over,
  };
}
function payment(document_id: Id, over: Partial<Payment>): Payment {
  seq += 1;
  return { id: seq, document_id, number_seq: seq, number: `REC-${String(seq)}`, amount: "50.00", currency: "USD", method: "bank-transfer", method_note: null, paid_on: "2026-07-10", recorded_by: null, recorded_at: null, voided: false, void_reason: null, voided_by: null, voided_at: null, client_id: 1, client_key: null, ...over };
}
const cost = (monthly_amount: string): RunningCost => ({ id: ++seq, label: "Rent", monthly_amount, position: 0, client_key: null });

function inputs(invoices: Invoice[], payments: Payment[] = [], costs: RunningCost[] = [], proposals: Proposal[] = []): MoneyInputs {
  return { today: "2026-07-28", currency: "USD", invoices: Object.fromEntries(invoices.map((i) => [i.id, i])), payments, proposals, costs };
}

describe("the six months", () => {
  it("end with the studio's own month and cross a year", () => {
    expect(sixMonths("2026-07-28")).toEqual(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
    expect(sixMonths("2027-02-01")).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("count sent invoices by the month they were issued, and nothing void, draft or in another currency", () => {
    const rows = [
      invoice({ total: "1000.00" }),
      invoice({ status: "void", total: "500.00" }),
      invoice({ status: "draft", issued_on: null, total: "400.00" }),
      invoice({ currency: "EUR", total: "300.00" }),
      invoice({ issued_on: "2026-06-30", total: "200.00" }),
    ];
    const bars = chart(inputs(rows));
    expect(bars.map((b) => [b.month, b.invoiced])).toEqual([
      ["2026-02", "0.00"],
      ["2026-03", "0.00"],
      ["2026-04", "0.00"],
      ["2026-05", "0.00"],
      ["2026-06", "200.00"],
      ["2026-07", "1000.00"],
    ]);
  });

  it("count payments received, leaving out a voided one and one on a void invoice", () => {
    const kept = invoice({});
    const voided = invoice({ status: "void" });
    const input = inputs([kept, voided], [payment(kept.id, { amount: "40.00" }), payment(kept.id, { amount: "15.00", voided: true }), payment(voided.id, { amount: "99.00" })]);
    expect(chart(input)[5]!.collected).toBe("40.00");
    expect(drill("2026-07", input).filter((r) => r.kind === "payment").map((r) => r.amount)).toEqual(["40.00"]);
  });

  it("itemise a month in the order things happened, and nothing for an empty one", () => {
    const a = invoice({ issued_on: "2026-07-20" });
    const b = invoice({ issued_on: "2026-07-02" });
    const input = inputs([a, b], [payment(b.id, { paid_on: "2026-07-20" })]);
    expect(drill("2026-07", input).map((r) => [r.kind, r.day])).toEqual([
      ["invoice", "2026-07-02"],
      ["invoice", "2026-07-20"],
      ["payment", "2026-07-20"],
    ]);
    expect(drill("2026-03", input)).toEqual([]);
  });

  it("draw each bar against the tallest, never below a sliver", () => {
    expect(barHeights([{ month: "a", invoiced: "100.00", collected: "25.00", invoices: 1, payments: 1 }, { month: "b", invoiced: "0.00", collected: "0.00", invoices: 0, payments: 0 }])).toEqual([
      { invoiced: 100, collected: 25 },
      { invoiced: 2, collected: 2 },
    ]);
  });
});

describe("the figures", () => {
  it("say how many months of costs the open balances cover, and nothing when there are no costs", () => {
    const open = invoice({ balance: "3000.00", total: "3000.00" });
    expect(figures(inputs([open], [], [cost("1000.00"), cost("500.00")])).monthsCovered).toBe(2);
    expect(figures(inputs([open])).monthsCovered).toBeNull();
  });

  it("count as open only what a sent invoice still owes", () => {
    const f = figures(inputs([invoice({ balance: "0.00" }), invoice({ status: "void", balance: "100.00" }), invoice({ due_on: "2026-08-10", balance: "70.00" })]));
    expect([f.open, f.openCount, f.overdue]).toEqual(["70.00", 1, "0.00"]);
  });
});

describe("aging", () => {
  it("buckets by days past due: not yet, 1–30, 31–60, over 60", () => {
    expect([0, 1, 30, 31, 60, 61].map(agingKeyOf)).toEqual(["current", "d30", "d30", "d60", "d60", "d61"]);
    const buckets = aging(inputs([invoice({ due_on: "2026-05-01", balance: "10.00" }), invoice({ due_on: "2026-07-27", balance: "5.00" })]));
    expect(buckets.map((b) => [b.key, b.amount, b.count])).toEqual([
      ["current", "0.00", 0],
      ["d30", "5.00", 1],
      ["d60", "0.00", 0],
      ["d61", "10.00", 1],
    ]);
  });
});
