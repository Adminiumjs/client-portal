/**
 * What the page is on: the one way into the printed copy (a proposal, an
 * invoice, a receipt, a statement), the Invoices list opened on one aging
 * bucket, and where a sign-in link lands.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { open, openInvoices, openPrint, printTargetOf, setPrintTarget, useUi } from "./ui.ts";

beforeEach(() => {
  useUi.setState({ view: "home", print: null, invoiceFilter: null, selected: { proposal: null, invoice: null, project: null, client: null, deliverable: null, payment: null } });
});

const target = () => printTargetOf(useUi.getState());

describe("the printed copy", () => {
  it("opens on each kind of document, and on the right row", () => {
    openPrint({ kind: "quote", id: 3 });
    expect(useUi.getState()).toMatchObject({ view: "print", selected: { proposal: 3 } });
    expect(target()).toEqual({ kind: "quote", id: 3 });
    openPrint({ kind: "receipt", id: 2 });
    expect(target()).toEqual({ kind: "receipt", id: 2 });
    openPrint({ kind: "statement", id: 1, period: "all" });
    setPrintTarget({ kind: "statement", id: 1, period: "year" });
    expect(target()).toEqual({ kind: "statement", id: 1, period: "year" });
    openPrint({ kind: "invoice", id: 7 });
    expect(useUi.getState().selected.invoice).toBe(7);
    expect(target()).toEqual({ kind: "invoice", id: 7 });
  });

  it("reads an invoice's copy opened the plain way as that invoice's, whatever was printed before", () => {
    openPrint({ kind: "quote", id: 3 });
    open("print", 5);
    expect(target()).toEqual({ kind: "invoice", id: 5 });
  });
});

describe("the Invoices list on one aging bucket", () => {
  it("opens the list with the bucket, and a plain visit keeps none", () => {
    openInvoices("d60");
    expect(useUi.getState()).toMatchObject({ view: "invoices", invoiceFilter: { bucket: "d60" } });
    openInvoices(null);
    expect(useUi.getState().invoiceFilter).toBeNull();
  });
});
