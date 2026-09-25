/**
 * The enquiry form, as the page works it out: what a visitor typed, what is
 * wrong with it before anything is sent, what goes to the studio, and every
 * answer the studio's server can give put into words.
 *
 * The checks here only save a visitor a refused round trip — the server makes
 * every one of them again (and more: a new enquiry, from the web, numbered
 * and stamped by Adminium whatever a browser sends). They mirror the server's
 * own rules exactly, so a form that passes here is not then refused for a
 * reason the page could have said first.
 */
import type { MessageKey, TFunction } from "../../../i18n/index.tsx";
import type { EnquiryForm } from "../../../data/ports.ts";
import type { Outcome } from "../../../state/outcome.ts";

/** What the visitor types. Every value is the field's text, as typed. */
export interface EnquireInput {
  name: string;
  email: string;
  business: string;
  trade: string;
  /** One of `BUDGETS`, or "" for not sure. */
  budget: string;
  start_when: string;
  body: string;
}

export type EnquireField = keyof EnquireInput;

export const EMPTY: EnquireInput = { name: "", email: "", business: "", trade: "", budget: "", start_when: "", body: "" };

/** The order the fields are drawn in — the first with a problem takes the focus. */
export const FIELD_ORDER: readonly EnquireField[] = ["name", "email", "business", "trade", "budget", "start_when", "body"];

/**
 * The longest each field may be: the column's width, and for the name the
 * server's own limit on a stranger's plain text (80). What they write has no
 * column limit; the form stops at a long letter's length.
 */
export const MAX: Readonly<Record<Exclude<EnquireField, "budget">, number>> = {
  name: 80,
  email: 254,
  business: 160,
  trade: 80,
  start_when: 60,
  body: 4000,
};

/** The budget bands offered, by key; the chosen band's words are what is stored. */
export const BUDGETS = ["under1k", "1to2k", "2to4k", "4to8k", "8kplus"] as const;
export type Budget = (typeof BUDGETS)[number];

/** Each band's edges, in the studio's currency (no lower edge: "under"; no upper: "or more"). */
const BANDS: Readonly<Record<Budget, readonly [number | null, number | null]>> = {
  under1k: [null, 1000],
  "1to2k": [1000, 2000],
  "2to4k": [2000, 4000],
  "4to8k": [4000, 8000],
  "8kplus": [8000, null],
};

/** A band in words: "Under $1K", "$2K–$4K", "$8K or more" — the amounts as `amount` writes them. */
export function budgetWords(band: Budget, t: TFunction, amount: (n: number) => string): string {
  const [from, to] = BANDS[band];
  if (from === null) return t("enquire.budget.under", { amount: amount(to!) });
  if (to === null) return t("enquire.budget.over", { amount: amount(from) });
  return t("enquire.budget.between", { from: amount(from), to: amount(to) });
}

/** A round amount written short in the visitor's language and the studio's currency ("$2K", "2 Tsd. €"). */
export function shortMoney(locale: string, currency: string): (n: number) => string {
  try {
    const format = new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 0 });
    return (n) => format.format(n);
  } catch {
    const plain = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 0 });
    return (n) => plain.format(n);
  }
}

/** An address shape good enough to answer (Adminium checks it again). */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A name a stranger may give: letters, spaces and ordinary punctuation, at
 * most 80 characters, never a link — the same test Adminium applies to a
 * name sent with no sign-in.
 */
