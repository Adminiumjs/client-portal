/**
 * Everything the studio's desk DOES, each one Adminium writes.
 *
 * Every action a screen or a sheet offers is a named function here; screens
 * draw and call, and never write a row themselves. Each answers an `Outcome`
 * (`outcome.ts`): done with the rows as the server saved them, or refused with
 * the server's code. Nothing is shown as saved before the server says so, and
 * no figure is the browser's: after lines or payments change, the document is
 * read back so its totals, paid and balance are Adminium's.
 *
 * ── Actions that write several rows ─────────────────────────────────────────
 *
 * Each is a step list under one action key (`data/sink.ts`), in the order the
 * studio's work needs, the row that makes the action visible LAST:
 *
 *   start a proposal     the client (if new) → the proposal → its lines →
 *                        the enquiry's client and status, on the first save only
 *   send (composer)      create → lines → the move to sent (a revision's send
 *                        then withdraws the proposal it revises)
 *   make a revision      the draft (`revision_of`) → its copied lines
 *   start the project    the project → its milestones → the first stage's
 *                        invoice draft → its line
 *   next stage           the invoice draft → its line
 *   new invoice          the invoice → its first line
 *   new project          the project → its first milestone
 *   add deliverable      the deliverable → its file → version 1 → shared
 *   post a version       the file → the version → back to pending
 *   send a reply         the message → the enquiry replied
 *   send the handover    the message → the project's handover sent
 *   new terms version    the version → its clauses
 *
 * A step that does not save answers `unfinished`; `unfinished.resume()` (the
 * sheet's "Finish it") runs the same key from the first step not done.
 */
import type { RowValues } from "../data/ports.ts";
import { newRun, SinkError, type Step, type StepContext } from "../data/sink.ts";
import type {
  Client,
  ClientTerms,
  Day,
  Deliverable,
  DeliverableApprovedHow,
  DeliverableNote,
  DeliverableVersion,
  Enquiry,
  EnquiryFit,
  HandoverFile,
  Id,
  Invoice,
  InvoiceLadder,
  Message,
  Milestone,
  MilestoneState,
  Payment,
  PaymentMethod,
  Person,
  Project,
  ProjectFont,
  Proposal,
  ProposalLine,
  ProposalSplit,
  Rate,
  BriefQuestion,
  Settings,
  TableRef,
  Tables,
  TermsClause,
  TermsClauseChange,
  TermsVersion,
} from "../data/types.ts";
import { addDays } from "../data/venueTime.ts";
import { now, today } from "../lib/clock.ts";
import { decimalValue } from "../lib/money.ts";
import { deskWrites, drop, ensureRows, loadWhere, refreshRows, rowsOf, upsert, useDesk } from "./desk.ts";
import { attempt, attemptSteps, refusalOf, type Outcome } from "./outcome.ts";

export type { Outcome } from "./outcome.ts";

// ── the saves, each folded into the desk as it lands ────────────────────────

async function insert<R extends TableRef>(ref: R, values: RowValues): Promise<Tables[R]> {
  const row = await deskWrites().insert(ref, values);
  upsert(ref, row);
  return row;
}
async function update<R extends TableRef>(ref: R, id: Id, patch: RowValues): Promise<Tables[R]> {
  const row = await deskWrites().update(ref, id, patch);
  upsert(ref, { ...row, id });
  return useDesk.getState().rows[ref][id] as Tables[R];
}
async function remove(ref: TableRef, id: Id): Promise<void> {
  await deskWrites().remove(ref, id);
  drop(ref, id);
}

const held = <R extends TableRef>(ref: R, id: Id): Tables[R] | undefined => useDesk.getState().rows[ref][id] as Tables[R] | undefined;
const gone = (): never => {
  throw new SinkError("gone", "refused", 404, "NOT_FOUND");
};
const need = <R extends TableRef>(ref: R, id: Id): Tables[R] => held(ref, id) ?? gone();

/** Read a document back: its totals, paid and balance are the server's. */
async function reread<R extends "proposals" | "invoices" | "deliverables" | "projects">(ref: R, id: Id): Promise<Tables[R]> {
  const [row] = await refreshRows(ref, [id]);
  return (row ?? need(ref, id)) as Tables[R];
}

/** A one-step create, still under an action key (an answer lost on the way may have saved). */
function createOne<R extends TableRef>(ref: R, values: RowValues): Promise<Outcome<Tables[R]>> {
  const run = newRun();
  return attemptSteps(run, () => [{ name: ref, run: (ctx) => insert(ref, { ...values, client_key: ctx.key }) }], (done) => done[ref] as Tables[R]);
}

/**
 * Read what an action builds on before it writes (a draft's lines, a
 * proposal's stage invoices), so it never acts on a partial picture; a read
 * that fails is answered like a refused write.
 */
async function after<T>(read: () => Promise<unknown>, then: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  try {
    await read();
  } catch (error) {
    return refusalOf<T>(error);
  }
  return then();
}

const linesRead = (table: "proposal_lines" | "invoice_lines", id: Id | null) => (id === null ? Promise.resolve() : loadWhere(table, { column: "document_id", op: "eq", value: id }, "position.asc"));

const blank = (value: string | null | undefined): string | null => (value === null || value === undefined || value.trim() === "" ? null : value.trim());

// ── inputs ──────────────────────────────────────────────────────────────────

/** One line as typed in the composer or a sheet. Amounts are the person's own typing, as decimal text. */
export interface LineInput {
  /** A line already saved (editing a draft). */
  id?: Id;
  description: string;
  qty: string;
  rate: string;
  /** An amount off the line (the composer's discount). */
  discount?: string | null;
}

