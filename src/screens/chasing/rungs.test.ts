/**
 * The chase ladder, read from the stored rungs: a held rung is ready once its
 * due time has come and waits before it; the day of the ladder is the rung's
 * own due day against the invoice's; the list's line, the next to wake, a
 * client's habit and a template's wording follow from the rows.
 */
import { describe, expect, it } from "vitest";

import type { Invoice, Message, Payment } from "../../data/types.ts";
import { venueStamp } from "../../data/venueTime.ts";
import { fillTemplate, invoiceLine, nextWake, paragraphs, payHabit, rungsOf, stateOf } from "./rungs.ts";

const ZONE = "America/New_York";
const NOW = venueStamp("2026-07-28", "10:00", ZONE);
const inv = (over: Partial<Invoice> = {}): Invoice => ({ id: 4, client_id: 1, status: "sent", due_on: "2026-07-16", balance: "100.00", ...over }) as Invoice;
const msg = (over: Partial<Message>): Message => ({ id: 1, kind: "invoice-rung-1", status: "held", invoice_id: 4, due: null, sent_at: null, skip_reason: null, ...over }) as Message;
const at = (day: string, time = "09:00") => new Date(venueStamp(day, time, ZONE)).toISOString();

describe("a rung's state", () => {
  it("is the row's: held and due is ready, held and not yet due waits", () => {
    expect(stateOf(msg({ due: at("2026-07-28") }), NOW)).toBe("ready");
    expect(stateOf(msg({ due: at("2026-07-28", "11:00") }), NOW)).toBe("waiting");
    expect(stateOf(msg({ status: "queued" }), NOW)).toBe("queued");
    expect(stateOf(msg({ status: "skipped" }), NOW)).toBe("skipped");
    expect(stateOf(null, NOW)).toBe("none");
  });

  it("falls on its day of the ladder, from its own due time", () => {
    const rungs = rungsOf(inv(), [msg({ id: 1, kind: "invoice-rung-1", status: "sent", due: at("2026-07-19"), sent_at: at("2026-07-19") }), msg({ id: 2, kind: "invoice-rung-2", due: at("2026-07-30") }), msg({ id: 9, kind: "invoice-rung-2", invoice_id: 5, due: at("2026-07-20") })], NOW, ZONE);
    expect(rungs.map((r) => [r.no, r.state, r.day, r.wait])).toEqual([
      [1, "sent", 3, 0],
      [2, "waiting", 14, 2],
      [3, "none", null, 0],
    ]);
  });

  it("reads the newest row when a rung has two", () => {
    const rungs = rungsOf(inv(), [msg({ id: 1, status: "skipped" }), msg({ id: 7, status: "held", due: at("2026-07-20") })], NOW, ZONE);
    expect(rungs[0]).toMatchObject({ state: "ready", message: { id: 7 } });
  });
});

describe("what the list says of an invoice", () => {
  const line = (messages: Message[]) => invoiceLine(rungsOf(inv(), messages, NOW, ZONE));
  it("names the ready rung, a rung on its way, all three sent, the next to wake, or nothing", () => {
    expect(line([msg({ kind: "invoice-rung-2", due: at("2026-07-27") })])).toEqual({ kind: "waiting", rung: 2 });
    expect(line([msg({ kind: "invoice-rung-3", status: "queued" })])).toEqual({ kind: "queued", rung: 3 });
    expect(line([1, 2, 3].map((n) => msg({ id: n, kind: `invoice-rung-${String(n)}` as Message["kind"], status: "sent" })))).toEqual({ kind: "allSent" });
    expect(line([msg({ kind: "invoice-rung-2", due: at("2026-07-31") })])).toEqual({ kind: "next", rung: 2, wait: 3 });
    expect(line([])).toEqual({ kind: "nothing" });
  });

  it("finds the earliest rung to wake across the open invoices", () => {
    const wake = nextWake([inv(), inv({ id: 5 })], [msg({ id: 1, due: at("2026-08-10") }), msg({ id: 2, invoice_id: 5, kind: "invoice-rung-2", due: at("2026-08-02") }), msg({ id: 3, invoice_id: 5, due: at("2026-07-01") })], NOW, ZONE);
    expect(wake).toMatchObject({ invoice: { id: 5 }, rung: { no: 2, dueDay: "2026-08-02" } });
  });
});

describe("how a client pays", () => {
  it("averages due day to last unvoided payment over their settled invoices, early as negative", () => {
    const invoices = [
      { id: 1, client_id: 1, status: "sent", due_on: "2026-06-15", balance: "0.00" },
      { id: 2, client_id: 1, status: "sent", due_on: "2026-06-30", balance: "0.00" },
      { id: 3, client_id: 1, status: "void", due_on: "2026-06-30", balance: "0.00" },
      { id: 4, client_id: 1, status: "sent", due_on: "2026-07-10", balance: "50.00" },
    ] as Invoice[];
    const payments = [
      { id: 1, document_id: 1, paid_on: "2026-06-12", voided: false },
      { id: 2, document_id: 2, paid_on: "2026-06-29", voided: false },
      { id: 3, document_id: 2, paid_on: "2026-07-20", voided: true },
    ] as Payment[];
    expect(payHabit(1, invoices, payments)).toEqual({ total: 3, settled: 2, average: -2 });
    expect(payHabit(9, invoices, payments)).toEqual({ total: 0, settled: 0, average: null });
  });
});

describe("a rung's wording", () => {
  it("fills the template's variables from the invoice, and leaves an unknown one empty", () => {
    expect(fillTemplate("{{invoice.number}} is {{ invoice.due_on.days_since }} days past due{{nope}}.", { "invoice.number": "INV-2038", "invoice.due_on.days_since": "12" })).toBe("INV-2038 is 12 days past due.");
  });

  it("keeps the studio's edited paragraphs, split on blank lines", () => {
    expect(paragraphs("One.\n\n\nTwo\nstill two.\n  \nThree.")).toEqual(["One.", "Two\nstill two.", "Three."]);
  });
});
