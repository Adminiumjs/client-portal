/**
 * Engine assertions for `lib/invoice.ts`.
 *
 * Money is integer cents throughout, so every expectation below is exact —
 * there is no `toBeCloseTo` in this file, deliberately. If an assertion here
 * ever needs a tolerance, the engine has started doing floating-point money.
 */

import { describe, expect, it } from "vitest";

import {
  CLIENTS,
  SEED_INVOICES,
  SEED_PROJECTS,
  SEED_PROPOSALS,
  TAX_RATE,
  TODAY,
  ser,
} from "../data/demo.ts";
import type { Invoice, LineItem } from "../data/types.ts";
import {
  aging,
  agingBucket,
  awaitingClient,
  balance,
  checkPayment,
  daysOverdue,
  docTotals,
  isExpired,
  isOverdue,
  isSettled,
  ledger,
  lineTotal,
  lookup,
  nextNumber,
  oldestOverdueDays,
  open,
  outstanding,
  overdueInvoices,
  paid,
  projectProgress,
  upcomingMilestones,
} from "./invoice.ts";

const inv = (n: string) => SEED_INVOICES.find((i) => i.num === n)!;

const item = (over: Partial<LineItem> = {}): LineItem => ({
  desc: "x",
  qty: 1,
  rate: 10_000,
  disc: 0,
  ...over,
});

describe("line math", () => {
  it("multiplies quantity by rate", () => {
    expect(lineTotal(item({ qty: 3, rate: 12_500 }))).toBe(37_500);
  });

  it("applies a line discount", () => {
    expect(lineTotal(item({ rate: 34_000, disc: 10 }))).toBe(30_600);
  });

  it("rounds a fractional cent once, at the line", () => {
    // 3 × 3,333 = 9,999; less 7% = 9,299.07 → 9,299.
    expect(lineTotal(item({ qty: 3, rate: 3_333, disc: 7 }))).toBe(9_299);
  });

  it("treats a missing discount as zero", () => {
    expect(lineTotal({ desc: "x", qty: 2, rate: 500, disc: 0 })).toBe(1_000);
  });
});

describe("document totals", () => {
  it("sums the lines, then taxes the subtotal", () => {
    const totals = docTotals(
      [item({ rate: 100_000 }), item({ rate: 50_000 })],
      TAX_RATE,
    );
    expect(totals.subtotal).toBe(150_000);
    expect(totals.tax).toBe(12_000);
    expect(totals.total).toBe(162_000);
  });

  it("total is always subtotal plus tax, exactly", () => {
    for (const invoice of SEED_INVOICES) {
      const t = docTotals(invoice.items, invoice.taxRate);
      expect(t.total).toBe(t.subtotal + t.tax);
    }
  });

  it("handles a zero tax rate", () => {
    const t = docTotals([item()], 0);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(t.subtotal);
  });

  it("computes the accepted proposal's total from its discounted line", () => {
    const pro = SEED_PROPOSALS.find((p) => p.num === "PRO-1142")!;
    // 180,000 + 96,000 + (34,000 − 10%) = 306,600; +8% tax = 331,128.
    const t = docTotals(pro.items, pro.taxRate);
    expect(t.subtotal).toBe(306_600);
    expect(t.total).toBe(331_128);
  });
});