export interface ClientInput {
  company: string;
  contact_name: string;
  email: string;
  trade?: string | null;
  phone?: string | null;
  address?: string | null;
  tax_number?: string | null;
  terms?: ClientTerms | null;
  tax_rate?: string | null;
  language?: string | null;
  tint?: string | null;
}

const clientValues = (input: ClientInput): RowValues => ({
  company: input.company.trim(),
  contact_name: input.contact_name.trim(),
  email: input.email.trim(),
  trade: blank(input.trade),
  phone: blank(input.phone),
  address: blank(input.address),
  tax_number: blank(input.tax_number),
  terms: input.terms ?? null,
  tax_rate: blank(input.tax_rate),
  language: blank(input.language),
  tint: blank(input.tint),
});

const lineValues = (line: LineInput, position: number): RowValues => ({
  position,
  description: line.description.trim(),
  qty: blank(line.qty) ?? "1",
  rate: blank(line.rate),
  discount_kind: "amount",
  discount: blank(line.discount ?? null),
});

/**
 * The steps that make a document's lines what the draft says: lines no longer
 * there are removed, changed ones patched, new ones created (each with its
 * own key). Held lines are the document's lines the desk read.
 */
function lineSteps(table: "proposal_lines" | "invoice_lines", documentStep: string, lines: readonly LineInput[], heldLines: readonly { id: Id }[]): Step[] {
  const kept = new Set(lines.flatMap((l) => (l.id === undefined ? [] : [l.id])));
  const steps: Step[] = heldLines
    .filter((l) => !kept.has(l.id))
    .map((l) => ({ name: `${table}:remove:${String(l.id)}`, run: () => remove(table, l.id) }));
  lines.forEach((line, i) => {
    if (line.id !== undefined) {
      const id = line.id;
      steps.push({ name: `${table}:${String(id)}`, run: () => update(table, id, lineValues(line, i)) });
    } else {
      steps.push({
        name: `${table}:new:${String(i)}`,
        run: (ctx) => insert(table, { ...lineValues(line, i), document_id: ctx.result<{ id: Id }>(documentStep).id, client_key: ctx.key }),
      });
    }
  });
  return steps;
}

const linesOf = <R extends "proposal_lines" | "invoice_lines">(table: R, documentId: Id | null): Tables[R][] =>
  documentId === null ? [] : (rowsOf(useDesk.getState(), table) as Tables[R][]).filter((l) => (l as { document_id: Id }).document_id === documentId);

// ── enquiries ───────────────────────────────────────────────────────────────

export interface EnquiryInput {
  name: string;
  business?: string | null;
  email?: string | null;
  trade?: string | null;
  budget?: string | null;
  start_when?: string | null;
  source?: string | null;
  fit?: EnquiryFit | null;
  body?: string | null;
}

/** Log a call: a new enquiry (its number and received time are Adminium's). */
export function logCall(input: EnquiryInput): Promise<Outcome<Enquiry>> {
  return createOne("enquiries", {
    name: input.name.trim(),
    business: blank(input.business),
    email: blank(input.email),
    trade: blank(input.trade),
    budget: blank(input.budget),
    start_when: blank(input.start_when),
    source: blank(input.source),
    fit: input.fit ?? null,
    body: blank(input.body),
  });
}

export interface ReplyInput {
  to: string;
  language: string;
  subject: string | null;
  body: string;
}

/** Send a reply: the message (the outbox sends it) → the enquiry replied. */
export function sendEnquiryReply(enquiryId: Id, reply: ReplyInput): Promise<Outcome<Enquiry>> {
  const run = newRun();
  return attemptSteps(
    run,
    () => {
      const enquiry = need("enquiries", enquiryId);
      return [
        {
          name: "message",
          run: (ctx: StepContext) =>
            insert("messages", {
              kind: "enquiry-reply",
              status: "queued",
              to: reply.to.trim(),
              language: reply.language,
              enquiry_id: enquiryId,
              client_id: enquiry.client_id,
              subject_override: blank(reply.subject),
              body_override: reply.body,
              client_key: ctx.key,
            }),
        },
        { name: "enquiry", run: () => update("enquiries", enquiryId, { status: "replied" }) },
      ];
    },
    (done) => done["enquiry"] as Enquiry,
  );
}

/** Park it: back in 30 days (the studio's calendar). */
export function parkEnquiry(enquiryId: Id, day: Day = today()): Promise<Outcome<Enquiry>> {
  return attempt(() => update("enquiries", enquiryId, { status: "parked", parked_until: addDays(day, 30) }));
}

/** Not for us. */
export function declineEnquiry(enquiryId: Id): Promise<Outcome<Enquiry>> {
  return attempt(() => update("enquiries", enquiryId, { status: "declined" }));
}

// ── proposals and the composer ──────────────────────────────────────────────

export interface ProposalDraft {
  /** The draft being edited; null for a new proposal. */
  id: Id | null;
  /** The client: one on file, or a new one made on the first save. */
  client: { id: Id } | { new: ClientInput };
  title: string;
  scope: string | null;
  split: ProposalSplit;
  valid_until: Day | null;
  terms_version_id: Id | null;
  revision_of?: Id | null;
  lines: LineInput[];
  /** A proposal started from an enquiry: the enquiry moves on the first save. */
  enquiryId?: Id | null;
}

