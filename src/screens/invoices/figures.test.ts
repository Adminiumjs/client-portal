/**
 * What the money screens work out for display: an invoice's pill, the list's
 * filters (on the desk and as the server reads them), the ledger — whose
 * voided payments stay on it but count for nothing — and sums by currency.
 */
import { describe, expect, it } from "vitest";

import type { Invoice, Payment } from "../../data/types.ts";
import { daysOverdue, filterCondition, invoiceWord, isDiscarded, ledger, matchesFilter, sumByCurrency, sumsLabel } from "./figures.ts";
import { compare, half, paymentProblem, paymentRefusal, readAmount } from "./amount.ts";

const DAY = "2026-07-28";

const inv = (over: Partial<Invoice>): Invoice =>
  ({
    id: 1,
    number_seq: 1,
    number: "INV-1",
    status: "sent",
    issued_on: "2026-07-01",
    terms: "net14",
    due_on: "2026-07-15",
    currency: "USD",
    tax_name: "Tax",
    tax_rate: "8.5",
    subtotal: "1000.00",
    tax: "85.00",
    total: "1085.00",
    paid: "0.00",
    balance: "1085.00",
    ladder: "standard",
    client_id: 1,
    client_paid_at: null,
    ...over,
  }) as Invoice;

const pay = (over: Partial<Payment>): Payment =>
  ({ id: 1, document_id: 1, number: "REC-1", amount: "100.00", currency: "USD", method: "card", paid_on: "2026-07-10", voided: false, void_reason: null, ...over }) as Payment;

describe("an invoice's pill", () => {
  it("is worked out from what is stored, in the order a person reads it", () => {
    expect(invoiceWord(inv({ status: "draft", issued_on: null, due_on: null }), DAY)).toBe("draft");
    expect(invoiceWord(inv({ status: "void" }), DAY)).toBe("void");
    expect(invoiceWord(inv({ balance: "0.00", paid: "1085.00" }), DAY)).toBe("paid");
    expect(invoiceWord(inv({}), DAY)).toBe("overdue");
    expect(invoiceWord(inv({ due_on: "2026-08-10" }), DAY)).toBe("sent");
    expect(invoiceWord(inv({ due_on: "2026-08-10", paid: "100.00", balance: "985.00" }), DAY)).toBe("partPaid");
    // Late and part paid reads as overdue: the lateness matters more.
    expect(invoiceWord(inv({ paid: "100.00", balance: "985.00" }), DAY)).toBe("overdue");
  });

  it("never calls a void invoice paid, and counts days late only while something is owed", () => {
    expect(invoiceWord(inv({ status: "void", balance: "0.00" }), DAY)).toBe("void");
    expect(daysOverdue(inv({}), DAY)).toBe(13);
    expect(daysOverdue(inv({ balance: "0.00" }), DAY)).toBe(0);
    expect(daysOverdue(inv({ due_on: DAY }), DAY)).toBe(0);
  });

  it("knows a discarded draft: void, and never issued", () => {
    expect(isDiscarded(inv({ status: "void", issued_on: null }))).toBe(true);
    expect(isDiscarded(inv({ status: "void" }))).toBe(false);
  });
});

describe("the list's filters", () => {
  const rows = [
    inv({ id: 1 }),
    inv({ id: 2, due_on: "2026-08-10" }),
    inv({ id: 3, status: "draft", issued_on: null, due_on: null }),
    inv({ id: 4, balance: "0.00", paid: "1085.00" }),
    inv({ id: 5, status: "void" }),
  ];
  const ids = (f: Parameters<typeof matchesFilter>[0]) => rows.filter((r) => matchesFilter(f, r, DAY)).map((r) => r.id);

  it("sort each invoice under the filters it belongs to", () => {
    expect(ids("all")).toEqual([1, 2, 3, 4, 5]);
    expect(ids("open")).toEqual([1, 2]);
    expect(ids("overdue")).toEqual([1]);
    expect(ids("draft")).toEqual([3]);
    expect(ids("paid")).toEqual([4]);
    expect(ids("void")).toEqual([5]);
  });

  it("are asked of the server as the same conditions", () => {
    expect(filterCondition("all", DAY)).toBeUndefined();
    expect(filterCondition("overdue", DAY)).toEqual({
      and: [
        { column: "status", op: "eq", value: "sent" },
        { column: "balance", op: "gt", value: 0 },
        { column: "due_on", op: "lt", value: DAY },
      ],
    });
    expect(filterCondition("paid", DAY)).toEqual({ and: [{ column: "status", op: "eq", value: "sent" }, { column: "balance", op: "lte", value: 0 }] });
    expect(filterCondition("void", DAY)).toEqual({ column: "status", op: "eq", value: "void" });
  });
});

