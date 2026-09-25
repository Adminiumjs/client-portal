/**
 * What the composer holds while a proposal or an invoice is being written,
 * and how that becomes the draft `actions.ts` saves.
 *
 * The form keeps every field AS TYPED (a quantity of "1,5" stays "1,5" until
 * it is saved); the checks the design draws — a red hint per line, Send off
 * until at least one line is good — are worked out from it here, and the
 * save turns each typed amount into the decimal Adminium stores.
 */
import type { ClientInput, InvoiceDraft, LineInput, ProposalDraft } from "../../state/actions.ts";
import type { Client, ClientTerms, Day, Enquiry, Id, Invoice, InvoiceLine, Proposal, ProposalLine, ProposalSplit } from "../../data/types.ts";
import { addDays } from "../../data/venueTime.ts";
import { moreThan, readAmount, times } from "./figures.ts";

/** A proposal's default life: three weeks from the day it is written. */
export const VALID_DAYS = 21;

/** Days each invoice term gives the client to pay. */
export const TERM_DAYS: Readonly<Record<ClientTerms, number>> = { net7: 7, net14: 14, net30: 30, "on-receipt": 0 };
export const TERMS: readonly ClientTerms[] = ["net7", "net14", "net30", "on-receipt"];
export const SPLITS: readonly ProposalSplit[] = ["5050", "403030", "end"];

export interface LineForm {
  /** A key for the list (a saved line's id, or a made-up one). */
  key: string;
  /** The saved line this is (editing a draft). */
  id?: Id;
  description: string;
  qty: string;
  rate: string;
  discount: string;
}

export interface ComposerForm {
  kind: "proposal" | "invoice";
  /** The draft being edited; null until the first save. */
  id: Id | null;
  number: string | null;
  /** The client on file; null for a new client made from an enquiry (`newClient`) or none chosen yet. */
  clientId: Id | null;
  newClient: ClientInput | null;
  enquiryId: Id | null;
  title: string;
  scope: string[];
  split: ProposalSplit;
  validUntil: Day | null;
  termsVersionId: Id | null;
  revisionOf: Id | null;
  projectId: Id | null;
  /** The terms picked in the composer; null keeps what the invoice has (or Adminium's default). */
  terms: ClientTerms | null;
  lines: LineForm[];
}

let lineNo = 0;
export const blankLine = (): LineForm => ({ key: `new-${String(++lineNo)}`, description: "", qty: "1", rate: "", discount: "" });

/** A stored decimal as a person would type it back ("1.00" → "1", "250.50" → "250.50"). */
const typedBack = (value: string | null): string => (value === null ? "" : value.replace(/\.0+$/, ""));

const lineForm = (line: ProposalLine | InvoiceLine): LineForm => ({
  key: `line-${String(line.id)}`,
  id: line.id,
  description: line.description ?? "",
  qty: typedBack(line.qty),
  rate: typedBack(line.rate),
  discount: line.discount === null || Number(line.discount) === 0 ? "" : typedBack(line.discount),
});

/** Scope paragraphs, as the proposal stores them: blank-line separated. */
export const scopeParagraphs = (scope: string | null): string[] => {
  const parts = (scope ?? "").split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p !== "");
  return parts.length === 0 ? [""] : parts;
};
export const joinScope = (paragraphs: readonly string[]): string | null => {
  const kept = paragraphs.map((p) => p.trim()).filter((p) => p !== "");
  return kept.length === 0 ? null : kept.join("\n\n");
};

const base = (kind: ComposerForm["kind"]): ComposerForm => ({
  kind,
  id: null,
  number: null,
  clientId: null,
  newClient: null,
  enquiryId: null,
  title: "",
  scope: [""],
  split: "5050",
  validUntil: null,
  termsVersionId: null,
  revisionOf: null,
  projectId: null,
  terms: null,
  lines: [blankLine()],
});

/** A new proposal: valid three weeks from today, paid 50 / 50, on the terms in force. */
export function newProposalForm(today: Day, opts: { clientId?: Id | null; termsVersionId: Id | null }): ComposerForm {
  return { ...base("proposal"), clientId: opts.clientId ?? null, validUntil: addDays(today, VALID_DAYS), termsVersionId: opts.termsVersionId };
}

/**
 * A new proposal started from an enquiry: the enquiry's words are the first
 * paragraph of scope, and its sender becomes the client on the first save —
 * the client already on file with that address, or a new one.
 */
export function enquiryProposalForm(enquiry: Enquiry, today: Day, opts: { existing: Client | null; termsVersionId: Id | null; title: string }): ComposerForm {
  const newClient: ClientInput | null =
    opts.existing === null ? { company: (enquiry.business ?? enquiry.name).trim(), contact_name: enquiry.name.trim(), email: (enquiry.email ?? "").trim(), trade: enquiry.trade } : null;
  return {
    ...newProposalForm(today, { clientId: opts.existing?.id ?? null, termsVersionId: opts.termsVersionId }),
    newClient,
    enquiryId: enquiry.id,
    title: opts.title,
    scope: scopeParagraphs(enquiry.body),
  };
}

/**
 * A saved proposal draft, to go on writing. A revision copied from an
 * out-of-date proposal carries a day already past: it starts again at three
 * weeks from today (saved only when the studio saves).
 */