/** The steps that save a proposal draft, ending with the step named "proposal" read back. */
function proposalSaveSteps(draft: ProposalDraft): Step[] {
  const steps: Step[] = [];
  if ("new" in draft.client) {
    const input = draft.client.new;
    steps.push({ name: "client", run: (ctx) => insert("clients", { ...clientValues(input), client_key: ctx.key }) });
  }
  const clientId = (ctx: StepContext): Id => ("id" in draft.client ? draft.client.id : ctx.result<Client>("client").id);
  const values = (ctx: StepContext): RowValues => ({
    client_id: clientId(ctx),
    title: draft.title.trim(),
    scope: blank(draft.scope),
    split: draft.split,
    valid_until: draft.valid_until,
    terms_version_id: draft.terms_version_id,
    revision_of: draft.revision_of ?? null,
  });
  const draftId = draft.id;
  steps.push(
    draftId === null
      ? { name: "proposal", run: (ctx) => insert("proposals", { ...values(ctx), client_key: ctx.key }) }
      : { name: "proposal", run: (ctx) => update("proposals", draftId, values(ctx)) },
  );
  steps.push(...lineSteps("proposal_lines", "proposal", draft.lines, linesOf("proposal_lines", draftId)));
  const enquiryId = draft.enquiryId ?? null;
  // The enquiry moves on the proposal's FIRST save only, never before it exists.
  if (enquiryId !== null && draftId === null) {
    steps.push({ name: "enquiry", run: (ctx) => update("enquiries", enquiryId, { client_id: clientId(ctx), proposal_id: ctx.result<Proposal>("proposal").id, status: "proposal" }) });
  }
  return steps;
}

/** Save as draft (new or edited): the proposal and its lines, read back with its totals. */
export function saveProposal(draft: ProposalDraft): Promise<Outcome<Proposal>> {
  const run = newRun();
  return after(
    () => linesRead("proposal_lines", draft.id),
    () => attemptSteps(run, () => proposalSaveSteps(draft), (done) => reread("proposals", (done["proposal"] as Proposal).id)),
  );
}

/**
 * Send: save the draft, then the move to sent (Adminium refuses an empty one:
 * the move names the lines it requires). A revision's send then withdraws the proposal it revises.
 */
export function sendProposal(draft: ProposalDraft, opts: { replacedReason: string }): Promise<Outcome<Proposal>> {
  const run = newRun();
  return after(() => linesRead("proposal_lines", draft.id), () => attemptSteps(
    run,
    () => {
      const steps = proposalSaveSteps(draft);
      steps.push({ name: "send", run: (ctx) => update("proposals", ctx.result<Proposal>("proposal").id, { status: "sent" }) });
      const original = draft.revision_of ?? null;
      // Only a proposal still out with the client is withdrawn; a declined or
      // withdrawn one keeps its own decision.
      if (original !== null && held("proposals", original)?.status === "sent") {
        steps.push({ name: "withdraw-original", run: () => update("proposals", original, { status: "withdrawn", withdraw_reason: opts.replacedReason }) });
      }
      return steps;
    },
    (done) => reread("proposals", (done["proposal"] as Proposal).id),
  ));
}

/** Send a reminder about a sent proposal (the outbox sends it). */
export function sendProposalReminder(proposalId: Id): Promise<Outcome<Message>> {
  const proposal = held("proposals", proposalId);
  return createOne("messages", { kind: "proposal-reminder", status: "queued", proposal_id: proposalId, client_id: proposal?.client_id ?? null });
}

/** Extend: a later valid-until (Adminium refuses an earlier one). */
export function extendProposal(proposalId: Id, validUntil: Day): Promise<Outcome<Proposal>> {
  return attempt(() => update("proposals", proposalId, { valid_until: validUntil }));
}

/** Withdraw a sent proposal, with the studio's reason. */
export function withdrawProposal(proposalId: Id, reason: string): Promise<Outcome<Proposal>> {
  return attempt(() => update("proposals", proposalId, { status: "withdrawn", withdraw_reason: reason.trim() }));
}

/** Make a revision: a new draft (`revision_of`) → the lines copied. Its number is Adminium's. */
export function makeRevision(proposalId: Id): Promise<Outcome<Proposal>> {
  const run = newRun();
  return after(() => Promise.all([ensureRows("proposals", [proposalId]), linesRead("proposal_lines", proposalId)]), () => attemptSteps(
    run,
    () => {
      const original = need("proposals", proposalId);
      const lines = linesOf("proposal_lines", proposalId).sort((a, b) => a.position - b.position);
      return [
        {
          name: "proposal",
          run: (ctx: StepContext) =>
            insert("proposals", {
              client_id: original.client_id,
              title: original.title,
              scope: original.scope,
              split: original.split,
              // A revision is offered afresh: three weeks from today.
              valid_until: addDays(today(), 21),
              terms_version_id: original.terms_version_id,
              revision_of: proposalId,
              client_key: ctx.key,
            }),
        },
        ...lines.map((line: ProposalLine) => ({
          name: `line:${String(line.id)}`,
          run: (ctx: StepContext) =>
            insert("proposal_lines", {
              document_id: ctx.result<Proposal>("proposal").id,
              position: line.position,
              description: line.description,
              qty: line.qty,
              rate: line.rate,
              discount_kind: line.discount_kind,
              discount: line.discount,
              client_key: ctx.key,
            }),
        })),
      ];
    },
    (done) => reread("proposals", (done["proposal"] as Proposal).id),
  ));
}

// ── starting the work ───────────────────────────────────────────────────────

export interface MilestoneInput {
  title: string;
  due_on: Day | null;
}

export interface StageInput {
  /** The share of the accepted proposal this invoice is, as decimal text ("50", "40"). */
  share_pct: string;
  /** The stage's name, in the studio's words ("Deposit"). */
  stage: string;
  /** The invoice's title. */
  title: string;
  /** The line's description. */
  description: string;
}

