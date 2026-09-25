/**
 * What the Settings screen decides before it saves: the studio card's
 * changes and their checks, the notice switches, how the studio signs off,
 * the rate card's hourly line, and the Invoices & Receipts card — the add-on's
 * own settings, read and written as the add-on declares them.
 *
 * Nothing here computes a stored figure. The hourly line and the "next"
 * numbers are labels drawn from stored values; what is saved is only what the
 * person typed, and only what changed.
 */
import type { ClientTerms, Decimal, Person, Settings } from "../../data/types.ts";
import { decimalValue } from "../../lib/money.ts";

// ── the studio card ─────────────────────────────────────────────────────────

/** The studio card's fields, as typed. */
export const STUDIO_FIELDS = ["name", "reply_to", "phone", "website", "hours_per_day"] as const;
export type StudioField = (typeof STUDIO_FIELDS)[number];
export type StudioDraft = Partial<Record<StudioField, string>>;

/** A stored value as the field shows it. */
export function studioValue(settings: Settings | null, field: StudioField): string {
  const value = settings?.[field];
  return value === null || value === undefined ? "" : String(value);
}

export type StudioError = "nameMissing" | "replyTo" | "hours";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is wrong with the studio card as typed, by field. */
export function studioErrors(settings: Settings | null, draft: StudioDraft): Partial<Record<StudioField, StudioError>> {
  const value = (field: StudioField) => (draft[field] ?? studioValue(settings, field)).trim();
  const errors: Partial<Record<StudioField, StudioError>> = {};
  if (value("name") === "") errors.name = "nameMissing";
  if (value("reply_to") !== "" && !EMAIL.test(value("reply_to"))) errors.reply_to = "replyTo";
  const hours = value("hours_per_day");
  if (!/^\d{1,2}$/.test(hours) || Number(hours) < 1 || Number(hours) > 24) errors.hours_per_day = "hours";
  return errors;
}

/** The studio card's changes as a patch: only what differs from what is stored. */
export function studioPatch(settings: Settings | null, draft: StudioDraft): Partial<Settings> {
  const patch: Record<string, unknown> = {};
  for (const field of STUDIO_FIELDS) {
    const typed = draft[field];
    if (typed === undefined || typed.trim() === studioValue(settings, field)) continue;
    patch[field] = field === "hours_per_day" ? Number(typed.trim()) : typed.trim() === "" ? null : typed.trim();
  }
  return patch as Partial<Settings>;
}

// ── the notice switches ─────────────────────────────────────────────────────

/**
 * The notices the studio is emailed, in the order the card lists them. A new
 * enquiry's notice waits for the public enquiry form, so its switch is not
 * offered yet.
 */
export const NOTICES = ["notify_accepted", "notify_declined", "notify_files", "notify_paid", "notify_brief", "notify_new_price", "notify_notes"] as const;
export type Notice = (typeof NOTICES)[number];
export type NoticeDraft = Partial<Record<Notice, boolean>>;

export function noticesPatch(settings: Settings | null, draft: NoticeDraft): Partial<Settings> {
  const patch: Partial<Record<Notice, boolean>> = {};
  for (const notice of NOTICES) {
    const typed = draft[notice];
    if (typed !== undefined && typed !== (settings?.[notice] ?? false)) patch[notice] = typed;
  }
  return patch;
}

// ── signing off ─────────────────────────────────────────────────────────────

/** First names, from the people who talk to clients (else everyone). */
function firstNames(people: readonly Person[]): string[] {
  const sorted = [...people].sort((a, b) => a.position - b.position);
  const shown = sorted.filter((p) => p.shown_to_clients);
  return (shown.length > 0 ? shown : sorted).map((p) => p.name.trim().split(/\s+/)[0] ?? p.name).filter((n) => n !== "");
}

/**
 * How the studio can sign its emails off: each person's first name, then all
 * of them together in the page's language — and what is stored now, when it
 * is none of those, so the choice never loses it.
 */
