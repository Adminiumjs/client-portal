/**
 * What the Invoices & Receipts add-on is handed to draw one of the studio's
 * documents — built from the demo's rows exactly as Adminium builds it
 * (`documents/subject.ts`): the add-on's own shape profiles map the columns
 * (`invoice` → invoices + lines + payments, `receipt` → a payment and its
 * invoice, `quote` → a proposal + its lines), and the client's name, contact,
 * address, email and tax number fill the customer slots (the app's manifest
 * maps the same five through `client_id`). Money goes as integer minor
 * units of the document's currency, a rate as basis points, a date as the
 * studio's day.
 *
 * The demo cannot run the add-on in the browser, so `prerender.ts` draws
 * these at build time, from a pinned checkout of the add-on, in every
 * language; `printed.test.ts` draws them again and fails when a copy drifts.
 *
 * DEMO BUILD ONLY.
 */
import { currencyScale } from "../data/sampleRows.ts";
import type { TableRef } from "../data/types.ts";
import type { Row, Rows } from "./engine.ts";

export type PrintedKind = "invoice" | "receipt" | "quote";

/** The printed copies the demo carries: the documents of the clients the card signs in as. */
export const PRINTED_CLIENTS = ["Hearth & Loaf", "Marigold Lane", "Northlight Records"] as const;

/** A copy's name: its kind and the row's number, as the add-on names the file. */
export const printedName = (kind: PrintedKind, number: string) => `${kind}-${number.replace(/[^A-Za-z0-9._-]+/g, "-")}`;

type SlotType = "money" | "percent" | "number" | "text" | "text[]" | "date" | "email" | "currency" | "collection";

/** The add-on's slots per kind, as its outline declares them (`describe(kind)`); what the demo maps. */
const SLOTS: Record<PrintedKind, Record<string, SlotType>> = {
  invoice: {
    number: "text",
    issuedAt: "date",
    customerName: "text",
    customerLines: "text[]",
    customerEmail: "email",
    customerContact: "text",
    customerTaxNumber: "text",
    currency: "currency",
    title: "text",
    terms: "text",
    taxName: "text",
    taxRate: "percent",
    dueAt: "date",
    subtotal: "money",
    tax: "money",
    total: "money",
    paid: "money",
    balance: "money",
    status: "text",
    voidedOn: "date",
  },
  receipt: {
    number: "text",
    issuedAt: "date",
    customerName: "text",
    customerLines: "text[]",
    customerEmail: "email",
    customerContact: "text",
    customerTaxNumber: "text",
    currency: "currency",
    amount: "money",
    paidWith: "text",
    invoiceNumber: "text",
    invoiceTotal: "money",
    balanceAfter: "money",
    voided: "text",
    voidedOn: "date",
  },
  quote: {
    number: "text",
    issuedAt: "date",
    customerName: "text",
    customerLines: "text[]",
    customerEmail: "email",
    customerContact: "text",
    customerTaxNumber: "text",
    currency: "currency",
    title: "text",
    taxName: "text",
    taxRate: "percent",
    subtotal: "money",
    tax: "money",
    total: "money",
    status: "text",
    sentOn: "date",
    validUntil: "date",
    scope: "text[]",
    signedName: "text",
    signedOn: "date",
    termsVersion: "text",
    fingerprint: "text",
  },
};

/** The shape profiles' columns, and the client's slots, for each kind. */
const MAPPING: Record<PrintedKind, Record<string, (row: Row, rows: Rows) => unknown>> = {
  invoice: {
    number: (r) => r["number"],
    issuedAt: (r) => r["issued_on"],
    dueAt: (r) => r["due_on"],
    terms: (r) => r["terms"],
    currency: (r) => r["currency"],
    title: (r) => r["title"],
    taxName: (r) => r["tax_name"],
    taxRate: (r) => r["tax_rate"],
    subtotal: (r) => r["subtotal"],
    tax: (r) => r["tax"],
    total: (r) => r["total"],
    paid: (r) => r["paid"],
    balance: (r) => r["balance"],
    status: (r) => r["status"],
    voidedOn: (r) => r["voided_at"],
  },
  receipt: {
    number: (r) => r["number"],
    issuedAt: (r) => r["paid_on"],
    currency: (r) => r["currency"],
    amount: (r) => r["amount"],
    paidWith: (r) => r["method"],
    invoiceNumber: (r, rows) => invoiceOf(r, rows)?.["number"],
    invoiceTotal: (r, rows) => invoiceOf(r, rows)?.["total"],
    balanceAfter: (r, rows) => balanceAfter(r, rows),
    voided: (r) => r["voided"],
    voidedOn: (r) => r["voided_at"],
  },
  quote: {
    number: (r) => r["number"],
    issuedAt: (r) => r["sent_at"],
    sentOn: (r) => r["sent_at"],
    validUntil: (r) => r["valid_until"],
    currency: (r) => r["currency"],
    title: (r) => r["title"],
    taxName: (r) => r["tax_name"],
    taxRate: (r) => r["tax_rate"],
    subtotal: (r) => r["subtotal"],
    tax: (r) => r["tax"],
    total: (r) => r["total"],
    status: (r) => r["status"],
    scope: (r) => r["scope"],
    signedName: (r) => r["signed_name"],
    signedOn: (r) => r["signed_at"],
    termsVersion: (r, rows) => rows.terms_versions.find((t) => String(t.id) === String(r["terms_version_id"]))?.["version"],
    fingerprint: (r) => r["fingerprint"],
  },
};