/** The steps that draft a stage invoice from a proposal: the draft, then its one line. */
function stageSteps(proposal: Proposal, projectId: (ctx: StepContext) => Id, stage: StageInput): Step[] {
  return [
    {
      name: "invoice",
      run: (ctx) =>
        insert("invoices", {
          client_id: proposal.client_id,
          project_id: projectId(ctx),
          proposal_id: proposal.id,
          from_quote_id: proposal.id,
          share_pct: stage.share_pct.trim(),
          // A stage is billed before tax, and taxed once, here, at the proposal's rate.
          tax_rate: proposal.tax_rate,
          stage: stage.stage.trim(),
          title: stage.title.trim(),
          client_key: ctx.key,
        }),
    },
    {
      name: "line",
      // Adminium copies the rate from the proposal's stored SUBTOTAL (tax is added once, on the invoice)
      // and works the amount out from the share.
      run: (ctx) => insert("invoice_lines", { document_id: ctx.result<Invoice>("invoice").id, quote_id: proposal.id, position: 0, description: stage.description.trim(), client_key: ctx.key }),
    },
  ];
}

/** The share already drafted or sent from a proposal (void invoices left out), as a number for the guard. */
function sharedSoFar(proposalId: Id): number {
  return rowsOf(useDesk.getState(), "invoices")
    .filter((i) => i.from_quote_id === proposalId && i.status !== "void")
    .reduce((sum, i) => sum + (decimalValue(i.share_pct) ?? 0), 0);
}

function overShare(proposalId: Id, share: string): boolean {
  return sharedSoFar(proposalId) + (decimalValue(share) ?? 0) > 100 + 1e-9;
}

/** A proposal's stage invoices, read before a share is checked against them. */
const stagesRead = (proposalId: Id) => Promise.all([ensureRows("proposals", [proposalId]), loadWhere("invoices", { column: "from_quote_id", op: "eq", value: proposalId }, "id.asc", 50)]);

const overShareRefusal = <T>(): Outcome<T> => ({ ok: false, reason: "over-share", code: "OVER_SHARE", field: "share_pct", details: {}, unfinished: null });

export interface StartProjectInput {
  name: string;
  milestones: MilestoneInput[];
  firstStage: StageInput;
}

/**
 * Start the project from an accepted proposal: the project → its milestones →
 * the first stage's invoice draft → its line. One project per proposal
 * (Adminium's unique index says so).
 */
export function startProject(proposalId: Id, input: StartProjectInput): Promise<Outcome<{ project: Project; invoice: Invoice }>> {
  const run = newRun();
  const steps = (): Step[] => {
    const proposal = need("proposals", proposalId);
    return [
      { name: "project", run: (ctx) => insert("projects", { client_id: proposal.client_id, proposal_id: proposalId, name: input.name.trim(), client_key: ctx.key }) },
      ...input.milestones.map((m, i): Step => ({
        name: `milestone:${String(i)}`,
        // The first milestone is the one under way.
        run: (ctx) => insert("milestones", { project_id: ctx.result<Project>("project").id, title: m.title.trim(), due_on: m.due_on, state: i === 0 ? "now" : "next", position: i, client_key: ctx.key }),
      })),
      ...stageSteps(proposal, (ctx) => ctx.result<Project>("project").id, input.firstStage),
    ];
  };
  return after(
    () => stagesRead(proposalId),
    async () =>
      overShare(proposalId, input.firstStage.share_pct)
        ? overShareRefusal()
        : attemptSteps(run, steps, async (done) => ({ project: done["project"] as Project, invoice: await reread("invoices", (done["invoice"] as Invoice).id) })),
  );
}

/**
 * Invoice the next stage (and "Draft it" when a project started without its
 * first invoice): the draft → its line. Shares never pass the whole proposal.
 */
export function draftStageInvoice(projectId: Id, stage: StageInput): Promise<Outcome<Invoice>> {
  const run = newRun();
  const proposalOf = (): Id | null => held("projects", projectId)?.proposal_id ?? null;
  const steps = (): Step[] => {
    const proposalId = proposalOf();
    if (proposalId === null) gone();
    return stageSteps(need("proposals", proposalId as Id), () => projectId, stage);
  };
  return after(
    async () => {
      await ensureRows("projects", [projectId]);
      const proposalId = proposalOf();
      if (proposalId !== null) await stagesRead(proposalId);
    },
    async () => {
      const proposalId = proposalOf();
      if (proposalId !== null && overShare(proposalId, stage.share_pct)) return overShareRefusal();
      return attemptSteps(run, steps, (done) => reread("invoices", (done["invoice"] as Invoice).id));
    },
  );
}

// ── invoices ────────────────────────────────────────────────────────────────

export interface InvoiceDraft {
  id: Id | null;
  client_id: Id;
  project_id: Id | null;
  title: string | null;
  terms?: ClientTerms | null;
  lines: LineInput[];
}

function invoiceSaveSteps(draft: InvoiceDraft): Step[] {
  const values: RowValues = { client_id: draft.client_id, project_id: draft.project_id, title: blank(draft.title), ...(draft.terms === undefined ? {} : { terms: draft.terms }) };
  const draftId = draft.id;
  return [
    draftId === null ? { name: "invoice", run: (ctx) => insert("invoices", { ...values, client_key: ctx.key }) } : { name: "invoice", run: () => update("invoices", draftId, values) },
    ...lineSteps("invoice_lines", "invoice", draft.lines, linesOf("invoice_lines", draftId)),
  ];
}

/** New invoice (the add sheet) or save a draft: the invoice → its lines. Its number is Adminium's. */
export function saveInvoice(draft: InvoiceDraft): Promise<Outcome<Invoice>> {
  const run = newRun();
  return after(
    () => linesRead("invoice_lines", draft.id),
    () => attemptSteps(run, () => invoiceSaveSteps(draft), (done) => reread("invoices", (done["invoice"] as Invoice).id)),
  );
}

