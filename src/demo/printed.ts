/**
 * The demo's printed copies, served as a page: the HTML the Invoices &
 * Receipts add-on drew at build time (`writePrinted.ts`), for the row and the
 * language asked, opened from memory. Each copy is its own chunk, fetched
 * only when it is opened.
 *
 * A document the demo has no copy of — one made during the visit, or of a
 * client the card never signs in as — answers null: the add-on runs on
 * Adminium's server, and the demo has none.
 *
 * DEMO BUILD ONLY.
 */
import type { DocumentKind } from "../data/ports.ts";
import type { TableRef } from "../data/types.ts";
import type { Row } from "./engine.ts";
import { printedName, type PrintedKind } from "./printedSubjects.ts";

const COPIES = import.meta.glob<string>("./printed/*/*.html", { query: "?raw", import: "default" });

const KIND_OF: Partial<Record<TableRef, PrintedKind>> = { invoices: "invoice", payments: "receipt", proposals: "quote" };

/** The copy's key: `./printed/<locale>/<kind>-<number>.html`, in the asked language or, failing it, English. */
export function printedKey(kind: DocumentKind, ref: TableRef, row: Row, locale: string): string | null {
  const own = KIND_OF[ref];
  if (own === undefined || own !== kind || typeof row["number"] !== "string") return null;
  const name = printedName(own, row["number"]);
  for (const tag of [locale, "en-US"]) {
    const key = `./printed/${tag}/${name}.html`;
    if (key in COPIES) return key;
  }
  return null;
}

/** The printed copy's HTML, or null when the demo has none. */
export async function printedHtml(kind: DocumentKind, ref: TableRef, row: Row, locale: string): Promise<string | null> {
  const key = printedKey(kind, ref, row, locale);
  return key === null ? null : await COPIES[key]!();
}

/** A page for the printed copy (a `blob:` address the screen can open), or null. */
export async function printedUrl(kind: DocumentKind, ref: TableRef, row: Row, locale: string): Promise<string | null> {
  const html = await printedHtml(kind, ref, row, locale);
  return html === null ? null : URL.createObjectURL(new Blob([html], { type: "text/html" }));
}
