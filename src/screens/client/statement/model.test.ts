/**
 * The statement: periods on the studio's calendar that move with it, sums
 * that leave a void invoice and a voided payment out, and a running "to date"
 * beside each payment.
 */
import { describe, expect, it } from "vitest";

import type { Tables } from "../../../data/types.ts";
import { inPeriod, statement } from "./model.ts";

const TODAY = "2026-07-28";
const inv = (id: number, issued_on: string, total: string, balance: string, status: "sent" | "void" = "sent", due_on = "2026-12-31") =>
  ({ id, number: `INV-${id}`, status, issued_on, due_on, total, balance, currency: "USD" }) as Tables["invoices"];
const pay = (id: number, document_id: number, amount: string, paid_on: string, voided = false) => ({ id, document_id, amount, paid_on, voided, currency: "USD" }) as Tables["payments"];

const invoices = [inv(1, "2025-03-02", "1000.00", "0.00"), inv(2, "2026-02-10", "500.00", "200.00"), inv(3, "2026-07-01", "800.00", "800.00", "void"), inv(4, "2025-09-01", "300.00", "300.00", "sent", "2025-10-01")];
const payments = [pay(1, 1, "1000.00", "2025-03-20"), pay(2, 2, "300.00", "2026-03-01"), pay(3, 2, "100.00", "2026-03-05", true), pay(4, 3, "800.00", "2026-07-02")];

describe("the periods", () => {
  it("are counted back from the studio's today", () => {
    expect(inPeriod("2026-01-01", "year", TODAY)).toBe(true);
    expect(inPeriod("2025-12-31", "year", TODAY)).toBe(false);
    expect(inPeriod("2025-07-29", "12m", TODAY)).toBe(true);
    expect(inPeriod("2025-07-28", "12m", TODAY)).toBe(false);
    expect(inPeriod("2026-07-29", "year", "2026-07-28")).toBe(false);
  });

  it("move with the clock", () => {
    expect(inPeriod("2025-09-01", "12m", "2026-07-28")).toBe(true);
    expect(inPeriod("2025-09-01", "12m", "2026-09-02")).toBe(false);
  });
});

describe("the sums", () => {
  it("leave a void invoice and a voided payment out of every figure", () => {
    const st = statement(invoices, payments, "all", TODAY);
    expect(st.invoiced).toBe("1800.00");
    expect(st.paid).toBe("1300.00");
    expect(st.open).toBe("500.00");
    expect(st.overdueOpen).toBe(true);
    // The void invoice is still listed — it was sent.
    expect(st.invoices.map((i) => i.id)).toEqual([3, 2, 4, 1]);
  });

  it("follow the period", () => {
    const st = statement(invoices, payments, "year", TODAY);
    expect(st.invoices.map((i) => i.id)).toEqual([3, 2]);
    expect([st.invoiced, st.paid, st.open]).toEqual(["500.00", "300.00", "200.00"]);
    expect(st.counts).toEqual({ all: 6, year: 3, "12m": 4 });
  });

  it("run a total to date beside each payment, newest first", () => {
    const st = statement(invoices, payments, "all", TODAY);
    expect(st.payments.map((p) => [p.payment.id, p.toDate])).toEqual([
      [2, "1300.00"],
      [1, "1000.00"],
    ]);
    expect(st.since).toBe("2025-03-02");
  });
});