/** Send: save the draft, then the move to sent (issued and due dates are Adminium's stamps). */
export function sendInvoice(draft: InvoiceDraft): Promise<Outcome<Invoice>> {
  const run = newRun();
  return after(
    () => linesRead("invoice_lines", draft.id),
    () =>
      attemptSteps(
        run,
        () => [...invoiceSaveSteps(draft), { name: "send", run: (ctx: StepContext) => update("invoices", ctx.result<Invoice>("invoice").id, { status: "sent" }) }],
        (done) => reread("invoices", (done["invoice"] as Invoice).id),
      ),
  );
}

/** Send a saved draft as it is. */
export function sendSavedInvoice(invoiceId: Id): Promise<Outcome<Invoice>> {
  return attempt(async () => {
    await update("invoices", invoiceId, { status: "sent" });
    return reread("invoices", invoiceId);
  });
}

export interface PaymentInput {
  /** As typed, decimal text. More than the balance is Adminium's to refuse. */
  amount: string;
  method: PaymentMethod;
  paid_on: Day;
  method_note?: string | null;
}

/**
 * Record a payment: one create (its receipt number is Adminium's); the
 * invoice is read back for its paid and balance, which also clears what the
 * client said they sent. Refused as over the balance, the invoice is read
 * again so the sheet shows what is really owed.
 */
export async function recordPayment(invoiceId: Id, input: PaymentInput): Promise<Outcome<{ payment: Payment; invoice: Invoice }>> {
  const run = newRun();
  const outcome = await attemptSteps(
    run,
    () => [
      {
        name: "payment",
        run: (ctx: StepContext) =>
          insert("payments", { document_id: invoiceId, amount: input.amount.trim(), method: input.method, paid_on: input.paid_on, method_note: blank(input.method_note), client_key: ctx.key }),
      },
    ],
    async (done) => ({ payment: done["payment"] as Payment, invoice: await reread("invoices", invoiceId) }),
  );
  if (!outcome.ok && outcome.reason === "balance") await refreshRows("invoices", [invoiceId]).catch(() => undefined);
  return outcome;
}

/** Void a payment (a studio manager), with the reason; the invoice is read back. */
export function voidPayment(paymentId: Id, reason: string): Promise<Outcome<Payment>> {
  return attempt(async () => {
    const payment = await update("payments", paymentId, { voided: true, void_reason: reason.trim() });
    await reread("invoices", payment.document_id);
    return payment;
  });
}

/** Void an invoice (a studio manager; Adminium refuses once anything is paid). */
export function voidInvoice(invoiceId: Id, reason: string): Promise<Outcome<Invoice>> {
  return attempt(() => update("invoices", invoiceId, { status: "void", void_reason: reason.trim() }));
}

/** The reason a discarded draft carries (the client never sees a draft, or its reason). */
export const DISCARDED_DRAFT = "Discarded draft";

/** Discard a draft invoice (a studio manager): numbered drafts are voided, never deleted. */
export function discardDraft(invoiceId: Id): Promise<Outcome<Invoice>> {
  return attempt(() => update("invoices", invoiceId, { status: "void", void_reason: DISCARDED_DRAFT }));
}

/** Change an invoice's chasing ladder (Adminium re-dates the rungs not yet sent). */
export function setLadder(invoiceId: Id, ladder: InvoiceLadder): Promise<Outcome<Invoice>> {
  return attempt(() => update("invoices", invoiceId, { ladder }));
}

// ── chasing ─────────────────────────────────────────────────────────────────

export interface Wording {
  subject: string | null;
  body: string | null;
}

/** Approve and send a held rung, with the studio's wording when it was edited. */
export function approveRung(messageId: Id, wording?: Wording): Promise<Outcome<Message>> {
  return attempt(() =>
    update("messages", messageId, {
      status: "queued",
      ...(wording === undefined ? {} : { subject_override: blank(wording.subject), body_override: blank(wording.body) }),
    }),
  );
}

/** Edit a held rung's wording; it stays held. */
export function editRung(messageId: Id, wording: Wording): Promise<Outcome<Message>> {
  return attempt(() => update("messages", messageId, { subject_override: blank(wording.subject), body_override: blank(wording.body) }));
}

/** Send a rung early: queued now. */
export function sendRungEarly(messageId: Id, at: number = now()): Promise<Outcome<Message>> {
  return attempt(() => update("messages", messageId, { status: "queued", due: new Date(at).toISOString() }));
}

/** Skip a rung, by hand. */
export function skipRung(messageId: Id): Promise<Outcome<Message>> {
  // Adminium writes why ("by-hand"): a reason a person sends is refused.
  return attempt(() => update("messages", messageId, { status: "skipped" }));
}

/**
 * The rungs "Send all" would approve: held, due, one per invoice — its LATEST
 * due one, since a later rung overtakes an earlier one still waiting.
 */
export function readyRungs(at: number = now()): Message[] {
  const byInvoice = new Map<Id, Message>();
  for (const message of rowsOf(useDesk.getState(), "messages")) {
    if (message.status !== "held" || !/^invoice-rung-\d$/.test(message.kind) || message.invoice_id === null) continue;
    if (message.due !== null && Date.parse(message.due) > at) continue;
    const earlier = byInvoice.get(message.invoice_id);
    if (earlier === undefined || (message.due ?? "") > (earlier.due ?? "")) byInvoice.set(message.invoice_id, message);
  }
  return [...byInvoice.values()];
}

/** Send all: approve only the rungs that are ready, one per invoice. */
export function sendAllReady(at: number = now()): Promise<Outcome<Message[]>> {
  const rungs = readyRungs(at);
  const run = newRun();
  return attemptSteps(
    run,
    () => rungs.map((m) => ({ name: `rung:${String(m.id)}`, run: () => update("messages", m.id, { status: "queued" }) })),
    (done) => Object.values(done) as Message[],
  );
}

// ── projects ────────────────────────────────────────────────────────────────

