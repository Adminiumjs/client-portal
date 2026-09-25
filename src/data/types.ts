/**
 * WRITTEN BY `scripts/write-row-types.ts` FROM `manifest.json` — do not edit.
 * Change the manifest, then run `npx vite-node scripts/write-row-types.ts`;
 * `types.test.ts` fails while this file and the manifest disagree.
 *
 * One row type per table, in the table's own column names. Three conventions
 * hold for every row the app holds (`rows.ts` makes them true on the way in):
 *
 *   - a key is a number;
 *   - an amount or any other decimal is a STRING, as Adminium returns it
 *     ("1950.00"): the app never does arithmetic on money it then saves, and
 *     shows it through `lib/money.ts`;
 *   - an instant is an ISO string in UTC; a calendar day is "YYYY-MM-DD" on
 *     the studio's calendar.
 */

export type Id = number;
/** A decimal as Adminium sends it: "1950.00", "8.5". Display only. */
export type Decimal = string;
/** A calendar day on the studio's calendar, "YYYY-MM-DD". */
export type Day = string;
/** An instant, as an ISO string in UTC. */
export type Instant = string;

/** Every table, by the manifest's short name (Adminium adds the prefix). */
export const TABLE_REFS = [
  "settings",
  "people",
  "rates",
  "terms_versions",
  "terms_clauses",
  "brief_questions",
  "clients",
  "client_notes",
  "enquiries",
  "proposals",
  "proposal_lines",
  "projects",
  "project_fonts",
  "handover_files",
  "milestones",
  "deliverables",
  "deliverable_versions",
  "deliverable_notes",
  "briefs",
  "brief_answers",
  "suppliers",
  "expenses",
  "time_entries",
  "invoices",
  "invoice_lines",
  "payments",
  "messages",
  "running_costs",
  "events",
] as const;

export type TableRef = (typeof TABLE_REFS)[number];

/** A row of `settings`. */
export interface Settings {
  id: Id;
  singleton: string;
  name: string | null;
  mark: string | null;
  reply_to: string | null;
  phone: string | null;
  website: string | null;
  sign_off: string | null;
  hours_per_day: number;
  days_per_week: number;
  notify_accepted: boolean;
  notify_declined: boolean;
  notify_files: boolean;
  notify_paid: boolean;
  notify_brief: boolean;
  notify_new_price: boolean;
  notify_notes: boolean;
  notify_enquiry: boolean;
}

/** A row of `people`. */
export interface Person {
  id: Id;
  name: string;
  role_label: string | null;
  initials: string | null;
  email: string | null;
  user_id: string | null;
  shown_to_clients: boolean;
  position: number;
  days_per_week: number | null;
}

/** A row of `rates`. */
export interface Rate {
  id: Id;
  label: string;
  amount: Decimal;
  hours_per_unit: Decimal | null;
  position: number;
  active: boolean;
}

export type TermsVersionStatus = "draft" | "in_force" | "retired";
/** A row of `terms_versions`. */
export interface TermsVersion {
  id: Id;
  version: number | null;
  status: TermsVersionStatus;
  in_force_from: Day | null;
  note: string | null;
  client_key: string | null;
}

export type TermsClauseChange = "added" | "changed" | "same";
/** A row of `terms_clauses`. */
export interface TermsClause {
  id: Id;
  version_id: Id;
  position: number;
  title: string;
  body: string | null;
  change: TermsClauseChange;
  change_note: string | null;
  client_key: string | null;
}

export type BriefQuestionKind = "text" | "area";
/** A row of `brief_questions`. */
export interface BriefQuestion {
  id: Id;
  key: string;
  question: string;
  hint: string | null;
  kind: BriefQuestionKind;
  position: number;
  active: boolean;
}

export type ClientTerms = "net7" | "net14" | "net30" | "on-receipt";
/** A row of `clients`. */
export interface Client {
  id: Id;
  company: string;
  trade: string | null;
  contact_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  tax_number: string | null;
  terms: ClientTerms | null;
  tax_rate: Decimal | null;
  language: string | null;
  tint: string | null;
  created_at: Instant;
  client_key: string | null;
}