describe("payments and the ledger", () => {
  it("sums what has been paid", () => {
    expect(paid(inv("INV-2039"))).toBe(120_000);
    expect(paid(inv("INV-2037"))).toBe(0);
  });

  it("settles an invoice paid in full", () => {
    expect(balance(inv("INV-2035"))).toBe(0);
    expect(isSettled(inv("INV-2035"))).toBe(true);
  });

  it("leaves a balance on a partial payment", () => {
    const invoice = inv("INV-2039");
    const total = docTotals(invoice.items, invoice.taxRate).total;
    expect(balance(invoice)).toBe(total - 120_000);
    expect(isSettled(invoice)).toBe(false);
  });

  it("never reports a negative balance", () => {
    const over: Invoice = {
      ...inv("INV-2037"),
      payments: [{ amt: 999_999_99, method: "card", at: TODAY }],
    };
    expect(balance(over)).toBe(0);
  });

  it("opens the ledger with the invoice total and carries the balance down", () => {
    const invoice = inv("INV-2039");
    const rows = ledger(invoice);
    const total = docTotals(invoice.items, invoice.taxRate).total;

    expect(rows[0]).toMatchObject({ kind: "opening", amount: total, balance: total });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ kind: "payment", amount: 120_000, method: "transfer" });
    expect(rows[1].balance).toBe(total - 120_000);
  });

  it("orders ledger payments oldest first regardless of seed order", () => {
    const invoice: Invoice = {
      ...inv("INV-2037"),
      payments: [
        { amt: 1_000, method: "card", at: ser(2026, 7, 20) },
        { amt: 2_000, method: "cash", at: ser(2026, 7, 10) },
      ],
    };
    const rows = ledger(invoice);
    expect(rows[1].at).toBeLessThan(rows[2].at);
  });

  it("accepts a partial payment", () => {
    const check = checkPayment(inv("INV-2037"), 50_000);
    expect(check).toMatchObject({ ok: true, amount: 50_000 });
  });

  it("accepts a payment for exactly the balance", () => {
    const invoice = inv("INV-2037");
    expect(checkPayment(invoice, balance(invoice)).ok).toBe(true);
  });

  it("refuses an overpayment and says what the maximum is", () => {
    const invoice = inv("INV-2037");
    const max = balance(invoice);
    const check = checkPayment(invoice, max + 1);
    expect(check).toMatchObject({ ok: false, reason: "overpay", max });
  });

  it("refuses zero and negative amounts", () => {
    expect(checkPayment(inv("INV-2037"), 0)).toMatchObject({ ok: false, reason: "empty" });
    expect(checkPayment(inv("INV-2037"), -100)).toMatchObject({ ok: false, reason: "negative" });
  });
});

describe("overdue, derived rather than stored", () => {
  it("marks a sent invoice past its due date as overdue", () => {
    expect(isOverdue(inv("INV-2037"), TODAY)).toBe(true);
    expect(daysOverdue(inv("INV-2037"), TODAY)).toBe(47);
  });

  it("never marks a draft overdue, however old", () => {
    const stale: Invoice = { ...inv("INV-2041"), due: ser(2026, 1, 1) };
    expect(stale.status).toBe("draft");
    expect(isOverdue(stale, TODAY)).toBe(false);
  });

  it("never marks a settled invoice overdue", () => {
    expect(isOverdue(inv("INV-2035"), TODAY)).toBe(false);
  });

  it("is not overdue before the due date", () => {
    expect(isOverdue(inv("INV-2039"), TODAY)).toBe(false);
    expect(daysOverdue(inv("INV-2039"), TODAY)).toBe(0);
  });

  it("changes answer as the clock moves, without touching the record", () => {
    const invoice = inv("INV-2039"); // due 3 Aug
    expect(isOverdue(invoice, TODAY)).toBe(false);
    expect(isOverdue(invoice, ser(2026, 8, 4))).toBe(true);
  });
});

describe("aging", () => {
  it("buckets by how late the invoice is", () => {
    expect(agingBucket(inv("INV-2039"), TODAY)).toBe("current");
    expect(agingBucket(inv("INV-2038"), TODAY)).toBe("d1_30"); // 12 days
    expect(agingBucket(inv("INV-2037"), TODAY)).toBe("d31_60"); // 47 days
  });

  it("returns every bucket even when empty, so the strip keeps its shape", () => {
    const rows = aging(SEED_INVOICES, TODAY);
    expect(rows.map((r) => r.bucket)).toEqual([
      "current",
      "d1_30",
      "d31_60",
      "d61plus",
    ]);
    expect(rows.find((r) => r.bucket === "d61plus")).toMatchObject({
      count: 0,
      amount: 0,
    });
  });

  it("populates two overdue buckets from the shipped seed", () => {
    const rows = aging(SEED_INVOICES, TODAY);
    expect(rows.find((r) => r.bucket === "d1_30")!.count).toBe(1);
    expect(rows.find((r) => r.bucket === "d31_60")!.count).toBe(1);
  });

  it("bucket amounts sum to the total outstanding", () => {
    const rows = aging(SEED_INVOICES, TODAY);
    expect(rows.reduce((sum, r) => sum + r.amount, 0)).toBe(
      outstanding(SEED_INVOICES),
    );
  });

  it("counts only sent, unsettled invoices as open", () => {
    const openOnes = open(SEED_INVOICES);
    expect(openOnes.map((i) => i.num).sort()).toEqual([
      "INV-2037",
      "INV-2038",
      "INV-2039",
      "INV-2040",
    ]);
  });

  it("orders overdue invoices oldest first and reports the oldest age", () => {
    const overdue = overdueInvoices(SEED_INVOICES, TODAY);
    expect(overdue.map((i) => i.num)).toEqual(["INV-2037", "INV-2038"]);
    expect(oldestOverdueDays(SEED_INVOICES, TODAY)).toBe(47);
  });

  it("reports zero oldest age when nothing is late", () => {
    expect(oldestOverdueDays([inv("INV-2035")], TODAY)).toBe(0);
  });
});