export function signOffOptions(people: readonly Person[], stored: string | null, locale: string): string[] {
  const names = firstNames(people);
  const options = [...names];
  if (names.length > 1) options.push(new Intl.ListFormat(locale, { type: "conjunction" }).format(names));
  if (stored !== null && stored.trim() !== "" && !options.includes(stored)) options.unshift(stored);
  return options;
}

// ── the rate card ───────────────────────────────────────────────────────────

/**
 * The internal hourly rate the card shows: the first rate (a day's work) over
 * the hours in a working day. A label only — never saved, never on a
 * document.
 */
export function hourlyRate(firstRate: Decimal | null | undefined, hoursPerDay: number | null | undefined): number | null {
  const amount = decimalValue(firstRate);
  if (amount === null || hoursPerDay === null || hoursPerDay === undefined || hoursPerDay <= 0) return null;
  return Math.round((amount / hoursPerDay) * 100) / 100;
}

/** An amount as typed on the rate card: a positive decimal with at most two places, else null. */
export function rateAmount(typed: string): string | null {
  const text = typed.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) <= 0) return null;
  return Number(text).toFixed(2);
}

// ── Invoices & Receipts (the add-on's settings) ─────────────────────────────

export const LADDERS = ["gentle", "standard", "firm"] as const;
export type Ladder = (typeof LADDERS)[number];
export const TERMS: readonly ClientTerms[] = ["net7", "net14", "net30", "on-receipt"];

/** The add-on's default ladder days, as it declares them. */
const DEFAULT_LADDERS: Record<Ladder, [number, number, number]> = { gentle: [7, 21, 45], standard: [3, 14, 30], firm: [1, 7, 21] };

/** The card's fields, as typed. */
export interface InvoiceForm {
  business_name: string;
  /** One line each. */
  business_lines: string;
  tax_name: string;
  tax_number: string;
  default_tax_rate: string;
  payment_instructions: string;
  default_terms: ClientTerms;
  footer: string;
  show_payment_ledger: boolean;
  default_ladder: Ladder;
  ladders: Record<Ladder, [string, string, string]>;
}

const text = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);

function laddersOf(value: unknown): Record<Ladder, [number, number, number]> {
  const doc = value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out = { ...DEFAULT_LADDERS };
  for (const ladder of LADDERS) {
    const days = doc[ladder];
    if (Array.isArray(days) && days.length === 3 && days.every((d) => typeof d === "number")) out[ladder] = [days[0], days[1], days[2]] as [number, number, number];
  }
  return out;
}

/** The form, from the add-on's stored values. */
export function invoiceFormOf(values: Record<string, unknown>): InvoiceForm {
  const lines = Array.isArray(values["business_lines"]) ? (values["business_lines"] as unknown[]).map(text) : [];
  const ladders = laddersOf(values["ladders"]);
  return {
    business_name: text(values["business_name"]),
    business_lines: lines.join("\n"),
    tax_name: text(values["tax_name"]),
    tax_number: text(values["tax_number"]),
    default_tax_rate: text(values["default_tax_rate"]),
    payment_instructions: text(values["payment_instructions"]),
    default_terms: oneOf(values["default_terms"], TERMS, "net14"),
    footer: text(values["footer"]),
    show_payment_ledger: values["show_payment_ledger"] !== false,
    default_ladder: oneOf(values["default_ladder"], LADDERS, "standard"),
    ladders: Object.fromEntries(LADDERS.map((l) => [l, ladders[l].map(String)])) as InvoiceForm["ladders"],
  };
}

export type InvoiceError = "taxRate" | "ladderWhole" | "ladderOrder";
export type InvoiceErrors = Partial<Record<"default_tax_rate" | Ladder, InvoiceError>>;

