/**
 * The doors the screens read and write through, as contracts.
 *
 *   DeskReads    what the studio's desk reads, as the signed-in staff member:
 *                the boot read set (`snapshot`), rows by key, a bounded query,
 *                a page of a list, the header's search. Live it is
 *                Adminium's data API (`adminiumSource.ts`); in the demo, the
 *                in-memory studio (`demo/world.ts`).
 *   DeskWrites   where the desk's writes go (`sink.ts`): create, patch,
 *                remove, a file upload, the share link's new code and the
 *                add-on's settings — every one an Adminium write.
 *   PortalPort   what the clients' side may do, through the portal's browser
 *                key and the signed-in client's session (`publicSource.ts`):
 *                the sign-in link, the client's own rows, and each narrow
 *                write the manifest opens (accept, sign, decline, a new price,
 *                a review, a note, the brief, "I've sent a payment").
 *
 * Nothing here computes a figure. Totals, paid, balance, numbers, states and
 * stamps are the server's, read back after every write.
 */
import type { ListCondition } from "./snapshotPort.ts";
import type {
  BriefQuestion,
  Client,
  Day,
  Deliverable,
  Enquiry,
  Id,
  Invoice,
  Message,
  Milestone,
  Person,
  Project,
  Proposal,
  Rate,
  Settings,
  TableRef,
  Tables,
  TermsVersion,
} from "./types.ts";

export type { ListCondition } from "./snapshotPort.ts";

// ── the desk ────────────────────────────────────────────────────────────────

/**
 * Everything the desk opens with, and nothing more: the studio's set-up, the
 * open work, and the clients any of it names. Every other row pages from the
 * server when a screen asks for it.
 */
export interface DeskSnapshot {
  /** The studio's calendar day the snapshot is of. */
  today: Day;
  settings: Settings | null;
  people: Person[];
  rates: Rate[];
  /** Every terms version (a studio has a handful). */
  termsVersions: TermsVersion[];
  briefQuestions: BriefQuestion[];
  /** Drafts and sent proposals, and every proposal decided in the last 90 days. */
  proposals: Proposal[];
  /** Drafts, and sent invoices with a balance. */
  invoices: Invoice[];
  /** Active and paused projects. */
  projects: Project[];
  /** The milestones of those projects. */
  milestones: Milestone[];
  /** The deliverables of those projects. */
  deliverables: Deliverable[];
  /** New and parked enquiries. */
  enquiries: Enquiry[];
  /** Messages held for the studio's approval (the chase rungs among them). */
  messages: Message[];
  /** Every client a row above names. */
  clients: Client[];
}

export interface PageQuery {
  where?: ListCondition;
  /** `column.desc,column2.asc`, at most three keys. */
  order?: string;
  limit: number;
  offset: number;
  /** Also count every match (a second query on the server): asked for, never assumed. */
  count?: boolean;
}

export interface Page<T> {
  rows: T[];
  /** Every match, when a count was asked for; null otherwise. */
  total: number | null;
}

/** One result of the header's search. */
export interface SearchHit {
  table: "proposals" | "invoices" | "projects" | "clients";
  id: Id;
  /** The document or project number, or the client's company. */
  label: string;
  title: string;
  /** The client's company, when the hit is a document or a project. */
  client: string | null;
}

export interface DeskReads {
  /** The boot read set, bounded (see `DeskSnapshot`). */
  snapshot(today: Day, zone: string): Promise<DeskSnapshot>;
  /**
   * Any table's rows by key, as they stand now — what a live update and a
   * detail screen read. A key missing from the answer is a row that is gone
   * (or no longer readable by this person).
   */
  rows<R extends TableRef>(ref: R, ids: readonly Id[]): Promise<Tables[R][]>;
  /** Every row a condition matches, up to `limit` (bounded; paged underneath). */
  where<R extends TableRef>(ref: R, where: ListCondition, order?: string, limit?: number): Promise<Tables[R][]>;
  /** One page of a list, for the screens that list more than the open work. */
  page<R extends TableRef>(ref: R, query: PageQuery): Promise<Page<Tables[R]>>;
  /** The header's search: proposals, invoices and projects by number or title, clients by name. */
  search(text: string, limit: number): Promise<SearchHit[]>;
}

export type RowValues = Record<string, unknown>;

export interface DeskWrites {
  insert<R extends TableRef>(ref: R, values: RowValues): Promise<Tables[R]>;
  update<R extends TableRef>(ref: R, id: Id, patch: RowValues): Promise<Tables[R]>;
  remove(ref: TableRef, id: Id): Promise<void>;
  /**
   * Upload a file for a row's file column (a deliverable version, a handover
   * file): the value to write into that column comes back.
   */
  upload(ref: TableRef, column: string, file: Blob, filename: string): Promise<string>;
  /** A fresh server-made code for a code column (the handover's share link). */
  regenerateCode<R extends TableRef>(ref: R, id: Id, column: string): Promise<Tables[R]>;
  /** The Invoices & Receipts add-on's settings (a studio manager's). */
  saveAddOnSettings(addOnKey: string, values: Record<string, unknown>): Promise<Record<string, unknown>>;
}

