/**
 * What Expenses says after an action: where passed-on purchases went, and a
 * refusal in words — the server's own code where the area has something more
 * exact to say than the shared wording.
 */
import type { Client, Decimal, Expense, Id } from "../../data/types.ts";
import type { MessageKey, TFunction } from "../../i18n/index.tsx";
import { sumDecimals } from "../../lib/money.ts";
import type { OntoDrafts } from "../../state/invoiceDrafts.ts";
import { refusalKey, type Outcome } from "../../state/outcome.ts";

export interface PassedWords {
  key: MessageKey;
  /** The stored costs of the purchases now on a line, added up to show. */
  amount: Decimal;
  company: string;
  count: number;
}

/**
 * "$110.40 added at cost to Hearth & Loaf’s draft invoice." — one draft; "… to
 * 2 draft invoices." — several; nothing new (another press or tab got there
 * first): they were on an invoice already.
 */
export function passedOnWords(done: OntoDrafts, passed: readonly Expense[], clients: Readonly<Record<Id, Client>>): PassedWords {
  const carried = new Set(done.lines.map((l) => l.expense_id));
  const amount = sumDecimals(passed.filter((e) => carried.has(e.id)).map((e) => e.amount));
  const drafts = [...new Set(done.lines.map((l) => l.document_id))];
  if (done.lines.length === 0) return { key: "expenses.passed.already", amount, company: "", count: done.skipped.length };
  if (drafts.length === 1) {
    const invoice = done.invoices.find((i) => i.id === drafts[0]);
    const clientId = invoice?.client_id ?? passed.find((e) => carried.has(e.id))?.client_id ?? null;
    return { key: "expenses.passed.one", amount, company: clientId === null ? "" : (clients[clientId]?.company ?? ""), count: 1 };
  }
  return { key: "expenses.passed.many", amount, company: "", count: drafts.length };
}

/** A refusal of a purchase's action, in words. */
export function refusalWords(out: Extract<Outcome<unknown>, { ok: false }>, t: TFunction): string {
  switch (out.code) {
    case "FK_VIOLATION":
      return t("expenses.refused.onInvoice");
    case "ALREADY_INVOICED":
      return t("expenses.refused.passedOn");
    case "WHAT_REQUIRED":
      return t("expenses.form.needWhat");
    case "AMOUNT_ABOVE_ZERO":
      return t("expenses.form.needCost");
    case "CLIENT_REQUIRED":
      return t("expenses.refused.needClient");
  }
  if (out.field === "date") return t("expenses.form.futureDate");
  if (out.field === "amount") return t("expenses.form.needCost");
  if (out.reason === "locked" || out.reason === "moved") return t("expenses.refused.changed");
  return t(refusalKey(out.reason), { id: "", balance: "" });
}
