/**
 * Which document the printed copy shows — kept with the page's other state in
 * `state/ui.ts` (`openPrint`, `setPrintTarget`, `usePrintTarget`), the ONE way
 * in for a proposal, an invoice, a receipt or a statement. This module keeps
 * what only the printed copy needs: the table each kind is drawn from.
 */
export type { PrintTarget } from "../../state/ui.ts";
export type { StatementPeriod } from "../../data/ports.ts";

export const REF_OF = { invoice: "invoices", quote: "proposals", receipt: "payments", statement: "clients" } as const;
