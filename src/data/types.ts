/**
 * The app's domain types.
 *
 * MONEY IS INTEGER CENTS everywhere in this app. A studio invoice is the one
 * place a floating-point rounding error is actually visible to a customer, so
 * nothing here is ever a fractional dollar; `lib/invoice.ts` does all the
 * arithmetic in cents and only `lib/format.ts` divides for display.
 *
 * VOCABULARY (21 D10, hard rule): the industry's usual b-word for "sending
 * invoices" appears nowhere in this codebase — not in a type name, not in a
 * comment, not in a string. Say invoicing, invoices, payments.
 */

export type View =
  /* Studio */
  | "home"
  | "proposals"
  | "proposal"
  | "projects"
  | "project"
  | "invoices"
  | "invoice"
  /* Client portal */
  | "entry"
  | "review"
  | "progress"
  | "clientinvoice"
  | "notfound";

export type Persona = "studio" | "client";

export interface Client {
  id: string;
  /** A brand name — a proper noun, never translated. */
  company: string;
  /** i18n key for the kind of business. */
  kind: string;
  contact: string;
  email: string;
  tint: string;
  icon: string;
  /** Day serial of the first engagement. */
  since: number;
}

/** One line on a proposal or an invoice. All money in integer cents. */
export interface LineItem {
  /** i18n key for seeded lines; literal text for lines a reader typed. */
  desc: string;
  qty: number;
  /** Unit price, in cents. */
  rate: number;
  /** Optional per-line discount, as a whole percentage. */
  disc: number;
}

export type ProposalStatus = "draft" | "sent" | "accepted" | "declined";

export interface Proposal {
  num: string;
  client: string;
  /** i18n key. */
  title: string;
  status: ProposalStatus;
  validUntil: number;
  /** Whole percentage. */
  taxRate: number;
  createdAt: number;
  sentAt: number | null;
  decidedAt: number | null;
  /** The project this proposal spawned, once accepted. */
  project: string | null;
  /** Free text from the client when declining. */
  declineNote: string;
  /** i18n keys for the scope paragraphs. */
  scope: string[];
  items: LineItem[];
}

export type ProjectStatus = "active" | "paused" | "done";

export interface Milestone {
  /** i18n key. */
  title: string;
  due: number;
  done: boolean;
}

export type DeliverableStatus = "pending" | "approved" | "changes";

export interface Deliverable {
  id: string;
  /** A fictional filename — shown in mono, never translated. */
  file: string;
  /** i18n key. */
  title: string;
  /** Index of the milestone this belongs to. */
  ms: number;
  icon: string;
  status: DeliverableStatus;
  /** The client's note when requesting changes. */
  note: string;
}

export interface Project {
  id: string;
  client: string;
  proposal: string | null;
  /** i18n key. */
  name: string;
  status: ProjectStatus;
  due: number;
  milestones: Milestone[];
  deliverables: Deliverable[];
}

export type PaymentMethod = "card" | "cash" | "transfer";

export interface Payment {
  /** Amount in cents. */
  amt: number;
  method: PaymentMethod;
  at: number;
}

/**
 * Stored status is only `draft | sent | paid`. **Overdue is DERIVED** from the
 * pinned clock against the due date and is never written to the record — a
 * stored "overdue" flag is a flag that is wrong the moment the clock moves.
 */
export type InvoiceStatus = "draft" | "sent" | "paid";

export interface Invoice {
  num: string;
  client: string;
  project: string | null;
  /** i18n key. */
  title: string;
  status: InvoiceStatus;
  issued: number;
  due: number;
  taxRate: number;
  items: LineItem[];
  payments: Payment[];
}

export interface ActivityEntry {
  id: string;
  icon: string;
  tone: "pos" | "warn" | "info" | "accent";
  /** i18n key; may carry a `{doc}` or `{who}` placeholder. */
  text: string;
  /** Values substituted into the key. */
  params?: Record<string, string>;
  at: number;
}

export interface Toast {
  id: number;
  text: string;
  tone: "pos" | "danger" | "info";
}