/** A row of `client_notes`. */
export interface ClientNote {
  id: Id;
  client_id: Id;
  body: string;
  by: string | null;
  at: Instant | null;
}

export type EnquiryFit = "good" | "maybe" | "no";
export type EnquiryStatus = "new" | "replied" | "parked" | "proposal" | "declined";
/** A row of `enquiries`. */
export interface Enquiry {
  id: Id;
  number_seq: number | null;
  number: string | null;
  business: string | null;
  name: string;
  email: string | null;
  trade: string | null;
  budget: string | null;
  start_when: string | null;
  source: string | null;
  fit: EnquiryFit | null;
  body: string | null;
  status: EnquiryStatus;
  parked_until: Day | null;
  client_id: Id | null;
  proposal_id: Id | null;
  received_at: Instant | null;
  client_key: string | null;
}

export type ProposalStatus = "draft" | "sent" | "accepted" | "declined" | "withdrawn";
export type ProposalSplit = "5050" | "403030" | "end";
export type ProposalAcceptedHow = "portal" | "email" | "call" | "meeting";
/** A row of `proposals`. */
export interface Proposal {
  id: Id;
  number_seq: number | null;
  number: string | null;
  status: ProposalStatus;
  valid_until: Day | null;
  currency: string | null;
  tax_name: string | null;
  tax_rate: Decimal | null;
  subtotal: Decimal | null;
  tax: Decimal | null;
  total: Decimal | null;
  sent_at: Instant | null;
  decided_at: Instant | null;
  withdraw_reason: string | null;
  client_id: Id;
  title: string;
  scope: string | null;
  split: ProposalSplit;
  terms_version_id: Id | null;
  revision_of: Id | null;
  signed_name: string | null;
  signed_email: string | null;
  signed_at: Instant | null;
  fingerprint: string | null;
  accepted_how: ProposalAcceptedHow | null;
  decline_note: string | null;
  new_price_asked: boolean;
  new_price_asked_at: Instant | null;
  client_key: string | null;
}

export type ProposalLineDiscountKind = "amount" | "percent";
/** A row of `proposal_lines`. */
export interface ProposalLine {
  id: Id;
  document_id: Id;
  position: number;
  description: string | null;
  qty: Decimal;
  rate: Decimal | null;
  discount_kind: ProposalLineDiscountKind;
  discount: Decimal | null;
  currency: string | null;
  amount: Decimal | null;
  client_id: Id | null;
  client_key: string | null;
}

export type ProjectStatus = "active" | "paused" | "done";
/** A row of `projects`. */
export interface Project {
  id: Id;
  number_seq: number | null;
  number: string | null;
  client_id: Id;
  proposal_id: Id | null;
  name: string;
  status: ProjectStatus;
  pause_note: string | null;
  started_on: Day | null;
  done_on: Day | null;
  share_token: string | null;
  share_expires_on: Day | null;
  share_stopped: boolean;
  share_stopped_at: Instant | null;
  handover_notes: string | null;
  handover_sent: boolean;
  handover_sent_at: Instant | null;
  client_key: string | null;
}

/** A row of `project_fonts`. */
export interface ProjectFont {
  id: Id;
  project_id: Id;
  client_id: Id | null;
  name: string;
  licence: string | null;
  position: number;
  client_key: string | null;
}

/** A row of `handover_files`. */
export interface HandoverFile {
  id: Id;
  project_id: Id;
  client_id: Id | null;
  file: string | null;
  link: string | null;
  note: string | null;
  position: number;
  client_key: string | null;
}

export type MilestoneState = "next" | "now" | "done";
/** A row of `milestones`. */
export interface Milestone {
  id: Id;
  project_id: Id;
  client_id: Id | null;
  title: string;
  due_on: Day | null;
  state: MilestoneState;
  done_at: Instant | null;
  estimated_days: Decimal | null;
  position: number;
  client_key: string | null;
}

