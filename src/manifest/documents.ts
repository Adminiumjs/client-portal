/**
 * The documents this app declares on its own tables.
 *
 * A quote (proposals), an invoice (invoices) and a receipt (payments) come
 * with the shapes those tables are built on: the add-on's profiles already
 * map their own columns. What the shapes cannot know is who the document is
 * made out to — the client, a row of this app's own `clients` table. Each
 * entry here adds the client's slots, read through the row's `client_id`;
 * Adminium lays them over the shape's mapping when the app is installed.
 *
 * A client's STATEMENT is over the client, for a period: it lists the client's
 * sent invoices and their payments (a voided one left out). The desk asks for
 * it on a client's record and the client on their statement page; Adminium
 * draws it with the Invoices & Receipts add-on.
 */
import { l } from "./labels.ts";

/** The client's slots, for a document on a table that points at the client. */
const CLIENT_SLOTS = {
  customerName: { via: "client_id", column: "company" },
  customerContact: { via: "client_id", column: "contact_name" },
  customerEmail: { via: "client_id", column: "email" },
  customerLines: { via: "client_id", column: "address" },
  customerTaxNumber: { via: "client_id", column: "tax_number" },
};

export const DOCUMENTS = [
  { kind: "quote", addOn: "invoices", table: "proposals", name: l("Proposal"), mapping: CLIENT_SLOTS },
  { kind: "invoice", addOn: "invoices", table: "invoices", name: l("Invoice"), mapping: CLIENT_SLOTS },
  { kind: "receipt", addOn: "invoices", table: "payments", name: l("Receipt"), mapping: CLIENT_SLOTS },
  {
    kind: "statement",
    addOn: "invoices",
    table: "clients",
    name: l("Statement"),
    mapping: {
      customerName: { column: "company" },
      customerContact: { column: "contact_name" },
      customerEmail: { column: "email" },
      customerLines: { column: "address" },
      customerTaxNumber: { column: "tax_number" },
    },
    statement: {
      documents: { table: "invoices", via: "client_id", date: "issued_on", amount: "total", number: "number", where: { column: "status", in: ["sent"] } },
      payments: { table: "payments", via: "client_id", date: "paid_on", amount: "amount", number: "number", unless: "voided" },
    },
  },
];