/** New project (no proposal): the project → its first milestone. */
export function newProject(input: { client_id: Id; name: string; milestone: MilestoneInput }): Promise<Outcome<Project>> {
  const run = newRun();
  return attemptSteps(
    run,
    () => [
      { name: "project", run: (ctx: StepContext) => insert("projects", { client_id: input.client_id, name: input.name.trim(), client_key: ctx.key }) },
      {
        name: "milestone",
        run: (ctx: StepContext) => insert("milestones", { project_id: ctx.result<Project>("project").id, title: input.milestone.title.trim(), due_on: input.milestone.due_on, position: 0, client_key: ctx.key }),
      },
    ],
    (done) => done["project"] as Project,
  );
}

export type ProjectMove = "pause" | "resume" | "done" | "reopen";

/** Pause (with a note) / Resume / Mark done / Reopen (a studio manager's; Adminium checks the role). */
export function moveProject(projectId: Id, move: ProjectMove, note?: string | null): Promise<Outcome<Project>> {
  const patch: RowValues =
    move === "pause" ? { status: "paused", pause_note: blank(note ?? null) } : move === "resume" ? { status: "active", pause_note: null } : move === "done" ? { status: "done" } : { status: "active", done_on: null };
  return attempt(() => update("projects", projectId, patch));
}

/**
 * Mark done: every open milestone closes, then the project moves to done —
 * LAST, so a project never reads done with work still open. Finishing after a
 * failure closes only what is still open.
 */
export function markProjectDone(projectId: Id): Promise<Outcome<Project>> {
  const run = newRun();
  return after(
    () => Promise.all([ensureRows("projects", [projectId]), loadWhere("milestones", { column: "project_id", op: "eq", value: projectId }, "position.asc")]),
    () =>
      attemptSteps(
        run,
        () => [
          ...rowsOf(useDesk.getState(), "milestones")
            .filter((m) => m.project_id === projectId && m.state !== "done")
            .map((m): Step => ({ name: `milestone:${String(m.id)}`, run: () => update("milestones", m.id, { state: "done" }) })),
          { name: "done", run: () => update("projects", projectId, { status: "done" }) },
        ],
        (done) => done["done"] as Project,
      ),
  );
}

export function addMilestone(projectId: Id, input: MilestoneInput & { position: number }): Promise<Outcome<Milestone>> {
  return createOne("milestones", { project_id: projectId, title: input.title.trim(), due_on: input.due_on, position: input.position });
}

export function editMilestone(milestoneId: Id, patch: Partial<MilestoneInput> & { position?: number }): Promise<Outcome<Milestone>> {
  return attempt(() => update("milestones", milestoneId, { ...patch, ...(patch.title === undefined ? {} : { title: patch.title.trim() }) }));
}

export function setMilestoneState(milestoneId: Id, state: MilestoneState): Promise<Outcome<Milestone>> {
  return attempt(() => update("milestones", milestoneId, { state }));
}

export function removeMilestone(milestoneId: Id): Promise<Outcome<void>> {
  return attempt(() => remove("milestones", milestoneId));
}

/** A version's content: a file to upload, or a link. */
export type VersionContent = { file: Blob; filename: string } | { link: string };

function versionSteps(deliverableStep: string | Id, content: VersionContent, note: string | null): Step[] {
  const deliverableId = (ctx: StepContext): Id => (typeof deliverableStep === "number" ? deliverableStep : ctx.result<Deliverable>(deliverableStep).id);
  const steps: Step[] = [];
  if ("file" in content) steps.push({ name: "upload", run: () => deskWrites().upload("deliverable_versions", "file", content.file, content.filename) });
  steps.push({
    name: "version",
    run: (ctx) =>
      insert("deliverable_versions", {
        deliverable_id: deliverableId(ctx),
        ...("file" in content ? { file: ctx.result<string>("upload") } : { link: content.link.trim() }),
        note: blank(note),
        client_key: ctx.key,
      }),
  });
  return steps;
}

export interface DeliverableInput {
  title: string;
  milestone_id: Id | null;
  icon?: string | null;
  position: number;
  content: VersionContent;
  note: string | null;
  /** Share with the client now (else it is saved unshared). */
  share: boolean;
}

/** Add deliverable: the deliverable → its file → version 1 → shared (last, so the client never sees one half-made). */
export function addDeliverable(projectId: Id, input: DeliverableInput): Promise<Outcome<Deliverable>> {
  const run = newRun();
  return attemptSteps(
    run,
    () => [
      {
        name: "deliverable",
        run: (ctx: StepContext) => insert("deliverables", { project_id: projectId, milestone_id: input.milestone_id, title: input.title.trim(), icon: blank(input.icon ?? null), position: input.position, client_key: ctx.key }),
      },
      ...versionSteps("deliverable", input.content, input.note),
      ...(input.share ? [{ name: "share", run: (ctx: StepContext) => update("deliverables", ctx.result<Deliverable>("deliverable").id, { status: "pending" }) }] : []),
    ],
    (done) => reread("deliverables", (done["deliverable"] as Deliverable).id),
  );
}

/** Share an unshared deliverable (its "shared" stamp is Adminium's; the new-work email is batched). */
export function shareDeliverable(deliverableId: Id): Promise<Outcome<Deliverable>> {
  return attempt(() => update("deliverables", deliverableId, { status: "pending" }));
}

/** Post a new version: the file → the version (its number is Adminium's) → back to pending. */
export function postVersion(deliverableId: Id, content: VersionContent, note: string | null): Promise<Outcome<{ version: DeliverableVersion; deliverable: Deliverable }>> {
  const run = newRun();
  return after(() => ensureRows("deliverables", [deliverableId]), () => attemptSteps(
    run,
    () => {
      const deliverable = need("deliverables", deliverableId);
      return [
        ...versionSteps(deliverableId, content, note),
        ...(deliverable.status === "pending" || deliverable.status === "unshared" ? [] : [{ name: "pending", run: () => update("deliverables", deliverableId, { status: "pending" }) }]),
      ];
    },
    async (done) => ({ version: done["version"] as DeliverableVersion, deliverable: await reread("deliverables", deliverableId) }),
  ));
}

