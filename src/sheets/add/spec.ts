/**
 * The "add" sheet's kinds: what each asks, what it checks before saving, and
 * which action saves it.
 *
 *   invoice     a draft invoice and its first line (numbered by Adminium; the
 *               composer opens next for the rest)
 *   project     a project with no proposal, and its first milestone
 *   client      a client
 *   clientEdit  a client's address, tax number, terms and tax rate
 *   enquiry     a call logged as an unanswered enquiry
 *   milestone   a milestone on an open project (or one edited, or removed)
 *   person      someone on the studio's list (who clients see, who signs)
 *   rate        a line of the rate card (or one edited, or removed)
 *
 * Every save is an action (`state/actions.ts`); the sheet only checks what a
 * person would want told before a round trip, and Adminium decides the rest.
 */
import type { ClientTerms, Day, Id } from "../../data/types.ts";
import { addDays } from "../../data/venueTime.ts";
import type { MessageKey } from "../../i18n/messages/index.ts";
import { today } from "../../lib/clock.ts";
import type { AddKind, DeskSheet } from "../../state/sheets.ts";

export type AddAbout = Extract<DeskSheet, { kind: "add" }>["about"];
export type Values = Record<string, string | boolean>;
export type Errors = Record<string, MessageKey>;

const TERMS: readonly ClientTerms[] = ["net7", "net14", "net30", "on-receipt"];
/** A client's or an invoice's terms as the select holds them: one of the add-on's, or the studio's default. */
export const TERM_CHOICES = ["studio", ...TERMS] as const;
export type TermChoice = (typeof TERM_CHOICES)[number];

export const BUDGETS = ["2to4k", "under1k", "5to8k", "10kplus", "notStated"] as const;
export type Budget = (typeof BUDGETS)[number];

