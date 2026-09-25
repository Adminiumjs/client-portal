/**
 * Which document the printed copy shows.
 *
 * The desk opens the printed copy from a document's own page: an invoice, a
 * proposal (a quote), one payment (its receipt) or a client (their
 * statement, over a period). `openPrint` says which, and goes there. An
 * invoice's printed copy opened the plain way — `open("print", id)` — is
 * understood too: with nothing else asked for, the copy is of the invoice
 * the desk has selected.
 */
import { create } from "zustand";

import type { Id } from "../../data/types.ts";
import { open, go, useUi } from "../../state/ui.ts";

/** The document kinds the add-on draws, and the rows they are drawn from. */
export type PrintTarget =
  | { kind: "invoice"; id: Id }
  | { kind: "quote"; id: Id }
  | { kind: "receipt"; id: Id }
  | { kind: "statement"; id: Id; period: StatementPeriod };

/** A statement's period: everything, this year, or the last twelve months. */
export type StatementPeriod = "all" | "year" | "12m";

export const REF_OF = { invoice: "invoices", quote: "proposals", receipt: "payments", statement: "clients" } as const;

/** The document asked for, and the invoice the desk had selected when it was asked. */
const usePrint = create<{ target: PrintTarget | null; selectedThen: Id | null }>(() => ({ target: null, selectedThen: null }));

/** Open the printed copy of one document. */
export function openPrint(target: PrintTarget): void {
  if (target.kind === "invoice") {
    usePrint.setState({ target, selectedThen: target.id });
    open("print", target.id);
    return;
  }
  usePrint.setState({ target, selectedThen: useUi.getState().selected.invoice });
  go("print");
}

/** Change what the open printed copy shows (a statement's period). */
export function setPrintTarget(target: PrintTarget): void {
  usePrint.setState({ target });
}

/**
 * The document on show: the one asked for — unless an invoice's copy was
 * opened another way since (the desk's selected invoice moved), which is then
 * the one shown.
 */
export function usePrintTarget(): PrintTarget | null {
  const { target, selectedThen } = usePrint();
  const invoice = useUi((s) => s.selected.invoice);
  if (target !== null && invoice === selectedThen) return target;
  return invoice === null ? null : { kind: "invoice", id: invoice };
}

/** The store itself, for a test that draws the page on the server side of React. */
export const printStore = usePrint;

/** Forget it (tests). */
export function resetPrintTarget(): void {
  usePrint.setState({ target: null, selectedThen: null });
}
