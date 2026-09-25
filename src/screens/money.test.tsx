/**
 * The money screens drawn from the sample studio, and the writes their
 * buttons make.
 *
 *   one invoice   what each state offers (a draft, sent and open, paid in
 *                 part, void, discarded), who sees the voids (managers only),
 *                 the ledger with a voided payment struck and left out, what
 *                 the client says they paid and "Record it"
 *   the sheets    record a payment (prefilled from the client's word; the
 *                 balance cap when another desk got there first), void a
 *                 payment, void an invoice or discard a draft
 *   chasing       the ready banner, one rung per invoice, Send all writing
 *                 only the ready rungs, nothing else written by the desk
 *   clients       the cards and a client's record
 *   printed copy  drawn from the stored rows: VOID and the day, never the
 *                 reason; a receipt's balance after that payment
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/index.tsx";
import { fakeStudio, type FakeStudio } from "../testing/fakeStudio.ts";
import { loadClient, loadInvoice, loadPage, useDesk } from "../state/desk.ts";
import { recordPayment, sendAllReady, voidPayment } from "../state/actions.ts";
import { useSheets } from "../state/sheets.ts";
import { openPrint, useUi } from "../state/ui.ts";
import { usePortal } from "../state/portal.ts";
import { now } from "../lib/clock.ts";
import Invoice from "./Invoice.tsx";
import Invoices from "./Invoices.tsx";
import Chasing from "./Chasing.tsx";
import Clients from "./Clients.tsx";
import ClientRecord from "./Client.tsx";
import Print from "./Print.tsx";
import RecordPayment from "../sheets/RecordPayment.tsx";
import VoidInvoice from "../sheets/VoidInvoice.tsx";
import VoidPayment from "../sheets/VoidPayment.tsx";
import { paymentRefusal } from "./invoices/amount.ts";

/*
 * Drawn to a string on the server side of React, a store hook reads the
 * store's INITIAL state. Before each drawing the initial state is made to say
 * what the stores hold now (test-only).
 */
