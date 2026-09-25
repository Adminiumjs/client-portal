/**
 * The add-on's own document for a row the desk can read.
 *
 * The desk's reads answer where it is (`documentUrl`): Adminium draws it
 * (`POST /api/v1/apps/:key/documents/render`, the kind and the row named the
 * way the app names them) and answers the HTML copy made for printing and the
 * PDF; the demo opens the copy the add-on drew at build time (HTML only). The
 * printed copy shows that copy, exactly as the client receives it.
 *
 * Where the reads cannot answer (no `documentUrl`, or null for this row), the
 * printed copy draws the document itself from the stored rows.
 */
import type { DeskReads, DocumentLink } from "../../data/ports.ts";
import { deskReads } from "../../state/desk.ts";
import type { PrintTarget } from "./target.ts";
import { REF_OF } from "./target.ts";

export type { DocumentLink } from "../../data/ports.ts";

export type DocumentPort = (target: PrintTarget, locale: string) => Promise<DocumentLink | null>;

/** The desk reads' document call, when they have one. */
export function documentPort(reads: DeskReads = deskReads()): DocumentPort | null {
  const call = reads.documentUrl;
  if (typeof call !== "function") return null;
  return (target, locale) => call.call(reads, target.kind, REF_OF[target.kind], target.id, locale, target.kind === "statement" ? target.period : undefined);
}

/** Languages the add-on's PDF can draw; the others print from the browser. */
export const PDF_LANGUAGES = ["en", "de", "fr", "cs", "da"];
export const pdfDraws = (locale: string): boolean => PDF_LANGUAGES.includes(locale.slice(0, 2));
