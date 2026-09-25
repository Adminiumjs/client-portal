/**
 * A client's figures, as the cards and the record show them: what is open
 * and overdue, what they have paid to date — a void invoice and a voided
 * payment counting for nothing — how fast they pay, and their state.
 */
import { describe, expect, it } from "vitest";

import type { Invoice, Milestone, Payment, Project, Proposal } from "../../data/types.ts";
import { clientFigures, progressOf } from "./figures.ts";

const DAY = "2026-07-28";
const inv = (over: Partial<Invoice>): Invoice =>
  ({ id: 1, client_id: 1, status: "sent", currency: "USD", issued_on: "2026-06-01", due_on: "2026-06-15", total: "100.00", paid: "0.00", balance: "100.00", ...over }) as Invoice;
const pay = (over: Partial<Payment>): Payment => ({ id: 1, document_id: 1, amount: "100.00", paid_on: "2026-06-10", voided: false, ...over }) as Payment;
const prj = (over: Partial<Project>): Project => ({ id: 1, client_id: 1, status: "active", started_on: "2026-05-20", name: "Work", ...over }) as Project;
const prop = (over: Partial<Proposal>): Proposal => ({ id: 1, client_id: 1, status: "sent", valid_until: "2026-08-30", ...over }) as Proposal;

describe("a client's figures", () => {
  it("leave void invoices out of paid to date and open, and count them as never issued only when discarded", () => {
    const invoices = [
      inv({ id: 1, paid: "100.00", balance: "0.00" }),
      inv({ id: 2, status: "void", paid: "0.00", balance: "0.00", total: "900.00" }),
      inv({ id: 3, status: "void", issued_on: null, total: "50.00" }),
      inv({ id: 4, due_on: "2026-08-20", paid: "40.00", balance: "60.00" }),
      inv({ id: 5, client_id: 2, paid: "999.00" }),
      inv({ id: 6, status: "draft", issued_on: null, total: "10.00" }),
    ];
    const f = clientFigures(1, { invoices, projects: [], proposals: [] }, DAY, "USD");
    expect(f.paid).toEqual([{ currency: "USD", amount: "140.00" }]);
    expect(f.open).toEqual([{ currency: "USD", amount: "60.00" }]);
    expect(f.anyOverdue).toBe(false);
    expect(f.issued).toBe(3);
  });

  it("say how fast they pay from issue to the last unvoided payment of each settled invoice", () => {
    const invoices = [inv({ id: 1, issued_on: "2026-06-01", paid: "100.00", balance: "0.00" }), inv({ id: 2, issued_on: "2026-06-10", paid: "100.00", balance: "0.00" }), inv({ id: 3, balance: "100.00" })];
    const payments = [pay({ id: 1, document_id: 1, paid_on: "2026-06-11" }), pay({ id: 2, document_id: 1, paid_on: "2026-07-30", voided: true }), pay({ id: 3, document_id: 2, paid_on: "2026-06-30" })];
    expect(clientFigures(1, { invoices, projects: [], proposals: [], payments }, DAY).paysIn).toBe(15);
    expect(clientFigures(1, { invoices: [inv({})], projects: [], proposals: [], payments: [] }, DAY).paysIn).toBeNull();
  });

  it("take the first state that holds: overdue, paused, active, awaiting, quiet", () => {
    const state = (rows: Parameters<typeof clientFigures>[1]) => clientFigures(1, rows, DAY).state;
    expect(state({ invoices: [inv({})], projects: [prj({ status: "paused" })], proposals: [] })).toBe("overdue");
    expect(state({ invoices: [], projects: [prj({ status: "paused" }), prj({ id: 2 })], proposals: [] })).toBe("paused");
    expect(state({ invoices: [], projects: [prj({})], proposals: [] })).toBe("active");
    expect(state({ invoices: [], projects: [prj({ status: "done" })], proposals: [prop({})] })).toBe("awaiting");
    // A proposal past its date is not waiting on the client: they can't accept it.
    expect(state({ invoices: [], projects: [], proposals: [prop({ valid_until: "2026-07-01" })] })).toBe("quiet");
  });

  it("say since when, from the earliest project start or invoice issue", () => {
    expect(clientFigures(1, { invoices: [inv({ issued_on: "2026-03-02" })], projects: [prj({ started_on: "2026-04-01" })], proposals: [] }, DAY).since).toBe("2026-03-02");
  });
});

describe("a project's progress", () => {
  it("is its done milestones of all, and the next is the first not done in order", () => {
    const ms = [
      { id: 1, project_id: 1, position: 1, state: "now", title: "B" },
      { id: 2, project_id: 1, position: 0, state: "done", title: "A" },
      { id: 3, project_id: 1, position: 2, state: "next", title: "C" },
      { id: 4, project_id: 2, position: 0, state: "done", title: "X" },
    ] as Milestone[];
    expect(progressOf(1, ms)).toMatchObject({ pct: 33, total: 3, next: { title: "B" } });
    expect(progressOf(2, ms)).toMatchObject({ pct: 100, next: null });
  });
});