/** A studio note on a deliverable (a pin when it has one); who and when are Adminium's. */
export function addStudioNote(deliverableId: Id, note: { version_id: Id | null; body: string; pin_x?: string | null; pin_y?: string | null }): Promise<Outcome<DeliverableNote>> {
  return createOne("deliverable_notes", { deliverable_id: deliverableId, version_id: note.version_id, body: note.body.trim(), pin_x: note.pin_x ?? null, pin_y: note.pin_y ?? null });
}

/** Mark approved (by email, on a call, in a meeting), also over changes asked — the screen confirms first. */
export function markApproved(deliverableId: Id, how: Exclude<DeliverableApprovedHow, "portal">, on: Day): Promise<Outcome<Deliverable>> {
  return attempt(() => update("deliverables", deliverableId, { status: "approved", approved_how: how, approved_on: on }));
}

// ── the handover ────────────────────────────────────────────────────────────

export function saveHandoverNotes(projectId: Id, notes: string): Promise<Outcome<Project>> {
  return attempt(() => update("projects", projectId, { handover_notes: blank(notes) }));
}

export function addFont(projectId: Id, font: { name: string; licence: string | null; position: number }): Promise<Outcome<ProjectFont>> {
  return createOne("project_fonts", { project_id: projectId, name: font.name.trim(), licence: blank(font.licence), position: font.position });
}

export function editFont(fontId: Id, patch: { name?: string; licence?: string | null; position?: number }): Promise<Outcome<ProjectFont>> {
  return attempt(() => update("project_fonts", fontId, patch));
}

export function removeFont(fontId: Id): Promise<Outcome<void>> {
  return attempt(() => remove("project_fonts", fontId));
}

/** Add a file to the handover: the upload → the row. */
export function addHandoverFile(projectId: Id, input: { file: Blob; filename: string; note: string | null; position: number }): Promise<Outcome<HandoverFile>> {
  const run = newRun();
  return attemptSteps(
    run,
    () => [
      { name: "upload", run: () => deskWrites().upload("handover_files", "file", input.file, input.filename) },
      { name: "file", run: (ctx: StepContext) => insert("handover_files", { project_id: projectId, file: ctx.result<string>("upload"), note: blank(input.note), position: input.position, client_key: ctx.key }) },
    ],
    (done) => done["file"] as HandoverFile,
  );
}

export function removeHandoverFile(fileId: Id): Promise<Outcome<void>> {
  return attempt(() => remove("handover_files", fileId));
}

/** The share link's expiry: a day, or null for never. */
export function setShareExpiry(projectId: Id, expiresOn: Day | null): Promise<Outcome<Project>> {
  return attempt(() => update("projects", projectId, { share_expires_on: expiresOn }));
}

/** Stop the share link (its "stopped on" is Adminium's stamp). */
export function stopShareLink(projectId: Id): Promise<Outcome<Project>> {
  return attempt(() => update("projects", projectId, { share_stopped: true }));
}

/** Make a new link: the server makes a new code (the old one stops working), then the link is live again. */
export function newShareLink(projectId: Id): Promise<Outcome<Project>> {
  const run = newRun();
  return after(() => ensureRows("projects", [projectId]), () => attemptSteps(
    run,
    () => [
      {
        name: "code",
        run: async () => {
          const row = await deskWrites().regenerateCode("projects", projectId, "share_token");
          upsert("projects", { ...row, id: projectId });
          return row;
        },
      },
      ...(held("projects", projectId)?.share_stopped === true ? [{ name: "live", run: () => update("projects", projectId, { share_stopped: false }) }] : []),
    ],
    () => need("projects", projectId),
  ));
}

/** Send the handover: the message → the project's handover marked sent. */
export function sendHandover(projectId: Id): Promise<Outcome<Project>> {
  const run = newRun();
  return after(() => ensureRows("projects", [projectId]), () => attemptSteps(
    run,
    () => {
      const project = need("projects", projectId);
      return [
        { name: "message", run: (ctx: StepContext) => insert("messages", { kind: "handover", status: "queued", project_id: projectId, client_id: project.client_id, client_key: ctx.key }) },
        { name: "sent", run: () => update("projects", projectId, { handover_sent: true }) },
      ];
    },
    (done) => done["sent"] as Project,
  ));
}

// ── clients ─────────────────────────────────────────────────────────────────

export function addClient(input: ClientInput): Promise<Outcome<Client>> {
  return createOne("clients", clientValues(input));
}

export function editClient(clientId: Id, patch: Partial<ClientInput>): Promise<Outcome<Client>> {
  const values: RowValues = {};
  for (const [key, value] of Object.entries(patch)) values[key] = typeof value === "string" ? blank(value) : value;
  return attempt(() => update("clients", clientId, values));
}

/** A private note on a client (who and when are Adminium's). */
export function addClientNote(clientId: Id, body: string): Promise<Outcome<Tables["client_notes"]>> {
  return attempt(() => insert("client_notes", { client_id: clientId, body: body.trim() }));
}

// ── terms ───────────────────────────────────────────────────────────────────

export interface ClauseInput {
  title: string;
  body: string | null;
  change: TermsClauseChange;
  change_note: string | null;
}