export type DeliverableStatus = "unshared" | "pending" | "approved" | "changes";
export type DeliverableApprovedHow = "portal" | "email" | "call" | "meeting";
/** A row of `deliverables`. */
export interface Deliverable {
  id: Id;
  project_id: Id;
  client_id: Id | null;
  milestone_id: Id | null;
  title: string;
  icon: string | null;
  status: DeliverableStatus;
  shared_at: Instant | null;
  reviewed_at: Instant | null;
  review_note: string | null;
  approved_how: DeliverableApprovedHow | null;
  approved_on: Day | null;
  approved_by: string | null;
  position: number;
  client_key: string | null;
}

/** A row of `deliverable_versions`. */
export interface DeliverableVersion {
  id: Id;
  deliverable_id: Id;
  client_id: Id | null;
  v: number | null;
  file: string | null;
  link: string | null;
  note: string | null;
  posted_by: string | null;
  posted_at: Instant | null;
  client_key: string | null;
}

export type DeliverableNoteSide = "studio" | "client";
/** A row of `deliverable_notes`. */
export interface DeliverableNote {
  id: Id;
  deliverable_id: Id;
  client_id: Id | null;
  version_id: Id | null;
  side: DeliverableNoteSide | null;
  author: string | null;
  body: string;
  pin_x: Decimal | null;
  pin_y: Decimal | null;
  at: Instant | null;
  client_key: string | null;
}

export type BriefStatus = "open" | "sent";
/** A row of `briefs`. */
export interface Brief {
  id: Id;
  project_id: Id;
  client_id: Id | null;
  status: BriefStatus;
  sent_at: Instant | null;
}

/** A row of `brief_answers`. */
export interface BriefAnswer {
  id: Id;
  brief_id: Id;
  client_id: Id | null;
  question_key: string;
  answer: string | null;
  first_answer: string | null;
  client_key: string | null;
}

export type SupplierKind = "print" | "paper" | "signage" | "courier" | "fonts" | "finishing" | "photography" | "software" | "other";
/** A row of `suppliers`. */
export interface Supplier {
  id: Id;
  number_seq: number | null;
  number: string | null;
  name: string;
  kind: SupplierKind;
  contact: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  lead_time: string | null;
  typical_cost: string | null;
  note: string | null;
  would_use_again: boolean;
  client_key: string | null;
}

/** A row of `expenses`. */
export interface Expense {
  id: Id;
  number_seq: number | null;
  number: string | null;
  date: Day;
  what: string;
  amount: Decimal;
  client_id: Id | null;
  project_id: Id | null;
  supplier_id: Id | null;
  rebill: boolean;
  receipt: string | null;
  client_key: string | null;
}

/** A row of `time_entries`. */
export interface TimeEntry {
  id: Id;
  project_id: Id;
  client_id: Id | null;
  milestone_id: Id | null;
  person_id: Id;
  date: Day;
  hours: Decimal | null;
  note: string | null;
  running_for: Id | null;
  started_at: Instant | null;
  client_key: string | null;
}

export type InvoiceStatus = "draft" | "sent" | "void";
export type InvoiceTerms = "net7" | "net14" | "net30" | "on-receipt";
export type InvoiceLadder = "gentle" | "standard" | "firm";
/** A row of `invoices`. */
export interface Invoice {
  id: Id;
  number_seq: number | null;
  number: string | null;
  status: InvoiceStatus;
  issued_on: Day | null;
  terms: InvoiceTerms | null;
  due_on: Day | null;
  currency: string | null;
  tax_name: string | null;
  tax_rate: Decimal | null;
  subtotal: Decimal | null;
  tax: Decimal | null;
  total: Decimal | null;
  paid: Decimal | null;
  balance: Decimal | null;
  ladder: InvoiceLadder | null;
  sent_at: Instant | null;
  void_reason: string | null;
  voided_at: Instant | null;
  voided_by: string | null;
  from_quote_id: Id | null;
  share_pct: Decimal | null;
  client_id: Id;
  project_id: Id | null;
  proposal_id: Id | null;
  stage: string | null;
  title: string | null;
  client_paid_note: string | null;
  client_paid_amount: Decimal | null;
  client_paid_on: Day | null;
  client_paid: boolean | null;
  client_paid_at: Instant | null;
  client_key: string | null;
}

