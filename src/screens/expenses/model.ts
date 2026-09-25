/**
 * What the Expenses screen draws, worked out from the stored rows: how each
 * purchase stands, the three sums at the top, the four filters and their
 * counts, and the words a row's second line uses.
 *
 *   passed on     a line of an invoice carries it — the line is the only record
 *                 that it went; which invoice, and whether that invoice is
 *                 still a draft, come from the line
 *   to pass on    marked to go to the client at cost, and no line carries it yet
 *   ours          the studio's own to carry (not marked to pass on)
 *
 * Every sum here is for showing only: the stored costs added up exactly
 * (`sumDecimals`), never a figure that is saved.
 */
import type { Decimal, Expense, Id, Invoice, InvoiceLine } from "../../data/types.ts";
import { sumDecimals } from "../../lib/money.ts";

export type PurchaseStanding = "passed-on" | "to-pass-on" | "ours";

export const PURCHASE_FILTERS = ["all", "to-pass-on", "passed-on", "ours"] as const;
export type PurchaseFilter = (typeof PURCHASE_FILTERS)[number];

/** Where a passed-on purchase went: the line carrying it and that line's invoice (when the desk holds it). */
export interface Carrier {
  line: InvoiceLine;
  invoice: Invoice | null;
}

/** The line carrying each purchase, by the purchase's id. */
export function carriersOf(lines: readonly InvoiceLine[], invoices: Readonly<Record<Id, Invoice>>): Map<Id, Carrier> {
  const out = new Map<Id, Carrier>();
  for (const line of lines) {
    if (line.expense_id === null) continue;
    out.set(line.expense_id, { line, invoice: invoices[line.document_id] ?? null });
  }
  return out;
}

export function standingOf(expense: Expense, carriers: ReadonlyMap<Id, Carrier>): PurchaseStanding {
  if (carriers.has(expense.id)) return "passed-on";
  return expense.rebill ? "to-pass-on" : "ours";
}

/** Newest first: by the day bought, then the newest row. */
export const newestFirst = (a: Expense, b: Expense): number => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1);

export interface Pile {
  count: number;
  /** The stored costs added up, to show. */
  sum: Decimal;
  ids: Id[];
}

export interface ExpenseFigures {
  all: Pile;
  "to-pass-on": Pile;
  "passed-on": Pile;
  ours: Pile;
}

const pile = (list: readonly Expense[]): Pile => ({ count: list.length, sum: sumDecimals(list.map((e) => e.amount)), ids: list.map((e) => e.id) });

export function expenseFigures(expenses: readonly Expense[], carriers: ReadonlyMap<Id, Carrier>): ExpenseFigures {
  const by = (s: PurchaseStanding) => expenses.filter((e) => standingOf(e, carriers) === s);
  return { all: pile(expenses), "to-pass-on": pile(by("to-pass-on")), "passed-on": pile(by("passed-on")), ours: pile(by("ours")) };
}

export const inFilter = (filter: PurchaseFilter, expense: Expense, carriers: ReadonlyMap<Id, Carrier>): boolean => filter === "all" || standingOf(expense, carriers) === filter;

/**
 * The purchases "Pass on" takes: every one marked to pass on, with a client,
 * that no line carries yet — whichever filter is on show.
 */
export const passable = (expenses: readonly Expense[], carriers: ReadonlyMap<Id, Carrier>): Expense[] =>
  expenses.filter((e) => standingOf(e, carriers) === "to-pass-on" && e.client_id !== null).sort(newestFirst);

/** How a passed-on purchase's invoice stands: still a draft (the line can come off), or sent and locked. */
export type CarrierState = "draft" | "locked" | "unknown";
export function carrierState(carrier: Carrier | undefined): CarrierState {
  if (carrier === undefined || carrier.invoice === null) return "unknown";
  return carrier.invoice.status === "draft" ? "draft" : "locked";
}

/** The projects a purchase can be for: every one not done, in the order they were opened. */
export const openProjects = <P extends { id: Id; status: string }>(projects: readonly P[]): P[] => projects.filter((p) => p.status !== "done").sort((a, b) => a.id - b.id);