const CUSTOMER: Record<string, (client: Row) => unknown> = {
  customerName: (c) => c["company"],
  customerContact: (c) => c["contact_name"],
  customerEmail: (c) => c["email"],
  customerLines: (c) => c["address"],
  customerTaxNumber: (c) => c["tax_number"],
};

const invoiceOf = (payment: Row, rows: Rows) => rows.invoices.find((i) => String(i.id) === String(payment["document_id"]));

/** What was left to pay on the invoice once this payment was in: the payments up to it, in the order they were paid. */
function balanceAfter(payment: Row, rows: Rows): unknown {
  const invoice = invoiceOf(payment, rows);
  if (invoice === undefined) return null;
  const places = currencyScale(invoice["currency"]);
  const units = (v: unknown) => Math.round(Number(v ?? 0) * 10 ** places);
  const upTo = rows.payments
    .filter((p) => String(p["document_id"]) === String(invoice.id) && p["voided"] !== true)
    .filter((p) => String(p["paid_on"]) < String(payment["paid_on"]) || (String(p["paid_on"]) === String(payment["paid_on"]) && Number(p.id) <= Number(payment.id)));
  const left = units(invoice["total"]) - upTo.reduce((sum, p) => sum + units(p["amount"]), 0);
  return (left / 10 ** places).toFixed(places);
}

// ── Adminium's coercion to the wire law ─────────────────────────────────────

const DECIMAL = /^([+−-]?)(\d*)(?:[.,](\d*))?$/;