export function proposalForm(proposal: Proposal, lines: readonly ProposalLine[], today: Day): ComposerForm {
  const ordered = [...lines].sort((a, b) => a.position - b.position);
  return {
    ...base("proposal"),
    id: proposal.id,
    number: proposal.number,
    clientId: proposal.client_id,
    title: proposal.title,
    scope: scopeParagraphs(proposal.scope),
    split: proposal.split,
    validUntil: proposal.valid_until === null || proposal.valid_until < today ? addDays(today, VALID_DAYS) : proposal.valid_until,
    termsVersionId: proposal.terms_version_id,
    revisionOf: proposal.revision_of,
    lines: ordered.length === 0 ? [blankLine()] : ordered.map(lineForm),
  };
}

/** A new invoice (no number until Adminium gives it one). */
export function newInvoiceForm(opts: { clientId?: Id | null; projectId?: Id | null }): ComposerForm {
  return { ...base("invoice"), clientId: opts.clientId ?? null, projectId: opts.projectId ?? null };
}

/** A saved invoice draft, to go on writing. */
export function invoiceForm(invoice: Invoice, lines: readonly InvoiceLine[]): ComposerForm {
  const ordered = [...lines].sort((a, b) => a.position - b.position);
  return {
    ...base("invoice"),
    id: invoice.id,
    number: invoice.number,
    clientId: invoice.client_id,
    title: invoice.title ?? "",
    projectId: invoice.project_id,
    lines: ordered.length === 0 ? [blankLine()] : ordered.map(lineForm),
  };
}

// ── the checks the design draws ─────────────────────────────────────────────

export type LineProblem = "description" | "qty" | "rate" | "discountNegative" | "discountOver";

/** Whether a line has anything typed in it (an untouched line is not a line). */
export const hasContent = (line: LineForm): boolean => line.description.trim() !== "" || line.rate.trim() !== "" || line.discount.trim() !== "";

/** What is wrong with a line, the first thing only; null for a good or an untouched one. */
export function lineProblem(line: LineForm): LineProblem | null {
  if (!hasContent(line)) return null;
  if (line.description.trim() === "") return "description";
  const qty = readAmount(line.qty);
  if (qty === null || !moreThan(qty, "0")) return "qty";
  const rate = readAmount(line.rate);
  if (rate === null || !moreThan(rate, "0")) return "rate";
  if (line.discount.trim() === "") return null;
  const discount = readAmount(line.discount);
  if (discount === null || moreThan("0", discount)) return "discountNegative";
  // More than the whole line (quantity × rate, unrounded).
  if (moreThan(discount, times(qty, rate))) return "discountOver";
  return null;
}

export type SendBlock = "noGoodLine" | "problems";

/** Why Send is off (a line marked in red, or no line worth sending), or null. */
export function sendBlock(form: ComposerForm): SendBlock | null {
  const problems = form.lines.map(lineProblem);
  if (problems.some((p) => p !== null)) return "problems";
  const good = form.lines.filter((l, i) => problems[i] === null && l.description.trim() !== "" && hasContent(l)).length;
  return good === 0 ? "noGoodLine" : null;
}

// ── the draft actions.ts saves ──────────────────────────────────────────────

/** The lines worth saving, each amount as the decimal Adminium stores (or as typed, for Adminium to refuse). */
export function lineInputs(lines: readonly LineForm[]): LineInput[] {
  return lines.filter(hasContent).map((l) => {
    const discount = l.discount.trim() === "" ? null : (readAmount(l.discount) ?? l.discount.trim());
    return {
      ...(l.id === undefined ? {} : { id: l.id }),
      description: l.description,
      qty: readAmount(l.qty) ?? (l.qty.trim() === "" ? "1" : l.qty.trim()),
      rate: readAmount(l.rate) ?? l.rate.trim(),
      discount,
    };
  });
}

/** The proposal draft to save; null while it has no client. */
export function toProposalDraft(form: ComposerForm): ProposalDraft | null {
  const client = form.clientId !== null ? { id: form.clientId } : form.newClient !== null ? { new: form.newClient } : null;
  if (client === null) return null;
  return {
    id: form.id,
    client,
    title: form.title,
    scope: joinScope(form.scope),
    split: form.split,
    valid_until: form.validUntil,
    terms_version_id: form.termsVersionId,
    revision_of: form.revisionOf,
    lines: lineInputs(form.lines),
    // The enquiry moves on the proposal's first save only.
    enquiryId: form.id === null ? form.enquiryId : null,
  };
}

/** The invoice draft to save; null while it has no client. */
export function toInvoiceDraft(form: ComposerForm): InvoiceDraft | null {
  if (form.clientId === null) return null;
  return {
    id: form.id,
    client_id: form.clientId,
    project_id: form.projectId,
    title: form.title,
    ...(form.terms === null ? {} : { terms: form.terms }),
    lines: lineInputs(form.lines),
  };
}

/** A saved proposal draft, as it stands, for a Send that changes nothing in it. */
export function storedProposalDraft(proposal: Proposal, lines: readonly ProposalLine[]): ProposalDraft {
  return {
    id: proposal.id,
    client: { id: proposal.client_id },
    title: proposal.title,
    scope: proposal.scope,
    split: proposal.split,
    valid_until: proposal.valid_until,
    terms_version_id: proposal.terms_version_id,
    revision_of: proposal.revision_of,
    lines: [...lines]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ id: l.id, description: l.description ?? "", qty: l.qty, rate: l.rate ?? "", discount: l.discount })),
    enquiryId: null,
  };
}