describe("document numbering", () => {
  it("mints the next number from the highest issued", () => {
    expect(nextNumber("INV", SEED_INVOICES.map((i) => i.num))).toBe("INV-2042");
    expect(nextNumber("PRO", SEED_PROPOSALS.map((p) => p.num))).toBe("PRO-1147");
  });

  it("starts at 1 from an empty list", () => {
    expect(nextNumber("INV", [])).toBe("INV-1");
  });

  it("expires a sent proposal past its validity date", () => {
    const sent = SEED_PROPOSALS.find((p) => p.num === "PRO-1145")!;
    expect(isExpired(sent, TODAY)).toBe(false);
    expect(isExpired(sent, ser(2026, 8, 16))).toBe(true);
  });

  it("never expires a decided proposal", () => {
    const accepted = SEED_PROPOSALS.find((p) => p.num === "PRO-1142")!;
    expect(isExpired(accepted, ser(2027, 1, 1))).toBe(false);
  });
});

describe("projects", () => {
  it("computes progress from completed milestones", () => {
    const drift = SEED_PROJECTS.find((p) => p.id === "pj-drift")!;
    expect(projectProgress(drift)).toBe(3 / 5);
    const orbit = SEED_PROJECTS.find((p) => p.id === "pj-orbit")!;
    expect(projectProgress(orbit)).toBe(1);
  });

  it("is zero for a project with no milestones rather than NaN", () => {
    expect(
      projectProgress({ ...SEED_PROJECTS[0], milestones: [] }),
    ).toBe(0);
  });

  it("lists deliverables still waiting on the client", () => {
    const waiting = awaitingClient(SEED_PROJECTS);
    expect(waiting.map((w) => w.deliverable.id).sort()).toEqual([
      "d-logo3",
      "d-menu2",
    ]);
  });

  it("lists upcoming milestones soonest first", () => {
    const upcoming = upcomingMilestones(SEED_PROJECTS, TODAY, 14);
    expect(upcoming.length).toBeGreaterThan(0);
    const dues = upcoming.map((u) => u.milestone.due);
    expect([...dues].sort((a, b) => a - b)).toEqual(dues);
    expect(upcoming.every((u) => !u.milestone.done)).toBe(true);
  });
});

describe("the portal lookup", () => {
  const find = (email: string, num: string) =>
    lookup(email, num, SEED_PROPOSALS, SEED_INVOICES, CLIENTS);

  it("finds a sent proposal for the right email", () => {
    expect(find("amara@driftandfern.example", "PRO-1142")).toMatchObject({
      ok: true,
      kind: "proposal",
    });
  });

  it("finds a sent invoice for the right email", () => {
    expect(find("tessa@loworbit.example", "INV-2039")).toMatchObject({
      ok: true,
      kind: "invoice",
    });
  });

  it("is case-insensitive on both fields", () => {
    expect(find("AMARA@DriftAndFern.example", "pro-1142").ok).toBe(true);
  });

  it("distinguishes an unknown number from a wrong email", () => {
    expect(find("amara@driftandfern.example", "INV-9999")).toMatchObject({
      ok: false,
      reason: "unknownNumber",
    });
    expect(find("someone@else.example", "PRO-1142")).toMatchObject({
      ok: false,
      reason: "wrongEmail",
    });
  });

  it("refuses a draft the studio has not sent, with its own reason", () => {
    expect(find("rowan@nightshiftrecords.example", "PRO-1146")).toMatchObject({
      ok: false,
      reason: "notSent",
    });
    expect(find("amara@driftandfern.example", "INV-2041")).toMatchObject({
      ok: false,
      reason: "notSent",
    });
  });
});