// ── the clients' side ───────────────────────────────────────────────────────

/**
 * A refusal the clients' pages turn into words: the server's own code
 * (`LINK_EXPIRED`, `PUBLIC_WRITE_REFUSED`, `PUBLIC_RATE_LIMITED` …) and what
 * it named.
 */
export class PortError extends Error {
  readonly code: string;
  readonly status: number;
  readonly params: Record<string, unknown>;
  constructor(code: string, message: string, status = 0, params: Record<string, unknown> = {}) {
    super(message);
    this.name = "PortError";
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

/** What anyone may read about the studio, before signing in. */
export interface PublicStudio {
  settings: Pick<Settings, "name" | "mark" | "reply_to" | "phone" | "website"> | null;
  people: Pick<Person, "name" | "role_label" | "initials" | "position">[];
  briefQuestions: Pick<BriefQuestion, "key" | "question" | "hint" | "kind" | "position">[];
}

/** Who is signed in on the clients' side. */
export interface Me {
  company: string;
  contact_name: string;
}

export type CodeResult = { ok: true } | { ok: false; triesLeft: number | null };

/** A client's answer to "I've sent a payment". */
export interface SentPayment {
  on: Day;
  /** Optional, display only — never enters a total. */
  amount: string | null;
  note: string | null;
}

/** A client's note on a deliverable (with a pin when it is on the artwork). */
export interface ClientNote {
  deliverable_id: Id;
  version_id: Id | null;
  body: string;
  pin_x: string | null;
  pin_y: string | null;
}

/** A document the add-on renders for one of the client's rows. */
export type DocumentKind = "quote" | "invoice" | "statement" | "receipt";

/** The shared handover page, read through its share link. */
export interface HandoverView {
  studio: Pick<Settings, "name" | "mark" | "website"> | null;
  project: Pick<Project, "id" | "number" | "name" | "done_on" | "handover_notes" | "share_expires_on">;
  fonts: Tables["project_fonts"][];
  files: Tables["handover_files"][];
  deliverables: Tables["deliverables"][];
  versions: Tables["deliverable_versions"][];
}

export interface PortalPort {
  /** The studio's clock: every day the pages show is on it. */
  timeZone(): string;
  /** The studio's currency, when the scope serves money. */
  currency(): string | null;

  // the session
  /** Whether a signed-in session is held. */
  signedIn(): boolean;
  /** Ask for a sign-in link. Answers the same for any address (202). */
  requestLink(email: string, language: string): Promise<void>;
  /** The first name a link is for, or null for a used or expired link. Spends nothing. */
  peekLink(token: string): Promise<{ firstName: string } | null>;
  /** Spend the link: a signed-in session. A used or expired one throws `LINK_EXPIRED`. */
  verifyLink(token: string): Promise<void>;
  /** The six-digit code from the same email, on another device. */
  verifyCode(email: string, code: string): Promise<CodeResult>;
  /** "Email me a new link" from a used or expired link: to that link's own address. */
  resendFromLink(token: string, language: string): Promise<void>;
  signOut(): Promise<void>;

  // reads
  studio(): Promise<PublicStudio>;
  me(): Promise<Me>;
  /** The signed-in client's own rows of a table, as the manifest scopes them. */
  list<R extends TableRef>(ref: R, where?: ListCondition, order?: string, limit?: number): Promise<Tables[R][]>;
  /** A link to one of the add-on's documents for a row the client may see. */
  documentUrl(kind: DocumentKind, ref: TableRef, id: Id, locale: string): Promise<string>;
  /** A short-lived link to a file column's file (a deliverable version, a handover file). */
  fileUrl(ref: TableRef, id: Id, column: string): string;

  // writes — each through its own narrow door
  accept(proposalId: Id, signedName: string): Promise<Tables["proposals"]>;
  sign(proposalId: Id, signedName: string): Promise<Tables["proposals"]>;
  decline(proposalId: Id, note: string | null): Promise<Tables["proposals"]>;
  askNewPrice(proposalId: Id): Promise<Tables["proposals"]>;
  review(deliverableId: Id, status: "approved" | "changes", note: string | null): Promise<Tables["deliverables"]>;
  addNote(note: ClientNote): Promise<Tables["deliverable_notes"]>;
  saveAnswer(briefId: Id, questionKey: string, answer: string, existing: Id | null): Promise<Tables["brief_answers"]>;
  sendBrief(briefId: Id): Promise<Tables["briefs"]>;
  sentPayment(invoiceId: Id, payment: SentPayment): Promise<Tables["invoices"]>;

  // the shared handover (its own key, by token)
  openHandover(token: string): Promise<HandoverView>;
}