/** What is wrong with the card as typed. */
export function invoiceErrors(form: InvoiceForm): InvoiceErrors {
  const errors: InvoiceErrors = {};
  const rate = form.default_tax_rate.trim();
  if (rate !== "" && (!/^\d{1,3}(\.\d{1,3})?$/.test(rate) || Number(rate) > 100)) errors.default_tax_rate = "taxRate";
  for (const ladder of LADDERS) {
    const days = form.ladders[ladder].map((d) => d.trim());
    if (!days.every((d) => /^\d{1,3}$/.test(d))) errors[ladder] = "ladderWhole";
    else if (!(Number(days[0]) < Number(days[1]) && Number(days[1]) < Number(days[2]))) errors[ladder] = "ladderOrder";
  }
  return errors;
}

/** The form as the add-on's values (every key the card edits). */
function valuesOf(form: InvoiceForm): Record<string, unknown> {
  return {
    business_name: form.business_name.trim(),
    business_lines: form.business_lines
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== ""),
    tax_name: form.tax_name.trim(),
    tax_number: form.tax_number.trim(),
    default_tax_rate: form.default_tax_rate.trim() === "" ? 0 : Number(form.default_tax_rate.trim()),
    payment_instructions: form.payment_instructions.trim(),
    default_terms: form.default_terms,
    footer: form.footer.trim(),
    show_payment_ledger: form.show_payment_ledger,
    default_ladder: form.default_ladder,
    ladders: Object.fromEntries(LADDERS.map((l) => [l, form.ladders[l].map((d) => Number(d.trim()))])),
  };
}

/**
 * What the card sends: only the settings that changed, and only those the
 * add-on declares — Adminium refuses a key it does not know, so a key the
 * installed version lacks is never sent.
 */
export function invoicePatch(stored: Record<string, unknown>, form: InvoiceForm, declared: readonly string[]): Record<string, unknown> {
  const before = valuesOf(invoiceFormOf(stored));
  const after = valuesOf(form);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (!declared.includes(key)) continue;
    if (JSON.stringify(value) !== JSON.stringify(before[key])) patch[key] = value;
  }
  return patch;
}

// ── the numbers ─────────────────────────────────────────────────────────────

/** The three numbered series, their add-on settings and their default prefix. */
export const SERIES = [
  { id: "invoices", table: "invoices", prefix: "prefix_invoice", start: "number_start_invoice", fallback: "INV-" },
  { id: "proposals", table: "proposals", prefix: "prefix_quote", start: "number_start_quote", fallback: "QUO-" },
  { id: "receipts", table: "payments", prefix: "prefix_receipt", start: "number_start_receipt", fallback: "REC-" },
] as const;
export type Series = (typeof SERIES)[number];

/** The number padding the add-on's shapes use. */
const PAD = 4;

/**
 * The next number a series gives, as a label: one after the last one given,
 * or the start when that is higher (the start only ever moves up). Sample
 * rows carry no number in the series and do not count.
 */
export function nextInSeries(lastSeq: number | null, start: unknown): number {
  const from = typeof start === "number" && Number.isInteger(start) && start > 0 ? start : 1;
  return Math.max(from, (lastSeq ?? 0) + 1);
}

export function formatNumber(prefix: unknown, seq: number, fallback: string): string {
  return `${typeof prefix === "string" && prefix !== "" ? prefix : fallback}${String(seq).padStart(PAD, "0")}`;
}

/** A new start as typed: a whole number above the next one, else null. */
export function newStart(typed: string, next: number): number | null {
  const t = typed.trim();
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return n > next ? n : null;
}

// ── the currency ────────────────────────────────────────────────────────────

/** A currency's sign in the page's language ("$", "€"), else its code. */
export function currencySymbol(code: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

/** The studio's currency as the card names it: "US dollar · $". */
export function currencyName(code: string, locale: string): string {
  let name = code;
  try {
    name = new Intl.DisplayNames(locale, { type: "currency" }).of(code) ?? code;
  } catch {
    // An engine without display names shows the code.
  }
  const symbol = currencySymbol(code, locale);
  return symbol === code ? name : `${name} · ${symbol}`;
}