const PLAIN = /^[\p{L}\p{M} .,'’()&-]*$/u;
export function plainName(value: string): boolean {
  const lower = value.toLowerCase();
  return value.length <= MAX.name && PLAIN.test(value) && !lower.includes("://") && !lower.includes("www.");
}

export type Problem = { field: EnquireField; key: MessageKey };

/** Everything wrong with the form before it is sent, in the order the fields are drawn. */
export function formProblems(input: EnquireInput): Problem[] {
  const out: Problem[] = [];
  const name = input.name.trim();
  if (name === "") out.push({ field: "name", key: "enquire.error.nameEmpty" });
  else if (!plainName(name)) out.push({ field: "name", key: "enquire.error.namePlain" });
  const email = input.email.trim();
  if (email === "") out.push({ field: "email", key: "enquire.error.emailEmpty" });
  else if (!EMAIL.test(email) || email.length > MAX.email) out.push({ field: "email", key: "enquire.error.emailShape" });
  for (const field of ["business", "trade", "start_when"] as const) {
    if (input[field].trim().length > MAX[field]) out.push({ field, key: "enquire.error.tooLong" });
  }
  const body = input.body.trim();
  if (body === "") out.push({ field: "body", key: "enquire.error.bodyEmpty" });
  else if (body.length > MAX.body) out.push({ field: "body", key: "enquire.error.tooLong" });
  return out;
}

/**
 * What is sent: the form's own columns and nothing else. The budget goes as
 * the band's words in the visitor's language (as the desk stores a budget
 * said on the phone); an empty field goes as nothing.
 */
export function payloadOf(input: EnquireInput, budgetWords: (budget: Budget) => string): EnquiryForm {
  // A NUL byte (pasted from somewhere) is no one's words, and some databases refuse to store one.
  const clean = (value: string): string => value.replace(/\u0000/g, "").trim();
  const text = (value: string): string | null => (clean(value) === "" ? null : clean(value));
  const band = (BUDGETS as readonly string[]).includes(input.budget) ? budgetWords(input.budget as Budget) : null;
  return {
    name: clean(input.name),
    email: clean(input.email),
    body: clean(input.body),
    business: text(input.business),
    trade: text(input.trade),
    budget: band,
    start_when: text(input.start_when),
  };
}

/** What the page says of an answer that was not a yes: its words, the field they are about, and whether to offer the studio's address. */
export interface Refused {
  key: MessageKey;
  field: EnquireField | null;
  /** "Write to us instead": the studio's address is offered beside the words. */
  writeInstead: boolean;
  /** Said as a warning (try again later), not as a mistake in the form. */
  tone: "danger" | "warn";
}

const said = (key: MessageKey, tone: Refused["tone"], writeInstead: boolean, field: EnquireField | null = null): Refused => ({ key, field, writeInstead, tone });

/**
 * Every code the enquiry door can answer with, in words. A code not listed
 * (none the door sends today) falls to the general words, which still offer
 * the studio's address.
 */
export const REFUSAL_WORDS: Readonly<Record<string, Refused>> = {
  // The human check: the proof was missing, used, stale or wrong — twice, since the page retries once.
  PUBLIC_PROOF_REQUIRED: said("enquire.refused.check", "warn", true),
  // So many a day from one address, so many an hour through the page.
  PUBLIC_LIMIT_REACHED: said("enquire.refused.limit", "warn", true),
  // Too many requests from this connection in a minute.
  PUBLIC_RATE_LIMITED: said("enquire.refused.busy", "warn", false),
  // Nothing answered.
  PUBLIC_NETWORK_UNAVAILABLE: said("enquire.refused.offline", "warn", false),
  PUBLIC_UPSTREAM_UNAVAILABLE: said("enquire.refused.offline", "warn", false),
  // The install has no enquiry door, or the door takes no new enquiries.
  PUBLIC_REF_NOT_FOUND: said("enquire.refused.closed", "warn", true),
  PUBLIC_ACTION_NOT_ALLOWED: said("enquire.refused.closed", "warn", true),
  // The studio switched the page (or all of Adminium's public side) off.
  PUBLIC_API_DISABLED: said("enquire.refused.off", "warn", true),
  PUBLIC_SWITCHED_OFF: said("enquire.refused.off", "warn", true),
  PUBLIC_KEY_OFF: said("enquire.refused.off", "warn", true),
  APP_DISABLED: said("enquire.refused.off", "warn", true),
  SURFACE_OFF: said("enquire.refused.off", "warn", true),
  // This page's key or address is not one the server takes.
  PUBLIC_KEY_INVALID: said("enquire.refused.page", "danger", true),
  PUBLIC_ORIGIN_REFUSED: said("enquire.refused.page", "danger", true),
  // A value the server would not store (its column, when it names one, is worded below).
  PUBLIC_WRITE_REFUSED: said("enquire.refused.written", "danger", true),
  PUBLIC_WRITE_REJECTED: said("enquire.refused.written", "danger", true),
  // The form's own checks, when the page is bypassed.
  NAME_REQUIRED: said("enquire.error.nameEmpty", "danger", false, "name"),
  EMAIL_REQUIRED: said("enquire.error.emailShape", "danger", false, "email"),
  BODY_REQUIRED: said("enquire.error.bodyEmpty", "danger", false, "body"),
  // The studio's preview of the clients' side: only a visitor can send.
  PREVIEW: said("portal.previewBlocked", "warn", false),
};

/** A refused value the server named: the field it is, in words. */
const BY_COLUMN: Readonly<Partial<Record<EnquireField, MessageKey>>> = {
  name: "enquire.error.namePlain",
  email: "enquire.error.emailShape",
  body: "enquire.error.bodyEmpty",
};

export const OTHERWISE: Refused = said("enquire.refused.other", "danger", true);

/** An answer that was not a yes, in words. */
export function refusalWords(outcome: Outcome<unknown>): Refused | null {
  if (outcome.ok) return null;
  const known = REFUSAL_WORDS[outcome.code];
  const column = outcome.field ?? (typeof outcome.details["column"] === "string" ? outcome.details["column"] : null);
  if ((outcome.code === "PUBLIC_WRITE_REFUSED" || outcome.code === "PUBLIC_WRITE_REJECTED") && column !== null && (FIELD_ORDER as readonly string[]).includes(column)) {
    const field = column as EnquireField;
    return said(BY_COLUMN[field] ?? "enquire.refused.written", "danger", BY_COLUMN[field] === undefined, field);
  }
  if (known !== undefined) return known;
  if (outcome.reason === "offline") return REFUSAL_WORDS["PUBLIC_NETWORK_UNAVAILABLE"]!;
  if (outcome.reason === "busy") return REFUSAL_WORDS["PUBLIC_RATE_LIMITED"]!;
  if (outcome.reason === "preview") return REFUSAL_WORDS["PREVIEW"]!;
  return OTHERWISE;
}
