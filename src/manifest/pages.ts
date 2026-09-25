/**
 * The Client Portal section in the dashboard: its pages, their forms and the
 * two groups they sit in.
 *
 * Records first, then Manage — the order, icons and titles of the Client
 * Portal Overview design. The studio's desk is the app's staff side, on its
 * own address; the Overview links to it. The Overview sits above every group
 * with no heading of its own.
 *
 * Forms are v2 documents. Their sections carry no headings: a form's section
 * label is one untranslated string, and every field already carries its
 * column's label in all eight languages. A value Adminium works out — a
 * total, a number, a stamp — shows in a form and cannot be typed over.
 */
import { l, titles } from "./labels.ts";
import { OVERVIEW_LAYOUT } from "./overview.ts";

export const NAV_GROUPS = [
  { key: "records", label: l("Records"), order: 1 },
  { key: "manage", label: l("Manage"), order: 2 },
];

type Field = Record<string, unknown>;
const f = (column: string, more: Field = {}): Field => ({ column, ...more });
const title = (column: string): Field => ({ column, control: "title", span: 2 });
const wide = (column: string, control = "textarea"): Field => ({ column, control, span: 2 });
const toggle = (column: string): Field => ({ column, control: "toggle-row" });
const rows = (relation: string, columns: Field[]): Field => ({ relation, control: "child-rows", span: 2, columns });
const form = (...sections: Field[][]) => ({
  form: { v: 2, sections: sections.map((fields, i) => ({ id: `s${String(i + 1)}`, fields })) },
});

/** A document's lines, as the proposal and invoice forms edit them. */
const LINES = [
  { column: "description", width: "2fr" },
  { column: "qty", width: "80px" },
  { column: "rate", control: "currency", width: "120px" },
  { column: "discount_kind", control: "select", width: "120px" },
  { column: "discount", control: "currency", width: "110px" },
  { column: "amount", control: "currency", width: "120px" },
];

interface PageSpec {
  ref: string;
  template: string;
  title: string;
  group: string;
  icon: string;
  order: number;
  table?: string;
  feature?: string;
  config: Record<string, unknown>;
  /**
   * Declared, and not installed yet: the back office's record pages wait for
   * the desk's own screens for the same rows, so nothing shows before the
   * screen that explains it. Taking the flag off installs the page.
   */
  later?: true;
}