export type InvoiceLineDiscountKind = "amount" | "percent";
/** A row of `invoice_lines`. */
export interface InvoiceLine {
  id: Id;
  document_id: Id;
  position: number;
  description: string | null;
  qty: Decimal;
  rate: Decimal | null;
  discount_kind: InvoiceLineDiscountKind;
  discount: Decimal | null;
  currency: string | null;
  quote_id: Id | null;
  share_pct: Decimal | null;
  amount: Decimal | null;
  client_id: Id | null;
  time_entry_id: Id | null;
  expense_id: Id | null;
  client_key: string | null;
}

export type PaymentMethod = "bank-transfer" | "card" | "cheque" | "cash" | "other";
/** A row of `payments`. */
export interface Payment {
  id: Id;
  document_id: Id;
  number_seq: number | null;
  number: string | null;
  amount: Decimal;
  currency: string | null;
  method: PaymentMethod;
  method_note: string | null;
  paid_on: Day;
  recorded_by: string | null;
  recorded_at: Instant | null;
  voided: boolean;
  void_reason: string | null;
  voided_by: string | null;
  voided_at: Instant | null;
  client_id: Id | null;
  client_key: string | null;
}

export type MessageKind = "proposal-sent" | "proposal-reminder" | "new-work" | "handover" | "enquiry-reply" | "ask-to-sign" | "accepted-and-signed" | "declined" | "changes-requested" | "approved" | "client-says-paid" | "brief-sent" | "asked-for-a-new-price" | "new-note" | "new-enquiry" | "invoice-sent" | "invoice-rung-1" | "invoice-rung-2" | "invoice-rung-3" | "payment-receipt";
export type MessageStatus = "held" | "queued" | "sent" | "failed" | "skipped";
export type MessageSkipReason = "overtaken" | "paid" | "void" | "no-longer-needed" | "by-hand";
/** A row of `messages`. */
export interface Message {
  id: Id;
  kind: MessageKind;
  status: MessageStatus;
  created_at: Instant | null;
  skip_reason: MessageSkipReason | null;
  to: string | null;
  language: string | null;
  client_id: Id | null;
  proposal_id: Id | null;
  invoice_id: Id | null;
  payment_id: Id | null;
  project_id: Id | null;
  deliverable_id: Id | null;
  enquiry_id: Id | null;
  subject_override: string | null;
  body_override: string | null;
  approved_by: string | null;
  due: Instant | null;
  sent_at: Instant | null;
  error: string | null;
  effect_at: Instant | null;
  effect_error: string | null;
  client_key: string | null;
}

/** A row of `running_costs`. */
export interface RunningCost {
  id: Id;
  label: string;
  monthly_amount: Decimal;
  position: number;
}

export type StudioEventKind = "call" | "press" | "away";
/** A row of `events`. */
export interface StudioEvent {
  id: Id;
  date: Day;
  to_date: Day | null;
  title: string;
  kind: StudioEventKind;
  person_id: Id | null;
  client_key: string | null;
}

/** Each table's row type, by short name. */
export interface Tables {
  settings: Settings;
  people: Person;
  rates: Rate;
  terms_versions: TermsVersion;
  terms_clauses: TermsClause;
  brief_questions: BriefQuestion;
  clients: Client;
  client_notes: ClientNote;
  enquiries: Enquiry;
  proposals: Proposal;
  proposal_lines: ProposalLine;
  projects: Project;
  project_fonts: ProjectFont;
  handover_files: HandoverFile;
  milestones: Milestone;
  deliverables: Deliverable;
  deliverable_versions: DeliverableVersion;
  deliverable_notes: DeliverableNote;
  briefs: Brief;
  brief_answers: BriefAnswer;
  suppliers: Supplier;
  expenses: Expense;
  time_entries: TimeEntry;
  invoices: Invoice;
  invoice_lines: InvoiceLine;
  payments: Payment;
  messages: Message;
  running_costs: RunningCost;
  events: StudioEvent;
}

