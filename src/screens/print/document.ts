/**
 * The add-on's own document for a row the desk can read.
 *
 * Adminium draws it (`POST /api/v1/apps/:key/documents/render`, the kind and
 * the row named the way the app names them) and answers where its bytes are
 * — the PDF, and the HTML copy made for printing. The printed copy shows that
 * copy, exactly as the client receives it.
 *
 * The desk's reads offer it as `document(...)`. Where they do not (a desk
 * read port without it, the demo), `documentPort()` answers null and the
 * printed copy draws the document itself from the stored rows.
 */
import type { DeskReads } from "../../data/ports.ts";
import type { Id } from "../../data/types.ts";
import { deskReads } from "../../state/desk.ts";
import type { PrintTarget, StatementPeriod } from "./target.ts";
import { REF_OF } from "./target.ts";

export interface DocumentRequest {
  kind: PrintTarget["kind"];
  ref: (typeof REF_OF)[keyof typeof REF_OF];
  pk: Id;
  locale: string;
  period?: StatementPeriod;
}

export interface DocumentLink {
  /** The PDF (or the document's own bytes). */
  contentUrl: string;
  /** The HTML copy, for printing. */
  printUrl: string;
}

export type DocumentPort = (request: DocumentRequest) => Promise<DocumentLink>;

/** The desk reads' document call, when they have one. */
export function documentPort(reads: DeskReads = deskReads()): DocumentPort | null {
  const call = (reads as DeskReads & { document?: DocumentPort }).document;
  return typeof call === "function" ? call.bind(reads) : null;
}

/** What to ask for, for a printed copy. */
export function requestFor(target: PrintTarget, locale: string): DocumentRequest {
  return {
    kind: target.kind,
    ref: REF_OF[target.kind],
    pk: target.id,
    locale,
    ...(target.kind === "statement" ? { period: target.period } : {}),
  };
}

/** Languages the add-on's PDF can draw; the others print from the browser. */
export const PDF_LANGUAGES = ["en", "de", "fr", "cs", "da"];
export const pdfDraws = (locale: string): boolean => PDF_LANGUAGES.includes(locale.slice(0, 2));