describe("the ledger", () => {
  it("runs the stored total down by each unvoided payment, leaves a voided one out, and closes on the stored balance", () => {
    const i = inv({ total: "1085.00", paid: "300.00", balance: "785.00" });
    const rows = ledger(i, [pay({ id: 2, amount: "200.00", paid_on: "2026-07-12" }), pay({ id: 1, amount: "100.00", paid_on: "2026-07-10" }), pay({ id: 3, amount: "500.00", paid_on: "2026-07-11", voided: true, void_reason: "Recorded twice" }), pay({ id: 9, document_id: 7 })]);
    expect(rows.map((r) => (r.kind === "payment" ? `${String(r.payment.id)}:${r.balance ?? "-"}` : `${r.kind}:${r.balance ?? ""}`))).toEqual(["total:1085.00", "1:985.00", "3:-", "2:785.00", "closing:785.00"]);
    const closing = rows[rows.length - 1]!;
    expect(closing.kind === "closing" && closing.lastPaid).toBe("2026-07-12");
  });

  it("closes settled on a paid invoice, and never on a draft", () => {
    expect(ledger(inv({ balance: "0.00", paid: "1085.00" }), []).at(-1)).toMatchObject({ kind: "closing", settled: true });
    expect(ledger(inv({ status: "draft", balance: "0.00" }), []).at(-1)).toMatchObject({ kind: "closing", settled: false });
  });

  it("keeps a currency's own places (none for yen)", () => {
    const rows = ledger(inv({ currency: "JPY", total: "10000", balance: "7000" }), [pay({ amount: "3000", currency: "JPY" })]);
    expect(rows[1]).toMatchObject({ kind: "payment", balance: "7000" });
  });
});

describe("sums for display", () => {
  it("add stored amounts exactly, one sum per currency, the studio's first", () => {
    const sums = sumByCurrency([inv({ balance: "0.10" }), inv({ balance: "0.20" }), inv({ currency: "EUR", balance: "5.00" })], (i) => i.balance, "USD");
    expect(sums).toEqual([
      { currency: "USD", amount: "0.30" },
      { currency: "EUR", amount: "5.00" },
    ]);
    expect(sumsLabel(sums, (v, c) => `${c ?? ""} ${v}`)).toBe("USD 0.30 + EUR 5.00");
    expect(sumByCurrency([], (i: Invoice) => i.balance, "USD")).toEqual([{ currency: "USD", amount: "0.00" }]);
  });
});

describe("an amount as typed", () => {
  it("reads either decimal mark, and groups of thousands", () => {
    expect(readAmount("1200.50")).toBe("1200.50");
    expect(readAmount(" 1,200.50 ")).toBe("1200.50");
    expect(readAmount("1.200,50", "de-DE")).toBe("1200.50");
    expect(readAmount("1200,5", "de-DE")).toBe("1200.5");
    expect(readAmount("1,200")).toBe("1200");
    expect(readAmount("1,200", "de-DE")).toBe("1.200");
    expect(readAmount("12,50")).toBe("12.50");
    expect(readAmount("1 234,56", "fr-FR")).toBe("1234.56");
    expect(readAmount("0.5")).toBe("0.5");
  });

  it("refuses what is not an amount", () => {
    for (const bad of ["", "abc", "-5", "1.2.3,4,5", "12e3", "$12"]) expect(readAmount(bad)).toBeNull();
  });

  it("compares and halves exactly", () => {
    expect(compare("741.60", "741.6")).toBe(0);
    expect(compare("741.61", "741.60")).toBe(1);
    expect(compare("0", "0.01")).toBe(-1);
    expect(half("741.60", "USD")).toBe("370.80");
    expect(half("0.03", "USD")).toBe("0.02");
    expect(half("1001", "JPY")).toBe("501");
    expect(half("12.345", "KWD")).toBe("6.173");
  });
});

describe("the record-payment sheet's checks", () => {
  const base = { amount: "100.00", balance: "741.60", on: DAY, today: DAY, issued: "2026-05-28" };

  it("says what is wrong before it asks, the amount first", () => {
    expect(paymentProblem(base)).toBeNull();
    expect(paymentProblem({ ...base, amount: null })).toEqual({ field: "amount", kind: "zero" });
    expect(paymentProblem({ ...base, amount: "0" })).toEqual({ field: "amount", kind: "zero" });
    expect(paymentProblem({ ...base, amount: "741.61" })).toEqual({ field: "amount", kind: "over" });
    expect(paymentProblem({ ...base, amount: "741.60" })).toBeNull();
    expect(paymentProblem({ ...base, on: "" })).toEqual({ field: "on", kind: "day" });
    expect(paymentProblem({ ...base, on: "2026-07-29" })).toEqual({ field: "on", kind: "future" });
    expect(paymentProblem({ ...base, on: "2026-05-27" })).toEqual({ field: "on", kind: "before" });
  });

  it("words Adminium's refusals by what they mean", () => {
    expect(paymentRefusal("balance", "balance")).toEqual({ field: "amount", words: "balance" });
    expect(paymentRefusal("moved", null)).toEqual({ field: null, words: "moved" });
    expect(paymentRefusal("invalid", "paid_on")).toEqual({ field: "on", words: "range" });
    expect(paymentRefusal("not-allowed", null)).toEqual({ field: null, words: "shared" });
  });
});