function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node: React.ReactNode) => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
/** The page's words, tags gone. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
const manager = (yes: boolean) => useDesk.setState({ me: { ...useDesk.getState().me, manager: yes, roleName: yes ? "Studio manager" : "Studio" } });

let studio: FakeStudio;

beforeEach(async () => {
  studio = await fakeStudio();
  useUi.setState({ print: null });
});

async function invoicePage(id: number): Promise<string> {
  await loadInvoice(id);
  useUi.setState({ view: "invoice", selected: { ...useUi.getState().selected, invoice: id } });
  return text(draw(<Invoice />));
}

describe("one invoice", () => {
  it("sent and part paid: record, print, preview; a payment row a manager may void; no invoice void once something is paid", async () => {
    const page = await invoicePage(5);
    expect(page).toContain("INV-2039");
    expect(page).toContain("Overdue");
    expect(page).toContain("47 days past due");
    for (const word of ["Record payment", "Printed copy", "Preview as the client"]) expect(page).toContain(word);
    expect(page).not.toContain("Send invoice");
    expect(page).toContain("Payment received");
    expect(page).toContain("REC-0016");
    expect(page.match(/Void…/g)?.length).toBe(1);
    await loadInvoice(5);
    expect(draw(<Invoice />)).toContain('aria-label="Void the $300.00 payment of Jun 20"');
    expect(page).toContain("Balance due");
  });

  it("hides every void from someone who is not a studio manager", async () => {
    manager(false);
    expect(await invoicePage(5)).not.toContain("Void…");
    expect(await invoicePage(4)).not.toContain("Void…");
    manager(true);
    expect(await invoicePage(4)).toContain("Void…");
  });

  it("a draft: send and edit, discard for a manager, no issue date, no printed copy, no preview", async () => {
    const page = await invoicePage(7);
    expect(page).toContain("Send invoice");
    expect(page).toContain("Edit");
    expect(page).toContain("Discard draft…");
    expect(page).toMatch(/Issued not sent/);
    expect(page).toContain("not sent yet");
    expect(page).not.toContain("Printed copy");
    expect(page).not.toContain("Preview as the client");
    expect(page).not.toContain("Record payment");
  });

  it("void: the line with the day and the studio's reason, its printed copy, nothing else", async () => {
    const page = await invoicePage(1);
    expect(page).toMatch(/Voided on .*May.* — Raised in error/);
    expect(page).toContain("Printed copy");
    for (const word of ["Record payment", "Preview as the client", "Void…", "Send invoice"]) expect(page).not.toContain(word);
  });

  it("a discarded draft says so and has no printed copy", async () => {
    const draft = useDesk.getState().rows.invoices[7]!;
    await studio.world.writes.update("invoices", 7, { status: "void", void_reason: "Discarded draft" });
    expect(draft.issued_on).toBeNull();
    const page = await invoicePage(7);
    expect(page).toContain("Discarded as a draft");
    expect(page).not.toContain("Printed copy");
  });

  it("shows what the client says they paid while something is owed, with Record it", async () => {
    const page = await invoicePage(3);
    expect(page).toContain("Cleo says they paid $500.00 on Jul 27");
    expect(page).toContain("Record it");
    expect(page).toContain("“Sent half by bank transfer.”");
  });
});

describe("the money sheets", () => {
  it("record a payment opens with what the client said, and the stored balance", async () => {
    await loadInvoice(3);
    useSheets.setState({ open: { kind: "recordPayment", invoiceId: 3, prefill: { amount: "500.00", on: "2026-07-27" } }, draft: {} });
    const html = draw(<RecordPayment sheet={{ kind: "recordPayment", invoiceId: 3, prefill: { amount: "500.00", on: "2026-07-27" } }} onClose={() => undefined} />);
    expect(html).toContain('value="500.00"');
    expect(html).toContain('value="2026-07-27"');
    expect(html).toContain('max="2026-07-28"');
    expect(html).toContain('min="2026-07-14"');
    expect(text(html)).toContain("Record $500.00");
    const balance = useDesk.getState().rows.invoices[3]!.balance!;
    expect(text(html)).toContain(`Open balance $${Number(balance).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  });

  it("the balance cap: another desk got there first — refused, the invoice read again, the most that can be recorded said", async () => {
    await loadInvoice(4);
    const before = useDesk.getState().rows.invoices[4]!.balance!;
    // Someone else records most of it.
    await studio.world.writes.insert("payments", { document_id: 4, amount: "1000.00", method: "cash", paid_on: "2026-07-28" });
    const out = await recordPayment(4, { amount: before, method: "bank-transfer", paid_on: "2026-07-28" });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("BALANCE_EXCEEDED");
    expect(paymentRefusal(out.reason, out.field)).toEqual({ field: "amount", words: "balance" });
    expect(useDesk.getState().rows.invoices[4]!.balance).toBe("519.00");
  });

  it("void a payment names it and asks for a reason; the balance goes back up", async () => {
    await loadInvoice(5);
    const html = text(draw(<VoidPayment sheet={{ kind: "voidPayment", paymentId: 2 }} onClose={() => undefined} />));
    expect(html).toContain("$300.00 on Jun 20 by Card. The row stays, struck through, and the balance goes back up.");
    const out = await voidPayment(2, "Recorded twice");
    expect(out.ok).toBe(true);
    expect(useDesk.getState().rows.invoices[5]!.balance).toBe(useDesk.getState().rows.invoices[5]!.total);
    const page = await invoicePage(5);
    expect(page).toContain("Payment voided");
    expect(page).toContain("Recorded twice");
    expect(page).not.toMatch(/Void the \$300\.00/);
  });

  it("void an invoice asks why; discarding a draft asks nothing and says the client never sees it", async () => {
    await loadInvoice(4);
    await loadInvoice(7);
    const sent = text(draw(<VoidInvoice sheet={{ kind: "voidInvoice", invoiceId: 4 }} onClose={() => undefined} />));
    expect(sent).toContain("Void INV-2038");
    expect(sent).toContain("Reason");
    expect(sent).toContain("Only the studio sees it.");
    const draft = text(draw(<VoidInvoice sheet={{ kind: "voidInvoice", invoiceId: 7 }} onClose={() => undefined} />));
    expect(draft).toContain("Discard INV-2041");
    expect(draft).toContain("the client never sees it");
    expect(draft).not.toContain("Reason");
  });
});

describe("the Invoices list", () => {
  it("lists what the desk holds, newest first, with what is late and what is still open", async () => {
    await loadPage("invoices", { order: "id.desc", limit: 50, offset: 0 });
    const page = text(draw(<Invoices />));
    const order = [...page.matchAll(/INV-20\d\d/g)].map((m) => m[0]);
    expect(order).toEqual(["INV-2041", "INV-2040", "INV-2039", "INV-2038", "INV-2037", "INV-2036", "INV-2035"]);
    expect(page).toContain("47 days over");
    expect(page).toMatch(/\$741\.60 open/);
    expect(page).toContain("not sent");
    expect(page).toMatch(/INV-2035 Menu deposit Marigold Tea Rooms void/);
  });
});

describe("Chasing", () => {
  it("counts the ready rungs, one per invoice, and Send all writes exactly those — nothing else", async () => {
    const page = text(draw(<Chasing />));
    expect(page).toContain("2 rungs are ready to send");
    expect(page).toContain("On INV-2038 and INV-2039.");
    expect(page).toContain("Send all 2");
    studio.writes.length = 0;
    const out = await sendAllReady(now());
    expect(out.ok).toBe(true);
    expect(studio.writes.map((w) => [w.table, w.id, w.values])).toEqual([
      ["messages", 2, { status: "queued" }],
      ["messages", 4, { status: "queued" }],
    ]);
    const after = draw(<Chasing />);
    expect(text(after)).toContain("Nothing is ready to send");
    expect(after).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Nothing to send/);
  });

  it("draws the selected invoice's rungs: the ready one's wording and its buttons, the pause the server makes", async () => {
    const page = text(draw(<Chasing />));
    expect(page).toContain("INV-2039 · Marigold Tea Rooms");
    expect(page).toContain("Pause the work");
    expect(page).toContain("Waiting on you");
    expect(page).toContain("Approve and send");
    expect(page).toContain("Skip this rung");
    expect(page).toContain("Hello Priya,");
    expect(page).toContain("INV-2039 is 47 days past due");
    // PRJ-03 is paused already: sending pauses nothing more.
    expect(page).toContain("PRJ-03 is already paused");
  });
  it("a sent rung says when and to whom; a rung not yet due waits, and may be sent early, edited or skipped", async () => {
    useUi.setState({ selected: { ...useUi.getState().selected, invoice: 4 } });
    await loadInvoice(4);
    const page = text(draw(<Chasing />));
    expect(page).toContain("INV-2038 · Hearth & Co Bakery");
    expect(page).toMatch(/A gentle nudge Sent Jul 17/);
    expect(page).toContain("Sent July 17, 2026 to amara@hearth.example.");
    expect(page).toMatch(/Pause the work In 13 days/);
    expect(page).toContain("Send it early");
    expect(page).toContain("Wakes up Aug 10 — day 25 past due.");
    // Rung 2 is ready; rung 3 waits: two held rungs, each editable and skippable; the sent one is not.
    expect(page.match(/Edit the wording/g)?.length).toBe(2);
    expect(page.match(/Skip this rung/g)?.length).toBe(2);
    expect(page).toContain("Sending this also pauses PRJ-02 and tells the client.");
  });
});

describe("Clients", () => {
  it("draws a card a client with open, overdue and paid to date, and a state", async () => {
    await loadPage("invoices", { order: "id.desc", limit: 50, offset: 0 });
    const page = text(draw(<Clients />));
    expect(page).toContain("Hearth & Co Bakery");
    expect(page).toMatch(/Marigold Tea Rooms Tea room Overdue Open \$741\.60 Paid to date \$300\.00/);
    expect(page).toMatch(/Kiln Street Ceramics Ceramics Quiet/);
  });

  it("a client's record: stats, work, who we talk to, notes and history, documents and the statement", async () => {
    await loadClient(1);
    useUi.setState({ view: "client", selected: { ...useUi.getState().selected, client: 1 } });
    const page = text(draw(<ClientRecord />));
    for (const word of ["New proposal", "Preview as the client", "Open balance", "Pays in", "Who we talk to", "14 Mill Lane", "Net 14 — this client’s", "The studio’s", "Prefers a call before anything big is sent.", "Statement", "PRO-1142", "INV-2038"]) {
      expect(page).toContain(word);
    }
    expect(page).toMatch(/\$1,519\.00 of it overdue/);
  });
});

describe("the printed copy, drawn from the stored rows", () => {
  it("marks a void invoice VOID with the day, and never prints the reason", async () => {
    await loadInvoice(1);
    openPrint({ kind: "invoice", id: 1 });
    const page = text(draw(<Print />));
    expect(page).toContain("VOID");
    expect(page).toMatch(/Voided on May 3, 2026\. The number is kept/);
    expect(page).not.toContain("Raised in error");
  });

  it("a receipt says the balance left after that payment", async () => {
    await loadInvoice(5);
    openPrint({ kind: "receipt", id: 2 });
    const page = text(draw(<Print />));
    expect(page).toContain("Receipt REC-0016 · for INV-2039");
    expect(page).toMatch(/Balance left \$741\.60/);
  });

  it("a draft has none", async () => {
    await loadInvoice(7);
    openPrint({ kind: "invoice", id: 7 });
    expect(text(draw(<Print />))).toContain("A draft has no printed copy.");
  });
});
