/**
 * The enquiries inbox, worked out from the rows: its filters and their
 * counts, the next one still unanswered, and which reply the studio starts
 * from for an enquiry's fit.
 */
import type { StatusWord } from "../../components/ui.tsx";
import type { Enquiry, EnquiryStatus, Id } from "../../data/types.ts";

/** The inbox's filters: "Parked" is parked only; a polite no has its own. */
export const ENQUIRY_FILTERS = ["all", "new", "replied", "proposal", "parked", "declined"] as const;
export type EnquiryFilter = (typeof ENQUIRY_FILTERS)[number];

export const inEnquiryFilter = (e: Enquiry, filter: EnquiryFilter): boolean => filter === "all" || e.status === filter;

/** Newest first. */
export const byReceived = (a: Enquiry, b: Enquiry): number => (b.received_at ?? "").localeCompare(a.received_at ?? "") || b.id - a.id;

/** The word an enquiry's pill says. */
export const ENQUIRY_WORD: Readonly<Record<EnquiryStatus, StatusWord>> = { new: "new", replied: "replied", parked: "parked", proposal: "toProposal", declined: "declined" };

/**
 * The unanswered enquiry to open next: the newest one that is not open now,
 * else the open one itself; null when nothing is unanswered.
 */
export function nextUnanswered(list: readonly Enquiry[], openId: Id | null): Enquiry | null {
  const unanswered = [...list].filter((e) => e.status === "new").sort(byReceived);
  return unanswered.find((e) => e.id !== openId) ?? unanswered[0] ?? null;
}

/** Which reply the studio starts from: a warm yes, a question first, or a polite no. */
export const replyFor = (e: Enquiry): "good" | "maybe" | "no" => (e.fit === "no" ? "no" : e.fit === "good" ? "good" : "maybe");

/** The first name a reply greets. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

/** An enquiry's one-line summary: trade, budget, where it came from — whichever it has. */
export const summary = (e: Enquiry): string => [e.trade, e.budget, e.source].filter((x): x is string => x !== null && x.trim() !== "").join(" · ");

/**
 * "Log a call", filled from outside the page (the website demo's "A call
 * comes in"): the fields the call form has, as given; anything else (a phone
 * number — an enquiry keeps none) is left out.
 */
export function callDraft(fill: Readonly<Record<string, string>>): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const key of ["business", "name", "email", "body"] as const) if (fill[key] !== undefined) draft[key] = fill[key];
  return draft;
}