/** A new terms version: the version (its number is Adminium's) → its full clause list. */
export function newTermsVersion(input: { in_force_from: Day | null; note: string | null; clauses: ClauseInput[] }): Promise<Outcome<TermsVersion>> {
  const run = newRun();
  return attemptSteps(
    run,
    () => [
      { name: "version", run: (ctx: StepContext) => insert("terms_versions", { in_force_from: input.in_force_from, note: blank(input.note), client_key: ctx.key }) },
      ...input.clauses.map((clause, i) => ({
        name: `clause:${String(i)}`,
        run: (ctx: StepContext) =>
          insert("terms_clauses", { version_id: ctx.result<TermsVersion>("version").id, position: i, title: clause.title.trim(), body: blank(clause.body), change: clause.change, change_note: blank(clause.change_note), client_key: ctx.key }),
      })),
    ],
    (done) => done["version"] as TermsVersion,
  );
}

/** Put a version in force: the one in force now retires first, then this one moves in. */
export function putTermsInForce(versionId: Id): Promise<Outcome<TermsVersion>> {
  const run = newRun();
  return attemptSteps(
    run,
    () => [
      ...rowsOf(useDesk.getState(), "terms_versions")
        .filter((v) => v.status === "in_force" && v.id !== versionId)
        .map((v) => ({ name: `retire:${String(v.id)}`, run: () => update("terms_versions", v.id, { status: "retired" }) })),
      {
        name: "in-force",
        // A version put in force with no start day starts today, on the studio's calendar.
        run: () => update("terms_versions", versionId, { status: "in_force", ...(held("terms_versions", versionId)?.in_force_from == null ? { in_force_from: today() } : {}) }),
      },
    ],
    (done) => done["in-force"] as TermsVersion,
  );
}

/** A version's note and the day it is in force from, after it was made (a locked version is Adminium's to refuse). */
export function editTermsVersion(versionId: Id, patch: { note?: string | null; in_force_from?: Day | null }): Promise<Outcome<TermsVersion>> {
  return attempt(() =>
    update("terms_versions", versionId, {
      ...(patch.note === undefined ? {} : { note: blank(patch.note) }),
      ...(patch.in_force_from === undefined ? {} : { in_force_from: patch.in_force_from }),
    }),
  );
}

export function addClause(versionId: Id, clause: ClauseInput & { position: number }): Promise<Outcome<TermsClause>> {
  return createOne("terms_clauses", { version_id: versionId, position: clause.position, title: clause.title.trim(), body: blank(clause.body), change: clause.change, change_note: blank(clause.change_note) });
}

export function editClause(clauseId: Id, patch: Partial<ClauseInput> & { position?: number }): Promise<Outcome<TermsClause>> {
  return attempt(() => update("terms_clauses", clauseId, patch));
}

export function removeClause(clauseId: Id): Promise<Outcome<void>> {
  return attempt(() => remove("terms_clauses", clauseId));
}

/** Ask them to sign (a proposal accepted by email): the outbox sends the request. */
export function askToSign(proposalId: Id): Promise<Outcome<Message>> {
  const proposal = held("proposals", proposalId);
  return createOne("messages", { kind: "ask-to-sign", status: "queued", proposal_id: proposalId, client_id: proposal?.client_id ?? null });
}

// ── settings ────────────────────────────────────────────────────────────────

/** The studio card and the notice switches (a studio manager's). */
export function saveStudioSettings(patch: Partial<Omit<Settings, "id" | "singleton">>): Promise<Outcome<Settings>> {
  const settings = Object.values(useDesk.getState().rows.settings)[0];
  if (settings === undefined) return attempt(() => insert("settings", { ...patch }));
  return attempt(() => update("settings", settings.id, patch));
}

/** The studio's mark: the file uploaded for the settings row's `mark` column, then the row points at it. */
export function saveStudioMark(file: Blob, filename: string): Promise<Outcome<Settings>> {
  const run = newRun();
  return attemptSteps(
    run,
    () => [
      { name: "upload", run: () => deskWrites().upload("settings", "mark", file, filename) },
      {
        name: "mark",
        run: (ctx: StepContext) => {
          const settings = Object.values(useDesk.getState().rows.settings)[0];
          return settings === undefined ? insert("settings", { mark: ctx.result<string>("upload") }) : update("settings", settings.id, { mark: ctx.result<string>("upload") });
        },
      },
    ],
    (done) => done["mark"] as Settings,
  );
}

/** The Invoices & Receipts card (a studio manager holds the add-on's settings grant). */
export function saveInvoiceSettings(values: Record<string, unknown>): Promise<Outcome<Record<string, unknown>>> {
  return attempt(async () => {
    const saved = await deskWrites().saveAddOnSettings("invoices", values);
    // What the desk holds of the add-on's settings follows the save.
    useDesk.setState((s) => ({ addOns: { ...s.addOns, invoices: { values: saved, declared: s.addOns["invoices"]?.declared ?? Object.keys(saved) } } }));
    return saved;
  });
}

export function savePerson(personId: Id | null, input: Partial<Omit<Person, "id">>): Promise<Outcome<Person>> {
  return personId === null ? attempt(() => insert("people", input)) : attempt(() => update("people", personId, input));
}

export function removePerson(personId: Id): Promise<Outcome<void>> {
  return attempt(() => remove("people", personId));
}

export function saveRate(rateId: Id | null, input: Partial<Omit<Rate, "id">>): Promise<Outcome<Rate>> {
  return rateId === null ? attempt(() => insert("rates", input)) : attempt(() => update("rates", rateId, input));
}

export function removeRate(rateId: Id): Promise<Outcome<void>> {
  return attempt(() => remove("rates", rateId));
}

export function saveBriefQuestion(questionId: Id | null, input: Partial<Omit<BriefQuestion, "id">>): Promise<Outcome<BriefQuestion>> {
  return questionId === null ? attempt(() => insert("brief_questions", input)) : attempt(() => update("brief_questions", questionId, input));
}
