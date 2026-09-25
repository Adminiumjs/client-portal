/**
 * The invoice page's own reckonings: the payments so far with what was left
 * after each (shown only; the page leads with the stored balance), and
 * "I've sent a payment" checked before it goes — an amount above zero or
 * none, a day that has happened and is not before the invoice was issued.
 */
import { describe, expect, it } from "vitest";

import type { Tables } from "../../../data/types.ts";
import { checkClaim, ledger, parseAmount } from "./model.ts";

const inv = { id: 4, total: "1519.00", balance: "719.00", currency: "USD", issued_on: "2026-07-02" } as Tables["invoices"];
const pay = (id: number, amount: string, paid_on: string, voided = false) => ({ id, document_id: 4, amount, paid_on, voided, method: "bank-transfer" }) as Tables["payments"];

describe("the payments so far", () => {
  it("start from the total and take off each payment, oldest first", () => {
    const rows = ledger(inv, [pay(2, "300.00", "2026-07-20"), pay(1, "500.00", "2026-07-10")]);
    expect(rows.map((r) => [r.kind, r.amount, r.after])).toEqual([
      ["total", "1519.00", "1519.00"],
      ["payment", "500.00", "1019.00"],
      ["payment", "300.00", "719.00"],
    ]);
  });

  it("never show a voided payment", () => {
    expect(ledger(inv, [pay(1, "500.00", "2026-07-10", true)]).map((r) => r.kind)).toEqual(["total"]);
  });
});

describe("an amount as typed", () => {
  it("reads either decimal mark and any grouping", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("300")).toBe("300");
    expect(parseAmount("$ 1,250.50")).toBe("1250.50");
    expect(parseAmount("1.250,50 €")).toBe("1250.50");
    expect(parseAmount("1,250")).toBe("1250");
    expect(parseAmount("abc")).toBe("bad");
  });
});

describe("I've sent a payment", () => {
  const today = "2026-07-28";
  it("takes an amount above zero, or none", () => {
    expect(checkClaim({ amount: "", on: today }, inv.issued_on, today)).toEqual({ ok: true, amount: null, on: today });
    expect(checkClaim({ amount: "719.00", on: today }, inv.issued_on, today)).toEqual({ ok: true, amount: "719.00", on: today });
    expect(checkClaim({ amount: "0", on: today }, inv.issued_on, today)).toMatchObject({ ok: false, field: "amount" });
    expect(checkClaim({ amount: "lots", on: today }, inv.issued_on, today)).toMatchObject({ ok: false, field: "amount" });
  });

  it("takes a day that has happened, not before the invoice was issued", () => {
    expect(checkClaim({ amount: "", on: "" }, inv.issued_on, today)).toMatchObject({ ok: false, key: "client.invoice.claimPickDay" });
    expect(checkClaim({ amount: "", on: "2026-07-29" }, inv.issued_on, today)).toMatchObject({ ok: false, key: "client.invoice.claimFuture" });
    expect(checkClaim({ amount: "", on: "2026-07-01" }, inv.issued_on, today)).toMatchObject({ ok: false, key: "client.invoice.claimBeforeIssue" });
  });
});