const s = (v: Values, k: string): string => {
  const value = v[k];
  return typeof value === "string" ? value.trim() : "";
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A positive decimal as typed, else null. */
export function positive(text: string, places: number): string | null {
  const t = text.replace(/,/g, "");
  const re = new RegExp(`^\\d+(\\.\\d{1,${String(places)}})?$`);
  return re.test(t) && Number(t) > 0 ? t : null;
}

/** Whether the sheet edits a row that exists (and so offers "Save", and maybe "Remove"). */
export function editing(what: AddKind, about: AddAbout): boolean {
  return (
    what === "clientEdit" ||
    (what === "milestone" && about?.milestoneId !== undefined) ||
    (what === "person" && about?.personId !== undefined) ||
    (what === "rate" && about?.rateId !== undefined)
  );
}

// ── what each kind starts with ──────────────────────────────────────────────

export interface Seed {
  clientId: Id | null;
  projectId: Id | null;
  /** The row being edited, as stored. */
  row?: Record<string, unknown> | null;
  /** The chosen client's own terms, if any. */
  clientTerms?: ClientTerms | null;
  /** The words a default first milestone is called, in the page's language. */
  firstMilestone: string;
}

const str = (value: unknown): string => (value === null || value === undefined ? "" : String(value));

export function defaults(what: AddKind, seed: Seed, day: Day = today()): Values {
  const row = seed.row ?? {};
  switch (what) {
    case "invoice":
      return { client: seed.clientId === null ? "" : String(seed.clientId), project: seed.projectId === null ? "" : String(seed.projectId), title: "", terms: seed.clientTerms ?? "studio", desc: "", qty: "1", rate: "" };
    case "project":
      return { client: seed.clientId === null ? "" : String(seed.clientId), name: "", milestone: seed.firstMilestone, due: addDays(day, 7) };
    case "client":
      return { company: "", trade: "", contact: "", email: "", address: "", tax_number: "" };
    case "clientEdit":
      return { address: str(row["address"]), tax_number: str(row["tax_number"]), terms: TERMS.includes(row["terms"] as ClientTerms) ? str(row["terms"]) : "studio", tax_rate: str(row["tax_rate"]) };
    case "enquiry":
      return { business: "", name: "", email: "", budget: "2to4k", body: "" };
    case "milestone":
      return seed.row === undefined || seed.row === null
        ? { project: seed.projectId === null ? "" : String(seed.projectId), title: "", due: addDays(day, 21) }
        : { project: str(row["project_id"]), title: str(row["title"]), due: str(row["due_on"]) };
    case "person":
      return { name: str(row["name"]), role_label: str(row["role_label"]), initials: str(row["initials"]), shown: row["shown_to_clients"] === true };
    case "rate":
      return { label: str(row["label"]), amount: str(row["amount"]), hours: str(row["hours_per_unit"]) };
  }
}

// ── what each kind checks ───────────────────────────────────────────────────

export function validate(what: AddKind, v: Values): Errors {
  const e: Errors = {};
  switch (what) {
    case "invoice":
      if (s(v, "client") === "") e["client"] = "sheets.add.noClient";
      if (s(v, "title") === "") e["title"] = "sheets.add.invoice.titleMissing";
      if (positive(s(v, "qty"), 4) === null) e["qty"] = "sheets.add.invoice.qtyBad";
      if (s(v, "rate") !== "" && positive(s(v, "rate"), 2) === null) e["rate"] = "sheets.add.invoice.rateBad";
      break;
    case "project":
      if (s(v, "client") === "") e["client"] = "sheets.add.noClient";
      if (s(v, "name") === "") e["name"] = "sheets.add.project.nameMissing";
      if (!DAY.test(s(v, "due"))) e["due"] = "sheets.add.dateMissing";
      break;
    case "client":
      if (s(v, "company") === "") e["company"] = "sheets.add.client.companyMissing";
      if (!EMAIL.test(s(v, "email"))) e["email"] = "sheets.add.client.emailBad";
      break;
    case "clientEdit": {
      const rate = s(v, "tax_rate");
      if (rate !== "" && (!/^\d{1,3}(\.\d{1,3})?$/.test(rate) || Number(rate) > 100)) e["tax_rate"] = "sheets.add.clientEdit.taxBad";
      break;
    }
    case "enquiry":
      if (s(v, "business") === "") e["business"] = "sheets.add.enquiry.businessMissing";
      if (s(v, "email") !== "" && !EMAIL.test(s(v, "email"))) e["email"] = "sheets.add.client.emailBad";
      break;
    case "milestone":
      if (s(v, "project") === "") e["project"] = "sheets.add.milestone.projectMissing";
      if (s(v, "title") === "") e["title"] = "sheets.add.milestone.titleMissing";
      if (!DAY.test(s(v, "due"))) e["due"] = "sheets.add.dateMissing";
      break;
    case "person":
      if (s(v, "name") === "") e["name"] = "sheets.add.person.nameMissing";
      break;
    case "rate":
      if (s(v, "label") === "") e["label"] = "sheets.add.rate.labelMissing";
      if (positive(s(v, "amount"), 2) === null) e["amount"] = "sheets.add.rate.amountBad";
      if (s(v, "hours") !== "" && positive(s(v, "hours"), 2) === null) e["hours"] = "sheets.add.rate.hoursBad";
      break;
  }
  return e;
}

// ── what each kind saves ────────────────────────────────────────────────────

const id = (v: Values, k: string): Id | null => (s(v, k) === "" ? null : Number(s(v, k)));
const orNull = (text: string): string | null => (text === "" ? null : text);

/** Initials as stored: letters only, at most three, in capitals. */
export function initialsOf(typed: string): string | null {
  const t = typed.replace(/\s+/g, "").slice(0, 3).toUpperCase();
  return t === "" ? null : t;
}

export const invoiceInput = (v: Values) => {
  const rate = s(v, "rate");
  const terms = s(v, "terms") as TermChoice;
  return {
    id: null,
    client_id: id(v, "client") as Id,
    project_id: id(v, "project"),
    title: s(v, "title"),
    ...(terms === "studio" ? {} : { terms: terms as ClientTerms }),
    // No rate: the draft opens in the composer with no line, and the lines are written there.
    lines: rate === "" ? [] : [{ description: s(v, "desc") === "" ? s(v, "title") : s(v, "desc"), qty: s(v, "qty"), rate: positive(rate, 2) ?? rate }],
  };
};

export const projectInput = (v: Values, firstMilestone: string) => ({
  client_id: id(v, "client") as Id,
  name: s(v, "name"),
  milestone: { title: s(v, "milestone") === "" ? firstMilestone : s(v, "milestone"), due_on: s(v, "due") },
});

export const clientInput = (v: Values) => ({
  company: s(v, "company"),
  // One contact each: a client with no contact named is spoken to by the business's name.
  contact_name: s(v, "contact") === "" ? s(v, "company") : s(v, "contact"),
  email: s(v, "email"),
  trade: orNull(s(v, "trade")),
  address: orNull(s(v, "address")),
  tax_number: orNull(s(v, "tax_number")),
});

export const clientEditInput = (v: Values) => ({
  address: orNull(s(v, "address")),
  tax_number: orNull(s(v, "tax_number")),
  terms: s(v, "terms") === "studio" ? null : (s(v, "terms") as ClientTerms),
  tax_rate: orNull(s(v, "tax_rate")),
});

export const enquiryInput = (v: Values, words: { source: string; budget: (b: Budget) => string }) => {
  const budget = s(v, "budget") as Budget;
  return {
    name: s(v, "name") === "" ? s(v, "business") : s(v, "name"),
    business: s(v, "business"),
    email: orNull(s(v, "email")),
    budget: budget === "notStated" || !BUDGETS.includes(budget) ? null : words.budget(budget),
    source: words.source,
    fit: "maybe" as const,
    body: orNull(s(v, "body")),
  };
};

export const personInput = (v: Values, position: number) => ({
  name: s(v, "name"),
  role_label: orNull(s(v, "role_label")),
  initials: initialsOf(s(v, "initials")),
  shown_to_clients: v["shown"] === true,
  position,
});

export const rateInput = (v: Values, position: number | null) => ({
  label: s(v, "label"),
  amount: Number(positive(s(v, "amount"), 2)).toFixed(2),
  hours_per_unit: s(v, "hours") === "" ? null : positive(s(v, "hours"), 2),
  ...(position === null ? {} : { position, active: true }),
});