/** Every column that is not plain text, per table: what `rows.ts` normalises. */
export const COLUMN_KINDS = {
  settings: { id: "int", hours_per_day: "int", days_per_week: "int", notify_accepted: "bool", notify_declined: "bool", notify_files: "bool", notify_paid: "bool", notify_brief: "bool", notify_new_price: "bool", notify_notes: "bool", notify_enquiry: "bool" },
  people: { id: "int", shown_to_clients: "bool", position: "int", days_per_week: "int" },
  rates: { id: "int", amount: "decimal", hours_per_unit: "decimal", position: "int", active: "bool" },
  terms_versions: { id: "int", version: "int", in_force_from: "day" },
  terms_clauses: { id: "int", version_id: "int", position: "int" },
  brief_questions: { id: "int", position: "int", active: "bool" },
  clients: { id: "int", tax_rate: "decimal", created_at: "instant" },
  client_notes: { id: "int", client_id: "int", at: "instant" },
  enquiries: { id: "int", number_seq: "int", parked_until: "day", client_id: "int", proposal_id: "int", received_at: "instant" },
  proposals: { id: "int", number_seq: "int", valid_until: "day", tax_rate: "decimal", subtotal: "decimal", tax: "decimal", total: "decimal", sent_at: "instant", decided_at: "instant", client_id: "int", terms_version_id: "int", revision_of: "int", signed_at: "instant", new_price_asked: "bool", new_price_asked_at: "instant" },
  proposal_lines: { id: "int", document_id: "int", position: "int", qty: "decimal", rate: "decimal", discount: "decimal", amount: "decimal", client_id: "int" },
  projects: { id: "int", number_seq: "int", client_id: "int", proposal_id: "int", started_on: "day", done_on: "day", share_expires_on: "day", share_stopped: "bool", share_stopped_at: "instant", handover_sent: "bool", handover_sent_at: "instant" },
  project_fonts: { id: "int", project_id: "int", client_id: "int", position: "int" },
  handover_files: { id: "int", project_id: "int", client_id: "int", position: "int" },
  milestones: { id: "int", project_id: "int", client_id: "int", due_on: "day", done_at: "instant", estimated_days: "decimal", position: "int" },
  deliverables: { id: "int", project_id: "int", client_id: "int", milestone_id: "int", shared_at: "instant", reviewed_at: "instant", approved_on: "day", position: "int" },
  deliverable_versions: { id: "int", deliverable_id: "int", client_id: "int", v: "int", posted_at: "instant" },
  deliverable_notes: { id: "int", deliverable_id: "int", client_id: "int", version_id: "int", pin_x: "decimal", pin_y: "decimal", at: "instant" },
  briefs: { id: "int", project_id: "int", client_id: "int", sent_at: "instant" },
  brief_answers: { id: "int", brief_id: "int", client_id: "int" },
  suppliers: { id: "int", number_seq: "int", would_use_again: "bool" },
  expenses: { id: "int", number_seq: "int", date: "day", amount: "decimal", client_id: "int", project_id: "int", supplier_id: "int", rebill: "bool" },
  time_entries: { id: "int", project_id: "int", client_id: "int", milestone_id: "int", person_id: "int", date: "day", hours: "decimal", running_for: "int", started_at: "instant" },
  invoices: { id: "int", number_seq: "int", issued_on: "day", due_on: "day", tax_rate: "decimal", subtotal: "decimal", tax: "decimal", total: "decimal", paid: "decimal", balance: "decimal", sent_at: "instant", voided_at: "instant", from_quote_id: "int", share_pct: "decimal", client_id: "int", project_id: "int", proposal_id: "int", client_paid_amount: "decimal", client_paid_on: "day", client_paid: "bool", client_paid_at: "instant" },
  invoice_lines: { id: "int", document_id: "int", position: "int", qty: "decimal", rate: "decimal", discount: "decimal", quote_id: "int", share_pct: "decimal", amount: "decimal", client_id: "int", time_entry_id: "int", expense_id: "int" },
  payments: { id: "int", document_id: "int", number_seq: "int", amount: "decimal", paid_on: "day", recorded_at: "instant", voided: "bool", voided_at: "instant", client_id: "int" },
  messages: { id: "int", created_at: "instant", client_id: "int", proposal_id: "int", invoice_id: "int", payment_id: "int", project_id: "int", deliverable_id: "int", enquiry_id: "int", due: "instant", sent_at: "instant", effect_at: "instant" },
  running_costs: { id: "int", monthly_amount: "decimal", position: "int" },
  events: { id: "int", date: "day", to_date: "day", person_id: "int" },
} as const satisfies Record<TableRef, Record<string, "int" | "decimal" | "bool" | "day" | "instant">>;

