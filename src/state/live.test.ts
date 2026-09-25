/**
 * Live updates on the desk: a frame names a row and the desk reads it again —
 * with what moved beside it on the server (a payment moves its invoice's
 * balance with no frame for the invoice) — and a reconnect reads the desk
 * again, with the document that was open.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { fakeStudio, type FakeStudio } from "../testing/fakeStudio.ts";
import { applyFrame, flush, resync } from "./live.ts";
import { loadPurchases, loadStudioDates } from "./officeActions.ts";
import { loadTime } from "./timeActions.ts";
import { loadInvoice, rowsOf, useDesk } from "./desk.ts";
import { open } from "./ui.ts";

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
});

describe("a frame from another computer", () => {
  it("reads the row again, and the invoice a new payment moved", async () => {
    await loadInvoice(4);
    const before = useDesk.getState().rows.invoices[4]!.balance;
    // Another computer records a payment: the world announces the payment only.
    const payment = await studio.world.writes.insert("payments", { document_id: 4, amount: "100.00", method: "cash", paid_on: "2026-07-28", client_key: "other-computer-0000000000000000000000" });
    applyFrame({ table: "payments", kind: "record.create", id: payment.id });
    await flush();
    expect(useDesk.getState().rows.payments[payment.id]).toMatchObject({ amount: "100.00" });
    expect(Number(useDesk.getState().rows.invoices[4]!.balance)).toBeCloseTo(Number(before) - 100, 2);
  });

  it("reads a new enquiry (open work) but not a row nobody here opened", async () => {
    const enquiry = await studio.world.writes.insert("enquiries", { name: "Walk-in", status: "new" });
    const font = await studio.world.writes.insert("project_fonts", { project_id: 4, name: "Söhne", position: 0 });
    applyFrame({ table: "enquiries", kind: "record.create", id: enquiry.id });
    applyFrame({ table: "project_fonts", kind: "record.create", id: font.id });
    await flush();
    expect(useDesk.getState().rows.enquiries[enquiry.id]).toBeDefined();
    expect(useDesk.getState().rows.project_fonts[font.id]).toBeUndefined();
  });

  it("drops a row that is gone, and re-reads what it moved", async () => {
    await loadInvoice(5);
    const paid = useDesk.getState().rows.invoices[5]!.paid;
    await studio.world.writes.remove("payments", 2);
    applyFrame({ table: "payments", kind: "record.delete", id: 2 });
    await flush();
    expect(useDesk.getState().rows.payments[2]).toBeUndefined();
    expect(useDesk.getState().rows.invoices[5]!.paid).not.toBe(paid);
  });
});

describe("after a reconnect", () => {
  it("reads the desk again, and the document that was open", async () => {
    open("invoice", 2);
    await studio.world.writes.update("enquiries", 2, { status: "declined" });
    await studio.world.writes.insert("invoice_lines", { document_id: 7, description: "Late line", qty: "1", rate: "10.00" });
    await resync();
    expect(useDesk.getState().rows.enquiries[2]).toBeUndefined();
    expect(rowsOf(useDesk.getState(), "payments").map((p) => p.document_id)).toEqual([2]);
  });

  it("keeps what the read set does not cover until the screen on show reads it again, and tells the screens to", async () => {
    await loadPurchases(null);
    await loadTime("2000-01-01");
    await loadStudioDates("2026-07-01", "2026-08-31");
    const before = useDesk.getState().reads;
    const held = (s = useDesk.getState()) => [rowsOf(s, "expenses").length, rowsOf(s, "time_entries").length, rowsOf(s, "events").length, rowsOf(s, "suppliers").length];
    expect(held()).toEqual([3, 3, 2, 2]);
    await resync();
    // Purchases, time, studio dates and suppliers are not in the read set: they stay, rather than empty the screens.
    expect(held()).toEqual([3, 3, 2, 2]);
    expect(useDesk.getState().reads).toBe(before + 1);
  });
});