const SPECS: PageSpec[] = [
  // ── the Overview: above every group, with no heading of its own ─────────────
  {
    ref: "clients-overview",
    template: "page-dashboard",
    title: "Overview",
    group: "overview",
    icon: "layout-dashboard",
    order: 0,
    config: { layout: OVERVIEW_LAYOUT },
  },

  // ── records ────────────────────────────────────────────────────────────────
  {
    ref: "clients-clients",
    template: "page-master-detail",
    title: "Clients",
    group: "records",
    icon: "building-2",
    order: 1,
    table: "clients",
    config: form(
      [title("company"), f("trade"), f("contact_name"), f("email", { control: "email" }), f("phone", { control: "phone" }), wide("address", "text")],
      [f("tax_number"), f("terms", { control: "select" }), f("tax_rate", { control: "number" }), f("language"), f("tint")],
      [{ relation: "client_notes", control: "child-rows", span: 2, columns: [{ column: "body", width: "3fr" }, { column: "by", width: "1fr" }, { column: "at", width: "1fr" }] }],
    ),
  },
  {
    ref: "clients-enquiries",
    template: "page-queue-inbox",
    title: "Enquiries",
    group: "records",
    icon: "inbox",
    order: 2,
    table: "enquiries",
    config: form(
      [title("name"), f("business"), f("email", { control: "email" }), f("trade"), f("budget"), f("start_when"), f("source")],
      [wide("body"), f("fit", { control: "segmented" }), f("status", { control: "segmented" }), f("parked_until", { control: "date" }), f("client_id", { control: "reference" })],
    ),
  },
  {
    ref: "clients-proposals",
    template: "page-crud",
    title: "Proposals",
    group: "records",
    icon: "file-pen-line",
    order: 3,
    table: "proposals",
    config: form(
      [title("title"), f("client_id", { control: "reference" }), f("status", { control: "select" }), f("valid_until", { control: "date" }), f("split", { control: "select" }), f("terms_version_id", { control: "reference" })],
      [wide("scope")],
      [rows("proposal_lines", LINES)],
      [f("tax_name"), f("tax_rate", { control: "number" }), f("subtotal", { control: "currency" }), f("tax", { control: "currency" }), f("total", { control: "currency" })],
    ),
  },
  {
    ref: "clients-projects",
    template: "page-crud",
    title: "Projects",
    group: "records",
    icon: "folder-kanban",
    order: 4,
    table: "projects",
    config: form(
      [title("name"), f("client_id", { control: "reference" }), f("proposal_id", { control: "reference" }), f("status", { control: "segmented" }), wide("pause_note", "text")],
      [rows("milestones", [{ column: "title", width: "2fr" }, { column: "due_on", control: "date", width: "140px" }, { column: "state", control: "select", width: "120px" }])],
      [wide("handover_notes"), f("share_expires_on", { control: "date" }), toggle("share_stopped")],
    ),
  },
  {
    ref: "clients-deliverables",
    template: "page-crud",
    title: "Deliverables",
    group: "records",
    icon: "package-check",
    order: 5,
    table: "deliverables",
    config: form(
      [title("title"), f("project_id", { control: "reference" }), f("milestone_id", { control: "reference" }), f("status", { control: "select" })],
      [wide("review_note", "text"), f("approved_how", { control: "select" }), f("approved_on", { control: "date" })],
    ),
  },
  {
    ref: "clients-invoices",
    template: "page-crud",
    title: "Invoices",
    group: "records",
    icon: "receipt",
    order: 6,
    table: "invoices",
    config: form(
      [title("title"), f("client_id", { control: "reference" }), f("project_id", { control: "reference" }), f("stage"), f("status", { control: "select" }), f("terms", { control: "select" }), f("due_on", { control: "date" }), f("ladder", { control: "segmented" })],
      [rows("invoice_lines", LINES)],
      [f("tax_name"), f("tax_rate", { control: "number" }), f("subtotal", { control: "currency" }), f("tax", { control: "currency" }), f("total", { control: "currency" }), f("paid", { control: "currency" }), f("balance", { control: "currency" })],
      [wide("void_reason", "text")],
    ),
  },
  {
    ref: "clients-payments",
    template: "page-crud",
    title: "Payments",
    group: "records",
    icon: "hand-coins",
    order: 7,
    table: "payments",
    config: form([
      f("document_id", { control: "reference" }),
      f("amount", { control: "currency" }),
      f("paid_on", { control: "date" }),
      f("method", { control: "segmented" }),
      f("method_note"),
      toggle("voided"),
      wide("void_reason", "text"),
    ]),
  },
  {
    ref: "clients-messages",
    template: "page-crud",
    title: "Emails",
    group: "records",
    icon: "mail",
    order: 8,
    table: "messages",
    config: form([
      f("kind", { control: "select" }),
      f("status", { control: "select" }),
      f("client_id", { control: "reference" }),
      f("to", { control: "email" }),
      f("due", { control: "datetime" }),
      f("sent_at", { control: "datetime" }),
      wide("subject_override", "text"),
      wide("body_override"),
      wide("error", "text"),
    ]),
  },

  // ── manage ─────────────────────────────────────────────────────────────────
  {
    ref: "clients-settings",
    template: "page-crud",
    title: "Studio settings",
    group: "manage",
    icon: "settings",
    order: 1,
    table: "settings",
    config: form(
      [title("name"), f("mark", { control: "image" }), f("reply_to", { control: "email" }), f("phone", { control: "phone" }), f("website", { control: "url" }), wide("sign_off")],
      [f("hours_per_day", { control: "stepper" }), f("days_per_week", { control: "stepper" })],
      [
        toggle("notify_accepted"),
        toggle("notify_declined"),
        toggle("notify_files"),
        toggle("notify_paid"),
        toggle("notify_brief"),
        toggle("notify_new_price"),
        toggle("notify_notes"),
        toggle("notify_enquiry"),
      ],
    ),
  },
  {
    ref: "clients-people",
    template: "page-crud",
    title: "People",
    group: "manage",
    icon: "users-round",
    order: 2,
    table: "people",
    config: form([title("name"), f("role_label"), f("initials"), f("email", { control: "email" }), toggle("shown_to_clients"), f("position", { control: "stepper" })]),
  },
  {
    ref: "clients-rates",
    template: "page-crud",
    title: "Rate card",
    group: "manage",
    icon: "tags",
    order: 3,
    table: "rates",
    config: form([title("label"), f("amount", { control: "currency" }), f("hours_per_unit", { control: "number" }), toggle("active"), f("position", { control: "stepper" })]),
  },
  {
    ref: "clients-terms",
    template: "page-crud",
    title: "Terms",
    group: "manage",
    icon: "scroll-text",
    order: 4,
    table: "terms_versions",
    config: form(
      [f("version"), f("status", { control: "segmented" }), f("in_force_from", { control: "date" }), wide("note", "text")],
      [rows("terms_clauses", [{ column: "title", width: "1fr" }, { column: "body", width: "3fr" }, { column: "change", control: "select", width: "110px" }])],
    ),
  },
  {
    ref: "clients-brief-questions",
    template: "page-crud",
    title: "Brief questions",
    group: "manage",
    icon: "message-circle-question",
    order: 5,
    table: "brief_questions",
    config: form([wide("question", "title"), f("key"), wide("hint", "text"), f("kind", { control: "segmented" }), toggle("active"), f("position", { control: "stepper" })]),
  },

  // ── the back office (declared; installed once the desk's screens for them ship) ──
  {
    ref: "clients-time",
    template: "page-crud",
    title: "Time",
    group: "records",
    icon: "timer",
    order: 9,
    table: "time_entries",
    config: form(
      [f("project_id", { control: "reference" }), f("milestone_id", { control: "reference" }), f("person_id", { control: "reference" }), f("date", { control: "date" }), f("hours", { control: "number" })],
      [wide("note", "text")],
    ),
  },
  {
    ref: "clients-expenses",
    template: "page-crud",
    title: "Expenses",
    group: "records",
    icon: "shopping-bag",
    order: 10,
    table: "expenses",
    config: form(
      [title("what"), f("date", { control: "date" }), f("amount", { control: "currency" }), f("supplier_id", { control: "reference" })],
      [f("project_id", { control: "reference" }), f("client_id", { control: "reference" }), toggle("rebill"), f("receipt", { control: "attachments" })],
    ),
  },
  {
    ref: "clients-suppliers",
    template: "page-master-detail",
    title: "Suppliers",
    group: "records",
    icon: "truck",
    order: 11,
    table: "suppliers",
    config: form(
      [title("name"), f("kind", { control: "select" }), f("contact"), f("email", { control: "email" }), f("phone", { control: "phone" }), wide("address", "text")],
      [f("lead_time"), f("typical_cost"), toggle("would_use_again"), wide("note")],
    ),
  },
  {
    ref: "clients-studio-dates",
    template: "page-crud",
    title: "Studio dates",
    group: "records",
    icon: "calendar-days",
    order: 12,
    table: "events",
    config: form([title("title"), f("kind", { control: "segmented" }), f("date", { control: "date" }), f("to_date", { control: "date" }), f("person_id", { control: "reference" })]),
  },
  {
    ref: "clients-running-costs",
    template: "page-crud",
    title: "Running costs",
    group: "manage",
    icon: "wallet",
    order: 6,
    table: "running_costs",
    config: form([title("label"), f("monthly_amount", { control: "currency" }), f("position", { control: "stepper" })]),
  },
];

/** The pages this release installs. */
const SHOWN = SPECS.filter((spec) => spec.later !== true);

/** A page as the manifest carries it. */
const pageOf = (spec: PageSpec) => ({
  ref: spec.ref,
  template: spec.template,
  title: { key: `mft.${spec.ref.replaceAll("-", ".")}`, fallback: spec.title },
  titles: titles(spec.title),
  nav: { group: spec.group, icon: spec.icon, order: spec.order },
  ...(spec.table === undefined ? {} : { bindings: { rows: spec.table } }),
  ...(spec.feature === undefined ? {} : { feature: spec.feature }),
  config: spec.config,
});

/**
 * The manifest's pages: those this release installs, or — `withLater`, for
 * the test that proves they will install when switched on — every page
 * declared.
 */
export function pages(withLater = false): unknown[] {
  return (withLater ? SPECS : SHOWN).map(pageOf);
}

/** Every installed page's ref, in order (the roles grant them by name). */
export const PAGE_REFS = SHOWN.map((spec) => spec.ref);

/** The pages declared for later: each with the table it will show. */
export const LATER_PAGES = SPECS.filter((spec) => spec.later === true).map((spec) => ({ ref: spec.ref, table: spec.table ?? null, title: spec.title }));