/** The columns a row may leave empty, per table. */
export const NULLABLE: Readonly<Record<TableRef, readonly string[]>> = {
  settings: ["name", "mark", "reply_to", "phone", "website", "sign_off"],
  people: ["role_label", "initials", "email", "user_id", "days_per_week"],
  rates: ["hours_per_unit"],
  terms_versions: ["version", "in_force_from", "note", "client_key"],
  terms_clauses: ["body", "change_note", "client_key"],
  brief_questions: ["hint"],
  clients: ["trade", "phone", "address", "tax_number", "terms", "tax_rate", "language", "tint", "client_key"],
  client_notes: ["by", "at"],
  enquiries: ["number_seq", "number", "business", "email", "trade", "budget", "start_when", "source", "fit", "body", "parked_until", "client_id", "proposal_id", "received_at", "client_key"],
  proposals: ["number_seq", "number", "valid_until", "currency", "tax_name", "tax_rate", "subtotal", "tax", "total", "sent_at", "decided_at", "withdraw_reason", "scope", "terms_version_id", "revision_of", "signed_name", "signed_email", "signed_at", "fingerprint", "accepted_how", "decline_note", "new_price_asked_at", "client_key"],
  proposal_lines: ["description", "rate", "discount", "currency", "amount", "client_id", "client_key"],
  projects: ["number_seq", "number", "proposal_id", "pause_note", "started_on", "done_on", "share_token", "share_expires_on", "share_stopped_at", "handover_notes", "handover_sent_at", "client_key"],
  project_fonts: ["client_id", "licence", "client_key"],
  handover_files: ["client_id", "file", "link", "note", "client_key"],
  milestones: ["client_id", "due_on", "done_at", "estimated_days", "client_key"],
  deliverables: ["client_id", "milestone_id", "icon", "shared_at", "reviewed_at", "review_note", "approved_how", "approved_on", "approved_by", "client_key"],
  deliverable_versions: ["client_id", "v", "file", "link", "note", "posted_by", "posted_at", "client_key"],
  deliverable_notes: ["client_id", "version_id", "side", "author", "pin_x", "pin_y", "at", "client_key"],
  briefs: ["client_id", "sent_at"],
  brief_answers: ["client_id", "answer", "first_answer", "client_key"],
  suppliers: ["number_seq", "number", "contact", "email", "phone", "address", "lead_time", "typical_cost", "note", "client_key"],
  expenses: ["number_seq", "number", "client_id", "project_id", "supplier_id", "receipt", "client_key"],
  time_entries: ["client_id", "milestone_id", "hours", "note", "running_for", "started_at", "client_key"],
  invoices: ["number_seq", "number", "issued_on", "terms", "due_on", "currency", "tax_name", "tax_rate", "subtotal", "tax", "total", "paid", "balance", "ladder", "sent_at", "void_reason", "voided_at", "voided_by", "from_quote_id", "share_pct", "project_id", "proposal_id", "stage", "title", "client_paid_note", "client_paid_amount", "client_paid_on", "client_paid", "client_paid_at", "client_key"],
  invoice_lines: ["description", "rate", "discount", "currency", "quote_id", "share_pct", "amount", "client_id", "time_entry_id", "expense_id", "client_key"],
  payments: ["number_seq", "number", "currency", "method_note", "recorded_by", "recorded_at", "void_reason", "voided_by", "voided_at", "client_id", "client_key"],
  messages: ["created_at", "skip_reason", "to", "language", "client_id", "proposal_id", "invoice_id", "payment_id", "project_id", "deliverable_id", "enquiry_id", "subject_override", "body_override", "approved_by", "due", "sent_at", "error", "effect_at", "effect_error", "client_key"],
  running_costs: [],
  events: ["to_date", "person_id", "client_key"],
};
