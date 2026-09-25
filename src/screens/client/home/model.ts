/**
 * The client's Home, worked out from their own rows: what is waiting on them,
 * where the work is, what happens next, every document they have and the
 * one figure at the foot of the list.
 *
 * "Waiting on you" holds only what the client can act on: an invoice with a
 * balance, a proposal still holding its price, a deliverable shared with them
 * and waiting for their review, and a brief not yet sent for a running
 * project. A draft, an unshared deliverable and a proposal past its date are
 * never on it. Totals leave void invoices and voided payments out.
 */
import type { Day, Decimal, Tables } from "../../../data/types.ts";
import { isPositive } from "../../../lib/money.ts";
import { canDecide, dayOf, isOpen, isOverdue, daysPastDue, leadProject, milestonesOf, paymentsOf, shownSum, versionFile, versionsOf } from "../shared/model.ts";

export interface HomeRows {
  today: Day;
  zone: string;
  proposals: Tables["proposals"][];
  projects: Tables["projects"][];
  milestones: Tables["milestones"][];
  deliverables: Tables["deliverables"][];
  versions: Tables["deliverable_versions"][];
  invoices: Tables["invoices"][];
  payments: Tables["payments"][];
  briefs: Tables["briefs"][];
}

export type Todo =
  | { kind: "invoice"; key: string; invoice: Tables["invoices"]; overdue: boolean; days: number }
  | { kind: "proposal"; key: string; proposal: Tables["proposals"] }
  | { kind: "review"; key: string; deliverable: Tables["deliverables"]; file: string; project: Tables["projects"] | undefined; sharedOn: Day | null }
  | { kind: "brief"; key: string; brief: Tables["briefs"]; project: Tables["projects"] };

/** Newest first, the way the documents are listed. */
const newest = <T extends { id: number }>(rows: readonly T[]): T[] => [...rows].sort((a, b) => b.id - a.id);

/** The invoices the client may see: sent ones, and void ones that were once sent. */
export const visibleInvoices = (rows: HomeRows): Tables["invoices"][] => newest(rows.invoices.filter((i) => i.status === "sent" || (i.status === "void" && i.issued_on !== null)));

/** The proposals the client may see: never a draft. */
export const visibleProposals = (rows: HomeRows): Tables["proposals"][] => newest(rows.proposals.filter((p) => p.status !== "draft"));

export function waitingOnYou(rows: HomeRows): Todo[] {
  const todo: Todo[] = [];
  for (const invoice of visibleInvoices(rows)) {
    if (!isOpen(invoice)) continue;
    todo.push({ kind: "invoice", key: `i${invoice.id}`, invoice, overdue: isOverdue(invoice, rows.today), days: daysPastDue(invoice, rows.today) });
  }
  for (const proposal of visibleProposals(rows)) {
    if (canDecide(proposal, rows.today)) todo.push({ kind: "proposal", key: `p${proposal.id}`, proposal });
  }
  for (const deliverable of rows.deliverables) {
    // Waiting for their review — shared with them by definition (an unshared one is never "pending").
    if (deliverable.status !== "pending") continue;
    const latest = versionsOf(rows.versions, deliverable.id)[0];
    todo.push({
      kind: "review",
      key: `d${deliverable.id}`,
      deliverable,
      file: versionFile(latest),
      project: rows.projects.find((p) => p.id === deliverable.project_id),
      sharedOn: dayOf(deliverable.shared_at, rows.zone),
    });
  }
  for (const brief of rows.briefs) {
    const project = rows.projects.find((p) => p.id === brief.project_id);
    if (brief.status === "open" && project !== undefined && project.status === "active") todo.push({ kind: "brief", key: `b${brief.id}`, brief, project });
  }
  return todo;
}

export type Doc =
  | { kind: "invoice"; key: string; invoice: Tables["invoices"]; settledOn: Day | null }
  | { kind: "proposal"; key: string; proposal: Tables["proposals"] };

/** Every document the client has: their invoices, then their proposals. */
export function documents(rows: HomeRows): Doc[] {
  const invoices: Doc[] = visibleInvoices(rows).map((invoice) => {
    const own = paymentsOf(rows.payments, invoice.id);
    return { kind: "invoice", key: `i${invoice.id}`, invoice, settledOn: own.length === 0 ? null : own[own.length - 1]!.paid_on };
  });
  const proposals: Doc[] = visibleProposals(rows).map((proposal) => ({ kind: "proposal", key: `p${proposal.id}`, proposal }));
  return [...invoices, ...proposals];
}

/**
 * The figure under the documents: what is still open (the stored balances of
 * sent invoices) while anything is, else what has been paid to date (unvoided
 * payments on invoices that are not void). A void invoice counts as neither.
 */
export function homeTotal(rows: HomeRows): { kind: "open" | "paid"; value: Decimal; overdue: boolean; currency: string | null } {
  const live = visibleInvoices(rows).filter((i) => i.status === "sent");
  const currency = live[0]?.currency ?? rows.invoices[0]?.currency ?? null;
  const open = shownSum(
    live.filter((i) => isPositive(i.balance)).map((i) => i.balance),
    currency,
  );
  if (isPositive(open)) return { kind: "open", value: open, overdue: live.some((i) => isOverdue(i, rows.today)), currency };
  const paid = shownSum(
    live.flatMap((i) => paymentsOf(rows.payments, i.id)).map((p) => p.amount),
    currency,
  );
  return { kind: "paid", value: paid, overdue: false, currency };
}

export type Step =
  | { kind: "milestone"; key: string; milestone: Tables["milestones"]; first: boolean }
  | { kind: "invoice"; key: string; invoice: Tables["invoices"]; overdue: boolean; days: number }
  | { kind: "handover"; key: string };

/**
 * What happens next: the next two milestones of the project Home leads with,
 * the next invoice to pay, and — while the work runs — the handover.
 */
export function nextSteps(rows: HomeRows): Step[] {
  const steps: Step[] = [];
  const project = leadProject(rows.projects);
  if (project !== undefined) {
    milestonesOf(rows.milestones, project.id)
      .filter((m) => m.state !== "done")
      .slice(0, 2)
      .forEach((milestone, i) => steps.push({ kind: "milestone", key: `m${milestone.id}`, milestone, first: i === 0 }));
  }
  const due = visibleInvoices(rows)
    .filter(isOpen)
    .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999"))[0];
  if (due !== undefined) steps.push({ kind: "invoice", key: `i${due.id}`, invoice: due, overdue: isOverdue(due, rows.today), days: daysPastDue(due, rows.today) });
  if (project !== undefined && project.status !== "done") steps.push({ kind: "handover", key: "handover" });
  return steps.slice(0, 4);
}