export function toMinorUnits(value: unknown, scale = 2): number | null {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "string" ? value : String(value);
  const match = DECIMAL.exec(text.trim().replace(/[\s_']/g, ""));
  if (match === null) return null;
  const [, sign, whole = "", frac = ""] = match;
  if (whole === "" && frac === "") return null;
  const digits = (frac + "0".repeat(scale + 1)).slice(0, scale + 1);
  const minor = Number(whole === "" ? "0" : whole) * 10 ** scale + (scale === 0 ? 0 : Number(digits.slice(0, scale))) + (Number(digits[scale]) >= 5 ? 1 : 0);
  if (!Number.isFinite(minor)) return null;
  return sign === "-" || sign === "−" ? -minor : minor;
}

const toText = (value: unknown): string => (value === null || value === undefined ? "" : typeof value === "object" ? "" : String(value));

function dayIn(at: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

const INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)$/i;

function toDate(value: unknown, zone: string): string {
  const text = toText(value);
  if (INSTANT.test(text.trim())) {
    const at = new Date(text.trim().replace(" ", "T"));
    if (!Number.isNaN(at.getTime())) return dayIn(at, zone);
  }
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : text;
}

function coerce(type: SlotType, value: unknown, scale: number, zone: string): unknown {
  switch (type) {
    case "money":
      return toMinorUnits(value, scale);
    case "percent":
      return toMinorUnits(value);
    case "number": {
      const n = typeof value === "number" ? value : Number(toText(value));
      return Number.isFinite(n) ? n : null;
    }
    case "text[]":
      return toText(value) === "" ? [] : toText(value).split("\n").filter((line) => line !== "");
    case "date":
      return toDate(value, zone);
    default:
      return toText(value);
  }
}

// ── the subject ─────────────────────────────────────────────────────────────

export interface PrintedInput {
  kind: PrintedKind;
  subject: {
    now: { iso: string; timezone: string };
    locale: string;
    currency: string;
    business: { name: string; lines: readonly string[] };
    entity: { connectionId: string; table: string; pk: Record<string, unknown>; label: string } | null;
    number: string | null;
    fields: Record<string, unknown>;
    collections: Record<string, readonly Record<string, unknown>[]>;
  };
  formats: readonly ["html"];
  paper: "a4" | "letter" | "receipt-80mm";
  settings: Readonly<Record<string, unknown>>;
}

const TABLE: Record<PrintedKind, TableRef> = { invoice: "invoices", receipt: "payments", quote: "proposals" };

export function printedInput(kind: PrintedKind, row: Row, rows: Rows, opts: { locale: string; zone: string; now: number; currency: string; settings: Readonly<Record<string, unknown>> }): PrintedInput {
  const currency = String(row["currency"] ?? opts.currency);
  const scale = currencyScale(currency);
  const fields: Record<string, unknown> = {};
  const client = rows.clients.find((c) => String(c.id) === String(row["client_id"]));
  for (const [slot, type] of Object.entries(SLOTS[kind])) {
    const read = MAPPING[kind][slot] ?? (client === undefined ? undefined : (r: Row) => CUSTOMER[slot]?.(client) ?? (void r, undefined));
    if (read === undefined) continue;
    const value = coerce(type, read(row, rows), scale, opts.zone);
    if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    fields[slot] = value;
  }
  const collections: Record<string, Record<string, unknown>[]> = {};
  if (kind === "invoice" || kind === "quote") {
    const lines = (kind === "invoice" ? rows.invoice_lines : rows.proposal_lines)
      .filter((line) => String(line["document_id"]) === String(row.id))
      .sort((a, b) => Number(a["position"] ?? 0) - Number(b["position"] ?? 0) || Number(a.id) - Number(b.id));
    collections["items"] = lines.map((line) => ({
      id: String(line.id),
      desc: toText(line["description"]),
      qty: coerce("number", line["qty"], scale, opts.zone),
      rate: coerce("money", line["rate"], scale, opts.zone),
      discount: coerce("number", line["discount"], scale, opts.zone),
      discountKind: toText(line["discount_kind"]),
      amount: coerce("money", line["amount"], scale, opts.zone),
      ...(kind === "invoice" ? { share: coerce("number", line["share_pct"], scale, opts.zone) } : {}),
    }));
  }
  if (kind === "invoice") {
    collections["payments"] = rows.payments
      .filter((p) => String(p["document_id"]) === String(row.id))
      .sort((a, b) => String(a["paid_on"]).localeCompare(String(b["paid_on"])) || Number(a.id) - Number(b.id))
      .map((p) => ({
        id: String(p.id),
        number: toText(p["number"]),
        paidOn: coerce("date", p["paid_on"], scale, opts.zone),
        method: toText(p["method"]),
        amount: coerce("money", p["amount"], scale, opts.zone),
        voided: toText(p["voided"]),
      }));
  }
  const setting = (name: string) => opts.settings[`invoices.${name}`];
  return {
    kind,
    subject: {
      now: { iso: new Date(opts.now).toISOString(), timezone: opts.zone },
      locale: opts.locale,
      currency,
      business: { name: String(setting("business_name") ?? ""), lines: (setting("business_lines") as string[] | undefined) ?? [] },
      entity: { connectionId: "demo", table: TABLE[kind], pk: { id: row.id }, label: toText(row["number"]) },
      number: toText(row["number"]) === "" ? null : toText(row["number"]),
      fields,
      collections,
    },
    formats: ["html"],
    paper: kind === "receipt" ? "a4" : "letter",
    settings: Object.fromEntries(Object.entries(opts.settings).filter(([key]) => key.startsWith("invoices.")).map(([key, value]) => [key.slice("invoices.".length), value])),
  };
}

/** The rows the demo carries a printed copy of, per kind. */
export function printedRows(rows: Rows): { kind: PrintedKind; row: Row }[] {
  const clients = new Set(rows.clients.filter((c) => (PRINTED_CLIENTS as readonly string[]).includes(String(c["company"]))).map((c) => String(c.id)));
  const out: { kind: PrintedKind; row: Row }[] = [];
  for (const row of rows.invoices) if (clients.has(String(row["client_id"])) && row["status"] !== "draft") out.push({ kind: "invoice", row });
  for (const row of rows.payments) if (clients.has(String(row["client_id"])) && row["voided"] !== true) out.push({ kind: "receipt", row });
  for (const row of rows.proposals) if (clients.has(String(row["client_id"])) && row["status"] !== "draft") out.push({ kind: "quote", row });
  return out;
}
